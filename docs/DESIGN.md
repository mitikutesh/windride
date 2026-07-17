# Design system — v0.1 tokens (DEC-005: Direction 01 "Baltic Dusk")

Three concept boards exist (Baltic Dusk / Chart Room & Cockpit / Slipstream). v0.1 ships with
Baltic Dusk tokens; ALL directions share the same semantic wind hues, so the semantics below
are permanent even if the skin changes. Keep every value in `src/ui/tokens.css` as CSS vars.

## 1. Semantic wind colours (permanent, non-negotiable)
--tail:#2EE6A8 (tailwind/flow) · --cross:#F5B84C (caution) · --head:#F26D5B (resistance) ·
--shelter:#3E8763 (forest shelter). Colour in WindRide always means wind relationship — never
decoration. Route polylines, ribbons, charts and heat strips all draw from these four.

## 2. Baltic Dusk core tokens
--bg:#0A1220 · --surface:#111C30 · --line:#1E2C46 · --text:#EDF3FB · --text2:#8CA1C0 ·
--sky:#4DA3FF · aurora gradient: linear-gradient(100deg,#2EE6A8,#4DA3FF) · on-aurora ink #05131D.
Radii: cards 20px, pills 999px. Spacing: 8-pt grid.

## 3. Type
Display/numerals: "Space Grotesk" 700 (Google Fonts, self-host in WR-002), body/UI: Inter.
Glance-zone numerals ≥ 27 px; tabular where numbers align.

## 4. Component inventory (build once in WR-002/009, reuse everywhere)
WindRibbon (segmented wind story bar) · ScoreRing (0–100 arc) · ConditionsStrip ·
HeatStrip (Epic 3) · RouteCard · StatCell · PrimaryButton (aurora) · Toggle · Chip.

## 5. Rules
Hit targets ≥ 44 px (gloves). Dark-first; WCAG AA contrast on all text. Motion only where wind
lives (streak drift, position pulse) and disabled under prefers-reduced-motion. Attribution
footer: "© OpenStreetMap contributors · Weather by Open-Meteo (CC-BY 4.0)". Every displayed
duration comes from the speed model.
