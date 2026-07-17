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
   * the generic per-kind retry state (e.g. 'roundtrip-cap' — retrying can never succeed).
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
