/** Deterministic inference-only Lanczos preprocessing for small source images. */
export const OUTER_LANCZOS_UPSCALE = true;
export const OUTER_LANCZOS_MIN_LONG_EDGE = 1440;
export const OUTER_LANCZOS_LOBES = 3;

export type InferenceResize = {
	applied: boolean;
	sourceWidth: number;
	sourceHeight: number;
	inferenceWidth: number;
	inferenceHeight: number;
	scaleX: number;
	scaleY: number;
};

export function planOuterInferenceResize(
	width: number,
	height: number,
	enabled = OUTER_LANCZOS_UPSCALE,
	targetLongEdge = OUTER_LANCZOS_MIN_LONG_EDGE
): InferenceResize {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
		throw new Error('Invalid source image dimensions');
	}
	const applied = enabled && Math.max(width, height) < targetLongEdge;
	const ratio = applied ? targetLongEdge / Math.max(width, height) : 1;
	const inferenceWidth = applied ? Math.max(1, Math.round(width * ratio)) : width;
	const inferenceHeight = applied ? Math.max(1, Math.round(height * ratio)) : height;
	return {
		applied,
		sourceWidth: width,
		sourceHeight: height,
		inferenceWidth,
		inferenceHeight,
		scaleX: inferenceWidth / width,
		scaleY: inferenceHeight / height
	};
}

export function mapInferencePointToSource<T extends { x: number; y: number }>(
	point: T,
	resize: Pick<InferenceResize, 'scaleX' | 'scaleY'>
) {
	return { ...point, x: point.x / resize.scaleX, y: point.y / resize.scaleY };
}

export function mapInferenceQuadToSource<T extends { x: number; y: number }>(
	quad: readonly T[],
	resize: Pick<InferenceResize, 'scaleX' | 'scaleY'>
) {
	return quad.map((point) => mapInferencePointToSource(point, resize));
}

function sinc(x: number) {
	if (Math.abs(x) < 1e-12) return 1;
	const angle = Math.PI * x;
	return Math.sin(angle) / angle;
}

function lanczos(x: number, lobes: number) {
	const distance = Math.abs(x);
	return distance < lobes ? sinc(x) * sinc(x / lobes) : 0;
}

type Contribution = { indices: Int32Array; weights: Float64Array };

function contributions(sourceSize: number, destinationSize: number, lobes: number): Contribution[] {
	const scale = destinationSize / sourceSize;
	return Array.from({ length: destinationSize }, (_, destination) => {
		const center = (destination + 0.5) / scale - 0.5;
		const first = Math.ceil(center - lobes);
		const last = Math.floor(center + lobes);
		const combined = new Map<number, number>();
		for (let source = first; source <= last; source++) {
			const clamped = Math.max(0, Math.min(sourceSize - 1, source));
			combined.set(clamped, (combined.get(clamped) ?? 0) + lanczos(center - source, lobes));
		}
		const sum = Array.from(combined.values()).reduce((total, weight) => total + weight, 0);
		return {
			indices: Int32Array.from(combined.keys()),
			weights: Float64Array.from(Array.from(combined.values(), (weight) => weight / sum))
		};
	});
}

/**
 * Separable Lanczos-3 RGBA resampling. Unlike Canvas imageSmoothingQuality, the kernel is explicit
 * and therefore does not depend on a browser's chosen implementation.
 */
export function resizeRgbaLanczos(
	source: Uint8ClampedArray,
	sourceWidth: number,
	sourceHeight: number,
	destinationWidth: number,
	destinationHeight: number,
	lobes = OUTER_LANCZOS_LOBES
) {
	if (source.length !== sourceWidth * sourceHeight * 4) throw new Error('RGBA buffer size mismatch');
	const horizontal = contributions(sourceWidth, destinationWidth, lobes);
	const vertical = contributions(sourceHeight, destinationHeight, lobes);
	const intermediate = new Float32Array(destinationWidth * sourceHeight * 4);
	for (let y = 0; y < sourceHeight; y++) {
		for (let x = 0; x < destinationWidth; x++) {
			const contribution = horizontal[x];
			const output = (y * destinationWidth + x) * 4;
			for (let channel = 0; channel < 4; channel++) {
				let value = 0;
				for (let tap = 0; tap < contribution.indices.length; tap++) {
					value += source[(y * sourceWidth + contribution.indices[tap]) * 4 + channel] * contribution.weights[tap];
				}
				intermediate[output + channel] = value;
			}
		}
	}
	const output = new Uint8ClampedArray(destinationWidth * destinationHeight * 4);
	for (let y = 0; y < destinationHeight; y++) {
		const contribution = vertical[y];
		for (let x = 0; x < destinationWidth; x++) {
			const destination = (y * destinationWidth + x) * 4;
			for (let channel = 0; channel < 4; channel++) {
				let value = 0;
				for (let tap = 0; tap < contribution.indices.length; tap++) {
					value += intermediate[(contribution.indices[tap] * destinationWidth + x) * 4 + channel] * contribution.weights[tap];
				}
				output[destination + channel] = value;
			}
		}
	}
	return output;
}
