import { Logger } from '@nestjs/common';
import { CommandHandler, ICommand, ICommandHandler } from '@nestjs/cqrs';

import { TLteResetStrategy } from './lte-quota.constants';
import { LteQuotaService } from './lte-quota.service';

export class EnforceLteQuotaCommand implements ICommand {}

export class ResetLteQuotaByStrategyCommand implements ICommand {
    constructor(public readonly strategy: TLteResetStrategy) {}
}

@CommandHandler(EnforceLteQuotaCommand)
export class EnforceLteQuotaHandler implements ICommandHandler<EnforceLteQuotaCommand> {
    private readonly logger = new Logger(EnforceLteQuotaHandler.name);

    constructor(private readonly service: LteQuotaService) {}

    async execute() {
        try {
            return await this.service.enforce();
        } catch (error) {
            this.logger.error(error);
            return { blocked: 0, restored: 0 };
        }
    }
}

@CommandHandler(ResetLteQuotaByStrategyCommand)
export class ResetLteQuotaByStrategyHandler
    implements ICommandHandler<ResetLteQuotaByStrategyCommand>
{
    private readonly logger = new Logger(ResetLteQuotaByStrategyHandler.name);

    constructor(private readonly service: LteQuotaService) {}

    async execute(command: ResetLteQuotaByStrategyCommand) {
        try {
            return await this.service.resetByStrategy(command.strategy);
        } catch (error) {
            this.logger.error(error);
            return 0;
        }
    }
}

export const LTE_COMMAND_HANDLERS = [EnforceLteQuotaHandler, ResetLteQuotaByStrategyHandler];
