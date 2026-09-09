import assert from 'node:assert/strict';
import test from 'node:test';
import { logUploadedImage } from './upload-logging.ts';

const image = new File([new Uint8Array([1, 2, 3])], 'card.jpg', { type: 'image/jpeg' });

test('reports success only after the capture endpoint confirms creation', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, created: true }), { status: 201 });
    try { assert.equal(await logUploadedImage(image), true); } finally { globalThis.fetch = original; }
});

test('capture failure returns false and remains non-throwing', async () => {
    const originalFetch = globalThis.fetch, originalWarn = console.warn;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), { status: 503 });
    console.warn = () => {};
    try { assert.equal(await logUploadedImage(image), false); }
    finally { globalThis.fetch = originalFetch; console.warn = originalWarn; }
});


test('successful response without confirmed creation does not increment', async () => {
    const originalFetch = globalThis.fetch, originalWarn = console.warn;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, created: false }), { status: 200 });
    console.warn = () => {};
    try { assert.equal(await logUploadedImage(image), false); }
    finally { globalThis.fetch = originalFetch; console.warn = originalWarn; }
});
