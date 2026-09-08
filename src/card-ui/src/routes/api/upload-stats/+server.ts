import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUploadStats } from '$lib/server/upload-stats';

export const prerender = false;

export const GET: RequestHandler = async ({ url }) => {
    const headers = { 'cache-control': 'private, max-age=0, no-store' };
    const productionBlobPath = !dev || env.VERCEL === '1';
    if (!productionBlobPath) return json({ last7Days: null }, { headers });
    try {
        return json(await getUploadStats(new Date(), url.searchParams.get('refresh') === '1'), { headers });
    } catch {
        return json({ last7Days: null }, { headers });
    }
};
