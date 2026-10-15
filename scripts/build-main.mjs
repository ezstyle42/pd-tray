import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const importMetaUrlFix = {
    name: 'import-meta-url-fix',
    setup(build) {
        build.onLoad({ filter: /node_modules[\\/]@protontech[\\/]crypto[\\/].*\.ts$/ }, (args) => {
            const contents = fs.readFileSync(args.path, 'utf8');
            if (!contents.includes('import.meta.url')) {
                return undefined;
            }
            return {
                loader: 'ts',
                contents: contents.replaceAll(
                    'import.meta.url',
                    'require("url").pathToFileURL(__filename).href',
                ),
            };
        });
    },
};

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
    plugins: [importMetaUrlFix],
    alias: {
        'proton-drive-sdk-account': path.join(root, 'src/vendor/account/src/index.ts'),
        openpgp: path.join(root, 'node_modules/@protontech/crypto/node_modules/openpgp/dist/node/openpgp.min.cjs'),
    },
});

if (result.errors.length > 0) {
    process.exit(1);
}
