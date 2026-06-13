const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const opts = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    // vscode and serialport must be external:
    // - vscode is provided by the host
    // - serialport has native bindings; bundling breaks the prebuilt loader
    external: ['vscode', 'serialport', '@serialport/*'],
    format: 'cjs',
    platform: 'node',
    // Prefer ESM entry points so packages like jsonc-parser (whose CJS build
    // is a UMD wrapper with dynamic requires) get bundled statically.
    mainFields: ['module', 'main'],
    target: 'node18',
    sourcemap: true,
    minify: !watch,
    loader: { '.json': 'json' },
};

(async () => {
    if (watch) {
        const ctx = await esbuild.context(opts);
        await ctx.watch();
        console.log('[esbuild] watching...');
    } else {
        await esbuild.build(opts);
        console.log('[esbuild] build complete');
    }
})();
