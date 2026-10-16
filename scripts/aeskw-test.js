// AES-KW (RFC 3394) WebCrypto sanity test — the exact operation that fails.
//
// Run inside Electron:
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/aeskw-test.js
// Run under plain Node:
//   node scripts/aeskw-test.js
const { webcrypto } = require('node:crypto');
const { subtle } = webcrypto;

async function main() {
    console.log(`runtime: node ${process.version}`);

    const kek = new Uint8Array(16).fill(7); // AES-128 KEK
    const data = new Uint8Array(32).fill(3); // 32 bytes = 2 blocks, valid for AES-KW

    // 1. Wrap with WebCrypto (openpgp's encrypt path)
    let wrapped;
    try {
        const wrappingKey = await subtle.importKey('raw', kek, { name: 'AES-KW' }, false, ['wrapKey']);
        const keyToWrap = await subtle.importKey('raw', data, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);
        wrapped = new Uint8Array(await subtle.wrapKey('raw', keyToWrap, wrappingKey, { name: 'AES-KW' }));
        console.log('wrapKey OK:', wrapped.length, 'bytes');
    } catch (e) {
        console.error('WRAP FAILED:', e.name, '-', e.message);
        process.exit(1);
    }

    // 2. Unwrap with WebCrypto (openpgp's decrypt path — this is where
    //    'Key Data Integrity failed' comes from)
    try {
        const wrappingKey = await subtle.importKey('raw', kek, { name: 'AES-KW' }, false, ['unwrapKey']);
        const unwrapped = await subtle.unwrapKey('raw', wrapped, wrappingKey, { name: 'AES-KW' }, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);
        const raw = new Uint8Array(await subtle.exportKey('raw', unwrapped));
        const match = Buffer.from(raw).equals(Buffer.from(data));
        console.log('unwrapKey OK, round-trip matches:', match);
        if (!match) {
            console.error('AES-KW IS BROKEN (wrong output, no error)');
            process.exit(1);
        }
    } catch (e) {
        console.error('UNWRAP FAILED:', e.name, '-', e.message);
        console.error('=> This runtime cannot do AES-KW via WebCrypto.');
        console.error('   openpgp turns this OperationError into');
        console.error('   "Key Data Integrity failed".');
        process.exit(1);
    }

    console.log('AES-KW HEALTHY in this runtime');
}

main().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
