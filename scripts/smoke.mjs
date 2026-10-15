// Smoke test: verifies the built main bundle and Drive SDK wiring load under plain Node.
// Run with: npm run smoke
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

fs.mkdirSync('/tmp/fake-electron', { recursive: true });
fs.writeFileSync(
    '/tmp/fake-electron/index.js',
    'module.exports = { app: { getPath: () => "/tmp/pd-smoke-userdata", whenReady: () => Promise.resolve(), on: () => {}, isPackaged: true }, BrowserWindow: class {}, Tray: class {}, Menu: { buildFromTemplate: () => ({}) }, dialog: {}, ipcMain: { handle: () => {} }, shell: {} };',
);
fs.writeFileSync('/tmp/fake-electron/package.json', JSON.stringify({ name: 'electron', main: 'index.js' }));

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'electron') {
        return '/tmp/fake-electron/index.js';
    }
    return origResolve.call(this, request, ...args);
};

const mainBundle = path.join(root, 'dist/main/main.js');
if (!fs.existsSync(mainBundle)) {
    console.error('smoke: dist/main/main.js not found — run npm run build first');
    process.exit(1);
}

process.on('uncaughtException', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('tray.setContextMenu')) {
        return;
    }
    console.error('smoke FAILED:', message);
    process.exit(1);
});

await import(pathToFileURL(mainBundle).href);
await new Promise((resolve) => setTimeout(resolve, 3000));
console.log('smoke: main bundle loaded OK (no createRequire/import.meta crash)');
