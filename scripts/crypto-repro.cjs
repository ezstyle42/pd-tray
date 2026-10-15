// Reproduces the account-module key decryption path in plain Node (CJS).
async function main() {
    require('@protontech/crypto/polyfill');
    const { CryptoProxy } = require('@protontech/crypto');
    const { Api: CryptoApi } = require('@protontech/crypto/proxy/endpoint/api.ts');

    const cryptoApi = new CryptoApi();
    CryptoApi.init({});
    CryptoProxy.setEndpoint(cryptoApi, async (endpoint) => {
        endpoint.clearKeyStore();
    });

    const passphrase = 'correct horse battery staple';

    const userKeyRef = await CryptoProxy.generateKey({
        userIDs: [{ name: 'Test', email: 'test@example.com' }],
        type: 'ecc',
        config: { v6Keys: false },
    });
    console.log('generated user key');
    const exported = await CryptoProxy.exportPrivateKey({ privateKey: userKeyRef, format: "armored", passphrase });
    const imported = await CryptoProxy.importPrivateKey({
        armoredKey: exported,
        passphrase,
    });
    const pub = await CryptoProxy.importPublicKey({
        binaryKey: await CryptoProxy.exportPublicKey({ key: imported, format: 'binary' }),
    });
    console.log('imported user key OK');

    const token = 'address-key-token-passphrase';
    const encrypted = await CryptoProxy.encryptMessage({
        textData: token,
        encryptionKeys: [pub],
        format: 'armored',
    });
    console.log('encryptMessage returned:', typeof encrypted, typeof encrypted === 'object' ? Object.keys(encrypted) : encrypted?.slice?.(0, 40));
    const encryptedString = typeof encrypted === 'string' ? encrypted : encrypted.message;
    console.log('encrypted token OK');

    const decrypted = await CryptoProxy.decryptMessage({
        armoredMessage: encryptedString,
        decryptionKeys: [imported],
        verificationKeys: [pub],
    });
    console.log('decryptMessage OK:', decrypted.data === token ? 'token matches' : 'MISMATCH');

    const addressKeyRef = await CryptoProxy.generateKey({
        userIDs: [{ name: 'Test', email: 'test@example.com' }],
        type: 'ecc',
        config: { v6Keys: false },
    });
    const addressExported = await CryptoProxy.exportPrivateKey({
        privateKey: addressKeyRef,
        format: 'armored',
        passphrase: decrypted.data,
    });
    const importedAddress = await CryptoProxy.importPrivateKey({
        armoredKey: addressExported,
        passphrase: decrypted.data,
    });
    console.log('imported address key OK');
    console.log('ALL CRYPTO OK');
}
main().catch((e) => {
    console.error('FAILED:', e && e.message);
    process.exit(1);
});
