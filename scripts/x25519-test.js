// X25519 sanity test: compares the runtime's WebCrypto X25519 against the
// pure-JS tweetnacl implementation bundled with openpgp (ground truth).
//
// Run under Electron (the app's runtime):
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/x25519-test.js
// Run under plain Node for comparison:
//   node scripts/x25519-test.js
const { webcrypto } = require('node:crypto');
const { subtle } = webcrypto;
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');
const requireFromRoot = createRequire(path.join(root, 'noop.js'));

async function loadNacl() {
    const openpgpCjs = path.join(
        root,
        'node_modules/@protontech/crypto/node_modules/openpgp/dist/node/openpgp.cjs',
    );
    const text = require('fs').readFileSync(openpgpCjs, 'utf8');
    // Extract the nacl-fast module (tweetnacl) from the bundle via its export map.
    const mod = require(openpgpCjs);
    // openpgp's CJS build doesn't expose nacl directly; use scalarMult via
    // noble? Simplest: require tweetnacl-like module from openpgp's dist.
    return null;
}

async function main() {
    console.log(`runtime: node ${process.version}`);

    // 1. Generate an X25519 pair (CryptoKeyPair)
    const pair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits']);
    console.log('generateKey OK:', pair?.publicKey?.type);

    // 2. Export keys
    const pubJwk = await subtle.exportKey('jwk', pair.publicKey);
    const privJwk = await subtle.exportKey('jwk', pair.privateKey);
    console.log('exportKey OK: crv=' + pubJwk.crv + ' kty=' + pubJwk.kty);

    // 3. Round-trip: both sides must derive the same secret
    const other = await subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits']);
    const a = await subtle.deriveBits({ name: 'X25519', public: other.publicKey }, pair.privateKey, 256);
    const b = await subtle.deriveBits({ name: 'X25519', public: pair.publicKey }, other.privateKey, 256);
    console.log('round-trip shared secrets match:', Buffer.from(a).equals(Buffer.from(b)));

    // 4. Cross-check against tweetnacl (pure JS, bundled with openpgp):
    //    scalarMult(priv, pub) must equal WebCrypto's deriveBits.
    const nacl = require('tweetnacl');
    if (nacl) {
        const b64u = (h) => Buffer.from(h, 'hex').toString('base64url');
        const u2h = (b64u) => Buffer.from(b64u, 'base64url').toString('hex');
        const priv = Buffer.from(privJwk.d, 'base64url');
        const pub = Buffer.from(pubJwk.x, 'base64url');
        const otherPub = Buffer.from((await subtle.exportKey('jwk', other.publicKey)).x, 'base64url');
        const naclSecret = nacl.scalarMult(priv, otherPub);
        console.log('tweetnacl secret :', Buffer.from(naclSecret).toString('hex'));
        console.log('WebCrypto secret :', Buffer.from(a).toString('hex'));
        const match = Buffer.from(naclSecret).equals(Buffer.from(a));
        console.log('WebCrypto matches tweetnacl:', match);
        if (!match) {
            console.error('X25519 IS BROKEN in this runtime (WebCrypto != tweetnacl)');
            process.exit(1);
        }
    } else {
        console.log('tweetnacl not resolvable at top level; skipping cross-check');
    }
    console.log('X25519 LOOKS HEALTHY in this runtime');
}

main().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
