import { get } from '@vercel/blob';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const [key, destination] = process.argv.slice(2);
if (!key || !destination || !/^uploads\/\d{4}-\d{2}-\d{2}\/\d{8}_\d{6}_[a-f0-9]{32}\.(jpg|png|webp|gif|json)$/.test(key)) {
    console.error('Usage: node --env-file=.env.local scripts/download-upload.mjs uploads/YYYY-MM-DD/generated-filename.ext destination-file');
    process.exit(1);
}
try {
    const result = await get(key, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) throw new Error('Unavailable');
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    await writeFile(resolve(destination), bytes, { flag: 'wx' });
    console.log(`Saved ${bytes.length} bytes to ${resolve(destination)}`);
    console.log(`SHA256 ${createHash('sha256').update(bytes).digest('hex')}`);
} catch {
    console.error('Download failed. Check the object key, credentials and that the destination does not already exist.');
    process.exitCode = 1;
}
