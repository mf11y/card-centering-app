const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/api';

export async function compressImageForApiIfNeeded(
	file: File,
	maxBytes = 300_000
): Promise<File> {
	if (file.size <= maxBytes) return file;

	const img = new Image();
	const objectUrl = URL.createObjectURL(file);

	try {
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('Failed to load image for compression'));
			img.src = objectUrl;
		});

		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');

		if (!ctx) return file;

		const width = img.naturalWidth;
		const height = img.naturalHeight;

		canvas.width = width;
		canvas.height = height;

		ctx.drawImage(img, 0, 0, width, height);

		let quality = 0.9;
		let blob: Blob | null = null;

		for (let i = 0; i < 8; i++) {
			blob = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob(resolve, 'image/jpeg', quality);
			});

			if (!blob) return file;
			if (blob.size <= maxBytes) break;

			quality -= 0.08;
		}

		if (!blob) return file;

		return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
			type: 'image/jpeg'
		});
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
	const apiFile = await compressImageForApiIfNeeded(file);

	const formData = new FormData();
	formData.append('file', apiFile);

	const response = await fetch(`${API_BASE}/infer-json`, {
		method: 'POST',
		body: formData
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || 'Inference request failed');
	}

	return response.json();
}