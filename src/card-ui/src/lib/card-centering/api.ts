/**
 * In-browser card segmentation and corner inference.
 *
 * This module letterboxes an uploaded image to the YOLO model input, runs the exported ONNX
 * segmentation model through ONNX Runtime Web, reconstructs the best detection mask, and delegates
 * quadrilateral fitting to the existing browser geometry pipeline. No image data leaves the device.
 */
import type * as Ort from 'onnxruntime-web';

import { fitQuadFromMask } from './mask-geometry';

const MODEL_URL = '/models/card-segmentation.onnx';
const MODEL_SIZE = 640;
const PROTO_SIZE = 160;
const MASK_CHANNELS = 32;
const CONFIDENCE_THRESHOLD = 0.25;

type PreprocessedImage = {
	tensor: Ort.Tensor;
	originalWidth: number;
	originalHeight: number;
	scale: number;
	padX: number;
	padY: number;
};

let runtimePromise: Promise<typeof import('onnxruntime-web/webgpu')> | null = null;
let sessionPromise: Promise<Ort.InferenceSession> | null = null;

/**
 * Loads and caches the browser-only ONNX Runtime bundle.
 *
 * Dynamic import prevents browser globals in the runtime package from being evaluated during
 * SvelteKit server rendering and keeps the inference runtime out of the initial page chunk.
 *
 * @returns The ONNX Runtime WebGPU module, including its WebAssembly fallback.
 */
async function getRuntime() {
	runtimePromise ??= import('onnxruntime-web/webgpu');
	const runtime = await runtimePromise;
	runtime.env.wasm.wasmPaths = '/ort/';
	return runtime;
}

/**
 * Creates and caches the ONNX session, preferring WebGPU and falling back to WebAssembly.
 *
 * @returns A shared inference session for the card segmentation model.
 */
async function getSession() {
	if (!sessionPromise) {
		const pendingSession = (async () => {
			const ort = await getRuntime();
			if ('gpu' in navigator) {
				try {
					return await ort.InferenceSession.create(MODEL_URL, {
						executionProviders: ['webgpu', 'wasm'],
						graphOptimizationLevel: 'all'
					});
				} catch (error) {
					console.warn('WebGPU inference unavailable; falling back to WebAssembly.', error);
				}
			}

			return ort.InferenceSession.create(MODEL_URL, {
				executionProviders: ['wasm'],
				graphOptimizationLevel: 'all'
			});
		})();
		sessionPromise = pendingSession;
		pendingSession.catch(() => {
			if (sessionPromise === pendingSession) sessionPromise = null;
		});
	}

	return sessionPromise;
}

/**
 * Starts downloading and initializing the shared segmentation model before it is needed.
 *
 * Calling this more than once is safe because every caller reuses the same cached session promise.
 * A failed preload clears the cached promise so a later user-triggered inference can retry.
 *
 * @returns A promise that resolves when the ONNX inference session is ready.
 */
export async function preloadInferenceModel() {
	await getSession();
}

/**
 * Decodes and letterboxes a file into the model's normalized RGB NCHW tensor.
 *
 * @param file - Source image selected by the user.
 * @returns Tensor input plus the dimensions and transform needed to restore original coordinates.
 */
async function preprocessImage(file: File): Promise<PreprocessedImage> {
	if (!file.type.startsWith('image/')) throw new Error('File must be an image');

	const ort = await getRuntime();
	const bitmap = await createImageBitmap(file);
	try {
		if (!bitmap.width || !bitmap.height) throw new Error('Invalid image dimensions');

		const scale = Math.min(MODEL_SIZE / bitmap.width, MODEL_SIZE / bitmap.height);
		const scaledWidth = Math.max(1, Math.round(bitmap.width * scale));
		const scaledHeight = Math.max(1, Math.round(bitmap.height * scale));
		const padX = Math.floor((MODEL_SIZE - scaledWidth) / 2);
		const padY = Math.floor((MODEL_SIZE - scaledHeight) / 2);
		const canvas = document.createElement('canvas');
		canvas.width = MODEL_SIZE;
		canvas.height = MODEL_SIZE;

		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Could not create inference canvas');

		context.fillStyle = 'rgb(114, 114, 114)';
		context.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, padX, padY, scaledWidth, scaledHeight);

		const rgba = context.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
		const planeSize = MODEL_SIZE * MODEL_SIZE;
		const input = new Float32Array(planeSize * 3);
		for (let pixel = 0; pixel < planeSize; pixel++) {
			const rgbaOffset = pixel * 4;
			input[pixel] = rgba[rgbaOffset] / 255;
			input[planeSize + pixel] = rgba[rgbaOffset + 1] / 255;
			input[planeSize * 2 + pixel] = rgba[rgbaOffset + 2] / 255;
		}

		return {
			tensor: new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]),
			originalWidth: bitmap.width,
			originalHeight: bitmap.height,
			scale,
			padX,
			padY
		};
	} finally {
		bitmap.close();
	}
}

/**
 * Locates the exported YOLO detection and mask-prototype tensors by their dimensions.
 *
 * @param outputs - Named tensors returned by ONNX Runtime.
 * @returns Detection and prototype tensors in a stable shape-independent order.
 */
function getModelOutputs(outputs: Ort.InferenceSession.ReturnType) {
	const tensors = Object.values(outputs) as Ort.Tensor[];
	const detections = tensors.find(
		(tensor) => tensor.dims.length === 3 && tensor.dims[1] === 4 + 1 + MASK_CHANNELS
	);
	const prototypes = tensors.find(
		(tensor) =>
			tensor.dims.length === 4 &&
			tensor.dims[1] === MASK_CHANNELS &&
			tensor.dims[2] === PROTO_SIZE &&
			tensor.dims[3] === PROTO_SIZE
	);

	if (!detections || !prototypes) {
		throw new Error('ONNX model returned unexpected output shapes');
	}

	return { detections, prototypes };
}

/**
 * Selects the highest-confidence card prediction and extracts its box and mask coefficients.
 *
 * @param detections - YOLO detection tensor shaped `[1, 37, 8400]`.
 * @returns Best detection data, or `null` when no candidate reaches the confidence threshold.
 */
function getBestDetection(detections: Ort.Tensor) {
	const data = detections.data as Float32Array;
	const candidates = Number(detections.dims[2]);
	let bestIndex = -1;
	let bestConfidence = CONFIDENCE_THRESHOLD;

	for (let index = 0; index < candidates; index++) {
		const confidence = data[4 * candidates + index];
		if (confidence > bestConfidence) {
			bestConfidence = confidence;
			bestIndex = index;
		}
	}

	if (bestIndex < 0) return null;

	const centerX = data[bestIndex];
	const centerY = data[candidates + bestIndex];
	const width = data[candidates * 2 + bestIndex];
	const height = data[candidates * 3 + bestIndex];
	const coefficients = new Float32Array(MASK_CHANNELS);
	for (let channel = 0; channel < MASK_CHANNELS; channel++) {
		coefficients[channel] = data[(5 + channel) * candidates + bestIndex];
	}

	return {
		confidence: bestConfidence,
		box: {
			left: centerX - width / 2,
			top: centerY - height / 2,
			right: centerX + width / 2,
			bottom: centerY + height / 2
		},
		coefficients
	};
}

/**
 * Reconstructs the selected instance mask from YOLO prototype channels and crops it to its box.
 *
 * @param prototypes - Mask prototype tensor shaped `[1, 32, 160, 160]`.
 * @param coefficients - Per-detection weights for the prototype channels.
 * @param box - Detection bounds in the 640×640 model coordinate space.
 * @returns A black/white mask data URL in model-input coordinates.
 */
function buildMaskDataUrl(
	prototypes: Ort.Tensor,
	coefficients: Float32Array,
	box: { left: number; top: number; right: number; bottom: number }
) {
	const prototypeData = prototypes.data as Float32Array;
	const prototypePlane = PROTO_SIZE * PROTO_SIZE;
	const smallCanvas = document.createElement('canvas');
	smallCanvas.width = PROTO_SIZE;
	smallCanvas.height = PROTO_SIZE;
	const smallContext = smallCanvas.getContext('2d');
	if (!smallContext) throw new Error('Could not create mask canvas');

	const pixels = smallContext.createImageData(PROTO_SIZE, PROTO_SIZE);
	const scaleToProto = PROTO_SIZE / MODEL_SIZE;
	const left = Math.max(0, box.left * scaleToProto);
	const top = Math.max(0, box.top * scaleToProto);
	const right = Math.min(PROTO_SIZE, box.right * scaleToProto);
	const bottom = Math.min(PROTO_SIZE, box.bottom * scaleToProto);

	for (let y = 0; y < PROTO_SIZE; y++) {
		for (let x = 0; x < PROTO_SIZE; x++) {
			const pixel = y * PROTO_SIZE + x;
			let logit = 0;
			for (let channel = 0; channel < MASK_CHANNELS; channel++) {
				logit += coefficients[channel] * prototypeData[channel * prototypePlane + pixel];
			}

			const insideBox = x >= left && x <= right && y >= top && y <= bottom;
			const foreground = insideBox && logit > 0;
			const value = foreground ? 255 : 0;
			const offset = pixel * 4;
			pixels.data[offset] = value;
			pixels.data[offset + 1] = value;
			pixels.data[offset + 2] = value;
			pixels.data[offset + 3] = 255;
		}
	}

	smallContext.putImageData(pixels, 0, 0);
	const maskCanvas = document.createElement('canvas');
	maskCanvas.width = MODEL_SIZE;
	maskCanvas.height = MODEL_SIZE;
	const maskContext = maskCanvas.getContext('2d');
	if (!maskContext) throw new Error('Could not create output mask canvas');
	maskContext.imageSmoothingEnabled = false;
	maskContext.drawImage(smallCanvas, 0, 0, MODEL_SIZE, MODEL_SIZE);
	return maskCanvas.toDataURL('image/png');
}

/**
 * Runs local ONNX segmentation and returns fitted corners in original-image coordinates.
 *
 * @param file - Original image selected by the user.
 * @returns The mask, confidence, ordered corners, refinement score, and fit metrics.
 * @throws If the image/model cannot be processed or no card detection meets the confidence threshold.
 */
export async function inferCorners(file: File) {
	const [session, prepared] = await Promise.all([getSession(), preprocessImage(file)]);
	const outputs = await session.run({ [session.inputNames[0]]: prepared.tensor });
	const { detections, prototypes } = getModelOutputs(outputs);
	const detection = getBestDetection(detections);
	if (!detection) throw new Error('No card detected');

	const maskUrl = buildMaskDataUrl(prototypes, detection.coefficients, detection.box);
	const fitted = await fitQuadFromMask(maskUrl);
	const ids = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
	const corners = fitted.quad.map((point, index) => ({
		id: ids[index],
		x: Math.max(0, Math.min(prepared.originalWidth, (point.x - prepared.padX) / prepared.scale)),
		y: Math.max(0, Math.min(prepared.originalHeight, (point.y - prepared.padY) / prepared.scale))
	}));

	return {
		ok: true,
		mask_data_url: maskUrl,
		confidence: detection.confidence,
		corners,
		refine_score: fitted.score,
		quad_metrics: fitted.metrics
	};
}
