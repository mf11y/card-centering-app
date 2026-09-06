import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTopInnerRescue, ENABLE_TOP_INNER_RESCUE } from '../src/lib/card-centering/top-inner-rescue.ts';
import { estimateInnerBorders, estimateInnerBordersWithRescue, type InnerDiagnostic } from '../src/lib/card-centering/inner-border.ts';
const original = { top: 9, bottom: 5, left: 4, right: 6 };
const winner: InnerDiagnostic = { side: 'top', detectorHeight: 700, detectorWidth: 500,
    fallback: false, reason: 'accepted', defaultPct: 5, insetPct: 9,
    bestPosition: 63, strength: 30, support: 1 };
const scores = [{ position: 21, strength: 21, support: .8 }];
test('OFF is default and preserves result identity', () => {
    assert.equal(ENABLE_TOP_INNER_RESCUE, false);
    assert.equal(applyTopInnerRescue(original, winner, scores).insets, original);
});
for (const [name, w, s, o, reason] of [
    ['bottom', { ...winner, side: 'bottom' }, scores, original, 'side_not_top'],
    ['fallback', { ...winner, fallback: true }, scores, original, 'original_not_accepted'],
    ['threshold equality', winner, scores, { ...original, top: 7 }, 'original_not_deep'],
    ['below threshold', winner, scores, { ...original, top: 6.9 }, 'original_not_deep'],
    ['missing shallow', winner, [], original, 'no_shallower_candidate'],
    ['weak', winner, [{ ...scores[0], strength: 13.99 }], original, 'rescue_strength_too_low'],
    ['low support', winner, [{ ...scores[0], support: .699 }], original, 'rescue_support_too_low'],
    ['ratio equality', winner, [{ ...scores[0], strength: 18 }], original, 'rescue_ratio_too_low'],
    ['ratio low', winner, [{ ...scores[0], strength: 17 }], original, 'rescue_ratio_too_low'],
] as const) test(name, () => {
    const r = applyTopInnerRescue(o, w, s, true);
    assert.equal(r.insets, o); assert.equal(r.diagnostic.reason, reason);
    assert.deepEqual(r.diagnostic.originalCentering, r.diagnostic.rescuedCentering);
});
test('valid rescue changes only top and centering sees its result', () => {
    const r = applyTopInnerRescue(original, winner, scores, true);
    assert.deepEqual(r.insets, { ...original, top: 3 });
    assert.equal(r.diagnostic.reason, 'rescue_applied');
    assert.equal(r.diagnostic.rescuedCentering.topPct, 37.5);
    assert.equal(r.diagnostic.originalCentering.leftPct, r.diagnostic.rescuedCentering.leftPct);
});
test('best qualifying local peak, not stronger unsupported peak; inclusive support/strength', () => {
    const r = applyTopInnerRescue(original, {...winner, strength: 20}, [
        {position: 14, strength: 19, support: .6}, {position: 15, strength: 0, support: 0},
        {position: 21, strength: 14, support: .7}
    ], true);
    assert.equal(r.insets.top, 3);
});
test('normal band and peak separation are retained', () => {
    assert.equal(applyTopInnerRescue(original, winner, [{position: 40,strength:25,support:1}], true).diagnostic.reason, 'no_shallower_candidate');
});
test('small and flat images retain all defaults with ON and OFF', () => {
    for (const size of [10, 100]) {
        const image = {width: size, height: size, data: new Uint8ClampedArray(size*size*4)};
        assert.deepEqual(estimateInnerBordersWithRescue(image, original, [], false), estimateInnerBorders(image, original));
        assert.deepEqual(estimateInnerBordersWithRescue(image, original, [], true), original);
    }
});
