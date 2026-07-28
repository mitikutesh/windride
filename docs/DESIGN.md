# Design system — v0.2 tokens (DEC-055: "Night Trail"; supersedes DEC-005 "Baltic Dusk")

Night Trail is a mobile-first reskin modelled on a navigation-app reference: near-black forest
greens, ONE lime accent, big rounded cards, map-dominant screens. ALL directions share the same
semantic wind hues, so §1 is permanent even if the skin changes again. Keep every value in
`src/ui/tokens.css` as CSS vars (the only file, with `windColors.ts`, allowed raw hex).

## 1. Semantic wind colours (permanent, non-negotiable)
--tail:#2EE6A8 (tailwind/flow) · --cross:#F5B84C (caution) · --head:#F26D5B (resistance) ·
--shelter:#3E8763 (forest shelter). Colour in WindRide always means wind relationship — never
decoration. Route polylines, ribbons, charts and heat strips all draw from these four. The lime
accent is NOT a wind hue and never colours a wind relationship.

## 2. Night Trail core tokens
--bg:#0E120D · --surface:#191F18 · --line:#2A3327 · --text:#F1F5EC · --text2:#A9B8A3 ·
--sky:#BFF04D (core UI accent: links, focus, selection, rider marker, CTA) · aurora gradient:
linear-gradient(100deg,#CDF45F,#A8E637) · on-aurora ink #131807.
Radii: cards 24px, pills 999px. Spacing: 8-pt grid. Tab bar height token --tabbar-h:64px.

## 3. Type
Display/numerals: "Space Grotesk" 700 (self-hosted), body/UI: Inter (self-hosted).
Glance-zone numerals ≥ 27 px (ride speed ≥ 48 px); tabular where numbers align. Labels are
uppercase, letter-spaced, --text2.

## 4. Shell & screen anatomy (DEC-055)
Fixed bottom tab bar: Plan / Routes / Ride / More (Kit, Help, About, Privacy in a More sheet) —
primary destinations one gloved thumb away at every width. Slim brand header; attribution footer
stays. The LIVE ride is a fixed full-screen overlay above the shell: top next-turn card (lime
glyph disc + distance, metres under 1 km), floating WindHud chip, round map buttons
(zoom/auto/recenter/mute), and a bottom panel — speed / km left / time left / arrival (24-h),
Details sheet, Details·Pause·End bar. Actions of equal importance get equal-size buttons
(`.wr-btn` primary, `.wr-btn--outline` peer, `.wr-btn--mini` list pills) — never text links.

## 5. Component inventory (reused everywhere)
WindRibbon (segmented wind story bar) · ScoreRing (0–100 arc) · ConditionsStrip ·
HeatStrip · RouteCard · StatCell · PrimaryButton · Toggle · Chip · Segmented · RideMap ·
WindHud · BasemapSwitcher · RideHistory (compact card: name+date, stats row, pill actions).

## 6. Rules
Hit targets ≥ 44 px (gloves). Dark-first; WCAG AA contrast on all text. Motion only where wind
lives and disabled under prefers-reduced-motion. Attribution footer: "© OpenStreetMap
contributors · Weather by Open-Meteo (CC-BY 4.0)". Every displayed duration/arrival comes from
the speed model.
