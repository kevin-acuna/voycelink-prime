/**
 * Obfuscate public-facing JavaScript files using Terser.
 * Only processes dist/public/*.js — server code is left untouched.
 */
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const PUBLIC_DIR = path.join(__dirname, '..', 'dist', 'public');

const TERSER_OPTIONS = {
    compress: {
        drop_console: false,   // keep console.log for runtime debugging
        dead_code: true,
        passes: 2,
    },
    mangle: {
        toplevel: false,       // don't mangle top-level names (globals used by HTML)
        properties: false,     // don't mangle property names
    },
    format: {
        comments: false,       // strip all comments
    },
    sourceMap: false,
};

async function obfuscatePublicJs() {
    if (!fs.existsSync(PUBLIC_DIR)) {
        console.log('[obfuscate] No dist/public directory found, skipping.');
        return;
    }

    const files = fs.readdirSync(PUBLIC_DIR).filter(f => f.endsWith('.js'));

    if (files.length === 0) {
        console.log('[obfuscate] No .js files in dist/public, skipping.');
        return;
    }

    for (const file of files) {
        const filePath = path.join(PUBLIC_DIR, file);
        const original = fs.readFileSync(filePath, 'utf8');
        const originalSize = Buffer.byteLength(original, 'utf8');

        try {
            const result = await minify(original, TERSER_OPTIONS);
            if (result.code) {
                fs.writeFileSync(filePath, result.code, 'utf8');
                const newSize = Buffer.byteLength(result.code, 'utf8');
                const reduction = ((1 - newSize / originalSize) * 100).toFixed(1);
                console.log(`[obfuscate] ${file}: ${(originalSize / 1024).toFixed(1)}KB → ${(newSize / 1024).toFixed(1)}KB (−${reduction}%)`);
            }
        } catch (err) {
            console.error(`[obfuscate] Failed to obfuscate ${file}:`, err.message);
            // Leave original file intact on failure
        }
    }
}

obfuscatePublicJs();
