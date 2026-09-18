export const SEGMENTATION_MODELS = {
	640: '/models/card-segmentation-640.onnx',
	960: '/models/card-segmentation-960.onnx'
} as const;

export type SegmentationModelKey = keyof typeof SEGMENTATION_MODELS;

/** Change only this key to roll the production default back to the retained 640 model. */
export const DEFAULT_SEGMENTATION_MODEL: SegmentationModelKey = 960;

export type TensorMetadata = {
	isTensor: boolean;
	shape?: readonly (number | string)[];
};

export type ModelInputDimensions = { width: number; height: number };

export function resolveModelInputDimensions(metadata: readonly TensorMetadata[]): ModelInputDimensions {
	const input = metadata.find((value) => value.isTensor && value.shape?.length === 4);
	const height = input?.shape?.[2];
	const width = input?.shape?.[3];
	if (typeof width !== 'number' || typeof height !== 'number' || width < 1 || height < 1) {
		throw new Error('Segmentation model must expose a static NCHW input shape');
	}
	return { width, height };
}

export function resolveSegmentationModelUrl(search = '') {
	if (import.meta.env.DEV) {
		const requested = new URLSearchParams(search).get('segModel');
		if (requested === '640' || requested === '960') return SEGMENTATION_MODELS[Number(requested) as SegmentationModelKey];
	}
	return SEGMENTATION_MODELS[DEFAULT_SEGMENTATION_MODEL];
}

export type Letterbox = { scale: number; scaledWidth: number; scaledHeight: number; padX: number; padY: number };

export function planModelLetterbox(sourceWidth: number, sourceHeight: number, modelWidth: number, modelHeight: number): Letterbox {
	const scale = Math.min(modelWidth / sourceWidth, modelHeight / sourceHeight);
	const scaledWidth = Math.max(1, Math.round(sourceWidth * scale));
	const scaledHeight = Math.max(1, Math.round(sourceHeight * scale));
	return {
		scale,
		scaledWidth,
		scaledHeight,
		padX: Math.floor((modelWidth - scaledWidth) / 2),
		padY: Math.floor((modelHeight - scaledHeight) / 2)
	};
}

export function restoreModelPoint(point: { x: number; y: number }, letterbox: Pick<Letterbox, 'scale' | 'padX' | 'padY'>) {
	return { x: (point.x - letterbox.padX) / letterbox.scale, y: (point.y - letterbox.padY) / letterbox.scale };
}
