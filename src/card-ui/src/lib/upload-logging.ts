/** Logging never blocks file loading or inference. No cookies or client identifiers. */
export async function logUploadedImage(file: File): Promise<boolean> {
    if (!file.type.startsWith('image/')) return false;
    if (file.size > 4 * 1024 * 1024) {
        console.warn('Image exceeds the 4 MiB capture limit; local processing will continue.');
        return false;
    }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const form = new FormData();
            form.append('file', file);
            const response = await fetch('/api/log-upload', {
                method: 'POST', body: form, credentials: 'omit',
                referrerPolicy: 'no-referrer', signal: controller.signal
            });
            const result = await response.json();
            if (!response.ok || result.ok !== true || result.created !== true) {
                throw new Error('Capture request was unsuccessful');
            }
            return true;
        } catch {
            console.warn('Image capture unavailable; local card processing continues.');
            return false;
        } finally {
            clearTimeout(timeout);
        }
}
