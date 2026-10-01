import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { LTE_COMMAND_HANDLERS } from './lte-quota.commands';
import { LteQuotaController } from './lte-quota.controller';
import { LteQuotaRepository } from './lte-quota.repository';
import { LteQuotaService } from './lte-quota.service';

@Module({
    imports: [CqrsModule],
    controllers: [LteQuotaController],
    providers: [LteQuotaRepository, LteQuotaService, ...LTE_COMMAND_HANDLERS],
    exports: [LteQuotaRepository],
})
export class LteQuotaModule {}
