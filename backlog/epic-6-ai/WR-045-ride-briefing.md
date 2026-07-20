# WR-045 · AI ride briefing
Epic: 6 · AI | Status: TODO | Depends on: WR-044 | Size: M

## Goal
For the selected route + today's conditions, a short pre-ride briefing: what to wear, surface
tips, fuel/water, safety flags — grounded ONLY in numbers the app already computed, so it
cannot hallucinate the weather.

## Context (read first)
WR-044 (adapter, validation, guardrails) · DEC-043 · SCORING_SPEC (the values being fed in) ·
WR-021 gust flags · WR-027 winter fields.

## Acceptance criteria
- [ ] Prompt input = the app's own computed values only: modelled temp, feels-like/wind-chill,
      gust, precip, distance, ascent, duration from the speed model, gust-flag stretches,
      sunset vs ETA. No free-form world knowledge required; a unit test pins the input shape.
- [ ] Briefing covers: layers/gloves/jacket keyed to temp + wind-chill + rain + duration;
      road-vs-gravel tips for the route's surface; fuel/water for the distance + ascent;
      safety flags (exposed gusty crosswind stretches, finishing near/after sunset).
- [ ] Structured JSON response (titled sections of short text) validated per WR-044;
      malformed ⇒ the briefing is simply absent.
- [ ] Opt-in: a "Briefing" action on the selected route — nothing auto-fires; the action is
      absent without an `ai` key.
- [ ] Any number the briefing displays came in via the prompt input — the model phrases,
      never computes (every user-facing time estimate stays the speed model's, CLAUDE.md).

## Test contract
Prompt-builder unit tests (correct fields in, nothing Strava-shaped possible); fixture
response renders the sections; malformed fixture ⇒ no briefing rendered; no key ⇒ action
hidden.

## Out of scope
Training/coaching advice (the "AI coach" exclusion stands) · multi-day forecasts.
