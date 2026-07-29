#!/usr/bin/env node
/**
 * DEC-059 guard: production bundles must be key-free.
 *
 * The primary protection is the `import.meta.env.DEV` gate on the adapter key fallbacks (Vite
 * dead-code-eliminates the key literals from every prod build). This scanner is the regression
 * backstop: after `vite build` it greps dist/ for (a) the actual secret values found in .env and
 * (b) the openrouteservice key shape, and fails the build on any hit — catching a future fallback
 * added without the DEV gate. Runs as the last step of `npm run build`; CI is keyless, so it only
 * ever bites a keyed local build. `ALLOW_KEYED_BUILD=1` bypasses it for deliberate experiments.
 *
 * Never prints key material — only variable names and file paths.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
// VITE_ vars that are PUBLIC configuration by design (.env.example) — everything else is secret.
const PUBLIC_VARS = new Set([
  'VITE_LIVE_APIS',
  'VITE_BASE',
  'VITE_COGNITO_REGION',
  'VITE_COGNITO_CLIENT_ID',
  'VITE_API_URL',
  'VITE_STRAVA_CLIENT_ID',
]);
// openrouteservice keys are JWTs whose payload starts {"org": ... → base64 'eyJvcmci'.
const ORS_KEY_SHAPE = 'eyJvcmci';
const SCAN_EXTS = ['.js', '.mjs', '.css', '.html', '.json', '.webmanifest', '.map'];

/** @returns {Map<string, string>} secret-var name → value, from .env (absent file → empty). */
function secretEnvValues() {
  const values = new Map();
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return values;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || PUBLIC_VARS.has(m[1])) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (value) values.set(m[1], value);
  }
  return values;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (SCAN_EXTS.some((e) => full.endsWith(e))) files.push(full);
  }
  return files;
}

if (process.env.ALLOW_KEYED_BUILD === '1') {
  console.warn(
    'check-dist-keys: SKIPPED (ALLOW_KEYED_BUILD=1) — dist/ may contain your API keys. ' +
      'Never publish this build.',
  );
  process.exit(0);
}

if (!existsSync(DIST)) {
  console.error('check-dist-keys: dist/ not found — run this after `vite build`.');
  process.exit(1);
}

const secrets = secretEnvValues();
/** @type {string[]} */
const hits = [];
for (const file of walk(DIST)) {
  const content = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const [name, value] of secrets) {
    if (content.includes(value)) hits.push(`${rel}: contains the value of ${name}`);
  }
  if (content.includes(ORS_KEY_SHAPE)) {
    hits.push(`${rel}: contains an openrouteservice-shaped key (${ORS_KEY_SHAPE}…)`);
  }
}

if (hits.length > 0) {
  console.error('check-dist-keys: API key material found in the production bundle (DEC-059):');
  for (const hit of hits) console.error(`  - ${hit}`);
  console.error(
    'Prod builds must be key-free (keys belong to the runtime keychain). ' +
      'If this build is a deliberate local experiment, re-run with ALLOW_KEYED_BUILD=1.',
  );
  process.exit(1);
}

console.log(
  `check-dist-keys: OK — no key material in dist/ (${secrets.size} secret var(s) checked).`,
);
