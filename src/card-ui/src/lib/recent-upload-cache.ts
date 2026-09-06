import { CARD_PROCESSING_VERSION } from './card-centering/processing-version';
export const RECENT_UPLOAD_LIMIT = 5;
const DB_NAME = 'card-centering-recent-uploads';
const STORE = 'images';
export type CachedDetection = {
    ok: boolean;
    corners: Array<{ id: string; x: number; y: number }>;
    mask_data_url: string;
};
export type CachedAnalysis = {
    processingVersion: string;
    result: CachedDetection;
    processedAt: number;
};
export type CachedUpload = {
    sha256: string; blob: Blob; mimeType: string; byteSize: number;
    originalFileName?: string;
    createdAt: number; lastUsedAt: number;
    analysis?: CachedAnalysis;
};
// Lazily migrate the earlier flat format without deleting the original image.
// Legacy results have no processing timestamp: discard only that derived data.
type StoredUpload = CachedUpload & { originalSize?: number; timestamp?: number };
function originalUpload(entry: StoredUpload): CachedUpload {
    return {
        sha256: entry.sha256, blob: entry.blob, mimeType: entry.mimeType,
        byteSize: entry.byteSize ?? entry.originalSize ?? entry.blob.size,
        originalFileName: entry.originalFileName,
        createdAt: entry.createdAt ?? entry.timestamp ?? entry.lastUsedAt,
        lastUsedAt: entry.lastUsedAt,
        analysis: entry.analysis
    };
}
export type UploadLookup = {
    sha256?: string; blob: Blob; hit: boolean; entries: number;
    result?: CachedDetection;
};
export const cacheDiagnostic = {
    cache: 'idle', entries: 0, inference: 'pending', imageHash: '',
    analysisCacheHit: false, staleAnalysisVersion: null as string | null,
    processingRerun: false, duplicateUploadSuppressed: false,
    lruEvictions: [] as string[], currentProcessingVersion: CARD_PROCESSING_VERSION
};
export function reportCacheInference(state: string) {
    cacheDiagnostic.inference = state;
    cacheDiagnostic.processingRerun = state === 'rerun';
    if (import.meta.env.DEV) Object.assign(globalThis, { __recentUploadCache: cacheDiagnostic });
}
function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        let expired = false;
        const timer = setTimeout(() => { expired = true; reject(new Error('Cache open timeout')); }, 2000);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'sha256' });
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error('Cache blocked')); };
        request.onsuccess = () => {
            clearTimeout(timer);
            if (expired) request.result.close();
            else { request.result.onversionchange = () => request.result.close(); resolve(request.result); }
        };
    });
}
function validResult(value: CachedDetection | undefined): value is CachedDetection {
    const ids = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
    return value?.ok === true && typeof value.mask_data_url === 'string' &&
        value.mask_data_url.startsWith('data:image/') && Array.isArray(value.corners) &&
        value.corners.length === 4 && ids.every(id => value.corners.filter(c => c?.id === id).length === 1) &&
        value.corners.every(c => Number.isFinite(c?.x) && Number.isFinite(c?.y));
}
export async function lookupRecentUpload(file: Blob, version = CARD_PROCESSING_VERSION): Promise<UploadLookup> {
    let db: IDBDatabase | undefined;
    Object.assign(cacheDiagnostic, { imageHash: '', analysisCacheHit: false, staleAnalysisVersion: null,
        duplicateUploadSuppressed: false, lruEvictions: [], currentProcessingVersion: version });
    try {
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        cacheDiagnostic.imageHash = sha256;
        db = await openDatabase();
        const result = await new Promise<UploadLookup>((resolve, reject) => {
            // One read/write transaction makes lookup, recency, insertion and eviction atomic across tabs.
            const tx = db!.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let output: UploadLookup;
            tx.onabort = () => reject(tx.error ?? new Error('Cache transaction aborted'));
            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => resolve(output);
            const request = store.getAll();
            request.onsuccess = () => {
                try {
                const entries = request.result as StoredUpload[];
                const existing = entries.find(e => e.sha256 === sha256);
                if (existing && (!(existing.blob instanceof Blob) || existing.blob.size !== file.size)) {
                    throw new Error('Invalid cached original');
                }
                const now = Math.max(Date.now(), ...entries.map(e => Number.isFinite(e.lastUsedAt) ? e.lastUsedAt + 1 : 0));
                const entry: CachedUpload = existing ? { ...originalUpload(existing), lastUsedAt: now } :
                    { sha256, blob: file, mimeType: file.type, byteSize: file.size,
                        originalFileName: file instanceof File ? file.name : undefined,
                        createdAt: now, lastUsedAt: now };
                cacheDiagnostic.staleAnalysisVersion = existing && entry.analysis?.processingVersion !== version
                    ? entry.analysis?.processingVersion ?? 'missing' : null;
                // Version mismatch invalidates only analysis, never the source or duplicate hit.
                if (entry.analysis && (entry.analysis.processingVersion !== version ||
                    !Number.isFinite(entry.analysis.processedAt) || !validResult(entry.analysis.result))) {
                    delete entry.analysis;
                }
                store.put(entry);
                const others = entries.filter(e => e.sha256 !== sha256).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
                cacheDiagnostic.lruEvictions = others.slice(RECENT_UPLOAD_LIMIT - 1).map(e => e.sha256);
                for (const old of others.slice(RECENT_UPLOAD_LIMIT - 1)) store.delete(old.sha256);
                output = { sha256, blob: entry.blob, hit: !!existing, entries: Math.min(others.length + 1, RECENT_UPLOAD_LIMIT),
                    result: entry.analysis?.result };
                } catch { tx.abort(); }
            };
        });
        cacheDiagnostic.cache = result.hit ? 'hit' : 'miss';
        cacheDiagnostic.entries = result.entries;
        cacheDiagnostic.analysisCacheHit = !!result.result;
        cacheDiagnostic.duplicateUploadSuppressed = result.hit;
        reportCacheInference(result.result ? 'reused' : 'rerun');
        return result;
    } catch {
        cacheDiagnostic.cache = 'unavailable';
        cacheDiagnostic.entries = 0;
        cacheDiagnostic.lruEvictions = [];
        reportCacheInference('rerun');
        return { blob: file, hit: false, entries: 0 };
    } finally { db?.close(); }
}
export async function saveRecentDetection(sha256: string, result: CachedDetection, version = CARD_PROCESSING_VERSION) {
    if (!validResult(result)) return;
    let db: IDBDatabase | undefined;
    try {
        db = await openDatabase();
        await new Promise<void>((resolve, reject) => {
            const tx = db!.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            tx.oncomplete = () => resolve();
            tx.onabort = tx.onerror = () => reject(tx.error);
            const request = store.get(sha256);
            request.onsuccess = () => {
                // Never reinsert an image evicted while inference was running.
                try {
                    if (request.result) store.put({ ...originalUpload(request.result), analysis: { processingVersion: version, result, processedAt: Date.now() } });
                } catch { tx.abort(); }
            };
        });
    } catch { /* Cache writes never interrupt card processing. */ }
    finally { db?.close(); }
}
