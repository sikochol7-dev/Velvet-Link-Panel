import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Cron } from '@nestjs/schedule';

import {
    EnforceLteQuotaCommand,
    LTE_RESET_STRATEGY,
    ResetLteQuotaByStrategyCommand,
    TLteResetStrategy,
} from '@modules/lte-quota';

import { JOBS_INTERVALS } from '@scheduler/intervals';

@Injectable()
export class LteQuotaTask {
    private readonly logger = new Logger(LteQuotaTask.name);

    constructor(private readonly commandBus: CommandBus) {}

    @Cron(JOBS_INTERVALS.LTE_QUOTA.ENFORCE, {
        name: 'lteQuotaEnforce',
        waitForCompletion: true,
    })
    async enforce() {
        try {
            await this.commandBus.execute(new EnforceLteQuotaCommand());
        } catch (error) {
            this.logger.error(error);
        }
    }

    @Cron(JOBS_INTERVALS.RESET_USER_TRAFFIC.DAILY, {
        name: 'lteQuotaResetDaily',
        waitForCompletion: true,
    })
    async resetDaily() {
        await this.reset(LTE_RESET_STRATEGY.DAY);
    }

    @Cron(JOBS_INTERVALS.RESET_USER_TRAFFIC.WEEKLY, {
        name: 'lteQuotaResetWeekly',
        waitForCompletion: true,
    })
    async resetWeekly() {
        await this.reset(LTE_RESET_STRATEGY.WEEK);
    }

    @Cron(JOBS_INTERVALS.RESET_USER_TRAFFIC.MONTHLY, {
        name: 'lteQuotaResetMonthly',
        waitForCompletion: true,
    })
    async resetMonthly() {
        await this.reset(LTE_RESET_STRATEGY.MONTH);
    }

    private async reset(strategy: TLteResetStrategy) {
        try {
            await this.commandBus.execute(new ResetLteQuotaByStrategyCommand(strategy));
        } catch (error) {
            this.logger.error(error);
        }
    }
}
