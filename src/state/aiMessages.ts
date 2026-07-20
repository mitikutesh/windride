// state/aiMessages.ts — one place for AI setup/failure copy (WR-050 consolidation), so every AI
// feature (briefing, NL planning, discovery, recap) says the SAME honest, actionable thing for the
// same cause instead of four different "try again" lines. Mirrors ridesStore.stravaFailureReason.
import { isProviderError } from '../adapters/errors';

/** Shown when an AI feature is invoked but no provider+key is set up. */
export const AI_NOT_SET_UP = 'AI isn’t set up — pick a provider and add its key in Kit → AI.';

/**
 * Turn an AI provider failure into honest copy that names the likely cause + fix: auth → check Kit,
 * quota → wait, network → offline. Anything else (a validation/parse failure) falls back to a
 * feature-specific "try again". `feature` is a verb phrase, e.g. "get a briefing".
 */
export function aiFailureReason(e: unknown, feature: string): string {
  if (isProviderError(e)) {
    if (e.code === 'auth') return 'Your AI key was rejected — check it in Kit → AI.';
    if (e.kind === 'quota') return 'AI limit reached — please try again later.';
    if (e.kind === 'network') return 'You appear to be offline. Check your connection.';
  }
  return `Couldn’t ${feature} right now — try again, or rephrase.`;
}
