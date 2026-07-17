import { describe, expect, it } from 'vitest';
import { isProviderError, ProviderError, providerError } from './errors';

describe('ProviderError', () => {
  it('carries its kind and a message', () => {
    const e = providerError('quota', 'daily budget spent');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.kind).toBe('quota');
    expect(e.message).toBe('daily budget spent');
  });

  it('narrows only genuine ProviderErrors', () => {
    expect(isProviderError(providerError('network'))).toBe(true);
    expect(isProviderError(new Error('plain'))).toBe(false);
    expect(isProviderError({ kind: 'network' })).toBe(false);
    expect(isProviderError(null)).toBe(false);
  });
});
