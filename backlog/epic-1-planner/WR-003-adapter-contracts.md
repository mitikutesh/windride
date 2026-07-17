# WR-003 · Domain types + adapter interfaces + mock providers
Epic: 1 · Planner | Status: TODO | Depends on: WR-001 | Size: M

## Goal
The seam that keeps WindRide provider-agnostic and testable: authoritative domain types,
WeatherProvider/RouteProvider interfaces, and fixture-backed mocks the whole app can run on.

## Context (read first)
ARCHITECTURE §3–4 (signatures are authoritative) · CLAUDE.md rules 3–4 · fixtures/README.md.

## Acceptance criteria
- [ ] `src/adapters/*/index.ts` exports the interfaces + domain types exactly per ARCHITECTURE §4
      (extend, don't diverge; note any additions in the Log).
- [ ] `mock.ts` for weather + routing: deterministic, fixture-fed, zero network; mock weather
      supports a synthetic "SW 8 m/s steady" scenario and a "shifting wind" scenario.
- [ ] A provider registry (`getProviders()`) returns mocks when `VITE_LIVE_APIS !== "true"`.
- [ ] Typed error model {kind: quota|network|badResponse} + helpers; mocks can simulate each.

## Test contract
Contract test suite that ANY provider implementation must pass (shape, ordering, error kinds) —
run it against the mocks now; WR-004/005 re-run it against real adapters' fixture mode.

## Technical notes
`WindSample[][]` is [pointIdx][hourIdx] — encode that in the type name or JSDoc; it's a classic
transposition bug. Keep fixtures small; realism arrives in WR-004/005.

## Out of scope
Any real HTTP.

## Log
