# Architecture

## 1. Stack (DEC-002)
React 18 + TS strict + Vite (+ vite-plugin-pwa) · zustand · MapLibre GL JS + OpenFreeMap ·
@turf/turf · idb (IndexedDB) · Vitest. No backend (DEC-007).

## 2. Folder map (WR-001 creates this)

```
src/
  adapters/            # ONLY place fetch() may appear
    weather/           # index.ts (interface) · openMeteo.ts · mock.ts
    routing/           # index.ts (interface) · ors.ts · mock.ts
    transit/           # (Epic 4) digitransit.ts
    strava/            # (Epic 3) upload.ts
  engine/              # PURE functions. No I/O, no DOM, no Date.now() (clock passed in)
    geometry.ts        # resampling, bearings, gradients, overlap
    wind.ts            # decomposition, effective wind
    speedModel.ts      # linear + physics models, ETA
    scoring.ts         # sub-scores, weights, total
    explain.ts         # rule-based explanation strings
    startTime.ts       # (Epic 3) score × hour
  nav/                 # location service, snap, cues, offRoute, recorder, replay
  state/               # zustand stores: plan, results, ride, settings
  ui/                  # screens/ components/ tokens.css
  data/                # db.ts (idb schema), exposureGrid.ts (Epic 3)
  utils/               # angles, units, formatting
tools/                 # offline Python preprocessing (exposure grid), strava-auth helper
fixtures/              # API samples, GPX traces, golden scoring cases
```

## 3. Module boundary rules (lint-enforced where possible)
- `engine/**` imports nothing from adapters/ui/state. Everything in it is unit-testable.
- UI components never fetch; they read stores. Stores call adapters; adapters return typed
  domain objects, never raw API JSON, and own caching + error mapping.
- All external services sit behind these interfaces so providers are swappable (commercial path).

## 4. Core types & adapter contracts (authoritative signatures — WR-003 implements)

```ts
// domain.ts
export type LatLon = { lat: number; lon: number };
export type Segment = {
  a: LatLon; b: LatLon;
  lengthM: number; bearingDeg: number; gradePct: number;
  surface?: "paved" | "gravel" | "path" | "unknown";
  wayClass?: string;            // ors waytype label
  exposure: number;             // 0.35–1.15, default 1.0 until Epic 3
};
export type WindSample = { windMs: number; windFromDeg: number; gustMs: number;
  precipProb: number; tempC: number; time: string };
export type CandidateRoute = {
  id: string; polyline: LatLon[]; segments: Segment[];
  distanceM: number; ascentM: number;
  steps?: TurnStep[];           // from routing provider, kept for Epic 2
};

// adapters/weather/index.ts
export interface WeatherProvider {
  /** One call: hourly samples for each point for the next `hours` hours. */
  windAlong(points: LatLon[], hours: number): Promise<WindSample[][]>; // [pointIdx][hourIdx]
  daylight(p: LatLon): Promise<{ sunrise: string; sunset: string }>;
}

// adapters/routing/index.ts
export type RoundTripParams = { start: LatLon; lengthM: number; seed: number;
  points: 3 | 4 | 5; profile: "cycling-regular" | "cycling-road" };
export interface RouteProvider {
  roundTrip(p: RoundTripParams): Promise<CandidateRoute>;
  pointToPoint(a: LatLon, b: LatLon, profile: string): Promise<CandidateRoute>; // out-and-back + rejoin
}
```

## 5. Data flow (plan path)

inputs → routing adapter ×6–8 (parallel, cached) → engine/geometry (resample ~300 m) →
weather adapter ×1 (all points × all hours) → engine/wind + speedModel + scoring →
ranked candidates + explanations → results store → UI. GPX export reads the store.

## 6. Persistence (idb, WR-010/017)
DB `windride` v1: stores `routes` (planned), `rides` (recorded points + meta),
`settings`, `riddenEdges` (Epic 4 geohash set). All writes await; recorder batches.

## 7. Error & offline posture
Adapters map failures to typed errors {kind: "quota"|"network"|"badResponse"}. UI shows a
plain retry state. Planned routes and the active ride must survive a reload (state hydrates
from idb). Tests simulate all three error kinds per adapter.
