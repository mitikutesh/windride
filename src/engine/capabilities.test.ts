import { describe, expect, it } from 'vitest';
import {
  aiCapability,
  capabilities,
  routingCapability,
  transitCapability,
  type CapabilitySnapshot,
} from './capabilities';

const base: CapabilitySnapshot = {
  liveApis: true,
  hasRoutingKey: false,
  hasDigitransitKey: false,
  aiProvider: null,
  hasAiKey: false,
};

describe('routingCapability', () => {
  it('is ready in mock mode regardless of keys', () => {
    expect(routingCapability({ ...base, liveApis: false }).ready).toBe(true);
  });
  it('is not ready when live with no key, and points at Kit', () => {
    const c = routingCapability(base);
    expect(c.ready).toBe(false);
    expect(c.reason).toMatch(/openrouteservice/i);
    expect(c.fixHref).toBe('#/kit');
    expect(c.soft).toBe(false);
  });
  it('is ready when a key exists', () => {
    expect(routingCapability({ ...base, hasRoutingKey: true }).ready).toBe(true);
  });
});

describe('transitCapability', () => {
  it('is soft (degrades, not an error) when absent', () => {
    const c = transitCapability(base);
    expect(c.ready).toBe(false);
    expect(c.soft).toBe(true);
    expect(c.reason).toMatch(/check return times/i);
  });
});

describe('aiCapability', () => {
  it('names the missing provider when none is picked', () => {
    const c = aiCapability(base);
    expect(c.ready).toBe(false);
    expect(c.reason).toMatch(/pick an ai provider/i);
    expect(c.fixLabel).toBe('Kit → AI');
  });
  it('asks for the key (naming the provider) when a provider is picked but no key', () => {
    const c = aiCapability({ ...base, aiProvider: 'anthropic' });
    expect(c.ready).toBe(false);
    expect(c.reason).toMatch(/add your anthropic key/i);
  });
  it('is ready with both a provider and a key', () => {
    expect(aiCapability({ ...base, aiProvider: 'gemini', hasAiKey: true }).ready).toBe(true);
  });
});

describe('capabilities', () => {
  it('returns a status for each capability', () => {
    const all = capabilities(base);
    expect(Object.keys(all).sort()).toEqual(['ai', 'routing', 'transit']);
  });
});
