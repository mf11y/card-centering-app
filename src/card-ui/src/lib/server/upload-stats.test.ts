import assert from 'node:assert/strict';
import test from 'node:test';
import { countUploadMetadata, isUploadMetadataPath, metadataPrefixesForWindow, metadataTimestamp } from './upload-stats.ts';

const NOW = new Date('2026-09-08T09:30:00.000Z');
const prefix = 'uploads/2026-09-01/20260901_093000_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const path = `${prefix}.json`;
const metadata = (timestamp: string, pathPrefix = prefix, overrides: Record<string, unknown> = {}) => JSON.stringify({
    timestamp, event: 'image_upload', stored_filename: `${pathPrefix.split('/').at(-1)}.jpg`, object_key: `${pathPrefix}.jpg`, ...overrides
});
const blob = (pathname: string) => ({ pathname, url: '', downloadUrl: '', size: 1, uploadedAt: NOW, etag: '' });

test('includes exact cutoff and recent records, excluding older and future timestamps', async () => {
    const prefixes = [prefix, prefix.replace('aaaaaaaa', 'bbbbbbbb'), prefix.replace('aaaaaaaa', 'cccccccc'), prefix.replace('aaaaaaaa', 'dddddddd')];
    const times = ['2026-09-01T09:30:00.000Z', '2026-09-08T09:29:59.999Z', '2026-09-01T09:29:59.999Z', '2026-09-08T09:30:00.001Z'];
    const texts = new Map(prefixes.map((p, i) => [`${p}.json`, metadata(times[i], p)]));
    const result = await countUploadMetadata(NOW, async (listedPrefix) => ({ blobs: listedPrefix === 'uploads/2026-09-01/' ? [...texts.keys()].map(blob) : [], hasMore: false }), async p => texts.get(p)!);
    assert.equal(result.last7Days, 2);
});

test('follows pagination and counts each metadata pathname once', async () => {
    let calls = 0;
    const result = await countUploadMetadata(NOW, async (listedPrefix, cursor) => {
        if (listedPrefix !== 'uploads/2026-09-01/') return { blobs: [], hasMore: false };
        calls++;
        return cursor ? { blobs: [blob(path)], hasMore: false } : { blobs: [blob(path)], cursor: 'next', hasMore: true };
    }, async () => metadata('2026-09-08T08:00:00.000Z'));
    assert.equal(calls, 2);
    assert.equal(result.last7Days, 1);
});

test('ignores malformed, unrelated, missing-field, and non-metadata blobs', async () => {
    const unrelated = 'uploads/2026-09-01/random.json';
    const result = await countUploadMetadata(NOW, async (listedPrefix) => ({ blobs: listedPrefix === 'uploads/2026-09-01/' ? [blob(path), blob(unrelated), blob(`${prefix}.jpg`)] : [], hasMore: false }),
        async pathname => pathname === path ? '{bad json' : metadata('2026-09-08T08:00:00.000Z'));
    assert.equal(result.last7Days, 0);
    assert.equal(isUploadMetadataPath(unrelated), false);
    assert.equal(metadataTimestamp(metadata('2026-09-08T08:00:00.000Z', prefix, { object_key: 'uploads/wrong.jpg' }), path), null);
});


test('lists only UTC day prefixes intersecting the rolling window', () => {
    const prefixes = metadataPrefixesForWindow(Date.parse('2026-09-01T09:30:00Z'), NOW.getTime());
    assert.deepEqual(prefixes, [
        'uploads/2026-09-01/', 'uploads/2026-09-02/', 'uploads/2026-09-03/', 'uploads/2026-09-04/',
        'uploads/2026-09-05/', 'uploads/2026-09-06/', 'uploads/2026-09-07/', 'uploads/2026-09-08/'
    ]);
});
