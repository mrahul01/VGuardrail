// Builds the unpacked MV3 Edge extension into dist/. Edge is Chromium, so the
// bundles are built straight from the Chrome extension's source (one copy of
// the adapter/gate/modal/transport logic); only this package's manifest.json
// differs. Transport: chromium (native messaging host + HTTP dev fallback).

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const src = '../../chrome/extension/src';
const outdir = 'dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  target: ['chrome116', 'edge116'],
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
  format: 'esm',
});

await cp('manifest.json', `${outdir}/manifest.json`);
console.log('built unpacked Edge extension → dist/');
