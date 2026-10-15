const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shimDir = path.join(root, 'node_modules', 'openpgp');

const pkgJson = {
    name: 'openpgp',
    version: '0.0.0-pd-tray-shim',
    private: true,
    main: 'index.js',
};

const indexJs = `const fs = require('node:fs');
const path = require('node:path');
const cryptoDir = path.join(__dirname, '..', '@protontech', 'crypto');
if (!fs.existsSync(path.join(cryptoDir, 'package.json'))) {
    throw new Error('openpgp shim: @protontech/crypto not found');
}
const forkDir = path.join(cryptoDir, 'node_modules', 'openpgp');
module.exports = require(path.join(forkDir, 'dist', 'node', 'openpgp.cjs'));
`;

fs.mkdirSync(shimDir, { recursive: true });
fs.writeFileSync(path.join(shimDir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');
fs.writeFileSync(path.join(shimDir, 'index.js'), indexJs);
console.log('[openpgp-shim] created node_modules/openpgp -> @protontech/openpgp fork');
