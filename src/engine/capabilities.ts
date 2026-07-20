/**
 * engine/capabilities.ts — one honest source of truth for "can this feature run, and if not, what
 * exactly is missing and where do I fix it" (WR-050). PURE: given a snapshot of what keys/providers
 * exist, it returns a per-capability status the UI renders consistently — so a missing key or an
 * unset AI provider always tells the user the specific thing to add and the exact Kit destination,
 * never a bare "something went wrong" or a silent disappearance.
 */

export type CapabilityName = 'routing' | 'transit' | 'ai';

export interface CapabilityStatus {
  name: CapabilityName;
  ready: boolean;
  /** Human, actionable reason it's not ready; null when ready. */
  reason: string | null;
  fixHref: string;
  fixLabel: string;
  /** Soft = degrades gracefully rather than breaking when absent (e.g. transit). */
  soft: boolean;
}

export interface CapabilitySnapshot {
  /** Live-APIs master switch — routing/transit only need keys when live (mock mode is always ready). */
  liveApis: boolean;
  hasRoutingKey: boolean;
  hasDigitransitKey: boolean;
  aiProvider: string | null;
  hasAiKey: boolean;
}

const KIT = '#/kit';
const AI_FEATURES = 'ride briefings, natural-language planning and route discovery';

export function routingCapability(s: CapabilitySnapshot): CapabilityStatus {
  const ready = !s.liveApis || s.hasRoutingKey;
  return {
    name: 'routing',
    ready,
    soft: false,
    fixHref: KIT,
    fixLabel: 'Kit → API keys',
    reason: ready
      ? null
      : 'Live route planning needs your own openrouteservice key (free tier at openrouteservice.org).',
  };
}

export function transitCapability(s: CapabilitySnapshot): CapabilityStatus {
  const ready = !s.liveApis || s.hasDigitransitKey;
  return {
    name: 'transit',
    ready,
    soft: true,
    fixHref: KIT,
    fixLabel: 'Kit → API keys',
    reason: ready
      ? null
      : 'Add a Digitransit key to rank downwind return times; without it, cards just say “check return times”.',
  };
}

export function aiCapability(s: CapabilitySnapshot): CapabilityStatus {
  const hasProvider = Boolean(s.aiProvider);
  const ready = hasProvider && s.hasAiKey;
  let reason: string | null = null;
  if (!ready) {
    reason = !hasProvider
      ? `Pick an AI provider in Kit → AI to use ${AI_FEATURES}. You bring your own key.`
      : `Add your ${s.aiProvider} key in Kit → AI to turn on ${AI_FEATURES}.`;
  }
  return { name: 'ai', ready, soft: false, fixHref: KIT, fixLabel: 'Kit → AI', reason };
}

export function capabilities(s: CapabilitySnapshot): Record<CapabilityName, CapabilityStatus> {
  return {
    routing: routingCapability(s),
    transit: transitCapability(s),
    ai: aiCapability(s),
  };
}
