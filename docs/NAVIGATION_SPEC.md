# Navigation spec (nav/) — track-following, not destination routing

## 1. Inputs
The chosen CandidateRoute (polyline + steps + per-segment wind), GPS fixes at ~1 Hz
(watchPosition; the replay harness injects identical fix objects).

## 2. Progress tracking — windowed snap (snap.ts)
Maintain `progressM` (distance along track). Each fix: search nearest point on the polyline
ONLY within [progressM − 100 m, progressM + 300 m]; accept if perpendicular distance < 60 m;
progress may only move forward (small jitter tolerance −15 m). This makes self-crossing loops
and out-and-backs safe. Global nearest-point is forbidden except at cold start.

## 3. Off-route (offRoute.ts)
Trigger: perpendicular distance > 45 m sustained > 10 s → audible alert →
one pointToPoint() call from current position to the track point at progressM + 500 m →
splice returned leg into the stored route; everything beyond is untouched. NEVER reroute to
the finish. If reroute fails (quota/network): keep alerting, show bearing-to-track arrow.

## 4. Cues (cues.ts)
From provider steps bound to track distances. Announce at 200 m and 40 m (scale ±40% with
speed). Voice: Web Speech synthesis; fallback beep mode. Debounce: never two utterances < 3 s.

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
