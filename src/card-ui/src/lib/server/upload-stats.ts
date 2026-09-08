import { get, list, type ListBlobResultBlob } from '@vercel/blob';

export const UPLOAD_METADATA_PREFIX = 'uploads/';
export const UPLOAD_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const UPLOAD_STATS_CACHE_MS = 60 * 1000;

type Metadata = { timestamp?: unknown; event?: unknown; object_key?: unknown; stored_filename?: unknown };
type Page = { blobs: ListBlobResultBlob[]; cursor?: string; hasMore: boolean };
type ListPage = (prefix: string, cursor?: string) => Promise<Page>;
type ReadMetadata = (pathname: string) => Promise<string>;
export type UploadStats = { last7Days: number; windowStart: string; windowEnd: string };

let cached: { expiresAt: number; value: UploadStats } | null = null;
export function invalidateUploadStatsCache() { cached = null; }

export function isUploadMetadataPath(pathname: string) {
    return /^uploads\/\d{4}-\d{2}-\d{2}\/\d{8}_\d{6}_[0-9a-f]{32}\.json$/i.test(pathname);
}

export function metadataTimestamp(text: string, pathname: string): number | null {
    try {
        const value = JSON.parse(text) as Metadata;
        if (value.event !== 'image_upload' || typeof value.timestamp !== 'string' ||
            typeof value.object_key !== 'string' || typeof value.stored_filename !== 'string') return null;
        const imagePrefix = pathname.slice(0, -'.json'.length);
        if (!value.object_key.startsWith(imagePrefix + '.') ||
            value.object_key !== `${pathname.slice(0, pathname.lastIndexOf('/') + 1)}${value.stored_filename}`) return null;
        const timestamp = Date.parse(value.timestamp);
        return Number.isFinite(timestamp) ? timestamp : null;
    } catch { return null; }
}

export function metadataPrefixesForWindow(start: number, end: number) {
    const prefixes: string[] = [];
    const day = new Date(start); day.setUTCHours(0, 0, 0, 0);
    while (day.getTime() <= end) {
        prefixes.push(`${UPLOAD_METADATA_PREFIX}${day.toISOString().slice(0, 10)}/`);
        day.setUTCDate(day.getUTCDate() + 1);
    }
    return prefixes;
}

export async function countUploadMetadata(now: Date, listPage: ListPage, readMetadata: ReadMetadata): Promise<UploadStats> {
    const end = now.getTime(), start = end - UPLOAD_STATS_WINDOW_MS;
    const paths = new Set<string>();
    for (const prefix of metadataPrefixesForWindow(start, end)) {
        let cursor: string | undefined;
        do {
            const page = await listPage(prefix, cursor);
            for (const blob of page.blobs) if (isUploadMetadataPath(blob.pathname)) paths.add(blob.pathname);
            cursor = page.hasMore ? page.cursor : undefined;
            if (page.hasMore && !cursor) throw new Error('Blob listing omitted its pagination cursor');
        } while (cursor);
    }

    const pathList = [...paths];
    let count = 0;
    for (let offset = 0; offset < pathList.length; offset += 12) {
        const timestamps = await Promise.all(pathList.slice(offset, offset + 12).map(async (pathname) => {
            try { return metadataTimestamp(await readMetadata(pathname), pathname); } catch { return null; }
        }));
        count += timestamps.filter((timestamp) => timestamp !== null && timestamp >= start && timestamp <= end).length;
    }
    return { last7Days: count, windowStart: new Date(start).toISOString(), windowEnd: now.toISOString() };
}

async function readBlobText(pathname: string) {
    const result = await get(pathname, { access: 'private', useCache: true });
    if (!result || result.statusCode !== 200) throw new Error('Metadata blob unavailable');
    return new Response(result.stream).text();
}

export async function getUploadStats(now = new Date(), force = false): Promise<UploadStats> {
    const time = now.getTime();
    if (!force && cached && cached.expiresAt > time) return cached.value;
    const value = await countUploadMetadata(now, async (prefix, cursor) => list({
        prefix, limit: 1000, ...(cursor ? { cursor } : {})
    }), readBlobText);
    cached = { expiresAt: time + UPLOAD_STATS_CACHE_MS, value };
    return value;
}
