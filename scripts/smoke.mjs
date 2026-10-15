
// # Run with: node scripts/smoke.cjs
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import Module from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await esbuild.build({
    entryPoints: [path.join(root, 'src/main/driveCore.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: '/tmp/smoke-driveCore.cjs',
    external: ['electron'],
    define: {
        'import.meta.url': JSON.stringify('file:///tmp/smoke-driveCore.cjs'),
    },
    alias: {
        'proton-drive-sdk-account': path.join(root, 'src/vendor/account/src/index.ts'),
    },
});

fs.writeFileSync('/tmp/fake-electron.js', 'module.exports = { app: { getPath: () => "/tmp/pd-smoke-userdata" } };');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'electron') {
        return '/tmp/fake-electron.js';
    }
    return origResolve.call(this, request, ...args);
};

const { initDriveCore } = await import(pathToFileURL('/tmp/smoke-driveCore.cjs').href);
const core = await initDriveCore();
console.log('smoke: initDriveCore OK');
console.log('smoke: logged in:', core.auth.isLoggedIn());
await core.dispose();
console.log('smoke: dispose OK');
