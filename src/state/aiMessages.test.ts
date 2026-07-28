import { describe, expect, it } from 'vitest';
import { ProviderError } from '../adapters/errors';
import { AI_NOT_SET_UP, aiFailureReason } from './aiMessages';

describe('aiFailureReason', () => {
  it('names the cause + fix for an auth failure (points at Kit)', () => {
    expect(aiFailureReason(new ProviderError('badResponse', 'rejected', 'auth'), 'x')).toMatch(
      /Kit → AI/,
    );
  });

  it('phrases quota and network distinctly', () => {
    expect(aiFailureReason(new ProviderError('quota', 'rate'), 'x')).toMatch(/limit/i);
    // While apparently online, a failed request is NOT phrased as "offline" (often a key problem).
    expect(aiFailureReason(new ProviderError('network', 'down'), 'x')).toMatch(/Kit → AI/);
    expect(aiFailureReason(new ProviderError('network', 'down', 'offline'), 'x')).toMatch(
      /offline/i,
    );
  });

  it('falls back to a feature-specific retry for other/validation failures', () => {
    expect(aiFailureReason(new Error('bad json'), 'get a briefing')).toMatch(/get a briefing/);
  });

  it('AI_NOT_SET_UP names the fix location', () => {
    expect(AI_NOT_SET_UP).toMatch(/Kit → AI/);
  });
});
