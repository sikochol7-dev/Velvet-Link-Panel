import { sql } from 'kysely';

import { Injectable } from '@nestjs/common';

import { TxKyselyService } from '@common/database';

import { TLteResetStrategy } from './lte-quota.constants';

export interface ILteQuotaRow {
    userId: bigint;
    limitBytes: bigint;
    usedBytes: bigint;
    lifetimeUsedBytes: bigint;
    resetStrategy: TLteResetStrategy;
    lastResetAt: Date | null;
    blockedAt: Date | null;
}

export interface INodeBalancerSettingsRow {
    nodeUuid: string;
    isLte: boolean;
    weight: number;
    maxOnline: number | null;
}

interface IRawQuotaRow {
    user_id: string;
    limit_bytes: string;
    used_bytes: string;
    lifetime_used_bytes: string;
    reset_strategy: TLteResetStrategy;
    last_reset_at: Date | null;
    blocked_at: Date | null;
}

/**
 * Raw SQL on purpose: tables are additive to upstream and this keeps the fork
 * independent from regenerated Kysely types.
 */
@Injectable()
export class LteQuotaRepository {
    constructor(private readonly qb: TxKyselyService) {}

    public async findUserIdByUsername(username: string): Promise<bigint | null> {
        const { rows } = await sql<{ id: string }>`
            SELECT "id" FROM "users" WHERE "username" = ${username} LIMIT 1
        `.execute(this.qb.kysely);

        return rows.length > 0 ? BigInt(rows[0].id) : null;
    }

    public async findByUserId(userId: bigint): Promise<ILteQuotaRow | null> {
        const { rows } = await sql<IRawQuotaRow>`
            SELECT * FROM "lte_user_quota" WHERE "user_id" = ${userId.toString()}::bigint
        `.execute(this.qb.kysely);

        return rows.length > 0 ? this.toRow(rows[0]) : null;
    }

    public async upsertLimit(
        userId: bigint,
        limitBytes: bigint,
        resetStrategy: TLteResetStrategy,
    ): Promise<ILteQuotaRow> {
        const { rows } = await sql<IRawQuotaRow>`
            INSERT INTO "lte_user_quota" ("user_id", "limit_bytes", "reset_strategy", "updated_at")
            VALUES (${userId.toString()}::bigint, ${limitBytes.toString()}::bigint, ${resetStrategy}, NOW())
            ON CONFLICT ("user_id") DO UPDATE SET
                "limit_bytes"    = EXCLUDED."limit_bytes",
                "reset_strategy" = EXCLUDED."reset_strategy",
                "updated_at"     = NOW()
            RETURNING *
        `.execute(this.qb.kysely);

        return this.toRow(rows[0]);
    }

    public async resetUserUsage(userId: bigint): Promise<void> {
        await sql`
            UPDATE "lte_user_quota"
            SET "used_bytes" = 0, "last_reset_at" = NOW(), "updated_at" = NOW()
            WHERE "user_id" = ${userId.toString()}::bigint
        `.execute(this.qb.kysely);
    }

    public async resetUsageByStrategy(strategy: TLteResetStrategy): Promise<number> {
        const { rows } = await sql<{ user_id: string }>`
            UPDATE "lte_user_quota"
            SET "used_bytes" = 0, "last_reset_at" = NOW(), "updated_at" = NOW()
            WHERE "reset_strategy" = ${strategy}
            RETURNING "user_id"
        `.execute(this.qb.kysely);

        return rows.length;
    }

    /** Marks users whose LTE quota is exhausted and returns their ids. */
    public async markExceeded(): Promise<bigint[]> {
        const { rows } = await sql<{ user_id: string }>`
            UPDATE "lte_user_quota"
            SET "blocked_at" = NOW(), "updated_at" = NOW()
            WHERE "limit_bytes" > 0
              AND "used_bytes" >= "limit_bytes"
              AND "blocked_at" IS NULL
            RETURNING "user_id"
        `.execute(this.qb.kysely);

        return rows.map((row) => BigInt(row.user_id));
    }

    /** Unblocks users that have quota again (after reset or after the limit was raised). */
    public async unmarkRestorable(): Promise<bigint[]> {
        const { rows } = await sql<{ user_id: string }>`
            UPDATE "lte_user_quota"
            SET "blocked_at" = NULL, "updated_at" = NOW()
            WHERE "blocked_at" IS NOT NULL
              AND ("limit_bytes" = 0 OR "used_bytes" < "limit_bytes")
            RETURNING "user_id"
        `.execute(this.qb.kysely);

        return rows.map((row) => BigInt(row.user_id));
    }

    public async removeFromSquad(squadUuid: string, userIds: bigint[]): Promise<void> {
        if (userIds.length === 0) return;

        await sql`
            DELETE FROM "internal_squad_members"
            WHERE "internal_squad_uuid" = ${squadUuid}::uuid
              AND "user_id" = ANY(${userIds.map(String)}::bigint[])
        `.execute(this.qb.kysely);
    }

    public async addToSquad(squadUuid: string, userIds: bigint[]): Promise<void> {
        if (userIds.length === 0) return;

        await sql`
            INSERT INTO "internal_squad_members" ("internal_squad_uuid", "user_id")
            SELECT ${squadUuid}::uuid, unnest(${userIds.map(String)}::bigint[])
            ON CONFLICT DO NOTHING
        `.execute(this.qb.kysely);
    }

    public async listNodeSettings(): Promise<INodeBalancerSettingsRow[]> {
        const { rows } = await sql<{
            node_uuid: string;
            is_lte: boolean;
            weight: number;
            max_online: number | null;
        }>`SELECT "node_uuid", "is_lte", "weight", "max_online" FROM "node_balancer_settings"`.execute(
            this.qb.kysely,
        );

        return rows.map((row) => ({
            nodeUuid: row.node_uuid,
            isLte: row.is_lte,
            weight: row.weight,
            maxOnline: row.max_online,
        }));
    }

    public async upsertNodeSettings(
        nodeUuid: string,
        data: { isLte: boolean; weight: number; maxOnline: number | null },
    ): Promise<INodeBalancerSettingsRow | null> {
        const exists = await sql<{ uuid: string }>`
            SELECT "uuid" FROM "nodes" WHERE "uuid" = ${nodeUuid}::uuid
        `.execute(this.qb.kysely);

        if (exists.rows.length === 0) return null;

        await sql`
            INSERT INTO "node_balancer_settings" ("node_uuid", "is_lte", "weight", "max_online", "updated_at")
            VALUES (${nodeUuid}::uuid, ${data.isLte}, ${data.weight}, ${data.maxOnline}, NOW())
            ON CONFLICT ("node_uuid") DO UPDATE SET
                "is_lte"     = EXCLUDED."is_lte",
                "weight"     = EXCLUDED."weight",
                "max_online" = EXCLUDED."max_online",
                "updated_at" = NOW()
        `.execute(this.qb.kysely);

        return { nodeUuid, ...data };
    }

    private toRow(raw: IRawQuotaRow): ILteQuotaRow {
        return {
            userId: BigInt(raw.user_id),
            limitBytes: BigInt(raw.limit_bytes),
            usedBytes: BigInt(raw.used_bytes),
            lifetimeUsedBytes: BigInt(raw.lifetime_used_bytes),
            resetStrategy: raw.reset_strategy,
            lastResetAt: raw.last_reset_at,
            blockedAt: raw.blocked_at,
        };
    }
}
