/**
 * Typed provider error model (WR-003, ARCHITECTURE §7).
 *
 * Adapters map every failure to one of three kinds so the UI can show a single plain retry
 * state without knowing which provider failed or why.
 */
export type ProviderErrorKind = 'quota' | 'network' | 'badResponse';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  /**
   * Optional machine-readable code for cases the UI should phrase specially rather than showing
   * the generic per-kind retry state. Well-known codes shared across adapters:
   * - 'auth'        — the provider rejected the API key (401/403); fix the key, retrying is futile.
   * - 'no-key'      — no API key configured at all; point the user at Kit → API keys.
   * - 'timeout'     — the request hit the adapter's timeout; retrying may help.
   * - 'offline'     — fetch failed AND the browser reports no connectivity.
   * - 'unreachable' — fetch failed while apparently online (CORS-blocked, DNS, firewall); often
   *                   what an invalid key looks like from JS, so never phrase it as "offline".
   * - 'roundtrip-cap' — requested distance exceeds the ORS round-trip cap; retrying can never succeed.
   */
  readonly code?: string;

  constructor(kind: ProviderErrorKind, message?: string, code?: string) {
    super(message ?? `Provider error: ${kind}`);
    this.name = 'ProviderError';
    this.kind = kind;
    this.code = code;
    // Preserve instanceof across transpilation targets.
    Object.setPrototypeOf(this, ProviderError.prototype);
  }
}

export function providerError(
  kind: ProviderErrorKind,
  message?: string,
  code?: string,
): ProviderError {
  return new ProviderError(kind, message, code);
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** True when the browser affirmatively reports no network connectivity. */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Classify a rejected fetch() into a typed network error. Browsers throw the same opaque
 * TypeError for "no internet", DNS failure and a CORS-blocked error response — and a blocked
 * 401/403 is exactly what an invalid API key looks like from JS. So distinguish what we CAN
 * observe: an abort is a 'timeout', navigator.onLine === false is 'offline', anything else is
 * 'unreachable' — and the UI must not claim "you are offline" for that last one.
 */
export function fetchFailure(service: string, aborted: boolean): ProviderError {
  if (aborted) return new ProviderError('network', `${service} request timed out`, 'timeout');
  if (isBrowserOffline()) {
    return new ProviderError('network', `${service} fetch failed while offline`, 'offline');
  }
  return new ProviderError(
    'network',
    `${service} request failed while apparently online`,
    'unreachable',
  );
}
