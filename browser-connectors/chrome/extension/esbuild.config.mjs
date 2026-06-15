// Builds the unpacked MV3 extension into dist/.
// - content script → a single classic IIFE bundle (content scripts can't be ESM)
// - service worker → an ESM module (manifest declares "type":"module")
// - manifest.json is copied verbatim.
// - __VG_TRANSPORT__ selects the background transport chain at build time
//   (see src/background/service-worker.ts); Chromium = native host + HTTP dev
//   fallback. The Edge/Brave/Firefox/Safari packages build this same source
//   with their own manifest and define.

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const outdir = 'dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  target: ['chrome116'],
  sourcemap: true,
  logLevel: 'info',
  define: { __VG_TRANSPORT__: '"chromium"' },
};

await build({
  ...common,
  entryPoints: { 'content/content-script': 'src/content/content-script.ts' },
  outdir,
  format: 'iife',
});

// MAIN-world page hook (patches window.fetch for file uploads). Classic IIFE so
// it runs in the page context; declared as a `world: "MAIN"` content script.
await build({
  ...common,
  entryPoints: { 'content/page-hook': 'src/content/page-hook.ts' },
  outdir,
  format: 'iife',
});

await build({
  ...common,
  entryPoints: { 'background/service-worker': 'src/background/service-worker.ts' },
  outdir,
  format: 'esm',
});

await cp('manifest.json', `${outdir}/manifest.json`);
console.log('built unpacked extension → dist/');
