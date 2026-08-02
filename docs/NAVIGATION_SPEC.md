# Navigation spec (nav/) — track-following, not destination routing

## 1. Inputs
The chosen CandidateRoute (polyline + steps + per-segment wind), GPS fixes at ~1 Hz
(watchPosition; the replay harness injects identical fix objects).

## 2. Progress tracking — windowed snap (snap.ts)
Maintain `progressM` (distance along track). Each fix: search nearest point on the polyline
ONLY within [progressM − 100 m, progressM + 300 m]; accept if perpendicular distance < 60 m;
progress may only move forward (small jitter tolerance −15 m). This makes self-crossing loops
and out-and-backs safe. Global nearest-point is forbidden except at cold start (where closed-loop
start==finish ties prefer the start arm).
**Arm ties (WR-054/DEC-062):** an out-and-back retraces the same polyline, so every position is
exactly equidistant from the outbound and return arms — for the WHOLE route, not just at the ends
like a closed loop. Plain min-perpendicular therefore picked between them on floating-point noise,
leaping progress to the mirrored position and then freezing (progress may only move forward). So
the windowed search tie-breaks toward current progress: among candidates within `SNAP_TIE_BAND_M`
(10 m) whose progress differs by more than `SNAP_ARM_SEPARATION_M` (25 m), the one nearest current
progress wins. The separation bound is load-bearing in both directions — below the tie band, a
candidate `d` m behind on a straight stretch has perpendicular ≈ `d` and would look like a tie,
dragging progress backwards; much above it, the fold itself is undefended (the arms are only ~2×
the remaining distance apart on approach), which is exactly where the turnaround cue lives. Outage recovery (DEC-058): while no fix is being
accepted, the FORWARD bound widens with time since the last accepted fix (bounded by a generous
rider speed); a candidate beyond +300 m commits only after 3 consecutive agreeing in-gate fixes,
so one glitchy fix can never teleport progress. The backward bound never widens — a rider who
went backwards past −100 m recovers via the §3 confirm-first reroute, not silently.

## 3. Off-route (offRoute.ts) — confirm-first reroute (WR-051)
Trigger: perpendicular distance > 45 m sustained > 10 s → audible alert + bearing-to-track
arrow → the Ride screen ASKS "reroute back to your planned route?" — no silent rerouting, no
automatic router traffic while lost. On confirm: one pointToPoint() call from current position
to the track point at progressM + 500 m → splice returned leg into the stored route (everything
beyond is untouched) → show the proposal as a DASHED line → only an explicit Accept swaps it
into live navigation. Decline silences the offer for the current off-route episode (re-arms
once back on the route). NEVER reroute to the finish. If the fetch fails (quota/network): keep
alerting, keep the bearing-to-track arrow, offer a manual retry.
The map's rider marker always shows the RAW GPS fix — the true position, even off the route;
only progress/cues/ETA use the snapped point.

## 4. Cues (cues.ts)
From provider steps bound to track distances. Announce at 200 m and 40 m (scale ±40% with
speed). Voice: Web Speech synthesis; fallback beep mode. Debounce: never two utterances < 3 s.
**Maneuver kind vs wording (WR-056/DEC-064):** the ORS `type` code is the source of truth for WHAT
the maneuver is (the turn arrow); the instruction text is the source of truth for WORDING (street
names, phrasing). Verified against a real 22.5 km / 128-step capture: the two agree on every step. A
code whose left/right sense contradicts unambiguous "left"/"right" in the text loses to the text —
drawing a left arrow for a right turn is the worst available failure. No code (curated/AI routes) ⇒
fall back to the wording. See `nav/turnKind.ts`.

**Chained maneuvers (WR-056):** decided at cue-BUILD time, never at fire time — with turns 50 m
apart the follower's prepare is spoken ~150 m before the leader's turn cue could suppress anything,
and the speed-scaled turn trigger (up to 56 m) is wider than the gap, so both turn cues would land
on the same tick. Within 15 m the two are the same junction: the follower is silent and its direction
rides along in the leader's cue ("Turn left, then right"). Within 60 m it is a real second maneuver:
its prepare is dropped, its turn cue still fires. Runs of three or more are judged against the last
maneuver the rider actually HEARD, so nothing goes silent. On real routes this is a third of all
maneuvers, not an edge case.

**Out-and-backs (WR-054/DEC-062):** a doubled route's steps are rebuilt by the adapter, never
forwarded — the leg's arrival step would otherwise sit on the fold and announce "you have arrived"
at halfway. The fold gets an explicit turnaround (ORS type 9, recognised by code so it survives
localization) and the true finish gets the only arrival. The return leg deliberately carries NO
street-level turns: ORS instructions cannot be honestly reversed, since which way you turn at each
node depends on the reversed geometry. Riders are retracing a road they just rode.

## 5. Wind HUD
From scored segments ahead: next transition ("Tailwind in 2.3 km"), exposure/gust warnings.
ETA = remaining Σ t_seg re-scaled by EMA(actual speed / modelled speed), α = 0.1.

## 6. Recorder (recorder.ts)
Append fix every 1–3 s to idb (batch 10). Auto-pause: speed < 1.2 km/h for > 20 s. Crash-safe:
on app start, an unfinished ride offers resume/save. Finish → GPX 1.1 (trk with ele + time).

## 7. Screen & power
Wake Lock while riding; re-acquire on visibilitychange. Dark, ≥ 27 px numerals in the glance
zone, hit targets ≥ 44 px. Battery saver mode: static map + audio cues.

## 8. Replay harness (replay.ts — built FIRST, WR-012)
`npm run replay -- fixtures/traces/x.gpx --speed 10` feeds recorded/synthetic fixes through the
real pipeline (no geolocation API). All nav integration tests run on it. Include one synthetic
trace that goes off-route on purpose and one figure-eight trace (window test).

## 9. Map orientation — heading-up (mapBearing.ts + ui/mapCamera.ts, WR-053)
Two modes, toggled on the map and remembered: **heading-up** (up = direction of travel, so a
spoken "turn left" matches the screen) and **north-up**. Heading-up also sits the rider low, at
~72% down the band the chrome leaves visible, so most of the map is the road ahead.

**Bearing source: the GPS travel bearing ONLY** (`HeadingSmoother`), never `RideState.headingDeg`
— that is compass-dominated below 0.8 m/s and can flip 180° near the 1.9 m/s crossfade midpoint
(DEC-033/DEC-061). The rider puck still uses the blended heading, so it swings when a stopped
rider turns the phone while the map holds still.

**Gate (`RideState.mapBearingDeg`), position-driven — no clock, no speed, no compass:** commit a
new bearing after 10 m of net displacement from the last commit; 5° deadband measured against the
committed bearing (so the map never lags the truth by more than 5°); a single-fix jump > 60 m is
an outage or teleport and re-anchors WITHOUT committing, so the chord bearing across a §2/DEC-058
gap never reaches the map; null until the first commit — the map is simply north-up until the
rider has moved. Speed is deliberately NOT the gate: `speedOf` falls back to `haversine/dt`, so
standstill GPS wander reads as several m/s.

**No EMA, no slew limit.** At ~1 Hz an EMA needs ~10 s to finish a corner; MapLibre's `easeTo` is
the smoother and already rotates the short way. Big rotations (>90°, e.g. recentring after
free-look) get a longer ease; battery saver jumps.

**Rotation is app-driven only** — gesture and keyboard rotation are both disabled, so the map can
never end up askew in the rider's hands. North-up is forced while a reroute proposal is previewed
(§3), since a dashed line that rejoins beside or behind the rider can otherwise sit off-screen.

**Overlays.** Body-relative overlays (the wind HUD arrow, the off-route bearing arrow) are NOT
map-anchored: on a bar-mounted phone screen-up already is the travel direction, so they stay
relative to the rider's heading in both modes.

`prefers-reduced-motion` defaults to north-up (a rotating map is a vestibular trigger); heading-up
stays available as an explicit opt-in and then eases rather than snapping.

### 9b. Zoom policy (ui/mapCamera.ts, WR-055)
**Cruise zoom is look-ahead TIME, not a speed offset:** `clamp(200, 900, 8.75 × speedKmh)` metres
across, derived from ~30 s of road ahead at the live layout. The rule it replaced
(`250 + speedKmh × 40`) showed ~171 s of road ahead at 25 km/h, which is why a 20 m junction was
~6 px. The floor also errs toward more context when crawling, and pins out the zoom churn that a
speed-linear rule inherits from jitter-derived speed.

**Junction approach is a function of DISTANCE ONLY** — full cruise beyond 200 m, tightest (140 m
across) inside a 40 m plateau, linear between, never wider than cruise. It must NOT reuse the
speed-scaled cue trigger: that threshold shrinks as the rider brakes for the corner, so the zoom
would pop out exactly when they slow down. Cues get away with it because they latch; a camera
re-evaluates every fix.

**Maneuver proximity (`RideState.turnProximityM`) is asymmetric:** the distance while the node is
ahead, 0 within 40 m past it (mid-corner), nothing beyond. Symmetric proximity would keep the view
tight for 200 m after every node too, so on urban routes with maneuvers <400 m apart it would never
return to cruise. Arrival and "continue straight" are not maneuvers; forks and turnarounds are.

**The camera anchors on the SNAPPED point while on-track** (the marker stays on the raw fix — §3):
at 140 m across, 1 m is ~2.8 px, so following the raw fix slides the basemap under a stationary
marker on standing wander. Off-track it follows the raw fix.

Suppressed while: the details sheet is open, off-route is sustained or two consecutive fixes were
refused (progress freezes then, so proximity goes stale), a reroute is being previewed, for the
first fixes after accepting one, and before any map bearing exists. Manual zoom always wins, and
`+`/`−` step from the APPLIED zoom — seeding them from cruise makes `+` zoom out mid-approach.

### 9c. What the junction looks like (WR-057)
The route line's width is interpolated by zoom (a thread over the whole route, a bold ribbon at a
junction) over a **dark** casing — the default basemap is the LIGHT OpenFreeMap Liberty style, so a
light casing would vanish into white and yellow roads. Route, casing and direction arrows are all
drawn **below the basemap's label layers**: street names are how the rider tells our road from the
others, so they must stay readable. The reroute proposal and gust markers stay above the labels —
neither may ever be hidden.

An arrow is pinned at the next junction pointing the way the route LEAVES it
(`RideState.junction`, a chord bearing over 25 m past the node), map-aligned so it keeps pointing
down that road as the map rotates. It skips the arrival step, "continue straight" and chained
followers — the finish line is not a junction — and the Ride screen shows it only once the junction
is inside `ZOOM_APPROACH_M`, and never during a reroute preview.
