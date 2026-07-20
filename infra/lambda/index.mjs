// WindRide API Lambda — one function behind a Function URL, routing by path (WR-038/040/041). The
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

/** Parse a Function URL request body (handles base64). Returns {} when empty, null when malformed. */
function readBody(event) {
  if (!event?.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

/** Verify the caller's JWT. Returns { claims } or { error } (a ready 401 response). */
async function authenticate(event, deps) {
  const token = bearer(event);
  if (!token) return { error: json(401, { error: 'missing bearer token' }) };
  const verify = deps.verify ?? getVerify();
  try {
    return { claims: await verify(token) };
  } catch {
    return { error: json(401, { error: 'invalid token' }) };
  }
}

/** GET /me — the caller's profile + entitlement (created on first call). */
async function handleMe(event, deps) {
  const { claims, error } = await authenticate(event, deps);
  if (error) return error;
  const store = deps.store ?? dynamoProfileStore;
  try {
    return json(200, await store.getOrCreateProfile(claims.sub, claims.email ?? ''));
  } catch {
    return json(500, { error: 'could not load profile' });
  }
}

/** GET /sync — pull the caller's synced document (saved routes + prefs). NEVER any API key. */
async function handleSyncGet(event, deps) {
  const { claims, error } = await authenticate(event, deps);
  if (error) return error;
  const store = deps.store ?? dynamoProfileStore;
  try {
    return json(200, await store.getSyncDoc(claims.sub));
  } catch {
    return json(500, { error: 'could not read sync' });
  }
}

/** PUT /sync — replace the caller's synced document. The client guarantees it holds no secrets. */
async function handleSyncPut(event, deps) {
  const { claims, error } = await authenticate(event, deps);
  if (error) return error;
  const body = readBody(event);
  if (body === null || typeof body.doc !== 'object' || body.doc === null || Array.isArray(body.doc)) {
    return json(400, { error: 'bad sync body' });
  }
  // Size cap — a DynamoDB item maxes at 400 KB; reject well before that so we never 500 on write.
  if (JSON.stringify(body.doc).length > 256 * 1024) {
    return json(413, { error: 'sync document too large' });
  }
  const store = deps.store ?? dynamoProfileStore;
  try {
    return json(200, await store.putSyncDoc(claims.sub, body.doc));
  } catch {
    return json(500, { error: 'could not write sync' });
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
  if (method === 'GET' && path === '/sync') return handleSyncGet(event, deps);
  if (method === 'PUT' && path === '/sync') return handleSyncPut(event, deps);
  return json(404, { error: 'not found', path });
}

export const handler = route;
