/**
 * About screen — what WindRide is, why it's different (wind-aware, generates routes), how the 0–100
 * score is built (sub-scores + weights from docs/SCORING_SPEC.md §6), and the user-facing
 * architecture. Static content; the weight numbers mirror the engine defaults.
 */

interface ScoreRow {
  name: string;
  weight: string;
  what: string;
}
// Mirrors SCORING_SPEC §6 default weights (settings-tunable in the engine).
const SCORES: ScoreRow[] = [
  {
    name: 'Wind comfort',
    weight: '0.28',
    what: 'how little time you spend grinding into a headwind',
  },
  { name: 'Robustness', weight: '0.10', what: 'does it still hold if the wind shifts ±30°' },
  {
    name: 'Crosswind safety',
    weight: '0.10',
    what: 'penalizes exposed, gusty crosswind stretches',
  },
  { name: 'Surface', weight: '0.12', what: 'matches your road / gravel preference' },
  { name: 'Traffic', weight: '0.10', what: 'avoids big roads that lack a cycleway' },
  { name: 'Scenery', weight: '0.07', what: 'rewards forest / waterside stretches' },
  { name: 'Shelter', weight: '0.06', what: 'share of into-wind time that’s sheltered' },
  { name: 'Climb match', weight: '0.06', what: 'hits your elevation preference' },
  { name: 'Distance match', weight: '0.05', what: 'lands near your target distance' },
  { name: 'Rain avoidance', weight: '0.04', what: 'dodges forecast showers' },
  { name: 'Novelty', weight: '0.04', what: 'rewards roads you haven’t ridden before' },
  { name: 'Sequencing', weight: '0.02', what: 'bonus for headwind early, tailwind home' },
];

export function AboutScreen() {
  return (
    <section className="wr-screen wr-doc" aria-labelledby="about-title">
      <h1 id="about-title">About WindRide</h1>
      <p>
        WindRide is a <b>wind-aware cycling route planner</b> that runs entirely in your browser.
        Tell it how far you want to ride today; it generates candidate routes, scores them against
        today’s actual wind, shelter and weather using time-weighted physics, and shows the best
        three with honest, wind-aware ETAs — then navigates the one you pick with live wind cues.
      </p>

      <h2>What makes it different</h2>
      <p>
        Other wind tools analyse a route you <i>already have</i>. WindRide <b>generates</b> routes
        for the conditions — and does planning <em>and</em> navigation in one app.
      </p>
      <p>
        The core insight: you can’t just “ride the tailwind”. On any loop in steady wind, the
        tailwind and headwind stretches cancel out exactly — net zero. So WindRide optimizes for the{' '}
        <b>least suffering today</b>, using levers that actually work on a loop:
      </p>
      <ul>
        <li>Turn direct headwind into crosswind through the route’s shape.</li>
        <li>
          Shelter the into-wind legs (forest and town beat the exposed coast — the biggest lever).
        </li>
        <li>Sequence the ride: headwind early, tailwind on the way home.</li>
        <li>
          Weight everything by <b>time</b>, not distance — a headwind kilometre costs more minutes.
        </li>
        <li>For one-ways: ride downwind and take transit back.</li>
      </ul>

      <h2>How the score works (0–100)</h2>
      <p>
        Each candidate is split into ~300 m segments. For every segment WindRide samples the
        forecast wind at your estimated time of arrival, separates it into head/tailwind and
        crosswind, and models your resulting speed (wind + hills + surface). It then rates the route
        on several sub-scores — each normalized 0–1 across the candidates — and blends them with
        tunable weights:
      </p>
      <div className="wr-doc__tablewrap">
        <table className="wr-doc__scores">
          <thead>
            <tr>
              <th scope="col">Sub-score</th>
              <th scope="col">Weight</th>
              <th scope="col">What it measures</th>
            </tr>
          </thead>
          <tbody>
            {SCORES.map((s) => (
              <tr key={s.name}>
                <th scope="row">{s.name}</th>
                <td className="tabular">{s.weight}</td>
                <td>{s.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Hard filters run first — within ~15% of your target distance, home before sunset if you
        asked, no ferries. And every explanation you read on a route is generated from these
        numbers, so there are no vague adjectives without a figure behind them.
      </p>

      <h2>The wind convention (for the curious)</h2>
      <p>
        Forecasts report the direction the wind comes <i>from</i>; WindRide converts that to where
        the wind is <i>going</i> and compares it with your heading, so “tailwind” really means the
        wind is pushing you along. The sign is locked down by tests — a loop can never be advertised
        as net tailwind.
      </p>

      <h2>Architecture, in short</h2>
      <ul>
        <li>
          <b>No backend, no account, zero running cost.</b> It’s a client-side PWA — everything runs
          in your browser.
        </li>
        <li>
          <b>Data sources:</b> routes from openrouteservice; weather from the Finnish Meteorological
          Institute (HARMONIE model) with an Open-Meteo fallback; transit from Digitransit; and a
          precomputed land-use shelter grid shipped with the app.
        </li>
        <li>
          <b>Your data stays local:</b> API keys, recorded rides, speed-model calibration and
          ridden-roads history all live in your browser (IndexedDB).
        </li>
        <li>
          <b>Region:</b> tuned for Uusimaa / southern Finland (shelter grid + transit), but the code
          is region-agnostic.
        </li>
      </ul>

      <p className="wr-muted">
        New here? The{' '}
        <a className="wr-link" href="#/help">
          Help page
        </a>{' '}
        walks through setup and the ride flow. Map &amp; data © OpenStreetMap contributors; weather
        CC-BY 4.0 (FMI &amp; Open-Meteo).
      </p>
    </section>
  );
}
