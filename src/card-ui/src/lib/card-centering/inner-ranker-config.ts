/** Rollback: set to 'a' and rebuild. No user-facing selector or telemetry. */
export const INNER_RANKER_MODE = 'learned' as 'a' | 'learned';
export const ENABLE_LEARNED_INNER_RANKER = INNER_RANKER_MODE === 'learned';
