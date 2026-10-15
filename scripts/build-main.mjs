import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Load the vendored openpgp build as an external, unmodified file at runtime
// instead of bundling it. esbuild bundling has already corrupted openpgp once
// (import.meta.url stubbing), and any in-place patching adds variables; running
// the exact upstream file removes that entire class of problems.
const OPENPGP_CJS = path.join(
    root,
    'node_modules/@protontech/crypto/node_modules/openpgp/dist/node/openpgp.cjs',
);
if (!fs.existsSync(OPENPGP_CJS)) {
    console.error(`openpgp build not found at ${OPENPGP_CJS}; run npm install`);
    process.exit(1);
}

// Mark bare 'openpgp' imports as external so the bundle does a plain
// require('openpgp') at runtime. Node then resolves it via
// node_modules/@protontech/crypto/node_modules/openpgp (the Proton fork),
// because that is the only openpgp in the dependency graph and the
// require is issued from within @protontech/crypto's module scope.
const openpgpExternal = {
    name: 'openpgp-external',
    setup(build) {
        // Resolve 'openpgp' to the forked package by its install name, and
        // mark external. Node resolves 'npm:@protontech/openpgp' installs under
        // the nested path; using the dependency's package directory directly
        // keeps the runtime location-independent.
        build.onResolve({ filter: /^openpgp$/ }, (args) => ({
            path: 'openpgp',
            external: true,
        }));
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
    plugins: [openpgpExternal],
    alias: {
        'proton-drive-sdk-account': path.join(root, 'src/vendor/account/src/index.ts'),
    },
});

if (result.errors.length > 0) {
    process.exit(1);
}
