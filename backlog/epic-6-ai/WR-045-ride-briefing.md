# WR-045 · AI ride briefing
Epic: 6 · AI | Status: DONE | Depends on: WR-044 | Size: M

## Goal
For the selected route + today's conditions, a short pre-ride briefing: what to wear, surface
tips, fuel/water, safety flags — grounded ONLY in numbers the app already computed, so it
cannot hallucinate the weather.

## Context (read first)
WR-044 (adapter, validation, guardrails) · DEC-043 · SCORING_SPEC (the values being fed in) ·
WR-021 gust flags · WR-027 winter fields.

## Acceptance criteria
- [x] Prompt input = the app's own computed values only: modelled temp, feels-like/wind-chill,
      gust, precip, distance, ascent, duration from the speed model, gust-flag stretches,
      sunset vs ETA. No free-form world knowledge required; a unit test pins the input shape.
- [x] Briefing covers: layers/gloves/jacket keyed to temp + wind-chill + rain + duration;
      road-vs-gravel tips for the route's surface; fuel/water for the distance + ascent;
      safety flags (exposed gusty crosswind stretches, finishing near/after sunset).
- [x] Structured JSON response (titled sections of short text) validated per WR-044;
      malformed ⇒ the briefing is simply absent.
- [x] Opt-in: a "Briefing" action on the selected route — nothing auto-fires; the action is
      absent without an `ai` key.
- [x] Any number the briefing displays came in via the prompt input — the model phrases,
      never computes (every user-facing time estimate stays the speed model's, CLAUDE.md).

## Test contract
Prompt-builder unit tests (correct fields in, nothing Strava-shaped possible); fixture
response renders the sections; malformed fixture ⇒ no briefing rendered; no key ⇒ action
hidden.

## Out of scope
Training/coaching advice (the "AI coach" exclusion stands) · multi-day forecasts.

## Log
Shipped `src/engine/briefing.ts` (PURE, +`briefing.test.ts`): `buildBriefingFacts` reduces a
scored route + today's conditions to a whitelisted set of grounded numbers — nothing else can
reach the prompt; `briefingRequest` builds the system+prompt demanding structured JSON;
`parseBriefing` validates and caps counts/lengths, rejecting malformed responses. Added
`src/state/briefingStore.ts` (+test) to orchestrate `getAiClient().complete()` (UI never touches
adapters directly) behind a status machine, with an injectable client for tests. Added
`src/ui/components/RideBriefing.tsx` (+test), a view over the store mounted only when AI is set
up. Wired `src/ui/screens/ResultsScreen.tsx` with an opt-in `<details>` panel gated on `aiReady`
(derived from the keychain store), mapping `planStore.conditions` → `BriefingConditions` and
passing `departureHour`. Added `.wr-briefing` styles to
`src/ui/components/components.css`.

Fable review found 8 issues; 7 fixed before merge: (1, critical) `toPct` treated any value ≤1
as a fraction, turning a genuine 1% rain chance into 100% — fixed by treating `precipProb` as
the app-wide PERCENT convention and clamping; (2) a slow response for route A could resolve
after the user switched to route B and overwrite its panel — fixed with a `routeId` guard on
resolve/catch; (3) `daylightMarginMin` ignored the planned departure hour — fixed by threading
`departureHour` → `rideStartMs` so the margin reflects the actual planned finish vs sunset, not
"now"; (5) `parseBriefing` silently dropped a malformed `safety` field instead of rejecting it —
now rejects present-but-malformed `safety` (absent still ⇒ `[]`); (6) added a whitelist
regression test pinning the exact `BriefingFacts` key set, so nothing un-whitelisted can reach
the prompt; (7) added store + UI tests (success / malformed→error / stale-route guard /
conditions-null disabled button / render); (8) the briefing button was dead when conditions were
null — now disabled with a hint.

Known limitations (not fixed, flagged as follow-ups):
- (4) `daylightMarginMin` uses `Date.parse` on the sunset string, which is host-timezone-
  dependent for offset-less Open-Meteo timestamps. Left as-is because it matches the existing
  app-wide idiom in `src/state/plan/runPlan.ts` (same assumption) — fixing it in isolation here
  would make this one path inconsistent with the rest of the app. A future story should fix the
  timezone handling app-wide, not just in the briefing.
- The briefing's temp/wind come from the hour-0 conditions sample, while the route's
  headwind/gust aggregates are scored at the departure hour — an accepted approximation
  (clothing advice is drawn from current conditions rather than the departure-hour forecast).
  The safety-critical daylight margin (see fix 3 above) does use the departure hour and is
  correct. Follow-up: thread the departure-hour sample into the clothing/fuel facts too, for
  full consistency.

Full gate green (528 tests, lint, build) after fixes.
