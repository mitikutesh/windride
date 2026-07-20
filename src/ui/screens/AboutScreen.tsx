/**
 * About screen: what WindRide is, why it's different (wind-aware, it generates routes), how the
 * 0-100 score is built (sub-scores + weights, matching the engine's DEFAULT_WEIGHTS and
 * docs/SCORING_SPEC.md §6), and the user-facing architecture. Static content.
 */

interface ScoreRow {
  name: string;
  weight: string;
  what: string;
}
// Mirrors the engine's DEFAULT_WEIGHTS (src/engine/scoring.ts) / SCORING_SPEC §6.
const SCORES: ScoreRow[] = [
  {
    name: 'Wind comfort',
    weight: '0.28',
    what: 'how little time you spend grinding into a headwind',
  },
  { name: 'Robustness', weight: '0.10', what: 'whether it still holds if the wind shifts ±30°' },
  {
    name: 'Crosswind safety',
    weight: '0.10',
    what: 'penalizes exposed, gusty crosswind stretches',
  },
  { name: 'Surface', weight: '0.12', what: 'matches your road or gravel preference' },
  { name: 'Traffic', weight: '0.10', what: 'avoids big roads that lack a cycleway' },
  { name: 'Scenery', weight: '0.07', what: 'rewards forest and waterside stretches' },
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
        WindRide is a wind-aware cycling route planner that runs entirely in your browser. You tell
        it how far you want to ride today, and it builds a set of candidate routes, scores them
        against the real wind, shelter and weather using time-weighted physics, and shows you the
        best three with honest, wind-aware ETAs. Then it navigates the one you choose, with live
        wind cues along the way.
      </p>

      <h2>What makes it different</h2>
      <p>
        Most wind tools take a route you already have and analyse it. WindRide generates routes to
        suit the day, and it does the planning and the navigation in one place.
      </p>
      <p>
        The idea behind it is that you can’t simply “ride the tailwind”. On any loop in steady wind,
        the tailwind and headwind stretches cancel out exactly, so the net is zero. So WindRide aims
        for the least suffering today instead, using the levers that actually work on a loop:
      </p>
      <ul>
        <li>It turns direct headwind into crosswind by shaping the route.</li>
        <li>
          It shelters the into-wind legs, since forest and town beat the open coast (the biggest
          lever around here).
        </li>
        <li>
          It sequences the ride so the headwind comes early and the tailwind carries you home.
        </li>
        <li>
          It weighs everything by time rather than distance, because a headwind kilometre costs you
          more minutes.
        </li>
        <li>For one-way trips it sends you downwind and you take transit back.</li>
      </ul>

      <h2>How the score works (0 to 100)</h2>
      <p>
        Each route is cut into segments of about 300 m. For every segment WindRide looks up the
        forecast wind for the time you’ll actually be there, splits it into head/tail wind and
        crosswind, and works out the speed you’d hold from the wind, the hills and the surface
        together. It then rates the route on a handful of sub-scores, each one scored from 0 to 1
        across the candidates, and blends them with weights you can tune:
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
        A few hard rules run first: the route has to land within about 15% of your target distance,
        get you home before sunset if you asked for that, and skip ferries. And every explanation
        you read on a route is built from these numbers, so you won’t see a vague adjective without
        a figure behind it.
      </p>

      <h2>The wind convention (for the curious)</h2>
      <p>
        Forecasts tell you the direction the wind is coming from. WindRide flips that to the
        direction it’s going and compares it with your heading, so a “tailwind” really does mean the
        wind is pushing you along. That sign is pinned down by tests, so a loop can never be sold to
        you as net tailwind.
      </p>

      <h2>Architecture, in short</h2>
      <ul>
        <li>
          Planning and navigation run entirely in your browser, with no account needed. It’s a PWA,
          so it installs and works offline.
        </li>
        <li>
          Data comes from openrouteservice for the routes, the Finnish Meteorological Institute (the
          HARMONIE model) for weather with Open-Meteo as a backup, Digitransit for transit, and a
          land-use shelter grid that ships with the app.
        </li>
        <li>
          Your own data stays with you. API keys, recorded rides, speed calibration and the roads
          you’ve ridden all live in your browser (IndexedDB) and are never sent to us.
        </li>
        <li>
          An <b>optional free account</b> syncs your saved routes across devices (and backs up a few
          plan preferences), through a small serverless backend (AWS, EU region). Your API keys are
          never part of it. What’s stored and how to export or delete it is spelled out on the{' '}
          <a className="wr-link" href="#/privacy">
            Privacy
          </a>{' '}
          page.
        </li>
        <li>
          Optional AI features (ride briefings, natural-language planning, route discovery) use{' '}
          <em>your own</em> AI provider and key, called straight from your browser. They’re additive
          and validated; the scoring engine stays the source of truth.
        </li>
        <li>
          It’s tuned for Uusimaa and southern Finland (the shelter grid and transit), but the code
          doesn’t hard-code the region.
        </li>
      </ul>

      <p className="wr-muted">
        Built and maintained by{' '}
        <a
          className="wr-link"
          href="https://mitikuteshome.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Mitiku Geleta
        </a>
        . New here? The{' '}
        <a className="wr-link" href="#/help">
          Help page
        </a>{' '}
        walks you through setup and the ride flow. Map and data © OpenStreetMap contributors;
        weather CC-BY 4.0 (FMI and Open-Meteo).
      </p>
    </section>
  );
}
