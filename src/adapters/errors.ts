/**
 * Typed provider error model (WR-003, ARCHITECTURE §7).
 *
 * Adapters map every failure to one of three kinds so the UI can show a single plain retry
 * state without knowing which provider failed or why.
 */
export type ProviderErrorKind = 'quota' | 'network' | 'badResponse';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;

  constructor(kind: ProviderErrorKind, message?: string) {
    super(message ?? `Provider error: ${kind}`);
    this.name = 'ProviderError';
    this.kind = kind;
    // Preserve instanceof across transpilation targets.
    Object.setPrototypeOf(this, ProviderError.prototype);
  }
}

export function providerError(kind: ProviderErrorKind, message?: string): ProviderError {
  return new ProviderError(kind, message);
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}
