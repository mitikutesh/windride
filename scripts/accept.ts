#!/usr/bin/env vite-node
/**
 * scripts/accept.ts — `npm run accept`. Runs the v0.1 acceptance (PRODUCT_SPEC §6) on fixtures,
 * writes a human-readable accept-report.md, and exits non-zero on failure (blocks merge in CI).
 */
import { writeFileSync } from 'node:fs';
import { runAcceptance } from '../src/accept/acceptance';

const report = await runAcceptance();

const lines: string[] = [];
lines.push('# WindRide v0.1 acceptance report\n');
lines.push(
  `Wall-clock: **${report.elapsedMs.toFixed(0)} ms** — overall: **${report.pass ? 'PASS' : 'FAIL'}**\n`,
);
lines.push(
  '| Distance | Candidates | Max overlap | Winner headwind (s) | Median (s) | Margin | Result |',
);
lines.push('|---|---|---|---|---|---|---|');
for (const r of report.results) {
  lines.push(
    `| ${r.distanceKm} km | ${r.candidateCount} | ${r.maxMutualOverlap.toFixed(2)} | ` +
      `${r.winnerHeadwindS.toFixed(0)} | ${r.medianHeadwindS.toFixed(0)} | ` +
      `${(r.marginPct * 100).toFixed(0)}% | ${r.pass ? '✅' : '❌'} |`,
  );
}
lines.push('\n## Winning route explanations\n');
for (const r of report.results) {
  lines.push(`- **${r.distanceKm} km:** ${r.winnerExplanation}`);
}
lines.push('\n## Checks\n');
for (const r of report.results) {
  lines.push(`### ${r.distanceKm} km`);
  for (const c of r.checks) lines.push(`- ${c.pass ? '✅' : '❌'} ${c.name} — ${c.detail}`);
}
const md = lines.join('\n') + '\n';
writeFileSync('accept-report.md', md);

console.log(md);
if (!report.pass) {
  console.error('Acceptance FAILED — see accept-report.md');
  process.exit(1);
}
console.log('Acceptance PASSED');
