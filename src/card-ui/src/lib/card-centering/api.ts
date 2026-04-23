const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/api';

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

	// Scale returned corners back to original image coordinates
	if (Array.isArray(result?.corners)) {
		result.corners = result.corners.map((c: any) => ({
			...c,
			x: c.x * prepared.scaleX,
			y: c.y * prepared.scaleY
		}));
	}

	return result;
}