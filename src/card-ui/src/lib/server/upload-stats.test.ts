import assert from 'node:assert/strict';
import test from 'node:test';
import { countUploadMetadata, metadataTimestampFromPath, UPLOAD_STATS_CACHE_CONTROL } from './upload-stats.ts';

const NOW = new Date('2026-09-08T09:30:00.000Z');
const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const pathAt = (date: string, time: string, suffix = id) => `uploads/${date}/${date.replaceAll('-', '')}_${time}_${suffix}.json`;
const blob = (pathname: string) => ({ pathname, url: '', downloadUrl: '', size: 1, uploadedAt: NOW, etag: '' });

test('uses one list call at current scale and needs no metadata reader', async () => {
    let calls = 0;
    const result = await countUploadMetadata(NOW, async () => {
        calls++;
        return { blobs: [blob(pathAt('2026-09-08', '090000'))], hasMore: false };
    });
    assert.equal(calls, 1);
    assert.equal(result.last7Days, 1);
});

test('follows pagination and de-duplicates metadata pathnames', async () => {
    let calls = 0;
    const path = pathAt('2026-09-08', '080000');
    const result = await countUploadMetadata(NOW, async cursor => {
        calls++;
        return cursor ? { blobs: [blob(path)], hasMore: false } : { blobs: [blob(path)], cursor: 'next', hasMore: true };
    });
    assert.equal(calls, 2);
    assert.equal(result.last7Days, 1);
});

test('parses canonical UTC pathname timestamps and validates calendar dates', () => {
    assert.equal(metadataTimestampFromPath(pathAt('2026-09-08', '093000')), NOW.getTime());
    assert.equal(metadataTimestampFromPath(pathAt('2026-02-30', '093000')), null);
    assert.equal(metadataTimestampFromPath('uploads/2026-09-08/20260907_093000_' + id + '.json'), null);
});

test('includes exact cutoff and excludes older and future records', async () => {
    const result = await countUploadMetadata(NOW, async () => ({ blobs: [
        blob(pathAt('2026-09-01', '093000')),
        blob(pathAt('2026-09-01', '092959', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
        blob(pathAt('2026-09-08', '093001', 'cccccccccccccccccccccccccccccccc'))
    ], hasMore: false }));
    assert.equal(result.last7Days, 1);
});

test('ignores malformed paths, image blobs, and unrelated JSON', async () => {
    const result = await countUploadMetadata(NOW, async () => ({ blobs: [
        blob('uploads/2026-09-08/photo.jpg'),
        blob('uploads/2026-09-08/random.json'),
        blob('uploads/2026-09-08/20260908_090000_not-a-uuid.json')
    ], hasMore: false }));
    assert.equal(result.last7Days, 0);
});

test('empty store returns zero', async () => {
    assert.equal((await countUploadMetadata(NOW, async () => ({ blobs: [], hasMore: false }))).last7Days, 0);
});

test('aggregate endpoint cache policy enables shared caching', () => {
    assert.equal(UPLOAD_STATS_CACHE_CONTROL, 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
});
