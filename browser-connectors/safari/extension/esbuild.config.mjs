// Builds the Safari web-extension resources into dist/ (the input for
// scripts/convert.sh → xcrun safari-web-extension-converter). The bundles are
// built straight from the Chrome extension's source (one copy of the adapter/
// gate/modal/transport logic); only this package's manifest.json differs.
//
// Safari runs the background as a non-persistent page ("background.scripts"),
// so the background entry is bundled as a classic IIFE script (not ESM).
//
// Two flavors:
//   default          — transport "safari": sendNativeMessage to the containing
//                      app's SafariWebExtensionHandler (XPC to vguardiand).
//                      Requires the Xcode-converted wrapper app.
//   VG_SAFARI_DEV=1  — transport "safari-dev": HTTP dev backend
//                      (localhost:8080/scan) only. For Safari 17.4+'s
//                      "Add Temporary Extension" unpacked loading, where no
//                      containing app exists so XPC is impossible. The dev
//                      manifest drops nativeMessaging and grants localhost.

import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const dev = process.env.VG_SAFARI_DEV === '1';
const src = '../../chrome/extension/src';
const outdir = 'dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  target: ['safari16'],
  sourcemap: true,
  logLevel: 'info',
  define: { __VG_TRANSPORT__: dev ? '"safari-dev"' : '"safari"' },
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

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (dev) {
  manifest.name += ' (dev)';
  // No containing app in temporary-load mode → no nativeMessaging; the
  // background fetch()es the local dev backend instead.
  manifest.permissions = manifest.permissions.filter((p) => p !== 'nativeMessaging');
  manifest.host_permissions = [...manifest.host_permissions, 'http://localhost:8080/*'];
}
await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`built Safari web-extension resources → dist/ (${dev ? 'safari-dev / HTTP' : 'safari / XPC app'})`);
