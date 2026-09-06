import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, readModelFingerprints, MODEL_ASSETS, modelFingerprintsPlugin } from './model-fingerprints.mjs';

test('SHA-256 is deterministic and sensitive to one changed weight byte', () => {
    const bytes = Buffer.from([0, 1, 2, 3]);
    assert.equal(fingerprint(bytes), fingerprint(Buffer.from(bytes)));
    assert.notEqual(fingerprint(bytes), fingerprint(Buffer.from([0, 1, 2, 4])));
});
test('reads exact asset bytes, regenerates on change, fails for missing asset', () => {
    const root = mkdtempSync(join(tmpdir(), 'card-model-hash-'));
    try {
        mkdirSync(join(root, 'static/models'), { recursive: true });
        assert.throws(() => readModelFingerprints(root), /required production outer asset/);
        for (const path of Object.values(MODEL_ASSETS)) writeFileSync(join(root, path), Buffer.from([1, 2]));
        const first = readModelFingerprints(root);
        assert.deepEqual(first, readModelFingerprints(root));
        writeFileSync(join(root, MODEL_ASSETS.ranker), Buffer.from([1, 3]));
        const next = readModelFingerprints(root);
        assert.equal(first.outer, next.outer);
        assert.notEqual(first.ranker, next.ranker);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
test('normal Vite configuration exposes current shipped bytes', () => {
    const plugin = modelFingerprintsPlugin();
    plugin.config();
    const generated = plugin.load(plugin.resolveId('virtual:production-model-fingerprints'));
    const hashes = readModelFingerprints();
    assert.ok(generated.includes(hashes.ranker));
    assert.ok(generated.includes(hashes.outer));
    plugin.generateBundle();
});
