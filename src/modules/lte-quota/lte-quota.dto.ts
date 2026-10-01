import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { LTE_RESET_STRATEGY_VALUES } from './lte-quota.constants';

export const SetLteLimitBodySchema = z.object({
    // bytes as a string to survive JSON for values above 2^53; 0 = unlimited
    limitBytes: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
    resetStrategy: z.enum(LTE_RESET_STRATEGY_VALUES).default('MONTH'),
});

export const SetNodeBalancerBodySchema = z.object({
    isLte: z.boolean().default(false),
    weight: z.number().int().min(1).max(10_000).default(100),
    maxOnline: z.number().int().positive().nullable().default(null),
});

export class SetLteLimitBodyDto extends createZodDto(SetLteLimitBodySchema) {}
export class SetNodeBalancerBodyDto extends createZodDto(SetNodeBalancerBodySchema) {}
