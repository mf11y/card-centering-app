import test from 'node:test';
import assert from 'node:assert/strict';
import { put, del } from '@vercel/blob';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

test('installed SDK uses connected-store OIDC automatically for private writes and deletes', async () => {
    // Fake credentials and intercepted transport only: no real Vercel request or secret.
    const names = ['BLOB_STORE_ID', 'VERCEL_OIDC_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'VERCEL'];
    const previous = names.map(name => process.env[name]);
    const originalDispatcher = getGlobalDispatcher();
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const jwt = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`;
    const calls: { url: string; headers: Headers }[] = [];
    try {
        process.env.BLOB_STORE_ID = 'store_oidctest';
        process.env.VERCEL_OIDC_TOKEN = jwt;
        process.env.VERCEL = '1';
        delete process.env.BLOB_READ_WRITE_TOKEN;
        agent.get(/.*/).intercept({ path: /.*/, method: /PUT|POST/ }).reply(200, (options) => {
            calls.push({ url: options.path, headers: new Headers(options.headers as Record<string, string>) });
            return { url: 'https://oidctest.private.blob.vercel-storage.com/uploads/test.png', pathname: 'uploads/test.png', contentType: 'image/png', contentDisposition: 'attachment', downloadUrl: 'https://oidctest.private.blob.vercel-storage.com/uploads/test.png', etag: 'test' };
        }).persist();
        const blob = await put('uploads/test.png', Buffer.from('test'), { access: 'private', addRandomSuffix: false });
        await del(blob.url);
        assert.equal(calls.length, 2);
        for (const call of calls) assert.equal(call.headers.get('authorization'), `Bearer ${jwt}`);
    } finally {
        setGlobalDispatcher(originalDispatcher);
        await agent.close();
        names.forEach((name, index) => {
            if (previous[index] === undefined) delete process.env[name];
            else process.env[name] = previous[index];
        });
    }
});
