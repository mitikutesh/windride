#!/usr/bin/env node
/**
 * WR-002 guard: colour lives in tokens only.
 *
 * Fails if any raw colour hex (#RGB / #RGBA / #RRGGBB / #RRGGBBAA) appears in src/ outside
 * src/ui/tokens.css. Components must compose CSS custom properties, never hardcode hues
 * (DESIGN §1, acceptance criterion). Runs as part of `npm run lint` and in CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const ALLOW = join(SRC, 'ui', 'tokens.css');
const EXTS = ['.css', '.ts', '.tsx'];
// Raw colour = hex OR a colour function literal (rgb/hsl/oklch/...). `color-mix()` is not
// matched (it composes tokens) and is only used inside the excluded tokens.css anyway.
const COLOR =
  /#[0-9a-fA-F]{3,4}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** @param {string} dir */
function walk(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (EXTS.some((e) => full.endsWith(e))) files.push(full);
  }
  return files;
}

const offenders = [];
for (const file of walk(SRC)) {
  if (file === ALLOW) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (COLOR.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
  });
}

if (offenders.length > 0) {
  console.error('Raw colour found outside src/ui/tokens.css (use CSS vars from tokens.css):');
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log('check-tokens: OK — no raw colour hex outside tokens.css');
