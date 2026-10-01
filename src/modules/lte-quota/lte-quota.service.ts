import { Injectable, Logger } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';

import { TypedConfigService } from '@common/config/app-config';

import { AddUsersToNodeEvent } from '@modules/nodes/events/add-users-to-node';

import { TLteResetStrategy } from './lte-quota.constants';
import {
    ILteQuotaRow,
    INodeBalancerSettingsRow,
    LteQuotaRepository,
} from './lte-quota.repository';

@Injectable()
export class LteQuotaService {
    private readonly logger = new Logger(LteQuotaService.name);
    private readonly squadUuid: string;

    constructor(
        private readonly repository: LteQuotaRepository,
        private readonly eventBus: EventBus,
        configService: TypedConfigService,
    ) {
        this.squadUuid = configService.get('LTE_INTERNAL_SQUAD_UUID');

        if (!this.squadUuid) {
            this.logger.warn(
                'LTE_INTERNAL_SQUAD_UUID is empty: LTE usage is counted, but users are not cut off when the quota is exhausted.',
            );
        }
    }

    /**
     * Cuts off users whose LTE quota is exhausted and restores users that have quota again.
     * Access is revoked by removing the user from the LTE internal squad, which goes through
     * the regular AddUsersToNodeEvent flow (the node drops users that lost their inbounds).
     */
    public async enforce(): Promise<{ blocked: number; restored: number }> {
        const exceeded = await this.repository.markExceeded();
        const restorable = await this.repository.unmarkRestorable();

        if (this.squadUuid) {
            if (exceeded.length > 0) {
                await this.repository.removeFromSquad(this.squadUuid, exceeded);
            }
            if (restorable.length > 0) {
                await this.repository.addToSquad(this.squadUuid, restorable);
            }
        }

        const changed = [...exceeded, ...restorable];
        if (this.squadUuid && changed.length > 0) {
            this.eventBus.publish(new AddUsersToNodeEvent(changed));
        }

        if (changed.length > 0) {
            this.logger.log(
                `LTE quota: blocked ${exceeded.length}, restored ${restorable.length} user(s).`,
            );
        }

        return { blocked: exceeded.length, restored: restorable.length };
    }

    public async resetByStrategy(strategy: TLteResetStrategy): Promise<number> {
        const count = await this.repository.resetUsageByStrategy(strategy);

        if (count > 0) {
            this.logger.log(`LTE quota: reset ${count} user(s) with strategy ${strategy}.`);
            await this.enforce();
        }

        return count;
    }

    public async getByUsername(username: string): Promise<ILteQuotaRow | null | undefined> {
        const userId = await this.repository.findUserIdByUsername(username);
        if (userId === null) return undefined;

        return this.repository.findByUserId(userId);
    }

    public async setLimit(
        username: string,
        limitBytes: bigint,
        resetStrategy: TLteResetStrategy,
    ): Promise<ILteQuotaRow | undefined> {
        const userId = await this.repository.findUserIdByUsername(username);
        if (userId === null) return undefined;

        const row = await this.repository.upsertLimit(userId, limitBytes, resetStrategy);
        // a raised limit unblocks the user without waiting for the next cron tick
        await this.enforce();

        return row;
    }

    public async resetUser(username: string): Promise<boolean> {
        const userId = await this.repository.findUserIdByUsername(username);
        if (userId === null) return false;

        await this.repository.resetUserUsage(userId);
        await this.enforce();

        return true;
    }

    public listNodeSettings(): Promise<INodeBalancerSettingsRow[]> {
        return this.repository.listNodeSettings();
    }

    public setNodeSettings(
        nodeUuid: string,
        data: { isLte: boolean; weight: number; maxOnline: number | null },
    ): Promise<INodeBalancerSettingsRow | null> {
        return this.repository.upsertNodeSettings(nodeUuid, data);
    }
}
