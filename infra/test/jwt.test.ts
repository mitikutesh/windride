import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM JS helper (no types).
import { assertClaims, decodeJwt, makeVerifier, verifyRs256 } from '../lambda/jwt.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

const ISSUER = 'https://cognito-idp.eu-north-1.amazonaws.com/eu-north-1_test';
const CLIENT = 'client1';

function b64url(obj: unknown) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function makeToken(payload: object, key: KeyObject = privateKey, kid = 'k1') {
  const header = b64url({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64url(payload);
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  signer.end();
  return `${header}.${body}.${signer.sign(key).toString('base64url')}`;
}

const goodPayload = {
  sub: 'u1',
  email: 'a@b.co',
  exp: 2_000_000_000,
  iss: ISSUER,
  aud: CLIENT,
  token_use: 'id',
};

describe('jwt helpers (WR-040)', () => {
  it('decodeJwt parses header + payload', () => {
    const { header, payload } = decodeJwt(makeToken(goodPayload));
    expect(header.kid).toBe('k1');
    expect(payload.sub).toBe('u1');
  });

  it('verifyRs256 accepts a correctly-signed token and rejects a tampered one', () => {
    const token = makeToken(goodPayload);
    expect(verifyRs256(token, jwk)).toBe(true);
    expect(verifyRs256(token.slice(0, -4) + 'AAAA', jwk)).toBe(false);
  });

  it('assertClaims rejects expired / wrong-audience / wrong-issuer tokens', () => {
    const now = 1_000_000_000;
    expect(() => assertClaims(goodPayload, { clientId: CLIENT, issuer: ISSUER, now })).not.toThrow();
    expect(() =>
      assertClaims({ ...goodPayload, exp: now - 1 }, { clientId: CLIENT, issuer: ISSUER, now }),
    ).toThrow(/expired/);
    expect(() =>
      assertClaims({ ...goodPayload, aud: 'other' }, { clientId: CLIENT, issuer: ISSUER, now }),
    ).toThrow(/audience/);
    expect(() =>
      assertClaims({ ...goodPayload, iss: 'evil' }, { clientId: CLIENT, issuer: ISSUER, now }),
    ).toThrow(/issuer/);
  });

  it('makeVerifier fetches the JWKS and returns the validated payload', async () => {
    const fetchFn = (async () => ({
      ok: true,
      json: async () => ({ keys: [jwk] }),
    })) as unknown as typeof fetch;
    const verify = makeVerifier({
      region: 'eu-north-1',
      userPoolId: 'eu-north-1_test',
      clientId: CLIENT,
      fetchFn,
      now: () => 1_000_000_000_000,
    });
    const payload = await verify(makeToken(goodPayload));
    expect(payload.sub).toBe('u1');
    // A token signed by a DIFFERENT key must be rejected (bad signature).
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verify(makeToken(goodPayload, other))).rejects.toThrow();
  });
});
