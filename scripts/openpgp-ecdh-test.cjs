// Raw OpenPGP ECDH round-trip test — no crypto proxy, no account module, no SDK.
// Replicates the exact failing operation (v4 ECC key, curve25519Legacy encryption
// subkey, token encrypt/decrypt) with freshly generated keys.
//
// Run inside Electron (the app's runtime):
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/openpgp-ecdh-test.cjs
// Run under plain Node for comparison:
//   node scripts/openpgp-ecdh-test.cjs
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');
const req = createRequire(path.join(root, 'dist', 'main', 'main.js'));
const opgp = req('openpgp');

async function main() {
    console.log(`runtime: node ${process.version}`);
    console.log(`openpgp: ${opgp.version ?? 'unknown'}`);

    const passphrase = 'test-passphrase-123';

    // Generate a Proton-style v4 ECC key: Ed25519 primary + curve25519Legacy encryption subkey
    const key = await opgp.generateKey({
        type: 'ecc',
        curve: 'ed25519',
        userIDs: [{ name: 'Test', email: 'test@example.com' }],
        passphrase,
        format: 'object',
    });
    const subkeyAlgo = key.privateKey.subkeys[0].keyPacket.algorithm;
    const kdf = key.privateKey.subkeys[0].keyPacket.publicParams.kdfParams;
    console.log(`subkey algo: ${subkeyAlgo} (18=ECDH), KDF hash: ${kdf?.hash}, cipher: ${kdf?.cipher}`);

    // Encrypt a token-like message to the key's encryption subkey (same shape as
    // Proton's address key tokens: armored, encrypted to the ECDH subkey)
    const token = 'address-key-token-passphrase';
    const encrypted = await opgp.encrypt({
        message: await opgp.createMessage({ text: token }),
        encryptionKeys: key.privateKey,
        format: 'armored',
    });
    console.log('encrypt OK (armored length', encrypted.length + ')');

    // Decrypt with the private key — this exercises the exact failing path:
    // Message.decryptSessionKeys -> PKESK.decrypt -> decrypt$3 (legacy ECDH, 3-attempt KDF)
    const privateKey = await opgp.decryptKey({
        privateKey: await opgp.readPrivateKey({ armoredKey: key.privateKey.armor() }),
        passphrase,
    });
    const decrypted = await opgp.decrypt({
        message: await opgp.readMessage({ armoredMessage: encrypted }),
        decryptionKeys: [privateKey],
    });
    console.log('decrypt OK:', decrypted.data === token ? 'token matches' : 'MISMATCH');
    console.log('OPENPGP ECDH HEALTHY in this runtime');
}

main().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
