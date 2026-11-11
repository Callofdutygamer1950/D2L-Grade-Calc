// Makes the Chrome Web Store images in store/images/:
//  - 1280x800 screenshots of the test harness pages (made-up course data), taken with
//    headless Chrome using a throwaway profile
//  - the 440x280 small promo tile, rendered from assets/promo-small.svg
// Needs the harness server running: node tests/harness/serve.js
// Run: npm run store-images   (set CHROME=path\to\chrome.exe if Chrome isn't in the usual place)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store', 'images');
const BASE = process.env.HARNESS_URL || 'http://127.0.0.1:5178';
fs.mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Chrome not found; set CHROME=path/to/chrome');

const SHOTS = [
  ['screenshot-1-badge.png', '/tests/harness/badge.html?weights=1'],
  ['screenshot-2-breakdown.png', '/tests/harness/badge.html?weights=1&open=1'],
  ['screenshot-3-syllabus.png', '/?course=demo&shot=syllabus'],
];

for (const [file, url] of SHOTS) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-shot-'));
  const out = path.join(OUT, file);
  const r = spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--force-color-profile=srgb', '--force-device-scale-factor=1', '--window-size=1280,800',
    '--blink-settings=preferredColorScheme=1', // light mode, whatever the OS theme is
    '--virtual-time-budget=5000', `--user-data-dir=${profile}`, `--screenshot=${out}`, BASE + url,
  ], { encoding: 'utf8', timeout: 60000 });
  fs.rmSync(profile, { recursive: true, force: true });
  if (!fs.existsSync(out)) throw new Error(`screenshot failed for ${url}: ${r.stderr || r.error}`);
  console.log(`store/images/${file}`);
}

const promo = fs.readFileSync(path.join(ROOT, 'assets', 'promo-small.svg'), 'utf8');
const png = new Resvg(promo, { fitTo: { mode: 'width', value: 440 }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng();
fs.writeFileSync(path.join(OUT, 'promo-small-440x280.png'), png);
console.log('store/images/promo-small-440x280.png');
