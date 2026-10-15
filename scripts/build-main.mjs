import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const result = await esbuild.build({
    entryPoints: {
        main: path.join(root, 'src/main/main.ts'),
        preload: path.join(root, 'src/main/preload.ts'),
    },
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outdir: path.join(root, 'dist/main'),
    external: ['electron'],
    sourcemap: false,
    logLevel: 'info',
    alias: {
        'proton-drive-sdk-account': path.join(root, 'src/vendor/account/src/index.ts'),
    },
});

if (result.errors.length > 0) {
    process.exit(1);
}
