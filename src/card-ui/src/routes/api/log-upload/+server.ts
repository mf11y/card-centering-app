import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { captureUpload, CaptureError, readUpload } from '$lib/server/upload-storage';

export const prerender = false;

export const POST: RequestHandler = async ({ request, url }) => {
    const headers = { 'cache-control': 'no-store' };
    // Same-origin browser uploads only. This is not authentication or abuse prevention.
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ ok: false }, { status: 403, headers });
    try {
        const file = await readUpload(request);
        const result = await captureUpload(file, {
            production: !dev || env.VERCEL === '1',
            localDirectory: env.UPLOAD_LOG_DIR
        });
        return json(result, { status: 201, headers });
    } catch (error) {
        const status = error instanceof CaptureError ? error.status : 503;
        if (status >= 500) console.warn('Upload capture unavailable');
        return json({ ok: false, error: status >= 500 ? 'Capture unavailable' : (error as Error).message }, { status, headers });
    }
};
