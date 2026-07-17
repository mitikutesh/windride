#!/usr/bin/env node
/**
 * tools/strava-auth.mjs — one-time localhost OAuth for the owner's Strava (WR-023). Manual only.
 *
 * Prints a refresh token (scope activity:write) and writes it + the client id/secret to a gitignored
 * local config (tools/.strava.json). The client SECRET lives only here — never in Vite env (it would
 * be bundled). Paste the printed values into the app's Strava settings (stored in idb) once.
 *
 *   STRAVA_CLIENT_ID=xxx STRAVA_CLIENT_SECRET=yyy node tools/strava-auth.mjs
 *
 * Set your Strava app's Authorization Callback Domain to "localhost" first.
 */
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const clientId = process.env.STRAVA_CLIENT_ID;
const clientSecret = process.env.STRAVA_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (from strava.com/settings/api).');
  process.exit(1);
}

const PORT = 8721;
const redirectUri = `http://localhost:${PORT}/callback`;
const authUrl =
  `https://www.strava.com/oauth/authorize?client_id=${clientId}` +
  `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
  `&approval_prompt=force&scope=activity:write`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('No code');
    return;
  }
  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const json = await tokenRes.json();
    if (!json.refresh_token) throw new Error(JSON.stringify(json));
    const config = { clientId, clientSecret, refreshToken: json.refresh_token };
    writeFileSync(new URL('.strava.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
    res
      .writeHead(200, { 'Content-Type': 'text/plain' })
      .end('WindRide: Strava authorised. You can close this tab.');
    console.log('\nRefresh token obtained. Written to tools/.strava.json (gitignored).');
    console.log('Paste these into the app Strava settings:');
    console.log(JSON.stringify(config, null, 2));
    server.close();
  } catch (e) {
    res.writeHead(500).end('Token exchange failed');
    console.error('Token exchange failed:', e);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Open this URL to authorise WindRide (activity:write only):\n\n${authUrl}\n`);
});
