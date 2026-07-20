/**
 * adapters/ai/client.ts — the ONLY place an AI provider is called (WR-044, CLAUDE.md rule 4).
 *
 * Bring-your-own key + per-user provider (DEC-043): the key never comes from Vite env and is never
 * bundled. Every call demands structured JSON and validates it; anything unparseable or rejected is
 * raised as a ProviderError so the feature no-ops rather than trusting garbage. Spend is the user's
 * own money, so requests are single-shot (no retry) with a small default token cap.
 *
 * Browser-callability (the DEC-043 finding): all three default endpoints answer CORS pre-flight for
 * a browser origin — Anthropic only once the explicit `anthropic-dangerous-direct-browser-access`
 * opt-in header is sent; OpenRouter and Gemini with just the key. No server proxy is needed.
 */
import { ProviderError } from '../errors';
import type { AiClient, AiProvider, AiRequest } from './types';

const DEFAULT_MAX_TOKENS = 700;
const DEFAULT_TIMEOUT_MS = 20_000;

/** Cheap, fast default model per provider (the user pays — favour small models). */
const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openrouter: 'openai/gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
};

// Response envelopes — only the fields we read, cast (not `any`) like the other adapters.
interface AnthropicResponse {
  content?: Array<{ text?: string }>;
}
interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export interface AiClientOptions {
  provider: AiProvider;
  apiKey: string;
  /** Injectable fetch for fixture-mode tests (defaults to the global, bound to globalThis). */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Override the default model (tests, or a future model picker). */
  model?: string;
}

interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export class AiHttpClient implements AiClient {
  readonly provider: AiProvider;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly model: string;

  constructor(opts: AiClientOptions) {
    this.provider = opts.provider;
    this.apiKey = opts.apiKey;
    // Bind to globalThis: an unbound `fetch` throws "Illegal invocation" in the browser (WR-023 bug).
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.model = opts.model ?? DEFAULT_MODEL[opts.provider];
  }

  async complete<T>(req: AiRequest, parse: (raw: unknown) => T | null): Promise<T> {
    const wire = this.buildRequest(req);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchFn(wire.url, {
          method: 'POST',
          headers: wire.headers,
          body: JSON.stringify(wire.body),
          signal: controller.signal,
        });
      } catch {
        throw new ProviderError(
          'network',
          controller.signal.aborted ? 'AI request timed out' : 'AI request failed',
        );
      }
      if (res.status === 429) throw new ProviderError('quota', 'AI rate limit or quota reached');
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError('badResponse', 'AI key was rejected', 'auth');
      }
      if (!res.ok) throw new ProviderError('badResponse', `AI HTTP ${res.status}`);

      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        throw new ProviderError(
          controller.signal.aborted ? 'network' : 'badResponse',
          controller.signal.aborted ? 'AI request timed out' : 'AI response was not JSON',
        );
      }
      const text = this.extractText(payload);
      const value = text === null ? null : safeJsonParse(text);
      let parsed: T | null = null;
      try {
        parsed = value === null ? null : parse(value);
      } catch {
        parsed = null; // a validator that THROWS is a rejection too — never surface it raw (DEC-043)
      }
      // A null here means "unparseable or failed validation" — never partially trust it (DEC-043).
      if (parsed === null) throw new ProviderError('badResponse', 'AI output failed validation');
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildRequest(req: AiRequest): WireRequest {
    const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
    // Reinforce JSON-only in the instructions. OpenRouter and Gemini also flip their native JSON
    // switch below; Anthropic is steered by the instruction alone (its structured-output schemas
    // are per-feature, which this adapter deliberately doesn't own).
    const system = `${req.system}\n\nReturn ONLY valid JSON. No prose, no markdown code fences.`;
    switch (this.provider) {
      case 'anthropic':
        return {
          url: 'https://api.anthropic.com/v1/messages',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: {
            model: this.model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: req.prompt }],
          },
        };
      case 'openrouter':
        return {
          url: 'https://openrouter.ai/api/v1/chat/completions',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: {
            model: this.model,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: req.prompt },
            ],
          },
        };
      case 'gemini':
        return {
          // Key goes in a header, never the URL query — keeps it out of devtools/SW/error URLs.
          url: `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: maxTokens,
            },
          },
        };
    }
  }

  /** Pull the text payload out of each provider's response shape. Null when absent/misshaped. */
  private extractText(payload: unknown): string | null {
    switch (this.provider) {
      case 'anthropic': {
        // Skip any non-text block (e.g. a leading `thinking` block on adaptive-thinking models).
        const block = (payload as AnthropicResponse)?.content?.find(
          (b) => typeof b?.text === 'string',
        );
        return block?.text ?? null;
      }
      case 'openrouter': {
        const text = (payload as OpenRouterResponse)?.choices?.[0]?.message?.content;
        return typeof text === 'string' ? text : null;
      }
      case 'gemini': {
        const text = (payload as GeminiResponse)?.candidates?.[0]?.content?.parts?.[0]?.text;
        return typeof text === 'string' ? text : null;
      }
    }
  }
}

/** JSON.parse that tolerates a stray ```json fence and returns null instead of throwing. */
function safeJsonParse(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
