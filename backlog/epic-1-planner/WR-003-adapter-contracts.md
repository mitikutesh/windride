# WR-003 · Domain types + adapter interfaces + mock providers
Epic: 1 · Planner | Status: DONE | Depends on: WR-001 | Size: M

## Goal
The seam that keeps WindRide provider-agnostic and testable: authoritative domain types,
WeatherProvider/RouteProvider interfaces, and fixture-backed mocks the whole app can run on.

## Context (read first)
ARCHITECTURE §3–4 (signatures are authoritative) · CLAUDE.md rules 3–4 · fixtures/README.md.

## Acceptance criteria
- [x] `src/adapters/*/index.ts` exports the interfaces + domain types exactly per ARCHITECTURE §4
      (extend, don't diverge; note any additions in the Log).
- [x] `mock.ts` for weather + routing: deterministic, fixture-fed, zero network; mock weather
      supports a synthetic "SW 8 m/s steady" scenario and a "shifting wind" scenario.
- [x] A provider registry (`getProviders()`) returns mocks when `VITE_LIVE_APIS !== "true"`.
- [x] Typed error model {kind: quota|network|badResponse} + helpers; mocks can simulate each.

## Test contract
Contract test suite that ANY provider implementation must pass (shape, ordering, error kinds) —
run it against the mocks now; WR-004/005 re-run it against real adapters' fixture mode.

## Technical notes
`WindSample[][]` is [pointIdx][hourIdx] — encode that in the type name or JSDoc; it's a classic
transposition bug. Keep fixtures small; realism arrives in WR-004/005.

## Out of scope
Any real HTTP.

## Log
- Shipped `src/domain.ts` with the authoritative ARCHITECTURE §4 types (`LatLon`, `Segment`,
  `WindSample`, `CandidateRoute`, `RoundTripParams`, `TurnStep`, plus interface param/return
  types). **Placement decision:** domain types live at the src root, not under `adapters/`,
  because `engine/**` will need to import them and the module-boundary rule forbids
  engine → adapters imports (recorded as DEC-011).
- Extensions beyond the literal §4 list (all additive, no divergence): `Surface`, `RouteProfile`,
  and `Daylight` type aliases; a named `WindGrid` alias for `WindSample[][]` (documented as
  `[pointIdx][hourIdx]` to guard the classic transposition bug); explicit `TurnStep` field names
  (`distanceM`/`durationS`/`type`/`wayPoints`).
- `src/adapters/weather/index.ts` and `src/adapters/routing/index.ts` export the
  `WeatherProvider`/`RouteProvider` interfaces and re-export the relevant domain types.
  `pointToPoint` keeps `profile: string` exactly per §4 (not the narrower `RouteProfile` union —
  that stays reserved for `RoundTripParams`).
- `src/adapters/errors.ts` adds the typed error model: `ProviderError` (kind
  `'quota'|'network'|'badResponse'`), `providerError()`, `isProviderError()` (instanceof-based).
- Mocks are deterministic and zero-network: `MockWeatherProvider` (`sw-steady` default 8 m/s
  from 225°, `shifting`, `fixture` scenarios; fixed base hour; `failWith` per error kind) and
  `MockRouteProvider` (fixture-fed, seed-jittered, honours requested `lengthM`, `failWith`).
  Real geometry/segments arrive in WR-005/WR-006 — mock `segments: []` for now.
- `src/adapters/registry.ts` `getProviders()` returns mocks unless
  `import.meta.env.VITE_LIVE_APIS === 'true'` (throws in that case until WR-004/WR-005 land).
- `src/adapters/providerContract.ts` holds reusable contract suites
  (`describeWeatherProviderContract`/`describeRouteProviderContract`) run against the mocks now;
  WR-004/WR-005 will re-run them against the real adapters in fixture mode.
- Tests: 39 total (19 new for adapters), all green; lint + build green.
- Follow-ups: WR-004 (Open-Meteo adapter) and WR-005 (ORS adapter) reuse the contract suite
  as-is; WR-006 (geometry engine) is the first consumer to fill in real `segments`.
