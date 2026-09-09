import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUploadStats, UPLOAD_STATS_CACHE_CONTROL } from '$lib/server/upload-stats';

export const prerender = false;

export const GET: RequestHandler = async () => {
    const headers = { 'cache-control': UPLOAD_STATS_CACHE_CONTROL };
    const productionBlobPath = !dev || env.VERCEL === '1';
    if (!productionBlobPath) return json({ last7Days: null }, { headers });
    try {
        return json(await getUploadStats(new Date()), { headers });
    } catch {
        return json({ last7Days: null }, { headers });
    }
};
