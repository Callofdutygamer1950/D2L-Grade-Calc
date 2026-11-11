// Packages the extension for a store.
//   npm run build:chrome   -> dist/grade-calculator-for-d2l-chrome-<version>.zip
//   npm run build:firefox  -> dist/grade-calculator-for-d2l-firefox-<version>.zip
// The source manifest works in both browsers when loaded unpacked; the store
// builds drop the keys the other browser doesn't use so review tools don't complain.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'extension');
const target = process.argv[2];
if (!['chrome', 'firefox'].includes(target)) {
  console.error('Usage: node scripts/build.mjs chrome|firefox');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
if (target === 'chrome') {
  // Chrome uses the service worker; background.scripts and Firefox settings are Firefox-only.
  manifest.background = { service_worker: 'background.js' };
  delete manifest.browser_specific_settings;
} else {
  // Firefox uses background scripts (config.js first) and ignores service_worker.
  manifest.background = { scripts: ['config.js', 'background.js'] };
}

// Refuse to package a copy that can't share (empty Supabase settings).
const config = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8');
if (/url:\s*''/.test(config) || /anonKey:\s*''/.test(config)) {
  console.error('extension/config.js has no Supabase URL/key; sharing would be off in this build.');
  process.exit(1);
}

const outDir = path.join(ROOT, 'dist', target);
fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(SRC, outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const zipPath = path.join(ROOT, 'dist', `grade-calculator-for-d2l-${target}-${manifest.version}.zip`);
fs.rmSync(zipPath, { force: true });
await new Promise((resolve, reject) => {
  const out = fs.createWriteStream(zipPath);
  const zip = archiver('zip', { zlib: { level: 9 } });
  out.on('close', resolve);
  zip.on('error', reject);
  zip.pipe(out);
  zip.directory(outDir, false); // manifest.json at the top of the zip
  zip.finalize();
});
console.log(`${path.relative(ROOT, zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(0)} KB)`);
