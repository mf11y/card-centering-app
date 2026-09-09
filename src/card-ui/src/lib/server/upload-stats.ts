import { list, type ListBlobResultBlob } from '@vercel/blob';

export const UPLOAD_METADATA_PREFIX = 'uploads/';
export const UPLOAD_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const UPLOAD_STATS_CACHE_MS = 5 * 60 * 1000;
export const UPLOAD_STATS_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';

type Page = { blobs: ListBlobResultBlob[]; cursor?: string; hasMore: boolean };
type ListPage = (cursor?: string) => Promise<Page>;
export type UploadStats = { last7Days: number; windowStart: string; windowEnd: string };

let cached: { expiresAt: number; value: UploadStats } | null = null;
let pendingStatsCalculation: Promise<UploadStats> | null = null;

export function invalidateUploadStatsCache() { cached = null; }

/**
 * Upload storage creates both image and metadata paths from the same UTC timestamp.
 * The metadata path is canonical for this aggregate so counting never downloads JSON bodies.
 */
export function metadataTimestampFromPath(pathname: string): number | null {
    const match = /^uploads\/(\d{4})-(\d{2})-(\d{2})\/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_[0-9a-f]{32}\.json$/i.exec(pathname);
    if (!match) return null;
    const [, folderYear, folderMonth, folderDay, year, month, day, hour, minute, second] = match;
    if (`${year}-${month}-${day}` !== `${folderYear}-${folderMonth}-${folderDay}`) return null;
    const timestamp = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
    const canonical = new Date(timestamp);
    if (canonical.getUTCFullYear() !== +year || canonical.getUTCMonth() + 1 !== +month ||
        canonical.getUTCDate() !== +day || canonical.getUTCHours() !== +hour ||
        canonical.getUTCMinutes() !== +minute || canonical.getUTCSeconds() !== +second) return null;
    return timestamp;
}

export async function countUploadMetadata(now: Date, listPage: ListPage): Promise<UploadStats> {
    const end = now.getTime(), start = end - UPLOAD_STATS_WINDOW_MS;
    const paths = new Set<string>();
    let cursor: string | undefined;
    do {
        const page = await listPage(cursor);
        for (const blob of page.blobs) paths.add(blob.pathname);
        cursor = page.hasMore ? page.cursor : undefined;
        if (page.hasMore && !cursor) throw new Error('Blob listing omitted its pagination cursor');
    } while (cursor);

    let count = 0;
    for (const pathname of paths) {
        const timestamp = metadataTimestampFromPath(pathname);
        if (timestamp !== null && timestamp >= start && timestamp <= end) count++;
    }
    return { last7Days: count, windowStart: new Date(start).toISOString(), windowEnd: now.toISOString() };
}

export async function getUploadStats(now = new Date()): Promise<UploadStats> {
    const time = now.getTime();
    if (cached && cached.expiresAt > time) return cached.value;
    if (pendingStatsCalculation) return pendingStatsCalculation;

    pendingStatsCalculation = countUploadMetadata(now, async (cursor) => list({
        prefix: UPLOAD_METADATA_PREFIX, limit: 1000, ...(cursor ? { cursor } : {})
    })).then((value) => {
        cached = { expiresAt: time + UPLOAD_STATS_CACHE_MS, value };
        return value;
    }).finally(() => { pendingStatsCalculation = null; });
    return pendingStatsCalculation;
}
