import { describe, expect, it } from 'vitest';
import { isProviderError } from '../errors';
import { CognitoAuthClient } from './cognito';

interface FakeCall {
  url: string;
  init: RequestInit;
}
function fakeFetch(opts: { status?: number; body?: unknown; throwErr?: boolean }) {
  const calls: FakeCall[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (opts.throwErr) throw new TypeError('offline');
    const status = opts.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => opts.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const cfg = { region: 'eu-north-1', clientId: 'abc123', now: () => 1_000_000 };
const SIGNIN_OK = {
  AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r', ExpiresIn: 3600 },
};

describe('CognitoAuthClient', () => {
  it('signs in and builds a session (tokens + expiry from ExpiresIn)', async () => {
    const { fn, calls } = fakeFetch({ body: SIGNIN_OK });
    const client = new CognitoAuthClient({ ...cfg, fetchFn: fn });
    const s = await client.signIn('a@b.co', 'pw');
    expect(s.idToken).toBe('i');
    expect(s.refreshToken).toBe('r');
    expect(s.email).toBe('a@b.co');
    expect(s.expiresAt).toBe(1_000_000 + 3600 * 1000);
    // Targets the Cognito IDP endpoint with the InitiateAuth action + JSON-1.1 content type.
    expect(calls[0].url).toBe('https://cognito-idp.eu-north-1.amazonaws.com/');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-amz-target']).toBe('AWSCognitoIdentityProviderService.InitiateAuth');
    expect(headers['content-type']).toBe('application/x-amz-json-1.1');
  });

  it('reuses the prior refresh token on refresh (Cognito returns none)', async () => {
    const body = { AuthenticationResult: { AccessToken: 'a2', IdToken: 'i2', ExpiresIn: 3600 } };
    const { fn } = fakeFetch({ body });
    const s = await new CognitoAuthClient({ ...cfg, fetchFn: fn }).refresh('r-old', 'a@b.co');
    expect(s.refreshToken).toBe('r-old');
    expect(s.idToken).toBe('i2');
  });

  it('sends the verification code on confirmSignUp', async () => {
    const { fn, calls } = fakeFetch({ body: {} });
    await new CognitoAuthClient({ ...cfg, fetchFn: fn }).confirmSignUp('a@b.co', '123456');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-amz-target']).toBe('AWSCognitoIdentityProviderService.ConfirmSignUp');
    expect(JSON.parse(calls[0].init.body as string).ConfirmationCode).toBe('123456');
  });

  it('sends the reset targets (ForgotPassword / ConfirmForgotPassword / ResendConfirmationCode)', async () => {
    const targetFor = async (run: (c: CognitoAuthClient) => Promise<void>) => {
      const { fn, calls } = fakeFetch({ body: {} });
      await run(new CognitoAuthClient({ ...cfg, fetchFn: fn }));
      return (calls[0].init.headers as Record<string, string>)['x-amz-target'];
    };
    expect(await targetFor((c) => c.forgotPassword('a@b.co'))).toBe(
      'AWSCognitoIdentityProviderService.ForgotPassword',
    );
    expect(await targetFor((c) => c.confirmForgotPassword('a@b.co', '1', 'NewPass1'))).toBe(
      'AWSCognitoIdentityProviderService.ConfirmForgotPassword',
    );
    expect(await targetFor((c) => c.resendConfirmationCode('a@b.co'))).toBe(
      'AWSCognitoIdentityProviderService.ResendConfirmationCode',
    );
  });

  it('maps a Cognito error __type to a ProviderError code', async () => {
    const { fn } = fakeFetch({
      status: 400,
      body: { __type: 'NotAuthorizedException', message: 'Incorrect username or password.' },
    });
    const err = await new CognitoAuthClient({ ...cfg, fetchFn: fn })
      .signIn('a@b.co', 'bad')
      .catch((e) => e);
    expect(isProviderError(err) && err.code).toBe('NotAuthorized');
  });

  it('maps 429 to quota and a network throw to network', async () => {
    const rate = await new CognitoAuthClient({
      ...cfg,
      fetchFn: fakeFetch({ status: 429, body: {} }).fn,
    })
      .signIn('a@b.co', 'pw')
      .catch((e) => e);
    expect(isProviderError(rate) && rate.kind).toBe('quota');
    const net = await new CognitoAuthClient({ ...cfg, fetchFn: fakeFetch({ throwErr: true }).fn })
      .signIn('a@b.co', 'pw')
      .catch((e) => e);
    expect(isProviderError(net) && net.kind).toBe('network');
  });

  it('errors clearly when not configured (no region/clientId)', async () => {
    const err = await new CognitoAuthClient({ region: '', clientId: '' })
      .signIn('a@b.co', 'pw')
      .catch((e) => e);
    expect(isProviderError(err) && err.code).toBe('no-config');
  });
});
