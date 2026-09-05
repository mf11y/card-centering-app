/** Keep SDK exception details in server logs, never credential values. */
export function uploadFailureDetails(error: unknown, productionBlobPath: boolean) {
    const secrets = [process.env.BLOB_STORE_ID, process.env.VERCEL_OIDC_TOKEN, process.env.BLOB_READ_WRITE_TOKEN]
        .filter((value): value is string => Boolean(value));
    const storeId = process.env.BLOB_STORE_ID;
    if (storeId?.startsWith('store_')) secrets.push(storeId.slice(6));
    const redact = (value: unknown): string | undefined => {
        if (value === undefined || value === null) return undefined;
        let text = String(value);
        for (const secret of secrets) {
            if (secret) text = text.split(secret).join('[REDACTED]');
        }
        return text;
    };
    const err = error !== null && typeof error === 'object'
        ? error as Record<string, unknown> : undefined;
    const cause = err?.cause;
    const causeMessage = cause !== null && typeof cause === 'object'
        ? (cause as Record<string, unknown>).message : cause;
    return {
        name: redact(error instanceof Error ? error.name : typeof error),
        message: redact(error instanceof Error ? error.message : String(error)),
        stack: redact(error instanceof Error ? error.stack : undefined),
        statusCode: redact(err?.statusCode),
        status: redact(err?.status),
        cause: redact(causeMessage),
        blobStoreIdPresent: Boolean(process.env.BLOB_STORE_ID),
        oidcTokenPresent: Boolean(process.env.VERCEL_OIDC_TOKEN),
        vercelEnvPresent: Boolean(process.env.VERCEL_ENV),
        // Only this non-secret, known environment label may be emitted.
        vercelEnv: ['production', 'preview', 'development'].includes(process.env.VERCEL_ENV ?? '')
            ? process.env.VERCEL_ENV : undefined,
        productionBlobPath,
        localFilesystemPath: !productionBlobPath
    };
}
