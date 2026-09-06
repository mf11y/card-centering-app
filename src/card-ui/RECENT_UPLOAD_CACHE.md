# Recent upload cache

Original selected image bytes are SHA-256 hashed using Web Crypto before `/api/log-upload`. IndexedDB database `card-centering-recent-uploads`, store `images`, holds at most five unique originals. Lookup, recency updates, insertion, and least-recently-used eviction share one read/write transaction (including across tabs). Same bytes under another filename hit; changed bytes under the same filename miss. Evicted or browser-cleared images are new uploads next time.

Each entry contains sha256, Blob, MIME type, byteSize, originalFileName (when supplied), createdAt, and lastUsedAt. Successful initial outer inference adds the unedited corners and mask data URL. No user-adjusted geometry is saved. A hit suppresses capture even if its result is missing or stale. Capture stays best-effort; cache/storage/crypto failure uses the existing uncached workflow. Cached blobs receive fresh working object URLs; existing reset/unmount cleanup revokes them.

`CARD_PROCESSING_VERSION` in `src/lib/card-centering/processing-version.ts` combines manual `CARD_PIPELINE_COMPAT_VERSION = 'pipeline-v1'` with full SHA-256 fingerprints: `pipeline-v1__outer-<outer hash>__ranker-<ranker hash>`.

Vite's `production-model-fingerprints` plugin (`scripts/model-fingerprints.mjs`) reads the exact `static/models/card-segmentation.onnx` and `static/models/learned-inner-v1.bin` bytes when dev/build config loads. Its virtual module supplies constants to client and SSR, without generating a checked-in file or hashing model assets per upload. Missing assets fail clearly; bundling checks for changes since startup. Restart dev after changing a model asset. Normal `npm run build` and `npm run dev`, and direct Vite invocations, automatically run the plugin. Both model fingerprints are automatic; outer weights do not require a manual bump.

Bump the manual pipeline version for output-affecting non-weight changes: outer preprocessing/detection logic, source quad/refinement, warp/curved transformations, inner candidate generation, numeric feature construction/voting, centering math, result semantics/schema. Do not bump for CSS, copy, layout or unrelated UI. This is one conservative compatibility boundary: a mismatch reruns the full processing pipeline; no separate per-stage compatibility logic. The optional cached result currently contains only automatic outer corners/mask; WARP and inner analysis still run normally on every restoration.

Image SHA-256 identifies an upload. Model SHA-256 identifies compatible analysis. Example (abbreviated): `pipeline-v1__outer-123__ranker-abc` becomes `pipeline-v1__outer-123__ranker-def` after changing weights. Selecting the same image remains a local hit, suppresses upload logging, rejects old analysis, runs current processing, and saves the new key. A pipeline-only change has the same invalidation behavior. Neither change deletes the source Blob or its creation metadata.


Development only: inspect `window.__recentUploadCache` for cache hit/miss/unavailable, entry count at latest lookup, inference reused/rerun, imageHash, analysisCacheHit, staleAnalysisVersion, processingRerun, duplicateUploadSuppressed, lruEvictions, and currentProcessingVersion. No hashes, names, images, or diagnostics are sent to a server. Normal production UI has no cache details.

## Verification

Start `npm.cmd run dev -- --host 127.0.0.1 --port 4180`. With Python Playwright and Edge installed, run `python scripts/test-recent-upload-cache.py`. Optional `REVIEW_TEST_URL` changes the server URL. Tests use fresh isolated browser contexts and real Web Crypto/IndexedDB. UI inference and capture are mocked to count calls without uploading test images. Geometry/model behavior is not mocked in production code.

Verified miss/hit, identical filename with changed bytes, five-entry eviction, refresh persistence, incompatible result invalidation, unavailable-IDB fallback, one capture/one inference across duplicate UI selections, cached inference after refresh, and stale inference rerun without recapture. TypeScript and Vite client/SSR compilation pass. Full local Vercel packaging still fails at the pre-existing Windows EPERM symlink step.

Derived results live only in `analysis: { processingVersion, result, processedAt }`. A mismatch removes analysis on lookup while preserving the original Blob, creation timestamp, SHA-256 key, and duplicate-hit status. Flat legacy entries are migrated on use: source metadata is preserved; legacy derived results are recomputed once. The IndexedDB name/store/schema version does not change for model updates.

The database schema remains version 1 with a SHA-256 keyPath; flat source metadata migrates lazily. Cache entries own no object URLs, so eviction does not revoke an active UI image. Malformed analysis is removed independently of its valid original; a corrupt original or database/hash/transaction failure falls back to uncached processing and best-effort capture. Automated UI tests also verify manual guide nudging after restoration and unchanged capture for new bytes.

Fingerprint tests: `node --test scripts/model-fingerprints.test.mjs`. Browser tests also exercise model-key and pipeline-only invalidation, saving the current key, unchanged-key reuse, and no duplicate capture.
