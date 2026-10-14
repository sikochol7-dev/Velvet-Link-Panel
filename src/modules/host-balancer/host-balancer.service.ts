import { sql } from 'kysely';

import { Injectable, Logger } from '@nestjs/common';

import { TxKyselyService } from '@common/database';
import { TypedConfigService } from '@common/config/app-config';

/** Hosts carrying this tag take part in balancing; all other hosts keep their position. */
export const HOST_BALANCER_TAG = 'LB';

const SNAPSHOT_TTL_MS = 5_000;
const JITTER = 0.2;

interface INodeState {
    usable: boolean;
    weight: number;
    maxOnline: number | null;
    online: number;
}

interface ISnapshot {
    takenAt: number;
    nodes: Map<string, INodeState>;
    hostNodes: Map<string, string[]>;
}

interface IBalancedHost {
    uuid: string;
    tags: string[];
}

/**
 * Orders hosts inside a subscription so clients try the least loaded healthy node first
 * and hosts on dead / full nodes sink to the end (fallback order).
 *
 * Opt-in: only hosts tagged `LB` are re-ordered, and only among the positions the `LB`
 * hosts already occupy. Nothing changes for installations that do not use the tag.
 */
@Injectable()
export class HostBalancerService {
    private readonly logger = new Logger(HostBalancerService.name);
    private readonly onlineWindowSeconds: number;

    private snapshot: ISnapshot | null = null;
    private inflight: Promise<ISnapshot> | null = null;

    constructor(
        private readonly qb: TxKyselyService,
        configService: TypedConfigService,
    ) {
        this.onlineWindowSeconds = configService.get('BALANCER_ONLINE_WINDOW_SECONDS');
    }

    public async arrange<T extends IBalancedHost>(hosts: T[]): Promise<T[]> {
        const balanced = hosts.filter((host) => host.tags.includes(HOST_BALANCER_TAG));
        if (balanced.length === 0) return hosts;

        let snapshot: ISnapshot;
        try {
            snapshot = await this.getSnapshot();
        } catch (error) {
            // never break subscriptions because of balancing
            this.logger.error(error);
            return hosts;
        }

        const alive: { host: T; score: number }[] = [];
        const dead: T[] = [];

        for (const host of balanced) {
            const score = this.scoreHost(host.uuid, snapshot);
            if (score === null) {
                dead.push(host);
            } else {
                alive.push({ host, score: score * (1 + (Math.random() - 0.5) * JITTER) });
            }
        }

        alive.sort((a, b) => a.score - b.score);

        const aliveQueue = alive.map((entry) => entry.host);
        const result: T[] = [];

        for (const host of hosts) {
            if (!host.tags.includes(HOST_BALANCER_TAG)) {
                result.push(host);
                continue;
            }

            const next = aliveQueue.shift();
            if (next) result.push(next);
        }

        return [...result, ...dead];
    }

    /** Lower is better; null = no usable node behind this host. */
    private scoreHost(hostUuid: string, snapshot: ISnapshot): number | null {
        const nodeUuids = snapshot.hostNodes.get(hostUuid);
        // host without bound nodes: we know nothing about it, keep it neutral
        if (!nodeUuids || nodeUuids.length === 0) return 1;

        let best: number | null = null;

        for (const nodeUuid of nodeUuids) {
            const node = snapshot.nodes.get(nodeUuid);
            if (!node || !node.usable) continue;
            if (node.maxOnline !== null && node.online >= node.maxOnline) continue;

            const load = node.online / Math.max(1, node.weight);
            if (best === null || load < best) best = load;
        }

        return best;
    }

    private getSnapshot(): Promise<ISnapshot> {
        if (this.snapshot && Date.now() - this.snapshot.takenAt < SNAPSHOT_TTL_MS) {
            return Promise.resolve(this.snapshot);
        }

        // one query per TTL window, concurrent subscription requests share it
        this.inflight ??= this.loadSnapshot()
            .then((snapshot) => {
                this.snapshot = snapshot;
                return snapshot;
            })
            .finally(() => {
                this.inflight = null;
            });

        return this.inflight;
    }

    private async loadSnapshot(): Promise<ISnapshot> {
        const nodesResult = await sql<{
            uuid: string;
            usable: boolean;
            weight: number;
            max_online: number | null;
            online: string;
        }>`
            WITH online AS (
                SELECT "last_connected_node_uuid" AS "node_uuid", COUNT(*) AS "cnt"
                FROM "user_traffic"
                WHERE "last_connected_node_uuid" IS NOT NULL
                  AND "online_at" > NOW() - make_interval(secs => ${this.onlineWindowSeconds})
                GROUP BY "last_connected_node_uuid"
            )
            SELECT
                n."uuid",
                (n."is_connected" AND NOT n."is_disabled" AND NOT n."is_connecting") AS "usable",
                COALESCE(s."weight", 100) AS "weight",
                s."max_online" AS "max_online",
                COALESCE(o."cnt", 0) AS "online"
            FROM "nodes" n
            LEFT JOIN "node_balancer_settings" s ON s."node_uuid" = n."uuid"
            LEFT JOIN online o ON o."node_uuid" = n."uuid"
        `.execute(this.qb.kysely);

        const linksResult = await sql<{ host_uuid: string; node_uuid: string }>`
            SELECT "host_uuid", "node_uuid" FROM "hosts_to_nodes"
        `.execute(this.qb.kysely);

        const nodes = new Map<string, INodeState>();
        for (const row of nodesResult.rows) {
            nodes.set(row.uuid, {
                usable: row.usable,
                weight: Number(row.weight),
                maxOnline: row.max_online === null ? null : Number(row.max_online),
                online: Number(row.online),
            });
        }

        const hostNodes = new Map<string, string[]>();
        for (const row of linksResult.rows) {
            const list = hostNodes.get(row.host_uuid);
            if (list) {
                list.push(row.node_uuid);
            } else {
                hostNodes.set(row.host_uuid, [row.node_uuid]);
            }
        }

        return { takenAt: Date.now(), nodes, hostNodes };
    }
}
