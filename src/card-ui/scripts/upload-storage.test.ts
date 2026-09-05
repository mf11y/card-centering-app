import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { captureUpload, CaptureError, readUpload, MAX_IMAGE_BYTES } from '../src/lib/server/upload-storage.ts';

const bytes = await sharp({ create: { width: 12, height: 20, channels: 3, background: 'blue' } }).png().toBuffer();
const file = () => new File([bytes], '../../private-name.jpeg', { type: 'image/png' });

test('local capture preserves bytes, safe names, dimensions and metadata without identifiers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capture-test-'));
    try {
        const results = await Promise.all(Array.from({ length: 6 }, () => captureUpload(file(), { production: false, localDirectory: root })));
        assert.equal(new Set(results.map(r => r.object_key)).size, 6);
        for (const result of results) {
            assert.match(result.object_key, /^uploads\/\d{4}-\d{2}-\d{2}\/\d{8}_\d{6}_[a-f0-9]{32}\.png$/);
            const relative = result.object_key.replace('uploads/', '');
            assert.deepEqual(await readFile(join(root, relative)), bytes);
            const metadata = JSON.parse(await readFile(join(root, relative.replace('.png', '.json')), 'utf8'));
            assert.equal(metadata.width, 12); assert.equal(metadata.height, 20);
            assert.equal(metadata.size_bytes, bytes.length);
            assert.equal(metadata.original_extension, 'jpeg');
            assert.equal(metadata.extension, 'png');
            assert.equal(metadata.object_key, result.object_key);
            assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
            assert.ok(!JSON.stringify(metadata).includes('private-name'));
            assert.deepEqual(Object.keys(metadata).sort(), ['timestamp','event','stored_filename','object_key','original_extension','extension','size_bytes','width','height','sha256'].sort());
        }
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('production uses private Blob for original image and JSON, never local disk', async () => {
    const calls: any[] = [];
    const client: any = { put: async (...args: any[]) => { calls.push(args); return { url: 'https://private.invalid/file' }; }, del: async () => {} };
    const result = await captureUpload(file(), { production: true }, client);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], result.object_key); assert.deepEqual(calls[0][1], bytes);
    assert.equal(calls[1][0], result.object_key.replace('.png', '.json'));
    for (const call of calls) {
        assert.equal(call[2].access, 'private'); assert.equal(call[2].allowOverwrite, false);
        assert.equal(call[2].addRandomSuffix, false);
        assert.ok(!('token' in call[2]));
        assert.ok(!('oidcToken' in call[2]));
    }
    assert.ok(!('url' in result));
});

test('missing credentials fail closed even with a writable local directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capture-test-'));
    try {
        const unavailable: any = { put: async () => { throw new Error('No blob credentials found'); }, del: async () => {} };
        await assert.rejects(captureUpload(file(), { production: true, localDirectory: root }, unavailable), /No blob credentials/);
        assert.deepEqual(await readdir(root), []);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('metadata failure rolls back Blob image; storage outage rejects', async () => {
    let puts = 0; const deleted: string[] = [];
    const client: any = {
        put: async () => { if (++puts === 2) throw new Error('outage'); return { url: 'private-image' }; },
        del: async (url: string, options: unknown) => { assert.equal(options, undefined); deleted.push(url); }
    };
    await assert.rejects(captureUpload(file(), { production: true }, client));
    assert.deepEqual(deleted, ['private-image']);
});

test('invalid, oversized and truncated images are rejected before storage', async () => {
    for (const bad of [new File(['text'], 'fake.png', { type: 'image/png' }), new File([bytes.subarray(0, 45)], 'truncated.png', { type: 'image/png' })]) {
        await assert.rejects(captureUpload(bad, { production: true }), (e: any) => e instanceof CaptureError && e.status === 415);
    }
    await assert.rejects(captureUpload(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' }), { production: true }), (e: any) => e.status === 413);
});

test('bounded multipart parser accepts one file and rejects invalid/oversize requests', async () => {
    const form = new FormData(); form.append('file', file());
    const parsed = await readUpload(new Request('https://example.test/api/log-upload', { method: 'POST', body: form }));
    assert.deepEqual(Buffer.from(await parsed.arrayBuffer()), bytes);
    form.append('extra', 'no');
    await assert.rejects(readUpload(new Request('https://example.test/', { method: 'POST', body: form })), (e: any) => e.status === 400);
    await assert.rejects(readUpload(new Request('https://example.test/', { method: 'POST', body: new Uint8Array(MAX_IMAGE_BYTES + 65537), headers: { 'content-type': 'multipart/form-data; boundary=test' } })), (e: any) => e.status === 413);
});
