/**
 * Help / how-to screen: a plain-language guide for riders. Covers the Plan/Results/Ride flow, how
 * the bring-your-own API keys work and that they stay in the browser, installing the PWA, and an
 * FAQ. Static content (no state), so it works offline and needs no data.
 */
export function HelpScreen() {
  return (
    <section className="wr-screen wr-doc" aria-labelledby="help-title">
      <h1 id="help-title">Help &amp; how to use WindRide</h1>
      <p className="wr-muted">
        WindRide plans bike rides that work with today’s wind instead of against it, then guides you
        along the one you pick.
      </p>

      <h2>The basics: Plan → Results → Ride</h2>
      <ol className="wr-doc__steps">
        <li>
          <b>Plan.</b> Set your distance, loop or out-and-back, road or gravel, your elevation and
          traffic preferences, a start time, and whether you need to be home before dark. Then tap{' '}
          <b>Plan routes</b>.
        </li>
        <li>
          <b>Results.</b> You get the top three routes on the map, coloured by wind (green is
          tailwind, red is headwind). Each one shows an honest wind-aware ETA, a wind ribbon, and a
          short note on why it scored well. Pick the one you like.
        </li>
        <li>
          <b>Ride.</b> A full-screen map follows you with your speed, kilometres left, ETA and a
          wind arrow. It speaks the turns, warns about gusts, and steers you back to the track if
          you drift off. Drag or pinch to look around, then tap <b>Recenter</b> to jump back to
          where you are.
        </li>
        <li>
          <b>After the ride.</b> It’s saved on your device. You can export a GPX file or send it to
          Strava from <b>Ride history</b>.
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
          <b>openrouteservice</b> builds the candidate routes. You need this one for live planning.
        </li>
        <li>
          <b>Digitransit</b> ranks the return trip for downwind one-way rides. This one is optional.
        </li>
        <li>
          <b>Strava</b> lets you upload finished rides. Optional, and upload-only.
        </li>
      </ul>
      <p>
        Where they’re kept: only in this browser, in its local database (IndexedDB). They’re never
        sent to us, because there’s no server of ours to send them to. They’re never written into
        the app’s code either, and they only ever go straight to that provider over HTTPS. If you
        clear the site data or move to another device you’ll need to enter them again. And if you’re
        using a build the owner published with their own keys, yours quietly take over on your
        device.
      </p>

      <h2>Install it like an app (PWA)</h2>
      <p>
        WindRide is a Progressive Web App, so you can install it, run it full screen, and keep using
        it offline.
      </p>
      <ul>
        <li>
          <b>iPhone or iPad (Safari):</b> tap Share, then <i>Add to Home Screen</i>.
        </li>
        <li>
          <b>Android (Chrome):</b> open the menu, then <i>Install app</i> or{' '}
          <i>Add to Home screen</i>.
        </li>
        <li>
          <b>Desktop (Chrome or Edge):</b> use the install icon in the address bar.
        </li>
      </ul>
      <p>
        Once it’s installed it opens full screen with no browser bars, and it keeps the screen awake
        while you ride. The app itself works offline, but planning a new route needs a connection,
        since the routes and weather come from online services.
      </p>

      <h2>FAQ</h2>
      <details className="wr-doc__faq">
        <summary>Why do I need my own API keys?</summary>
        <p>
          WindRide is built for one person and costs nothing to run. There’s no shared server to
          hold keys, and the free tiers are tied to your own account, so bringing your own keeps you
          inside your own quota.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Is my ride data private?</summary>
        <p>
          Yes. Your recordings, history, speed calibration and the roads you’ve ridden are stored
          only in your browser. Nothing leaves your device unless you export a GPX file yourself or
          send a ride to Strava.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Does it work offline?</summary>
        <p>
          The installed app opens offline and pages you’ve already visited keep working. Planning a
          fresh route needs online routing and weather. If something can’t be reached, the app falls
          back gracefully instead of breaking.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Why is the ETA different from other apps?</summary>
        <p>
          Because it accounts for the wind. WindRide works out how head and tail wind and the hills
          change your speed on each part of the route, then adds up the time. A plain “distance
          divided by average speed” can’t do that.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>What is a “downwind” ride?</summary>
        <p>
          You ride out with the wind behind you and take public transport home, so you never have to
          grind back into a headwind. WindRide can rank the end points by how often the return
          service runs (this needs a Digitransit key).
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Strava says “auth failed”. What now?</summary>
        <p>
          Your Strava token needs the <code>activity:write</code> permission. Re-authorise it from{' '}
          <a className="wr-link" href="#/kit">
            Kit → Strava
          </a>{' '}
          and paste in the new refresh token. It’s upload-only, so it never reads anything from your
          Strava account.
        </p>
      </details>
      <details className="wr-doc__faq">
        <summary>Nothing happens when I tap “Plan routes”.</summary>
        <p>
          Make sure you’ve added an openrouteservice key under Kit and that you’re online. Live
          planning needs both.
        </p>
      </details>

      <h2>Safety</h2>
      <p className="wr-muted">
        Turn cues and gust warnings are there to help, not to replace your own judgement. They’re
        estimates from forecasts, so you’re still the one responsible for riding safely and
        following the rules of the road.
      </p>
    </section>
  );
}
