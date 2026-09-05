import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateInnerBorders } from '../src/lib/card-centering/inner-border.ts';

const defaults = { top: 5, bottom: 5, left: 5, right: 5 };
function card(flat = false, competing = false) {
    const width = 400, height = 560;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let color = !flat && x >= 16 && x < 372 && y >= 20 && y < 526 ? 50 : 230;
        if (competing && x >= 28 && x < 364 && y >= 32 && y < 514) color = 230;
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = color; data[i + 3] = 255;
    }
    return { width, height, data };
}
test('asymmetric borders produce independent initial guesses', () => {
    const result = estimateInnerBorders(card(), defaults);
    for (const [key, expected] of Object.entries({ left: 4, right: 7, top: 20 / 560 * 100, bottom: 34 / 560 * 100 })) {
        assert.ok(Math.abs(result[key as keyof typeof result] - expected) < 0.5, `${key}: ${result[key as keyof typeof result]}`);
    }
    assert.notEqual(result.left, result.right);
});
test('flat, competing borders and low-resolution inputs retain defaults', () => {
    assert.deepEqual(estimateInnerBorders(card(true), defaults), defaults);
    assert.deepEqual(estimateInnerBorders(card(false, true), defaults), defaults);
    assert.deepEqual(estimateInnerBorders({ width: 10, height: 10, data: new Uint8ClampedArray(400) }, defaults), defaults);
});
