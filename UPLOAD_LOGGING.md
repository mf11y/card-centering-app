# Upload capture: Vercel production, local development

## Deployment audit (2026-09-05)

The deployable web app is `src/card-ui`, a SvelteKit app using `@sveltejs/adapter-vercel`. The previous logging route was added only to the separate `api/card-api` FastAPI service. There was no SvelteKit upload endpoint or repository configuration that deployed that Python logging handler with the frontend. Do not infer a deployed Python backend from its presence in this repository.

The live `https://cardcentering.app/api/log-upload` returned **404** for both HEAD and an empty, non-image POST on 2026-09-05. Its response included Vercel headers. Cloudflare CDN headers do not imply a Cloudflare Tunnel or a service running on a personal PC. Production storage has **not** been verified: these changes have not been deployed and no real Blob write/download has been performed.

The new `src/routes/api/log-upload/+server.ts` is a Node server endpoint included by the existing Vercel adapter. No FastAPI server, Docker service, external API hostname, tunnel, CORS setup or `PUBLIC_UPLOAD_LOG_URL` is required. The superseded Python logging router, tests, filelock dependency and logging-specific Docker configuration were removed. Existing inference code and local captured files remain intact.

## Production setup

1. In the Vercel project serving cardcentering.app, confirm the framework is SvelteKit and the root directory is `src/card-ui` (or the equivalent existing build configuration).
2. In Storage, create/connect a Blob store with **Private** access. A public store is unsuitable; this code always specifies `access: 'private'` and never retries as public.
3. Ensure the private store connection includes **Production**. The installed `@vercel/blob` 2.8.0 automatically uses `BLOB_STORE_ID` and Vercel-managed `VERCEL_OIDC_TOKEN`, including token refresh. Do not manually paste either a static secret or an OIDC token. `BLOB_READ_WRITE_TOKEN` is **not required**; the SDK can still use it as a fallback outside OIDC environments. Configure Preview separately if captures are desired there. Missing or unauthorized credentials return 503 and never write to production disk.
4. Deploy the updated frontend. Install/build from the committed lockfile with optional dependencies enabled, so Sharp installs its Linux runtime on Vercel. No new Python dependencies are needed.

The server dependencies are `@vercel/blob` and `sharp`. No secret is hardcoded or included in the browser bundle. Neither uploads nor rollback deletes pass `token` or `oidcToken` options, allowing SDK credential resolution on each operation. `BLOB_WEBHOOK_PUBLIC_KEY` is not used by this server-upload flow. The live connected-store environment cannot be inspected from this workspace: no authenticated Vercel CLI/project connection is available. If the private store is already connected to Production with the standard `BLOB_STORE_ID`, deploying this updated code is sufficient; otherwise update that store connection first. Redeploying an older commit will not include this fix. Vercel supplies `VERCEL` automatically; do not set `PUBLIC_`/`VITE_` tokens. `UPLOAD_LOG_DIR` is ignored in production. Any non-development build, including local preview, requires Blob credentials and never falls back to disk.

After deployment, the browser posts one multipart `file` to **`https://cardcentering.app/api/log-upload`** when the user selects/drops an image. It never waits for this request before local processing. Page visits, refreshes, sample images and repeated inference do not create captures. Network errors, timeouts and storage failures leave browser processing available.

## Stored objects and privacy

Example keys (dates and times are UTC):

```text
uploads/2026-09-05/20260905_153012_a83d2f0123456789abcdef0123456789.jpg
uploads/2026-09-05/20260905_153012_a83d2f0123456789abcdef0123456789.json
```

The image is the exact original uploaded bytes, not a resized or recompressed image. Sharp validates JPEG, PNG, WebP and GIF, decoding the first frame; other formats are skipped with a best-effort failure and can still be processed by the existing browser flow. Maximum capture size is **4 MiB**, maximum image dimensions are **40 million pixels**. The request parser allows another 64 KiB for multipart overhead. The former 10 MiB cap exceeded Vercel's 4.5 MB function request limit. Larger-image capture would require a separate direct-to-Blob upload flow; this implementation does not resize files to hide that limitation.

The JSON sidecar contains UTC timestamp, event, generated filename, object key, sanitized original extension, detected extension, byte size, width, height and SHA-256. No original basename, IP address, user agent, cookies, referrer or fingerprint is recorded by this feature. Original file bytes can themselves contain embedded EXIF metadata; they are preserved as requested. Hosting providers may maintain their own request logs separately.

Both image and JSON use **private** access, unique UUID filenames and overwrite protection. URLs are **not public**: knowing the URL does not grant anonymous access. The response returns a generated key, never a Blob URL or credential. The app exposes no listing/download endpoint. A metadata-write failure triggers best-effort deletion of the image; a simultaneous deletion failure can leave an orphan for manual cleanup. Retention disclosure remains beside the upload controls. There is no automatic expiry/deletion policy in this change.

## Inspect and download

Open the private store in the Vercel Storage dashboard and browse `uploads/<UTC date>/`. Each image has a matching JSON sidecar. Use authenticated dashboard access to inspect the objects.

For an authenticated download, use Vercel CLI `vercel env pull .env.local` from the linked project to obtain connected Development credentials in a private, git-ignored file. This requires the store to be connected to Development and a logged-in CLI. The SDK can refresh those local OIDC credentials using the CLI login. A static `BLOB_READ_WRITE_TOKEN` is an optional alternative for the local download helper, not a production requirement. Do not put credentials in code, public configuration or terminal command history. From `src/card-ui`, using Node 22.18+ or 24:

```powershell
node --env-file=.env.local scripts/download-upload.mjs "uploads/2026-09-05/<actual-generated-name>.jpg" "$env:TEMP\captured-card.jpg"
node --env-file=.env.local scripts/download-upload.mjs "uploads/2026-09-05/<actual-generated-name>.json" "$env:TEMP\captured-card.json"
```

Replace the example key with the exact dashboard/response key. The helper refuses to overwrite an existing destination and prints the downloaded SHA-256. It runs locally and adds no public route.

## Local development

```powershell
cd C:\Users\Cuco\card-centering-app\src\card-ui
npm install
npm run dev
```

Vite development mode writes original images and JSON sidecars to `api/card-api/upload_logs/<UTC date>/`. `UPLOAD_LOG_DIR` optionally overrides the local root; never point it at served content. No Blob token or Python server is needed for development. Existing `events.jsonl` and image files are preserved; new captures use individual JSON sidecars to avoid shared-file concurrency problems. Git and Docker exclude the default log directory.

## Verify one production upload

1. After deploying, open cardcentering.app and DevTools Network. Select one known JPEG/PNG/WebP/GIF under 4 MiB. Confirm the retention disclosure is visible and detection still completes.
2. Check exactly one same-origin `POST /api/log-upload` returns **201** with `ok: true` and an `object_key`. A 404 means the route is not deployed; 413 means the capture is too large; 503 means storage/configuration failed. No captured image is expected after a page refresh alone.
3. Find that exact key and matching JSON in the private Blob store. Download both using authenticated access. Compare original and downloaded SHA-256 with `Get-FileHash -Algorithm SHA256`; compare metadata dimensions and byte size. Matching hashes establish that the original bytes reached persistent storage.
4. Verify the raw Blob URL cannot be downloaded anonymously. A generated key/201 response alone is not sufficient verification of privacy or durable storage.

Only after this upload, storage inspection and hash comparison should production persistence be reported as verified.

## Local validation results

- Node storage tests pass: original bytes/metadata and concurrent local writes; private SDK options and image/JSON pairing; no production disk fallback; rollback; malformed/truncated/oversized payloads; bounded multipart parsing.
- `node node_modules/typescript/bin/tsc --noEmit` passes.
- Real Edge browser: disclosure visible; visits/refresh do not capture; one selected image stored byte-for-byte; ONNX returns corners on success, aborted request, 503 and malformed response; local image URL returns 404.
- Client/server compilation passes and generates the `/api/log-upload` server entry. Final adapter packaging is blocked on this Windows machine by the existing symlink `EPERM` error. A Linux Vercel build and real Blob integration remain unverified.

The installed SDK also passes an OIDC transport test with fake credentials, no static token and external networking disabled, verifying automatic Bearer authentication for both put and del. This is not verification against the live store.

Run tests from `src/card-ui` with `node --experimental-strip-types --test scripts/upload-storage.test.ts scripts/blob-oidc.test.ts`.

References: [private Blob storage](https://vercel.com/docs/vercel-blob/private-storage), [server SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk), [function payload limit](https://vercel.com/docs/errors/function_payload_too_large).
