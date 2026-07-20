# WR-044 · AI adapter + 'ai' key wiring
Epic: 6 · AI | Status: TODO | Depends on: — | Size: M

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
- [ ] `src/adapters/ai/`: the only place AI fetches happen; reads the `ai` key from the
      runtime keychain — never from Vite env, never bundled.
- [ ] Browser-callable providers behind a small interface. The provider is a PER-USER choice
      set in Kit (DEC-043) — each user brings their own provider AND key; the adapter dispatches
      on the stored `aiProvider`. WR-044 verifies which of Anthropic / OpenRouter / Gemini are
      reliably CORS-callable direct from a browser and records the supported menu in DEC-043.
- [ ] **Kit → AI**: a provider dropdown (the supported menu) plus the `ai` key field, replacing
      today's "reserved" row; both persist in the keychain (idb-only, DEC-040). Per-provider
      help text (where to get the key). Store `aiProvider` alongside the `ai` key.
- [ ] ALL calls request structured JSON output and validate the response against a
      per-feature schema; malformed or unparseable responses are DROPPED (the feature no-ops)
      — never partially trusted, never surfaced as an error wall.
- [ ] No key OR no provider ⇒ graceful no-op: AI features disable/hide and point the user to
      Kit → AI with a clear reason (the shared messaging pattern is WR-050); the core app is
      unaffected; no nags when AI simply isn't set up.
- [ ] Guardrails encoded, not hoped: the engine stays the source of truth — AI output can
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
