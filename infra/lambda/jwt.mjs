// Cognito JWT verification for the API Lambda (WR-040). The Function URL is public (authType NONE),
// so every authed route MUST verify the caller's Cognito JWT here. Plain Node — no bundler, no lib:
// node:crypto verifies RS256 against the pool's JWKS. Pure helpers are unit-tested with a generated
// key; makeVerifier() wires JWKS fetching + claim checks for the runtime.
import { createPublicKey, createVerify } from 'node:crypto';

function b64urlToJson(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

/** Decode a JWT into { header, payload } without verifying. Throws on a malformed token. */
export function decodeJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  return { header: b64urlToJson(parts[0]), payload: b64urlToJson(parts[1]) };
}

/** Verify an RS256 signature against a JWK (public key). Returns boolean. */
export function verifyRs256(token, jwk) {
  const [h, p, sig] = String(token).split('.');
  if (!h || !p || !sig) return false;
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const v = createVerify('RSA-SHA256');
  v.update(`${h}.${p}`);
  v.end();
  return v.verify(key, Buffer.from(sig, 'base64url'));
}

/** Validate the security-relevant claims. `now` is epoch seconds. Throws on any failure. */
export function assertClaims(payload, { clientId, issuer, now }) {
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('token expired');
  if (issuer && payload.iss !== issuer) throw new Error('issuer mismatch');
  // Cognito id tokens carry `aud`; access tokens carry `client_id`. Accept either matching our client.
  const audience = payload.aud ?? payload.client_id;
  if (clientId && audience !== clientId) throw new Error('audience mismatch');
  if (payload.token_use && !['id', 'access'].includes(payload.token_use)) {
    throw new Error('wrong token_use');
  }
  if (!payload.sub) throw new Error('no subject');
}

/**
 * Build a verifier bound to a Cognito pool. Returns verify(token) → the validated payload, or
 * throws. Caches the JWKS in memory (keys rotate rarely). `fetchFn`/`now` injectable for tests.
 */
export function makeVerifier({ region, userPoolId, clientId, fetchFn = fetch, now = () => Date.now() }) {
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  let jwksCache = null;

  async function jwks() {
    if (!jwksCache) {
      const res = await fetchFn(`${issuer}/.well-known/jwks.json`);
      if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
      jwksCache = (await res.json()).keys ?? [];
    }
    return jwksCache;
  }

  return async function verify(token) {
    const { header, payload } = decodeJwt(token);
    let key = (await jwks()).find((k) => k.kid === header.kid);
    if (!key) {
      jwksCache = null; // key may have rotated — refetch once before giving up
      key = (await jwks()).find((k) => k.kid === header.kid);
    }
    if (!key) throw new Error('signing key not found');
    if (!verifyRs256(token, key)) throw new Error('bad signature');
    assertClaims(payload, { clientId, issuer, now: Math.floor(now() / 1000) });
    return payload;
  };
}
