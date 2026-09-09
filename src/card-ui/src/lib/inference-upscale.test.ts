import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
	OUTER_LANCZOS_MIN_LONG_EDGE,
	mapInferencePointToSource,
	planOuterInferenceResize,
	resizeRgbaLanczos
} from './card-centering/inference-upscale.ts';

const apiSource = readFileSync(new URL('./card-centering/api.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../routes/+page.svelte', import.meta.url), 'utf8');
const cacheSource = readFileSync(new URL('./recent-upload-cache.ts', import.meta.url), 'utf8');
const versionSource = readFileSync(new URL('./card-centering/processing-version.ts', import.meta.url), 'utf8');

test('below-threshold image reaches 1440 and preserves aspect ratio', () => {
	const plan = planOuterInferenceResize(375, 500);
	assert.equal(plan.applied, true);
	assert.deepEqual([plan.inferenceWidth, plan.inferenceHeight], [1080, 1440]);
	assert.ok(Math.abs(plan.inferenceWidth / plan.inferenceHeight - 375 / 500) < 1e-12);
});

test('exactly 1440 and larger images are unchanged', () => {
	assert.equal(planOuterInferenceResize(1080, 1440).applied, false);
	assert.equal(planOuterInferenceResize(1600, 1200).applied, false);
});

test('integer rounding uses independent exact coordinate scales', () => {
	const plan = planOuterInferenceResize(373, 500);
	assert.deepEqual([plan.inferenceWidth, plan.inferenceHeight], [1074, 1440]);
	assert.notEqual(plan.scaleX, plan.scaleY);
	const source = mapInferencePointToSource({ x: 537, y: 720 }, plan);
	assert.ok(Math.abs(source.x - 186.5) < 1e-12);
	assert.ok(Math.abs(source.y - 250) < 1e-12);
});

test('feature flag off restores identity behavior', () => {
	assert.deepEqual(planOuterInferenceResize(375, 500, false), {
		applied: false, sourceWidth: 375, sourceHeight: 500,
		inferenceWidth: 375, inferenceHeight: 500, scaleX: 1, scaleY: 1
	});
});

test('Lanczos RGBA resizer is deterministic and preserves a constant image', () => {
	const source = new Uint8ClampedArray(3 * 2 * 4);
	for (let i = 0; i < source.length; i += 4) source.set([31, 97, 203, 255], i);
	const a = resizeRgbaLanczos(source, 3, 2, 11, 7);
	assert.deepEqual(a, resizeRgbaLanczos(source, 3, 2, 11, 7));
	for (let i = 0; i < a.length; i += 4) assert.deepEqual(Array.from(a.slice(i, i + 4)), [31, 97, 203, 255]);
});

test('detector quad maps once before refinement receives the original file', () => {
	assert.match(apiSource, /mapInferenceQuadToSource\(inferenceQuad, prepared\.resize\)/);
	assert.match(apiSource, /refineCardImage\(file, original\)/);
});

test('Try Me and uploads share inferCorners without preprocessing special cases', () => {
	assert.match(pageSource, /const result = cached\?\.result \?\? await inferCorners\(file\)/);
	assert.doesNotMatch(pageSource, /inferCorners\([^)]*tryme/i);
});

test('compatibility bump invalidates derived analysis while preserving original and duplicate hit', () => {
	assert.match(versionSource, /pipeline-v2-lanczos-1440/);
	assert.match(cacheSource, /Version mismatch invalidates only analysis, never the source or duplicate hit/);
	assert.match(cacheSource, /delete entry\.analysis/);
	assert.match(cacheSource, /blob: entry\.blob/);
	assert.match(cacheSource, /duplicateUploadSuppressed = result\.hit/);
});
