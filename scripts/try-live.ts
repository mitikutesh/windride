/**
 * Manual live end-to-end smoke of the real product pipeline (FMI wind + ORS routing). NOT a test,
 * NEVER in CI (CLAUDE.md rule 3). Run explicitly with a real ORS key in .env:
 *
 *   VITE_LIVE_APIS=true npm run try:live
 *
 * Mirrors what the browser does on "Find today's route": drafts candidates via openrouteservice,
 * reads wind from FMI (Open-Meteo fallback), scores, and prints the ranked routes + honest ETAs.
 */
import { getProviders } from '../src/adapters/registry';
import { runPlan, type PlanInputs } from '../src/state/plan/runPlan';

if (import.meta.env.VITE_LIVE_APIS !== 'true') {
  console.error(
    'Refusing to run on mocks — set VITE_LIVE_APIS=true (with a real ORS key in .env).',
  );
  process.exit(1);
}

const inputs: PlanInputs = {
  distanceKm: 35,
  routeType: 'loop',
  surface: 'road',
  homeBeforeDark: false,
  avoidBusy: false,
  start: { lat: 60.17, lon: 24.94 }, // Helsinki
};

const out = await runPlan(getProviders(), inputs, { now: Date.now() });

const c = out.conditions;
console.log('\n── live conditions (weather source) ──');
console.log(
  `wind ${c.windMs.toFixed(1)} m/s FROM ${Math.round(c.windFromDeg)}° · gust n/a · ` +
    `temp ${c.tempC.toFixed(1)}°C · feels ${c.feelsC?.toFixed(1) ?? '—'}°C · precip ${c.precipProb}%`,
);

console.log('\n── ranking ──');
console.log(`candidates ranked: ${out.ranked.length} · rejected: ${out.rejected.length}`);
for (const r of out.rejected.slice(0, 3)) {
  console.log(`  rejected ${r.candidate.id}: ${r.reasons.join('; ')}`);
}

for (const r of out.ranked.slice(0, 3)) {
  console.log(
    `\n#${r.rank} ${r.candidate.id} — score ${Math.round(r.total)} · ` +
      `${r.evidence.distanceKm.toFixed(1)} km · ${r.candidate.polyline.length} road points · ` +
      `${Math.round((r.evidence.noveltyShare ?? 1) * 100)}% new · ` +
      `robustness spread ${r.evidence.robustnessSpreadMs.toFixed(1)} m/s`,
  );
  console.log(`   ${r.explanation}`);
}
console.log('');
