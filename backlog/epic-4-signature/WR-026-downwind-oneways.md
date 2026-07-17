# WR-026 · Downwind one-ways + transit return
Epic: 4 · Signature | Status: TODO | Depends on: WR-011 | Size: L

## Goal
The only geometry where tailwind is unbounded: generate point-to-point rides toward downwind
rail/bus stations and rank by tailwind share × return service — "55 km downwind to Riihimäki,
train back every 30 min."

## Context (read first)
PRODUCT_SPEC §1 lever 5 · API_NOTES §3 · ARCHITECTURE §4 pointToPoint.

## Acceptance criteria
- [ ] Station dataset: static JSON of HSL/VR rail + trunk stations (name, latlon, modes) with
      a documented refresh script in tools/ (checked-in data, no runtime dependency for list).
- [ ] Candidate endpoints: stations within target±20% distance inside wind_to ±35° arc;
      route via pointToPoint; score with the standard engine (one-way: Sequencing off,
      DistanceMatch on actual).
- [ ] Digitransit adapter (`VITE_DIGITRANSIT_KEY`): next departures + frequency for the return
      leg at ETA time; rank = tailwindTimeShare × frequencyFactor; graceful no-key mode
      (rank by wind only, label "check return times").
- [ ] "Downwind" mode on Plan produces ranked one-ways with card copy including the return
      ("trains every ~30 min from 18:40").
- [ ] Fixtures for Digitransit responses; contract tests; live probe captured once.

## Test contract
Endpoint-arc geometry tests; ranking test on a fixture where a closer-but-crosswind station
loses to a farther pure-downwind one; no-key degradation test.

## Technical notes
Return planning is for the RIDER + bike — flag bike-carriage uncertainty in copy rather than
modelling it. Keep the station arc math in engine/.

## Out of scope
Multi-leg transit optimization; buying tickets.

## Log
