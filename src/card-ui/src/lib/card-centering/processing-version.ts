import { OUTER_MODEL_ASSET_HASH, LEARNED_RANKER_ASSET_HASH } from 'virtual:production-model-fingerprints';
export { OUTER_MODEL_ASSET_HASH, LEARNED_RANKER_ASSET_HASH };

/**
 * Bump for non-weight changes to preprocessing, source quad, warp/curved transforms,
 * inner candidate generation/features/voting, centering math or result semantics.
 * Model bytes invalidate automatically. Pure UI/CSS/copy changes need no bump.
 */
export const CARD_PIPELINE_COMPAT_VERSION = 'pipeline-v1';
export function processingVersion(pipeline: string, outerHash: string, rankerHash: string) {
    return `${pipeline}__outer-${outerHash}__ranker-${rankerHash}`;
}
export const CARD_PROCESSING_VERSION = processingVersion(
    CARD_PIPELINE_COMPAT_VERSION, OUTER_MODEL_ASSET_HASH, LEARNED_RANKER_ASSET_HASH
);
