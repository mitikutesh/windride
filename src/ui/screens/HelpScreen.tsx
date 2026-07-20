/**
 * Help / how-to screen — plain-language guide for riders: the Plan→Results→Ride flow, how the
 * bring-your-own API keys work and that they stay in the browser, installing the PWA, and an FAQ.
 * Static content only (no state), so it works offline and needs no data.
 */
export function HelpScreen() {
  return (
    <section className="wr-screen wr-doc" aria-labelledby="help-title">
      <h1 id="help-title">Help &amp; how to use WindRide</h1>
      <p className="wr-muted">
        WindRide plans bike rides that work <em>with</em> today’s wind instead of against it — then
        guides you along the one you pick.
      </p>

      <h2>The basics: Plan → Results → Ride</h2>
      <ol className="wr-doc__steps">
        <li>
          <b>Plan.</b> Set your distance, loop or out-and-back, road or gravel, elevation and
          traffic preferences, start time, and whether you need to be “home before dark”. Tap{' '}
          <b>Plan routes</b>.
        </li>
        <li>
          <b>Results.</b> See the top three routes on the map, coloured by wind (green = tailwind,
          red = headwind), each with an honest wind-aware ETA, a wind ribbon, and a plain-language
          explanation of why it scored well. Pick one.
        </li>
        <li>
          <b>Ride.</b> A full-screen map follows you with your speed, kilometres left, ETA and a
          wind arrow, spoken turn cues, off-route re-routing, and gust warnings. Drag or pinch to
          look around; <b>Recenter</b> snaps back to following you.
        </li>
        <li>
          <b>After.</b> Your ride is saved on your device. Export a GPX file or send it to Strava
          from <b>Ride history</b>.
        </li>
      </ol>

      <h2>Your API keys stay in your browser</h2>
      <p>
        WindRide has no server and no account. To use live data you add your own free API keys under{' '}
        <a className="wr-link" href="#/kit">
          Kit → API keys
        </a>
        :
      </p>
      <ul>
        <li>
          <b>openrouteservice</b> — generates the candidate routes (needed for live planning).
        </li>
        <li>
          <b>Digitransit</b> — ranks the return trip for downwind one-way rides (optional).
        </li>
        <li>
          <b>Strava</b> — upload finished rides (optional, upload-only).
        </li>
      </ul>
      <p>
        <b>Where they’re kept:</b> only in this browser, in its local database (IndexedDB). They are
        never uploaded to us — there is no “us” server — never baked into the app’s code, and only
        ever sent straight to that provider over HTTPS. Clearing site data or switching devices
        means re-entering them. If you’re using a build the owner published with their own keys,
        yours override them locally.
      </p>

      <h2>Install it like an app (PWA)</h2>
      <p>WindRide is a Progressive Web App — installable, full-screen, and offline-tolerant.</p>
      <ul>
        <li>
          <b>iPhone / iPad (Safari):</b> Share → <i>Add to Home Screen</i>.
        </li>
        <li>
          <b>Android (Chrome):</b> menu (⋮) → <i>Install app</i> / <i>Add to Home screen</i>.
        </li>
        <li>
          <b>Desktop (Chrome / Edge):</b> the install icon in the address bar.
        </li>
      </ul>
      <p>
        Once installed it opens full-screen with no browser bars and keeps the screen awake while
        you ride. The app itself works offline, but <b>generating new routes needs a connection</b>{' '}
        — routes and weather come from online APIs.
      </p>

      <h2>FAQ</h2>
      <details className="wr-doc__faq">
        <summary>Why do I need my own API keys?</summary>
        <p>
          WindRide is single-user and free to run: there’s no shared backend to hold keys, and the
          providers’ free tiers are per-account. Bringing your own keeps you within your own quota
          and your own privacy.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Is my ride data private?</summary>
        <p>
          Yes. Recordings, history, speed calibration and ridden-roads are stored only in your
          browser and never leave your device — except a GPX you export yourself or a Strava upload
          you trigger.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Does it work offline?</summary>
        <p>
          The installed app launches offline and previously loaded screens work, but planning new
          routes needs online routing + weather. Shelter data and cached pieces degrade gracefully
          when something isn’t reachable.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Why is the ETA different from other apps?</summary>
        <p>
          It’s wind-aware. WindRide models how head/tailwind and hills change your speed on every
          segment and weights the ride by time. A flat “distance ÷ average speed” ignores all of
          that.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>What is a “downwind” ride?</summary>
        <p>
          Ride out with the wind and take public transit back, so you never grind home into a
          headwind. WindRide ranks end points partly by how frequent the return service is (needs a
          Digitransit key).
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Strava says “auth failed”. Now what?</summary>
        <p>
          Your Strava token needs the <code>activity:write</code> scope. Re-authorize from{' '}
          <a className="wr-link" href="#/kit">
            Kit → Strava
          </a>{' '}
          and paste the new refresh token. It’s upload-only and never reads your Strava data.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Nothing happens when I tap “Plan routes”.</summary>
        <p>
          Check that you added an openrouteservice key under Kit and that you’re online — live
          planning needs both.
        </p>
      </details>

      <h2>Safety</h2>
      <p className="wr-muted">
        Turn cues and gust warnings are aids, not guarantees — they’re estimates from forecasts. You
        are responsible for riding safely and obeying traffic laws.
      </p>
    </section>
  );
}
