const fs = require('fs');
const path = require('path');

// Patch the vendored @protontech/openpgp fork so X25519 ECDH always uses the
// bundled pure-JS tweetnacl implementation instead of the runtime's WebCrypto.
//
// Why: openpgp prefers WebCrypto X25519 and only falls back to tweetnacl when
// WebCrypto throws NotSupportedError. In Electron, WebCrypto X25519 can
// succeed but compute incorrect shared secrets (observed as
// "Key Data Integrity failed" when decrypting Proton address-key tokens),
// leaving no fallback path. tweetnacl is deterministic and runtime-independent.
//
// The same patch is applied to the ECDH keygen/encrypt paths for consistency:
// all curve25519 x25519 ECDH operations go through the pure-JS implementation.
const TARGETS = [
    'node_modules/@protontech/crypto/node_modules/openpgp/dist/node/openpgp.cjs',
    'node_modules/@protontech/crypto/node_modules/openpgp/dist/node/openpgp.min.cjs',
];

const root = path.join(__dirname, '..');

for (const rel of TARGETS) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
        console.warn(`[openpgp-x25519-patch] missing ${rel}; skipping`);
        continue;
    }
    let text = fs.readFileSync(file, 'utf8');
    if (text.includes('PDM_X25519_NACL_ALWAYS')) {
        console.log(`[openpgp-x25519-patch] ${rel} already patched`);
        continue;
    }

    // Force all X25519 ECDH paths (shared-secret recompute, ephemeral keygen
    // for encryption) onto tweetnacl: make getWebCrypto throw NotSupportedError
    // inside these functions, which openpgp handles by using the pure-JS path.
    const naclAlways = `try {
                // PDM_X25519_NACL_ALWAYS: WebCrypto X25519 is unreliable in some
                // Electron builds; always use the pure-JS implementation.
                const e = new Error('X25519 WebCrypto disabled');
                e.name = 'NotSupportedError';
                throw e;
                const webCrypto = util.getWebCrypto();`;

    const patterns = [
        // recomputeSharedSecret (decryption)
        `case enums.publicKey.x25519:
            try {
                const webCrypto = util.getWebCrypto();
                const privateKeyJWK = privateKeyToJWK(algo, A, k);`,
        // generateEphemeralEncryptionMaterial (encryption)
        `case enums.publicKey.x25519:
            try {
                const webCrypto = util.getWebCrypto();
                const ephemeralKeyPair = await webCrypto.generateKey('X25519', true, ['deriveKey', 'deriveBits'])`,
    ];

    const replacements = [
        `case enums.publicKey.x25519:
            ` + naclAlways + `
                const privateKeyJWK = privateKeyToJWK(algo, A, k);`,
        `case enums.publicKey.x25519:
            ` + naclAlways + `
                const ephemeralKeyPair = await webCrypto.generateKey('X25519', true, ['deriveKey', 'deriveBits'])`,
    ];

    let patched = 0;
    for (let i = 0; i < patterns.length; i++) {
        if (text.includes(patterns[i])) {
            text = text.replace(patterns[i], replacements[i]);
            patched++;
        } else {
            console.warn(`[openpgp-x25519-patch] pattern ${i} not found in ${rel}`);
        }
    }

    // Minified build: openpgp.min.cjs uses short identifiers and no whitespace.
    const minRecompute = 'case F.publicKey.x25519:try{const i=H.getWebCrypto(),s=function(e,t,r)';
    if (text.includes(minRecompute)) {
        text = text.replace(
            minRecompute,
            'case F.publicKey.x25519:try{const pdmErr=new Error("X25519 WebCrypto disabled");pdmErr.name="NotSupportedError";throw pdmErr;const i=H.getWebCrypto(),s=function(e,t,r)',
        );
        patched++;
    }
    if (patched === 0) {
        continue;
    }

    fs.writeFileSync(file, text);
    console.log(`[openpgp-x25519-patch] patched ${rel} (${patched} site(s))`);
}
