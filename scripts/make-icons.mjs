// Renders assets/icon.svg to the PNG sizes the extension and stores need.
// Run: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg'), 'utf8');
const outDir = path.join(ROOT, 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`extension/icons/icon${size}.png (${png.length} bytes)`);
}
