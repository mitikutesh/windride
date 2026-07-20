/**
 * Privacy policy (WR-042). WindRide is a data controller once you create an account. This page states
 * plainly what is stored, why, for how long, and how to get it out or delete it. Static content.
 */
export function PrivacyScreen() {
  return (
    <section className="wr-screen wr-doc" aria-labelledby="privacy-title">
      <h1 id="privacy-title">Privacy &amp; your data</h1>
      <p className="wr-muted">
        WindRide works fully without an account. If you choose to create one, this is exactly what
        we hold and what you can do about it.
      </p>

      <h2>Without an account</h2>
      <p>
        Everything stays on your device. Your API keys, recorded rides, saved routes, speed
        calibration and the roads you have ridden all live in your browser’s local database. Nothing
        is sent to us, because there is nothing of ours for it to go to. Weather and routing
        requests go straight from your browser to those providers using your own keys.
      </p>

      <h2>With an account</h2>
      <p>
        An optional free account syncs your saved routes across devices (and backs up a few planning
        preferences). To do that we store, on our servers:
      </p>
      <ul>
        <li>Your email address (needed to sign in and reset your password).</li>
        <li>
          Your saved routes and a small set of plan preferences (distance, road or gravel, and so
          on).
        </li>
        <li>
          Your subscription tier (currently just the free plan) and the date your account was
          created.
        </li>
      </ul>
      <p>
        We never store your API keys or credentials. They are deliberately kept out of anything that
        syncs and stay only in your browser. We run no analytics and no tracking, and we do not
        share your data with anyone.
      </p>

      <h2>Where it lives, and for how long</h2>
      <p>
        Account data is held in Amazon Web Services in the EU (Stockholm region). The lawful basis
        is the contract you enter by using the account features. We keep it until you delete your
        account, at which point it is removed. For a short window after that, restorable copies may
        remain in our database provider’s automatic backups, which expire on their own cycle (up to
        about 35 days).
      </p>

      <h2>Getting your data out, or deleting it</h2>
      <p>
        From{' '}
        <a className="wr-link" href="#/kit">
          Kit → Account
        </a>
        , when signed in, you can:
      </p>
      <ul>
        <li>
          <b>Export your data</b>: download everything we hold for you as a JSON file.
        </li>
        <li>
          <b>Delete your account</b>: this erases your server-side data and removes your login. It
          does not touch the data that lives only in your browser, which you control by clearing the
          site’s storage.
        </li>
      </ul>

      <h2>Who runs this</h2>
      <p className="wr-muted">
        WindRide is built and maintained by{' '}
        <a
          className="wr-link"
          href="https://mitikuteshome.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Mitiku Geleta
        </a>
        , the data controller for account data. Questions about your data can go through that site.
      </p>
    </section>
  );
}
