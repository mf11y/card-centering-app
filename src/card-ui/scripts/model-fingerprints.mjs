import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MODEL_ASSETS = {
    outer: 'static/models/card-segmentation.onnx',
    ranker: 'static/models/learned-inner-v1.bin'
};
/** @param {import("node:crypto").BinaryLike} bytes */
export function fingerprint(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
export function readModelFingerprints(root = fileURLToPath(new URL('../', import.meta.url))) {
    return Object.fromEntries(Object.entries(MODEL_ASSETS).map(([name, path]) => {
        try { return [name, fingerprint(readFileSync(`${root}/${path}`))]; }
        catch (error) { throw new Error(`Cannot fingerprint required production ${name} asset: ${path}`, { cause: error }); }
    }));
}
/** Vite invokes config for both dev and build; no checked-in hash can become stale. */
export function modelFingerprintsPlugin() {
    /** @type {Record<string, string>} */
    let hashes;
    return {
        name: 'production-model-fingerprints',
        config() {
            hashes = readModelFingerprints();

        },
        /** @param {string} id */
        resolveId(id) {
            if (id === 'virtual:production-model-fingerprints') return '\0production-model-fingerprints';
        },
        /** @param {string} id */
        load(id) {
            if (id === '\0production-model-fingerprints') {
                return `export const OUTER_MODEL_ASSET_HASH = ${JSON.stringify(hashes.outer)}; export const LEARNED_RANKER_ASSET_HASH = ${JSON.stringify(hashes.ranker)};`;
            }
        },
        generateBundle() {
            const current = readModelFingerprints();
            for (const name of Object.keys(hashes)) {
                if (hashes[name] !== current[name]) throw new Error(`Production ${name} asset changed during build; restart the build.`);
            }
        }
    };
}
