import assert from 'node:assert/strict';
import test from 'node:test';

import { planModelLetterbox, resolveModelInputDimensions, restoreModelPoint } from './card-centering/model-config.ts';
import { nativeMask } from './card-centering/native-mask.ts';

test('resolves static 640 and 960 NCHW model inputs', () => {
	assert.deepEqual(resolveModelInputDimensions([{ isTensor: true, shape: [1, 3, 640, 640] }]), { width: 640, height: 640 });
	assert.deepEqual(resolveModelInputDimensions([{ isTensor: true, shape: [1, 3, 960, 960] }]), { width: 960, height: 960 });
});

test('rejects symbolic model spatial dimensions', () => {
	assert.throws(() => resolveModelInputDimensions([{ isTensor: true, shape: [1, 3, 'height', 'width'] }]), /static NCHW/);
});

test('letterbox restoration is resolution-independent', () => {
	for (const size of [640, 960]) {
		const plan = planModelLetterbox(1440, 1080, size, size);
		const source = { x: 1111.25, y: 713.5 };
		const model = { x: source.x * plan.scale + plan.padX, y: source.y * plan.scale + plan.padY };
		const restored = restoreModelPoint(model, plan);
		assert.ok(Math.abs(restored.x - source.x) < 1e-9);
		assert.ok(Math.abs(restored.y - source.y) < 1e-9);
	}
});

test('native mask decoding supports 160 and 240 prototype grids', () => {
	for (const prototype of [160, 240]) {
		const logits = new Float32Array(prototype * prototype).fill(1);
		const mask = nativeMask(logits, prototype, prototype, 120, 160, { left: 10, top: 20, right: 110, bottom: 140 });
		assert.equal(mask.length, 120 * 160);
		assert.ok(mask.some((value) => value === 1));
	}
});
