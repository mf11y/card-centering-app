/**
 * Browser-side API preparation and inference orchestration.
 *
 * This module validates and compresses uploaded images, sends them to the segmentation API,
 * normalizes the different mask response formats supported by the backend, and converts the
 * returned mask into source-image corner coordinates by fitting the quadrilateral in-browser.
 */
import { fitQuadFromMask } from './mask-geometry';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/api';

/**
 * Converts an uploaded image into a bounded JPEG suitable for the inference API.
 *
 * The image is resized so its longest side does not exceed `maxLongSide`, then repeatedly
 * encoded at lower JPEG quality until it meets `maxBytes` or reaches `minQuality`. The returned
 * scale factors map coordinates in the API image back to the original image.
 *
 * @param file - User-selected image file to validate, decode, resize, and encode.
 * @param options - Optional byte, dimension, and JPEG-quality limits.
 * @returns The API-ready file, both image dimensions, and coordinate scale factors.
 * @throws If the input is not an image, cannot be decoded, has invalid dimensions, or cannot be encoded.
 */
export async function prepareImageForApi(
	file: File,
	{
		maxBytes = 300_000,
		maxLongSide = 1600,
		minQuality = 0.5,
		startQuality = 0.9
	}: {
		maxBytes?: number;
		maxLongSide?: number;
		minQuality?: number;
		startQuality?: number;
	} = {}
): Promise<{
		apiFile: File;
		scaleX: number;
		scaleY: number;
		originalWidth: number;
		originalHeight: number;
		apiWidth: number;
		apiHeight: number;
	}> {
	if (!file.type.startsWith('image/')) {
		throw new Error('File must be an image');
	}

	const img = new Image();
	const objectUrl = URL.createObjectURL(file);

	try {
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('Failed to load image'));
			img.src = objectUrl;
		});

		const originalWidth = img.naturalWidth;
		const originalHeight = img.naturalHeight;

		if (!originalWidth || !originalHeight) {
			throw new Error('Invalid image dimensions');
		}

		const longSide = Math.max(originalWidth, originalHeight);
		const resizeRatio = longSide > maxLongSide ? maxLongSide / longSide : 1;

		const apiWidth = Math.max(1, Math.round(originalWidth * resizeRatio));
		const apiHeight = Math.max(1, Math.round(originalHeight * resizeRatio));

		const canvas = document.createElement('canvas');
		canvas.width = apiWidth;
		canvas.height = apiHeight;

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Could not create canvas context');
		}

		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(img, 0, 0, apiWidth, apiHeight);

		let quality = startQuality;
		let blob: Blob | null = null;

		while (quality >= minQuality) {
			blob = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob(resolve, 'image/jpeg', quality);
			});

			if (!blob) break;
			if (blob.size <= maxBytes) break;

			quality -= 0.08;
		}

		if (!blob) {
			throw new Error('Failed to encode image');
		}

		const apiFile = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
			type: 'image/jpeg'
		});

		return {
			apiFile,
			scaleX: originalWidth / apiWidth,
			scaleY: originalHeight / apiHeight,
			originalWidth,
			originalHeight,
			apiWidth,
			apiHeight
		};
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

/**
 * Extracts a usable segmentation-mask URL from a backend response.
 *
 * Data URLs are preferred, followed by supported base64 fields and finally a regular mask URL.
 *
 * @param result - Parsed API response whose mask fields may vary by backend version.
 * @returns A mask data/remote URL, or an empty string when no supported mask is present.
 */
export function getSegmentationMaskUrl(result: any): string {
	if (
		typeof result?.mask_data_url === 'string' &&
		result.mask_data_url.startsWith('data:image/')
	) {
		return result.mask_data_url;
	}

	if (typeof result?.mask_base64 === 'string' && result.mask_base64.length > 0) {
		return `data:image/png;base64,${result.mask_base64}`;
	}

	if (typeof result?.mask_png_base64 === 'string' && result.mask_png_base64.length > 0) {
		return `data:image/png;base64,${result.mask_png_base64}`;
	}

	if (typeof result?.mask_url === 'string' && result.mask_url.length > 0) {
		return result.mask_url;
	}

	return '';
}

/**
 * Runs the complete corner-inference workflow for an uploaded image.
 *
 * The file is prepared for upload, posted to the segmentation endpoint, and the returned mask
 * is fitted locally. Fitted coordinates are rescaled to the original image and attached to the
 * API result together with the refinement score and quality metrics.
 *
 * @param file - Original user image whose card corners should be inferred.
 * @returns The backend result enriched with ordered original-image corners and fit metrics.
 * @throws If preparation, the HTTP request, mask extraction, or quadrilateral fitting fails.
 */
export async function inferCorners(file: File) {
	const prepared = await prepareImageForApi(file, {
		maxBytes: 300_000,
		maxLongSide: 1600
	});

	const formData = new FormData();
	formData.append('file', prepared.apiFile);

	const response = await fetch(`${API_BASE}/infer-json`, {
		method: 'POST',
		body: formData
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || 'Inference request failed');
	}

	const result = await response.json();
	const maskUrl = getSegmentationMaskUrl(result);
	if (!result?.ok || !maskUrl) {
		throw new Error('API did not return a segmentation mask');
	}

	const fitted = await fitQuadFromMask(maskUrl);
	const ids = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
	result.corners = fitted.quad.map((point, index) => ({
		id: ids[index],
		x: point.x * prepared.scaleX,
		y: point.y * prepared.scaleY
	}));
	result.refine_score = fitted.score;
	result.quad_metrics = fitted.metrics;

	return result;
}
