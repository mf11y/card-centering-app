import type { InnerDiagnostic } from './inner-border.ts';
import { getCenteringStats, type GuideInsets } from './centering.ts';

/** Controlled experiment. Never enable implicitly from a user upload or browser storage. */
export const ENABLE_TOP_INNER_RESCUE = false;
export const TOP_RESCUE_MIN_INSET_PCT = 7.0;
export type DepthEvidence = { position: number; strength: number; support: number };
export type RescueReason = 'rescue_disabled' | 'side_not_top' | 'original_not_accepted'
    | 'original_not_deep' | 'no_shallower_candidate' | 'rescue_strength_too_low'
    | 'rescue_support_too_low' | 'rescue_ratio_too_low' | 'rescue_applied';
export type RescueDiagnostic = {
    triggered: boolean; skipped: boolean; reason: RescueReason;
    originalInsetPct: number; rescuedInsetPct: number; depthShiftPct: number;
    winnerStrength?: number; winnerSupport?: number;
    rescueStrength?: number; rescueSupport?: number; strengthRatio?: number;
    originalCentering: ReturnType<typeof getCenteringStats>;
    rescuedCentering: ReturnType<typeof getCenteringStats>;
};
// Latest evaluation only: no images, names, IDs, storage, or network reporting.
export const topRescueDebug: { evaluations: number; triggers: number; last?: RescueDiagnostic } = {
    evaluations: 0, triggers: 0
};

/** Post-A only. Frozen tuning normal band and local maxima match the reviewed analysis. */
export function applyTopInnerRescue(original: GuideInsets, winner: InnerDiagnostic | undefined,
    scores: readonly DepthEvidence[], enabled = ENABLE_TOP_INNER_RESCUE,
    minInsetPct = TOP_RESCUE_MIN_INSET_PCT) {
    let result = original;
    const diagnostic: RescueDiagnostic = {
        triggered: false, skipped: true, reason: 'rescue_disabled',
        originalInsetPct: original.top, rescuedInsetPct: original.top, depthShiftPct: 0,
        winnerStrength: winner?.strength, winnerSupport: winner?.support,
        originalCentering: getCenteringStats(original), rescuedCentering: getCenteringStats(original)
    };
    const finish = (reason: RescueReason) => {
        diagnostic.reason = reason;
        if (enabled) {
            topRescueDebug.evaluations++;
            if (diagnostic.triggered) topRescueDebug.triggers++;
            topRescueDebug.last = diagnostic;
        }
        return { insets: result, diagnostic };
    };
    if (!enabled) return finish('rescue_disabled');
    if (winner && winner.side !== 'top') return finish('side_not_top');
    if (!winner || winner.fallback) return finish('original_not_accepted');
    if (!(original.top > minInsetPct)) return finish('original_not_deep');
    const depth = winner.detectorHeight;
    const profile = [...scores].sort((a, b) => a.position - b.position);
    const shallow = profile.filter((p, i) =>
        p.strength >= (profile[i - 1]?.strength ?? -1) &&
        p.strength >= (profile[i + 1]?.strength ?? -1) &&
        p.position / depth * 100 >= 1.875 && p.position / depth * 100 <= 4.035 &&
        (winner.bestPosition ?? 0) - p.position > Math.max(3, depth * 0.008)
    ).sort((a, b) => b.strength - a.strength || a.position - b.position);
    const strong = shallow.filter(p => p.strength >= 14);
    const viable = strong.filter(p => p.support >= 0.70);
    const candidate = viable[0] ?? strong[0] ?? shallow[0];
    if (!candidate) return finish('no_shallower_candidate');
    diagnostic.rescueStrength = candidate.strength;
    diagnostic.rescueSupport = candidate.support;
    diagnostic.strengthRatio = candidate.strength / (winner.strength ?? 0);
    if (!strong.length) return finish('rescue_strength_too_low');
    if (!viable.length) return finish('rescue_support_too_low');
    if (!(winner.strength! > 0) || !(diagnostic.strengthRatio > 0.60)) return finish('rescue_ratio_too_low');
    result = { ...original, top: Math.round(candidate.position / depth * 10000) / 100 };
    diagnostic.triggered = true;
    diagnostic.skipped = false;
    diagnostic.rescuedInsetPct = result.top;
    diagnostic.depthShiftPct = original.top - result.top;
    diagnostic.rescuedCentering = getCenteringStats(result);
    return finish('rescue_applied');
}
