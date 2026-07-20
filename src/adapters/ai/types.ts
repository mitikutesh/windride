/**
 * Shared AI adapter types (WR-044). The provider is a PER-USER choice made in Kit (DEC-043) —
 * each user brings their own provider AND key. Kept in its own file so the registry and the Kit
 * UI can name providers without pulling in the HTTP client (ARCHITECTURE §3 boundary).
 */

/** The AI providers WindRide can talk to. Verified browser-CORS-callable for DEC-043. */
export type AiProvider = 'anthropic' | 'openrouter' | 'gemini';

export interface AiProviderMeta {
  id: AiProvider;
  label: string;
  /** One line shown under the Kit provider picker: what it is + where a key comes from. */
  help: string;
  /** Where the user gets a key (rendered as a link). */
  keysUrl: string;
}

/** The menu offered in Kit → AI. Order = display order. */
export const AI_PROVIDERS: AiProviderMeta[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    help: 'Your own Anthropic API key.',
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    help: 'One key, many models, behind a single endpoint.',
    keysUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    help: 'Your own Google AI Studio key.',
    keysUrl: 'https://aistudio.google.com/app/apikey',
  },
];

/** Narrowing guard for a value read back from storage (idb) or the DOM (a <select> value). */
export function isAiProvider(v: unknown): v is AiProvider {
  return v === 'anthropic' || v === 'openrouter' || v === 'gemini';
}

/** One AI request. `parse` turns the model's raw JSON into T, or returns null to reject it. */
export interface AiRequest {
  /** System / instruction text: role, constraints, and the JSON shape to return. */
  system: string;
  /** The user turn: the concrete data + task. */
  prompt: string;
  /** Hard cap on output tokens — the user pays, so keep it small by default. */
  maxTokens?: number;
}

export interface AiClient {
  readonly provider: AiProvider;
  /**
   * Run one completion and validate it. The provider is asked for JSON; the adapter extracts the
   * text, JSON-parses it, and hands the value to `parse`. Returns T on success. Throws
   * ProviderError ('network' | 'quota' | 'badResponse') on transport failure OR when the output
   * can't be parsed / `parse` rejects it — so a bad AI response is handled exactly like any other
   * provider failure and the feature no-ops, never surfacing half-trusted output (DEC-043).
   */
  complete<T>(req: AiRequest, parse: (raw: unknown) => T | null): Promise<T>;
}
