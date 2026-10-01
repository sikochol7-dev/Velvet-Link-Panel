import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    Put,
    UseFilters,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '@common/decorators/roles/roles';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ROLE } from '@libs/contracts/constants';

import { LTE_CONTROLLER } from './lte-quota.constants';
import { SetLteLimitBodyDto, SetNodeBalancerBodyDto } from './lte-quota.dto';
import { ILteQuotaRow } from './lte-quota.repository';
import { LteQuotaService } from './lte-quota.service';

const serializeQuota = (row: ILteQuotaRow | null | undefined) => ({
    limitBytes: (row?.limitBytes ?? 0n).toString(),
    usedBytes: (row?.usedBytes ?? 0n).toString(),
    lifetimeUsedBytes: (row?.lifetimeUsedBytes ?? 0n).toString(),
    resetStrategy: row?.resetStrategy ?? 'MONTH',
    lastResetAt: row?.lastResetAt ?? null,
    blockedAt: row?.blockedAt ?? null,
});

/**
 * Admin-only on purpose (no API-token role): the endpoints are not part of the upstream
 * scope list, so scoped API tokens must not reach them implicitly.
 */
@ApiBearerAuth('Authorization')
@ApiTags('LTE Quota')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(LTE_CONTROLLER)
export class LteQuotaController {
    constructor(private readonly service: LteQuotaService) {}

    @Get('users/:username')
    async getUserQuota(@Param('username') username: string) {
        const row = await this.service.getByUsername(username);
        if (row === undefined) throw new NotFoundException('User not found');

        return { response: serializeQuota(row) };
    }

    @Put('users/:username')
    async setUserQuota(@Param('username') username: string, @Body() body: SetLteLimitBodyDto) {
        const row = await this.service.setLimit(
            username,
            BigInt(body.limitBytes),
            body.resetStrategy,
        );
        if (!row) throw new NotFoundException('User not found');

        return { response: serializeQuota(row) };
    }

    @Post('users/:username/reset')
    @HttpCode(HttpStatus.OK)
    async resetUserQuota(@Param('username') username: string) {
        const ok = await this.service.resetUser(username);
        if (!ok) throw new NotFoundException('User not found');

        return { response: { isReset: true } };
    }

    @Get('nodes')
    async listNodes() {
        return { response: await this.service.listNodeSettings() };
    }

    @Put('nodes/:uuid')
    async setNode(
        @Param('uuid', new ParseUUIDPipe()) uuid: string,
        @Body() body: SetNodeBalancerBodyDto,
    ) {
        const row = await this.service.setNodeSettings(uuid, body);
        if (!row) throw new NotFoundException('Node not found');

        return { response: row };
    }
}
