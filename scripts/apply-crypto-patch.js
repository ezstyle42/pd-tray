const fs = require('fs');
const path = require('path');

const targets = [
    'src/pmcrypto/openpgp.ts',
    'src/pmcrypto/pmcrypto.d.ts',
];

const root = path.join(__dirname, '..', 'node_modules', '@protontech', 'crypto');
for (const rel of targets) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
        console.warn(`[apply-crypto-patch] missing ${rel}; skipping`);
        continue;
    }
    let text = fs.readFileSync(file, 'utf8');
    if (!text.includes('openpgp/lightweight')) {
        continue;
    }
    text = text.split('"openpgp/lightweight"').join('"openpgp"');
    fs.writeFileSync(file, text);
    console.log(`[apply-crypto-patch] patched ${rel}`);
}
