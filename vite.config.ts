import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Electron loads the renderer over file://; Chromium refuses module scripts
// carrying a crossorigin attribute from file:// origins, which leaves the
// window blank. Vite 5 hardcodes the attribute, so rewrite the HTML after emit.
function stripCrossorigin(): Plugin {
    return {
        name: 'strip-crossorigin',
        apply: 'build',
        closeBundle() {
            const outDir = path.resolve(__dirname, 'renderer/dist');
            for (const file of fs.readdirSync(outDir)) {
                if (!file.endsWith('.html')) {
                    continue;
                }
                const htmlPath = path.join(outDir, file);
                const html = fs.readFileSync(htmlPath, 'utf8');
                fs.writeFileSync(htmlPath, html.replaceAll(' crossorigin', ''));
            }
        },
    };
}

export default defineConfig({
    plugins: [react(), stripCrossorigin()],
    root: path.resolve(__dirname, 'renderer'),
    base: './',
    build: {
        outDir: path.resolve(__dirname, 'renderer/dist'),
        emptyOutDir: true,
        modulePreload: { polyfill: false },
    },
});
