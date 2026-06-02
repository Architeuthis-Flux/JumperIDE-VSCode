#!/usr/bin/env node
/**
 * Sync the bundled Jumperless type stubs from the canonical JumperlOS source so
 * the extension always ships the same API surface the firmware does.
 *
 * Synced files:
 *   JumperlOS/scripts/jumperless.pyi   -> stubs/jumperless.pyi
 *   JumperlOS/scripts/ex/oledgui.py    -> stubs/oledgui.pyi  (OLED layout API)
 *
 * Source resolution (first hit wins), per file:
 *   1. --from <path>            (a JumperlOS repo root)
 *   2. $JUMPERLESS_REPO         (a JumperlOS repo root)
 *   3. a sibling ../JumperlOS checkout
 *   4. GitHub raw (Architeuthis-Flux/JumperlOS @ main)
 *
 * Resilient by design: if a source is unreachable but a stub is already bundled,
 * it keeps the existing one and exits 0 so packaging never breaks offline.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, '..');
const stubsDir = path.join(extRoot, 'stubs');
const RAW_BASE = 'https://raw.githubusercontent.com/Architeuthis-Flux/JumperlOS/main/';

// dest filename in stubs/  ->  path within a JumperlOS checkout
const FILES = {
    'jumperless.pyi': 'scripts/jumperless.pyi',
    'oledgui.pyi': 'scripts/ex/oledgui.py',
};

function argFrom() {
    const i = process.argv.indexOf('--from');
    if (i >= 0 && process.argv[i + 1]) { return process.argv[i + 1]; }
    return process.env.JUMPERLESS_REPO || null;
}

function repoRoots() {
    const roots = [];
    const from = argFrom();
    if (from) { roots.push(from); }
    for (const sib of ['JumperlOS', '../JumperlOS', '../../JumperlOS']) {
        roots.push(path.resolve(extRoot, sib));
    }
    return roots;
}

function looksLikeSource(text) {
    return typeof text === 'string' && text.length > 500 && /\b(def|class)\s+\w/.test(text);
}

async function syncOne(dest, relInRepo) {
    const target = path.join(stubsDir, dest);

    for (const root of repoRoots()) {
        const p = path.join(root, relInRepo);
        if (fs.existsSync(p)) {
            const text = fs.readFileSync(p, 'utf-8');
            if (looksLikeSource(text)) {
                fs.writeFileSync(target, text, 'utf-8');
                console.log(`[sync-stubs] ${dest} <- ${p} (${text.length} bytes)`);
                return true;
            }
        }
    }

    try {
        const res = await fetch(RAW_BASE + relInRepo);
        if (res.ok) {
            const text = await res.text();
            if (looksLikeSource(text)) {
                fs.writeFileSync(target, text, 'utf-8');
                console.log(`[sync-stubs] ${dest} <- ${RAW_BASE + relInRepo} (${text.length} bytes)`);
                return true;
            }
        }
        console.warn(`[sync-stubs] ${dest}: remote returned ${res.status}`);
    } catch (err) {
        console.warn(`[sync-stubs] ${dest}: remote fetch failed: ${err?.message || err}`);
    }

    if (fs.existsSync(target)) {
        console.warn(`[sync-stubs] ${dest}: no fresh source — keeping existing bundled copy.`);
        return true;
    }
    console.warn(`[sync-stubs] ${dest}: no source and no bundled copy.`);
    return false;
}

async function main() {
    fs.mkdirSync(stubsDir, { recursive: true });
    for (const [dest, rel] of Object.entries(FILES)) {
        await syncOne(dest, rel);
    }
}

main();
