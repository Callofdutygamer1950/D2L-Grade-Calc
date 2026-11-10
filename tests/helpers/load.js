// Loads the extension's classic scripts (which attach to globalThis) for tests.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXT = path.join(ROOT, 'extension');

export const readExt = (name) => fs.readFileSync(path.join(EXT, name), 'utf8');

// Runs extension scripts in this test process (each test file runs in its own
// process) and returns globalThis, where they attach D2LGradesCore etc.
export function loadScripts(names) {
  for (const name of names) vm.runInThisContext(readExt(name), { filename: name });
  return globalThis;
}

// Runs scripts inside a jsdom window (for content.js, which needs the DOM).
export function runInWindow(window, names) {
  for (const name of names) window.eval(readExt(name));
}
