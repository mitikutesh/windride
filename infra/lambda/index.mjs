// WindRide API Lambda — one function behind a Function URL, routing by path (WR-038, WR-040). The
// Function URL is PUBLIC (authType NONE), so authed routes verify the Cognito JWT here (WR-040).
// Plain ESM JS (no build step) so `Code.fromAsset` zips it as-is and `cdk synth` needs no Docker.
// Route logic is pure + injectable (verify/store) for unit tests; the real deps are built lazily.
import { makeVerifier } from './jwt.mjs';
import { dynamoProfileStore } from './store.mjs';

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function bearer(event) {
  const h = event?.headers ?? {};
  const raw = h.authorization ?? h.Authorization ?? '';
  return raw.startsWith('Bearer ') ? raw.slice(7) : '';
}

let defaultVerify;
function getVerify() {
  if (!defaultVerify) {
    defaultVerify = makeVerifier({
      region: process.env.COGNITO_REGION,
      userPoolId: process.env.COGNITO_USER_POOL_ID,
      clientId: process.env.COGNITO_CLIENT_ID,
    });
  }
  return defaultVerify;
}

/** GET /me — verify the caller's JWT, then return (creating if needed) their profile + entitlement. */
async function handleMe(event, deps) {
  const token = bearer(event);
  if (!token) return json(401, { error: 'missing bearer token' });
  const verify = deps.verify ?? getVerify();
  let claims;
  try {
    claims = await verify(token);
  } catch {
    return json(401, { error: 'invalid token' });
  }
  const store = deps.store ?? dynamoProfileStore;
  try {
    const profile = await store.getOrCreateProfile(claims.sub, claims.email ?? '');
    return json(200, profile);
  } catch {
    return json(500, { error: 'could not load profile' });
  }
}

/** Route a Lambda Function URL event. `deps` (verify/store) are injected in unit tests. */
export async function route(event, deps = {}) {
  const method = event?.requestContext?.http?.method ?? 'GET';
  const path = event?.rawPath ?? '/';

  if (method === 'GET' && path === '/health') {
    return json(200, { status: 'ok', version: process.env.BUILD_VERSION ?? 'dev' });
  }
  if (method === 'GET' && path === '/me') return handleMe(event, deps);
  return json(404, { error: 'not found', path });
}

export const handler = route;
