import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { put, del } from '@vercel/blob';
import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
export class CaptureError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function readUpload(request: Request): Promise<File> {
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
        throw new CaptureError(415, 'Expected multipart image upload');
    }
    if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) {
        throw new CaptureError(413, 'Capture limit is 4 MiB');
    }
    const reader = request.body?.getReader();
    if (!reader) throw new CaptureError(400, 'Missing upload');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_REQUEST_BYTES) {
                await reader.cancel();
                throw new CaptureError(413, 'Capture limit is 4 MiB');
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    let form: FormData;
    try {
        form = await new Response(Buffer.concat(chunks), {
            headers: { 'content-type': request.headers.get('content-type')! }
        }).formData();
    } catch { throw new CaptureError(400, 'Invalid multipart upload'); }
    const entries = [...form.entries()];
    if (entries.length !== 1 || entries[0][0] !== 'file' || typeof entries[0][1] === 'string') {
        throw new CaptureError(400, 'Expected one file');
    }
    return entries[0][1];
}

type Settings = { production: boolean; localDirectory?: string };
type BlobClient = { put: typeof put; del: typeof del };

/** Only original bytes are persisted. Decoding validates the image, never rewrites it. */
export async function captureUpload(file: File, settings: Settings, blobs: BlobClient = { put, del }) {
    if (!file.type.startsWith('image/')) throw new CaptureError(415, 'Expected an image');
    if (!file.size) throw new CaptureError(400, 'Empty image');
    if (file.size > MAX_IMAGE_BYTES) throw new CaptureError(413, 'Capture limit is 4 MiB');
    const bytes = Buffer.from(await file.arrayBuffer());
    let width: number, height: number, extension: string, contentType: string;
    try {
        const decoded = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
        const info = await decoded.metadata();
        const formats: Record<string, [string, string]> = {
            jpeg: ['jpg', 'image/jpeg'], png: ['png', 'image/png'],
            webp: ['webp', 'image/webp'], gif: ['gif', 'image/gif']
        };
        if (!info.format || !formats[info.format] || !info.width || !info.height) throw new Error();
        [extension, contentType] = formats[info.format];
        width = info.width; height = info.height;
        await decoded.stats(); // Decode the first frame to reject corrupt payloads.
    } catch { throw new CaptureError(415, 'Capture supports valid JPEG, PNG, WebP and GIF images up to 40 megapixels'); }

    const timestamp = new Date().toISOString();
    const day = timestamp.slice(0, 10);
    const stem = `${day.replaceAll('-', '')}_${timestamp.slice(11, 19).replaceAll(':', '')}_${randomUUID().replaceAll('-', '')}`;
    const filename = `${stem}.${extension}`;
    const objectKey = `uploads/${day}/${filename}`;
    const originalExtension = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name)?.[1].toLowerCase() ?? '';
    const metadata = {
        timestamp, event: 'image_upload', stored_filename: filename,
        object_key: objectKey, original_extension: originalExtension, extension,
        size_bytes: bytes.length, width, height,
        sha256: createHash('sha256').update(bytes).digest('hex')
    };
    const json = JSON.stringify(metadata, null, 2) + '\n';
    if (settings.production) {
        // Never fall back to ephemeral disk on Vercel or in a production build.
        // The SDK resolves BLOB_STORE_ID + Vercel OIDC credentials and refreshes tokens.
        // Do not pass an explicit token: that overrides automatic OIDC authentication.
        const options = { access: 'private' as const, addRandomSuffix: false, allowOverwrite: false };
        const image = await blobs.put(objectKey, bytes, { ...options, contentType });
        try {
            await blobs.put(`uploads/${day}/${stem}.json`, json, { ...options, contentType: 'application/json' });
        } catch (error) {
            // Best effort rollback; a failed delete can leave an orphan image for manual cleanup.
            try { await blobs.del(image.url); } catch { /* no secrets in logs */ }
            throw error;
        }
    } else {
        const root = resolve(settings.localDirectory || '../../api/card-api/upload_logs');
        if (root.split(/[\\/]/).some(part => /^(static|public)$/i.test(part))) {
            throw new CaptureError(503, 'Capture directory must be private');
        }
        const directory = resolve(root, day);
        await mkdir(directory, { recursive: true });
        const imagePath = resolve(directory, filename);
        await writeFile(imagePath, bytes, { flag: 'wx' });
        try { await writeFile(resolve(directory, `${stem}.json`), json, { flag: 'wx' }); }
        catch (error) { await unlink(imagePath).catch(() => {}); throw error; }
    }
    return { ok: true, stored_filename: filename, object_key: objectKey };
}
