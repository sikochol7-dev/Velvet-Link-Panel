import { Prisma } from '@prisma/client';

export class BulkUpdateUserUsedTrafficBuilder {
    public query: Prisma.Sql;

    constructor(list: { u: string; b: string; n: string }[]) {
        this.query = this.getQuery(list);
        return this;
    }

    public getQuery(list: { u: string; b: string; n: string }[]): Prisma.Sql {
        if (list.length === 0) {
            return Prisma.sql`SELECT NULL::uuid AS "id" WHERE FALSE`;
        }

        const values = Prisma.join(
            list.map((h) => Prisma.sql`(${h.b}::bigint, ${h.u}::bigint, ${h.n}::uuid)`),
        );

        // LTE nodes (node_balancer_settings.is_lte) are accounted in a separate quota:
        // their traffic is NOT added to user_traffic.used_traffic_bytes, but is added to
        // lte_user_quota.used_bytes. Lifetime counters, online_at and last node stay shared.
        return Prisma.sql`
        WITH data("inc_used","id","last_connected_node_uuid") AS (
          VALUES ${values}
        ),
        classified AS (
          SELECT
            d."id",
            d."inc_used",
            d."last_connected_node_uuid",
            COALESCE(s."is_lte", FALSE) AS "is_lte"
          FROM data d
          LEFT JOIN "node_balancer_settings" s
            ON s."node_uuid" = d."last_connected_node_uuid"
        ),
        locked AS (
          SELECT u."id"
          FROM classified c
          JOIN "user_traffic" u ON u."id" = c."id"
          ORDER BY u."id"
          FOR UPDATE OF u
        ),
        updated_users AS (
          UPDATE "user_traffic" AS u
          SET
            "used_traffic_bytes"          = u."used_traffic_bytes"
                                            + CASE WHEN c."is_lte" THEN 0 ELSE c."inc_used" END,
            "lifetime_used_traffic_bytes" = u."lifetime_used_traffic_bytes" + c."inc_used",
            "online_at"                   = NOW(),
            "first_connected_at"          = COALESCE(u."first_connected_at", NOW()),
            "last_connected_node_uuid"    = c."last_connected_node_uuid"
          FROM classified c
          JOIN locked l ON l."id" = c."id"
          WHERE c."id" = u."id"
          RETURNING
            u."id",
            (u."first_connected_at" = u."online_at") AS "isFirstConnection"
        ),
        lte_usage AS (
          INSERT INTO "lte_user_quota" ("user_id", "used_bytes", "lifetime_used_bytes", "updated_at")
          SELECT c."id", c."inc_used", c."inc_used", NOW()
          FROM classified c
          WHERE c."is_lte"
          ON CONFLICT ("user_id") DO UPDATE SET
            "used_bytes"          = "lte_user_quota"."used_bytes" + EXCLUDED."used_bytes",
            "lifetime_used_bytes" = "lte_user_quota"."lifetime_used_bytes" + EXCLUDED."lifetime_used_bytes",
            "updated_at"          = NOW()
        )
        SELECT "id" AS "id"
        FROM updated_users
        WHERE "isFirstConnection";
        `;
    }
}
