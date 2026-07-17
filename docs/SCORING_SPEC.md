# Scoring spec (engine/) — the heart of WindRide

All formulas operate on resampled segments (§1) and are weighted by **time** (§3).

## 1. Segmentation (geometry.ts)
Resample candidate polylines to 200–500 m segments (target ~300 m). Per segment: length,
bearing (from north, clockwise), grade % from elevation, surface/wayClass from ORS extras,
exposure (1.0 until Epic 3). Wind is sampled at the segment's estimated time-of-arrival:
one rough pass with base speed → arrival times → final pass with wind-adjusted speeds.

## 2. Wind decomposition (wind.ts) — sign conventions guarded by tests
```
wind_to  = (wind_from + 180) mod 360
delta    = smallestAngle(bearing, wind_to)        // 0..180
W_eff    = W * exposure
v_par    = W_eff * cos(deg2rad(delta))            // + tailwind, − headwind
v_cross  = W_eff * |sin(deg2rad(delta))|
gust_eff = gust * exposure
```
**Must-pass cases:** bearing 45, wind_from 225, W 8 ⇒ delta 0, v_par +8, v_cross 0.
bearing 45, wind_from 45 ⇒ v_par −8. bearing 45, wind_from 135 ⇒ v_par 0, v_cross 8.

## 3. Speed & time (speedModel.ts)
Linear MVP (km/h; coefficients in settings):
```
v = v0(surface) + 0.35*max(v_par_kmh,0) + 0.60*min(v_par_kmh,0)
      - 2.2*max(grade,0) + 1.2*min(grade,0)      // grade in %, downhill capped
v = clamp(v, 5, 55);  t_seg = length / v
```
Physics upgrade (same signature, flag-switched): solve
`P = 0.5*rho*CdA*(v+w_head)^2*v + Crr*m*g*v + m*g*s*v` by Newton iteration
(rho 1.25, CdA 0.32, Crr 0.005 paved / 0.012 gravel, m 85, P from settings).
Monotonicity tests: more headwind ⇒ v never increases; steeper up ⇒ v never increases.

## 4. Sub-scores (scoring.ts) — each normalized 0–1 across the candidate set
- WindComfort: 1 − Σ t·f(delta)·max(0,−v_par), where f emphasizes delta>150° (direct headwind).
- Sequencing: bonus when headwind time concentrates in the first half of total time.
- CrosswindSafety: penalty Σ t·gust_eff over segments inside flagged exposed-crosswind gust
  stretches — a stretch is exposure ≥ 1.0 AND gust_eff ≥ 13 m/s (settings 10–18) AND
  v_cross ≥ 0.6·W_eff, contiguous flagged segments merged (bridging calm gaps < 150 m) into
  stretches ≥ 300 m (single source: `engine/gustFlags.ts`, shared with the results chip, ride
  HUD warning, and map markers).
- Shelter (Epic 3): share of upwind time with exposure ≤ 0.6.
- SurfaceMatch · Traffic (wayClass penalties; primary/secondary without cycleway = heavy) ·
  Scenery (forest/water adjacency share) · ClimbMatch, DistanceMatch (gaussian on target) ·
  RainAvoid: 1 − Σ t·precipProb.
- Robustness (Epic 4): min WindComfort over wind_from ∈ {−30°,0°,+30°}.

## 5. Hard constraints (filter before scoring)
|distance − target| ≤ 15% · finish ≤ sunset − 20 min when "home before dark" · no ferries.

## 6. Total
```
score = 100 * Σ w_k * S_k   // defaults (settings-tunable):
wind .28  robustness .10  safety .10  shelter .06  surface .12
traffic .10  scenery .07  climb .06  distance .05  rain .04  sequencing .02
```
(Until Epic 3/4 ship, renormalize weights over available sub-scores.)

## 7. Invariant tests (fixtures/golden/)
- **Loop cancellation:** for any closed polyline, Σ L_i·cos(delta_i to a fixed wind) ≈ 0
  (tolerance: |Σ|/Σ|L| < 0.05). Guards against ever advertising net tailwind on loops.
- Golden ranking: synthetic 3-candidate fixture where hand-computed ranking is known; scoring
  must reproduce it exactly (snapshot).

## 8. Explanations (explain.ts)
Emit the top 2–3 contributing facts as templated sentences with real numbers from the data
(sheltered-upwind km, direct-headwind km vs candidate median, tailwind-finish km, gust flags).
No adjectives without a number behind them.
