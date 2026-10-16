const fs = require('node:fs');
const path = require('node:path');

// Patch the vendored @protontech/openpgp fork so AES key wrap/unwrap (RFC 3394)
// always uses the bundled pure-JS `aeskw` implementation instead of WebCrypto.
//
// Why: openpgp's `unwrap()` maps ANY WebCrypto OperationError to
// "Key Data Integrity failed". Some Electron builds (observed on Node 22.19 /
// Electron 36) fail AES-KW WebCrypto operations with OperationError even for
// 16-byte keys, which openpgp misreports as an integrity failure of the key
// material. The pure-JS aeskw is RFC 3394 over the same AES primitive used
// everywhere else, runtime-independent, and already bundled by openpgp as the
// fallback for 192-bit keys.
const root = path.join(__dirname, '..');

const TARGETS = [
    'node_modules/@protontech/crypto/node_modules/openpgp/dist/node/openpgp.cjs',
];

for (const rel of TARGETS) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
        console.warn(`[openpgp-aeskw-patch] missing ${rel}; skipping`);
        continue;
    }
    let text = fs.readFileSync(file, 'utf8');
    if (text.includes('PDM_AESKW_JS_ALWAYS')) {
        console.log(`[openpgp-aeskw-patch] ${rel} already patched`);
        continue;
    }

    let patched = 0;

    // unwrap(): force the JS path before the WebCrypto attempt.
    const unwrapBefore = `async function unwrap(algo, key, wrappedData) {
    const { keySize } = getCipherParams(algo);
    // sanity checks, since WebCrypto does not use the \`algo\` input
    if (!util.isAES(algo) || key.length !== keySize) {
        throw new Error('Unexpected algorithm or key size');
    }
    let wrappingKey;
    try {
        wrappingKey = await webCrypto$7.importKey('raw', key, { name: 'AES-KW' }, false, ['unwrapKey']);
    }`;
    const unwrapAfter = `async function unwrap(algo, key, wrappedData) {
    const { keySize } = getCipherParams(algo);
    // sanity checks, since WebCrypto does not use the \`algo\` input
    if (!util.isAES(algo) || key.length !== keySize) {
        throw new Error('Unexpected algorithm or key size');
    }
    // PDM_AESKW_JS_ALWAYS: WebCrypto AES-KW is unreliable in some Electron
    // builds (OperationError), which this function misreports as a key
    // integrity failure. Use the bundled pure-JS implementation.
    return aeskw(key).decrypt(wrappedData);
    let wrappingKey;
    try {
        wrappingKey = await webCrypto$7.importKey('raw', key, { name: 'AES-KW' }, false, ['unwrapKey']);
    }`;
    if (text.includes(unwrapBefore)) {
        text = text.replace(unwrapBefore, unwrapAfter);
        patched++;
    } else {
        console.warn(`[openpgp-aeskw-patch] unwrap pattern not found in ${rel}`);
    }

    // wrap(): force the JS path before the WebCrypto attempt.
    const wrapBefore = `async function wrap(algo, key, dataToWrap) {
    const { keySize } = getCipherParams(algo);
    // sanity checks, since WebCrypto does not use the \`algo\` input
    if (!util.isAES(algo) || key.length !== keySize) {
        throw new Error('Unexpected algorithm or key size');
    }
    try {
        const wrappingKey = await webCrypto$7.importKey('raw', key, { name: 'AES-KW' }, false, ['wrapKey']);`;
    const wrapAfter = `async function wrap(algo, key, dataToWrap) {
    const { keySize } = getCipherParams(algo);
    // sanity checks, since WebCrypto does not use the \`algo\` input
    if (!util.isAES(algo) || key.length !== keySize) {
        throw new Error('Unexpected algorithm or key size');
    }
    // PDM_AESKW_JS_ALWAYS: use the bundled pure-JS implementation (see unwrap).
    return aeskw(key).encrypt(dataToWrap);
    try {
        const wrappingKey = await webCrypto$7.importKey('raw', key, { name: 'AES-KW' }, false, ['wrapKey']);`;
    if (text.includes(wrapBefore)) {
        text = text.replace(wrapBefore, wrapAfter);
        patched++;
    } else {
        console.warn(`[openpgp-aeskw-patch] wrap pattern not found in ${rel}`);
    }

    if (patched === 0) {
        console.warn(`[openpgp-aeskw-patch] no sites patched in ${rel}`);
        continue;
    }
    fs.writeFileSync(file, text);
    console.log(`[openpgp-aeskw-patch] patched ${rel} (${patched} site(s))`);
}
