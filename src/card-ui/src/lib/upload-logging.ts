/** Logging never blocks file loading or inference. No cookies or client identifiers. */
export function logUploadedImage(file: File): void {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 4 * 1024 * 1024) {
        console.warn('Image exceeds the 4 MiB capture limit; local processing will continue.');
        return;
    }
    void (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const form = new FormData();
            form.append('file', file);
            const response = await fetch('/api/log-upload', {
                method: 'POST', body: form, credentials: 'omit',
                referrerPolicy: 'no-referrer', signal: controller.signal
            });
            if (!response.ok || (await response.json()).ok !== true) {
                throw new Error('Capture request was unsuccessful');
            }
        } catch {
            console.warn('Image capture unavailable; local card processing continues.');
        } finally {
            clearTimeout(timeout);
        }
    })();
}
