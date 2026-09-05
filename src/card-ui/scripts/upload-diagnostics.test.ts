import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadFailureDetails } from '../src/lib/server/upload-diagnostics.ts';

test('SDK diagnostics preserve details while redacting credentials, including nested cause', () => {
    const names = ['BLOB_STORE_ID', 'VERCEL_OIDC_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'VERCEL_ENV'];
    const previous = names.map(name => process.env[name]);
    try {
        process.env.BLOB_STORE_ID = 'store_test-secret-store';
        process.env.VERCEL_OIDC_TOKEN = 'test-secret-oidc';
        process.env.BLOB_READ_WRITE_TOKEN = 'test-secret-static';
        process.env.VERCEL_ENV = 'production';
        const error = Object.assign(new Error('Denied store_test-secret-store test-secret-oidc', {
            cause: new Error('test-secret-store test-secret-static')
        }), { name: 'BlobAccessError', statusCode: 403, status: 401 });
        const details = uploadFailureDetails(error, true);
        assert.equal(details.name, 'BlobAccessError');
        assert.equal(details.statusCode, '403');
        assert.equal(details.status, '401');
        assert.ok(details.stack?.includes('BlobAccessError'));
        assert.equal(details.cause, '[REDACTED] [REDACTED]');
        assert.equal(details.blobStoreIdPresent, true);
        assert.equal(details.oidcTokenPresent, true);
        assert.equal(details.vercelEnv, 'production');
        assert.equal(details.productionBlobPath, true);
        assert.equal(details.localFilesystemPath, false);
        assert.ok(!JSON.stringify(details).includes('test-secret'));
        assert.equal(uploadFailureDetails('failure', false).localFilesystemPath, true);
        assert.equal(uploadFailureDetails(null, false).message, 'null');
    } finally {
        names.forEach((name, i) => {
            if (previous[i] === undefined) delete process.env[name];
            else process.env[name] = previous[i];
        });
    }
});
