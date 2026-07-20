# WR-044 · AI adapter + 'ai' key wiring
Epic: 6 · AI | Status: DONE | Depends on: — | Size: M

## Goal
The plumbing every Epic 6 story stands on: a `src/adapters/ai/` adapter that reads the user's
own `ai` key AND their chosen `aiProvider` from the keychain (DEC-034e) and returns
schema-validated structured JSON. Each user brings their own provider + key (set in Kit);
nothing else in the app may ever call an AI provider. Backend-independent — runs on the current
static app.

## Context (read first)
DECISIONS DEC-034 (keychain, reserved `ai` slot) · DEC-043 · ARCHITECTURE §2 (adapters-only
fetch) · CLAUDE.md domain warnings (Strava never enters any AI path).

## Acceptance criteria
- [x] `src/adapters/ai/`: the only place AI fetches happen; reads the `ai` key from the
      runtime keychain — never from Vite env, never bundled.
- [x] Browser-callable providers behind a small interface. The provider is a PER-USER choice
      set in Kit (DEC-043) — each user brings their own provider AND key; the adapter dispatches
      on the stored `aiProvider`. WR-044 verifies which of Anthropic / OpenRouter / Gemini are
      reliably CORS-callable direct from a browser and records the supported menu in DEC-043.
- [x] **Kit → AI**: a provider dropdown (the supported menu) plus the `ai` key field, replacing
      today's "reserved" row; both persist in the keychain (idb-only, DEC-040). Per-provider
      help text (where to get the key). Store `aiProvider` alongside the `ai` key.
- [x] ALL calls request structured JSON output and validate the response against a
      per-feature schema; malformed or unparseable responses are DROPPED (the feature no-ops)
      — never partially trusted, never surfaced as an error wall.
- [x] No key OR no provider ⇒ graceful no-op: AI features disable/hide and point the user to
      Kit → AI with a clear reason (the shared messaging pattern is WR-050); the core app is
      unaffected; no nags when AI simply isn't set up.
- [x] Guardrails encoded, not hoped: the engine stays the source of truth — AI output can
      never override scores/ETAs/routes; Strava data never appears in any prompt input. A
      test guards the prompt-builder input types where feasible.

## Test contract
Contract tests on `fixtures/ai/`: schema-valid response parses; malformed drops; missing key
no-ops; HTTP errors map to `ProviderError` kinds. Never a live AI call in tests/CI (rule 3).
Manual live check: `npm run probe:ai` with a real key.

## Technical notes
Prompts + schemas live per feature next to the feature; the adapter owns transport, auth
header, and validation only. Spend is the user's own money: small `max_tokens`, no retry on
4xx, single attempt per user action.

## Out of scope
Every user-facing AI feature (WR-045+) · server-side proxying (there is none — DEC-043).

## Log
Shipped `src/adapters/ai/` (types.ts, client.ts, index.ts + client.test.ts): `AiHttpClient` is
the only place AI `fetch` happens, dispatching per `AiProvider` (Anthropic / OpenRouter /
Gemini) with structured-JSON output validated against a caller-supplied schema; a malformed
response OR a throwing validator is always caught and rejected as a `ProviderError` so the
calling feature no-ops rather than surfacing raw/partial output. Added single-shot timeout/abort
(no retry — rule 3 spend discipline). Wired `RuntimeConfig.aiProvider` and
`getAiClient()`/`aiReady()`/`getAiProvider()` into `src/adapters/registry.ts`, gated purely on
key + provider presence, independent of the live-APIs switch; the `ai` key is never read from
Vite env and never bundled. `src/state/keychainStore.ts` grew `aiProvider` state +
`setAiProvider` + hydrate with junk-value rejection, pushed to the registry. Replaced the
"reserved" AI row in `src/ui/components/ApiKeysSettings.tsx` with a provider dropdown + `ai` key
field and per-provider help text. Added `fixtures/ai/*.json` contract fixtures and
`scripts/probe-ai.mjs` (`npm run probe:ai`) for manual live checks — no live call in tests/CI.

DEC-043 finding: verified all three candidate providers are directly browser-CORS-callable, so
the menu ships with all three — Anthropic needs the `anthropic-dangerous-direct-browser-access:
true` opt-in header, OpenRouter uses a Bearer token, Gemini uses `x-goog-api-key`. No server
proxy needed. Default models kept cheap (user pays): `claude-haiku-4-5-20251001`,
`openai/gpt-4o-mini`, `gemini-2.0-flash`. DEC-043 flipped from DEFAULT-open to DECIDED.

Fable review found and fixed four issues before merge: (1) a throwing validator could otherwise
escape the catch and surface raw output — now always caught and treated as a rejection; (2)
Anthropic text-block extraction now skips non-text content blocks via `.find()` instead of
assuming index 0; (3) the Gemini key moved from the URL query string to the `x-goog-api-key`
header, keeping it out of URL-logging surfaces (proxies, browser history, dev-tools network
tab); (4) a timeout that fires mid-body-read now maps to a network `ProviderError`, not
`badResponse`. Full gate (506 tests, lint, build) green after fixes.

Follow-ups for later stories: WR-045+ consume `getAiClient()`/`aiReady()` directly — no new
adapter surface needed. Deferred: provider-native structured-output schemas (currently
prompt-instructed JSON + our own validation) and any in-app model picker (models are fixed
per-provider defaults for now, per DEC-043).
