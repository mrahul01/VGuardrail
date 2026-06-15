// Builds the unpacked MV3 Firefox extension into dist/. The bundles are built
// straight from the Chrome extension's source (one copy of the adapter/gate/
// modal/transport logic); only this package's manifest.json differs.
//
// Firefox does not support MV3 background service workers, so the manifest
// declares an event page ("background.scripts") and the background entry is
// bundled as a classic IIFE script (not ESM). The shared source reaches the
// WebExtension API through the webext shim, which resolves Firefox's
// promise-first `browser.*` global (runtime.connectNative & co.).
// Transport: chromium (native messaging host + HTTP dev fallback).

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const src = '../../chrome/extension/src';
const outdir = 'dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  target: ['firefox115'],
  sourcemap: true,
  logLevel: 'info',
  define: { __VG_TRANSPORT__: '"chromium"' },
};

await build({
  ...common,
  entryPoints: { 'content/content-script': `${src}/content/content-script.ts` },
  outdir,
  format: 'iife',
});

await build({
  ...common,
  entryPoints: { 'background/service-worker': `${src}/background/service-worker.ts` },
  outdir,
  format: 'iife',
});

await cp('manifest.json', `${outdir}/manifest.json`);
console.log('built unpacked Firefox extension → dist/');
