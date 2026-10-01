export const LTE_RESET_STRATEGY = {
    NO_RESET: 'NO_RESET',
    DAY: 'DAY',
    WEEK: 'WEEK',
    MONTH: 'MONTH',
} as const;

export type TLteResetStrategy = (typeof LTE_RESET_STRATEGY)[keyof typeof LTE_RESET_STRATEGY];

export const LTE_RESET_STRATEGY_VALUES = Object.values(LTE_RESET_STRATEGY) as [
    TLteResetStrategy,
    ...TLteResetStrategy[],
];

export const LTE_CONTROLLER = 'lte-quota' as const;
