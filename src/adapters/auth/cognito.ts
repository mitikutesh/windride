/**
 * adapters/auth/cognito.ts — Amazon Cognito auth from the browser (WR-039). Calls the Cognito IDP
 * JSON API directly with plain fetch (USER_PASSWORD_AUTH) — no AWS SDK, no server proxy, no secret
 * (the SPA client is public). One of the few places fetch() may appear (CLAUDE.md rule 4). The pool
 * region + public client id come from VITE_ env (public config, safe to bundle) — never a secret.
 */
import { ProviderError } from '../errors';
import type { AuthClient, Session } from './types';

/** True when the build was configured with a Cognito pool (region + public client id). */
export function authConfigured(): boolean {
  return Boolean(import.meta.env.VITE_COGNITO_REGION && import.meta.env.VITE_COGNITO_CLIENT_ID);
}

interface CognitoAuthResult {
  AuthenticationResult?: {
    AccessToken?: string;
    IdToken?: string;
    RefreshToken?: string;
    ExpiresIn?: number;
  };
}

export interface CognitoOptions {
  region?: string;
  clientId?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** Map a Cognito error `__type` / HTTP status to a ProviderError kind + a short code. */
function providerErrorFor(
  status: number,
  type: string | undefined,
  message: string,
): ProviderError {
  if (status === 429 || type === 'TooManyRequestsException') {
    return new ProviderError('quota', 'Too many attempts — try again later', 'rate');
  }
  const code = (type ?? '').replace(/Exception$/, '');
  return new ProviderError('badResponse', message || 'Auth request failed', code || undefined);
}

export class CognitoAuthClient implements AuthClient {
  private readonly region: string;
  private readonly clientId: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(opts: CognitoOptions = {}) {
    this.region = opts.region ?? import.meta.env.VITE_COGNITO_REGION ?? '';
    this.clientId = opts.clientId ?? import.meta.env.VITE_COGNITO_CLIENT_ID ?? '';
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
  }

  private async call(target: string, body: Record<string, unknown>): Promise<unknown> {
    if (!this.region || !this.clientId) {
      throw new ProviderError(
        'badResponse',
        'Accounts are not configured in this build',
        'no-config',
      );
    }
    let res: Response;
    try {
      res = await this.fetchFn(`https://cognito-idp.${this.region}.amazonaws.com/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': `AWSCognitoIdentityProviderService.${target}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ProviderError('network', 'Network error — check your connection');
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        __type?: string;
        message?: string;
        Message?: string; // some Cognito payloads capitalise it
      };
      throw providerErrorFor(res.status, err.__type, err.message ?? err.Message ?? '');
    }
    return res.json();
  }

  private toSession(raw: unknown, email: string, priorRefresh?: string): Session {
    const r = (raw as CognitoAuthResult).AuthenticationResult;
    if (!r?.IdToken || !r.AccessToken) {
      throw new ProviderError('badResponse', 'Auth response missing tokens');
    }
    return {
      idToken: r.IdToken,
      accessToken: r.AccessToken,
      // REFRESH_TOKEN_AUTH doesn't return a new refresh token — keep the prior one.
      refreshToken: r.RefreshToken ?? priorRefresh ?? '',
      expiresAt: this.now() + (r.ExpiresIn ?? 3600) * 1000,
      email,
    };
  }

  async signUp(email: string, password: string): Promise<void> {
    await this.call('SignUp', {
      ClientId: this.clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    });
  }

  async confirmSignUp(email: string, code: string): Promise<void> {
    await this.call('ConfirmSignUp', {
      ClientId: this.clientId,
      Username: email,
      ConfirmationCode: code,
    });
  }

  async resendConfirmationCode(email: string): Promise<void> {
    await this.call('ResendConfirmationCode', { ClientId: this.clientId, Username: email });
  }

  async forgotPassword(email: string): Promise<void> {
    await this.call('ForgotPassword', { ClientId: this.clientId, Username: email });
  }

  async confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
    await this.call('ConfirmForgotPassword', {
      ClientId: this.clientId,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
    });
  }

  async signIn(email: string, password: string): Promise<Session> {
    const raw = await this.call('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: this.clientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    return this.toSession(raw, email);
  }

  async refresh(refreshToken: string, email: string): Promise<Session> {
    const raw = await this.call('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: this.clientId,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
    return this.toSession(raw, email, refreshToken);
  }
}
