/**
 * nav/cues.ts — turn-cue engine (WR-014, NAVIGATION_SPEC §4). PURE: maps provider steps to track
 * distances, then fires each cue exactly once as progress approaches, at 200 m and 40 m before the
 * maneuver (scaled ±40% with speed). No audio, no DOM — the Announcer (announcer.ts) does output.
 *
 * The provider `instruction` string is the source of truth for WORDING (direction phrasing + street
 * name); the numeric `type` is the source of truth for the maneuver KIND (see nav/turnKind.ts, and
 * DEC-064 for the real-capture evidence that the two agree).
 *
 * Closely-spaced maneuvers are chained at BUILD time, not at fire time (WR-056) — see markChains.
 */
import { ORS_ARRIVAL, ORS_DEPART, ORS_UTURN, type TurnStep } from '../domain';
import type { Track } from './snap';
import { shortDirection, turnKindOf, type TurnKind } from './turnKind';

export type CueKind = 'prepare' | 'turn';
export type UnitSystem = 'metric' | 'imperial';

export const CUE_PREPARE_M = 200;
export const CUE_TURN_M = 40;
export const CUE_SPEED_SCALE = 0.4; // ±40%
export const CUE_NOMINAL_SPEED_MS = 5.5; // ~20 km/h reference cadence
/** A turn already this far behind us is marked done silently, never announced (stale after a jump). */
export const CUE_STALE_SLACK_M = 25;

/**
 * Two maneuvers this close are the SAME junction (a slip road, a path fork with a lane hint right
 * before the turn). The follower is not announced at all; its direction is spoken as part of the
 * leader's cue, so nothing is lost but the street name.
 */
export const CUE_MERGE_M = 15;
/**
 * Beyond CUE_MERGE_M but within this, the follower is a real second maneuver but its PREPARE would
 * stack on the leader's: at 25 km/h prepares fire ~250 m out, so a follower 50 m later is announced
 * while the rider is still 200 m from the first turn. Its prepare is dropped and the leader's cue
 * mentions it instead; its own turn cue still fires.
 *
 * Must stay above the widest scaled turn trigger (CUE_TURN_M × 1.4 = 56 m), or the two TURN cues land
 * on the same tick and talk over each other.
 *
 * Real-world weight (a 22.5 km ORS capture, WR-056): 43 of 120 maneuvers fall inside this window —
 * 23 of them inside CUE_MERGE_M. This is a third of a ride, not an edge case.
 */
export const CUE_CHAIN_M = 60;

/** A maneuver bound to a progress distance along the route. */
export interface CuePoint {
  stepIndex: number;
  /** Progress distance (m) along the route where the maneuver occurs. */
  turnDistanceM: number;
  instruction: string;
  type?: number;
  /**
   * Set by markChains (WR-056): 'all' = this maneuver shares a junction with the one before it and is
   * never announced; 'prepare' = announce only its imminent-turn cue, its prepare would stack.
   */
  suppress?: 'prepare' | 'all';
  /** Set on a LEADER: the kind of the maneuver following it closely, for the ", then …" hint. */
  thenKind?: TurnKind;
}

/** A cue ready to be announced. */
export interface Cue {
  stepIndex: number;
  kind: CueKind;
  text: string;
  turnDistanceM: number;
}

/** Map provider steps to progress distances using the same polyline the Snapper tracks. */
export function buildCuePoints(steps: TurnStep[], track: Track): CuePoint[] {
  const cues: CuePoint[] = [];
  steps.forEach((step, stepIndex) => {
    if (step.type === ORS_DEPART) return; // the initial "Head …" is not a turn
    const startIdx = step.wayPoints?.[0];
    if (startIdx === undefined || startIdx >= track.cum.length) return;
    cues.push({
      stepIndex,
      turnDistanceM: track.cum[startIdx],
      instruction: step.instruction,
      type: step.type,
    });
  });
  markChains(cues);
  return cues;
}

/**
 * Decide, up front, which closely-spaced maneuvers get folded into their predecessor (WR-056).
 *
 * This CANNOT be done when cues fire. With maneuvers at 1000 m and 1050 m at 25 km/h the firing order
 * is leader-prepare (748 m), FOLLOWER-prepare (798 m), leader-turn (949 m) — so by the time the
 * leader's turn cue could suppress anything, the follower's prepare was spoken 150 m ago. Only the
 * full cue list knows the distances in advance.
 *
 * Walks forward tracking the last cue that will actually be announced, so runs of three or more
 * compose: each maneuver is judged against the last one the rider will have HEARD, never against one
 * that was itself folded away.
 */
function markChains(cues: CuePoint[]): void {
  let leader: CuePoint | undefined;
  for (const cue of cues) {
    if (!leader) {
      leader = cue;
      continue;
    }
    const gap = cue.turnDistanceM - leader.turnDistanceM;
    if (gap > CUE_CHAIN_M) {
      leader = cue;
      continue;
    }
    // Only the FIRST follower is mentioned: at these distances "left, then right, then right" is
    // noise, and the later ones still get their own turn cue unless they share the junction.
    leader.thenKind ??= turnKindOf(cue);
    if (gap <= CUE_MERGE_M) {
      cue.suppress = 'all'; // same junction — the leader's cue already names this direction
    } else {
      cue.suppress = 'prepare';
      leader = cue; // its turn cue still fires, so it becomes what the rider last heard
    }
  }
}

/**
 * How long a maneuver still matters after the rider has passed its node — they are mid-corner, not
 * done with it. A navigation fact, not a rendering choice, which is why it lives here.
 */
export const MANEUVER_GRACE_M = 40;

/** ORS "continue straight" — a step, but not a place where anyone has to decide anything. */
const ORS_CONTINUE = 6;

/**
 * Whether a cue point is a junction the rider actually steers through. Arrival is the finish, not a
 * junction; "continue straight" is a step with no decision in it. Kept: 12/13 "keep left/right" (a
 * fork is exactly where riders get it wrong) and 9 (the out-and-back turnaround).
 */
function isManeuver(cue: CuePoint): boolean {
  return cue.type !== ORS_CONTINUE && !isArrival(cue);
}

/**
 * Distance to the nearest maneuver the rider is steering through, or null when there is none in
 * reach (including a route that ships no steps at all — curated and AI routes do).
 *
 * Asymmetric on purpose (WR-055): the full distance while the node is AHEAD, 0 while it is within
 * `graceM` behind, and nothing once it is further back than that. A symmetric |distance| would keep
 * a junction "near" for the whole grace window on BOTH sides, so on an urban route with maneuvers a
 * few hundred metres apart nothing would ever be far from a junction.
 */
/**
 * The next junction the rider actually steers through (WR-057) — skipping the arrival step, "continue
 * straight", and followers folded into their predecessor by markChains. Without the filter the finish
 * line would get a turn arrow drawn on it.
 */
export function nextManeuver(cues: CuePoint[], progressM: number): CuePoint | undefined {
  return cues.find(
    (cue) => isManeuver(cue) && cue.suppress !== 'all' && cue.turnDistanceM > progressM,
  );
}

export function proximityToManeuverM(
  cues: CuePoint[],
  progressM: number,
  graceM: number = MANEUVER_GRACE_M,
): number | null {
  let best = Infinity;
  for (const cue of cues) {
    if (!isManeuver(cue)) continue;
    const ahead = cue.turnDistanceM - progressM;
    if (ahead >= 0) best = Math.min(best, ahead);
    else if (-ahead <= graceM) best = 0; // mid-corner: still the junction we care about
  }
  return Number.isFinite(best) ? best : null;
}

/** Trigger distance for a cue, scaled ±40% by speed so faster riders are warned earlier. */
export function scaledTriggerDistanceM(baseM: number, speedMs: number): number {
  const ratio = speedMs > 0 ? speedMs / CUE_NOMINAL_SPEED_MS : 0;
  const clamped = Math.max(1 - CUE_SPEED_SCALE, Math.min(1 + CUE_SPEED_SCALE, ratio));
  return baseM * clamped;
}

function isArrival(cue: CuePoint): boolean {
  return cue.type === ORS_ARRIVAL || /arriv|destination|goal/i.test(cue.instruction);
}

/**
 * The fold of an out-and-back (WR-054). Keyed on the maneuver code, not the text, so it holds in any
 * locale; the text test is only a safety net for providers that omit the code.
 */
function isTurnaround(cue: CuePoint): boolean {
  return (cue.type === ORS_UTURN || /turn around/i.test(cue.instruction)) && !isArrival(cue);
}

/** "Turn left onto Metsäpolku" -> "left onto Metsäpolku" (drop the leading verb for the prepare cue). */
function shortenInstruction(instruction: string): string {
  return instruction.replace(/^(turn|make|take)\s+/i, '');
}

/** Append the chained follower, so one utterance covers both maneuvers (WR-056). */
function withThen(text: string, cue: CuePoint): string {
  return cue.thenKind ? `${text}, then ${shortDirection(cue.thenKind)}` : text;
}

/** Direction phrase for the imminent-turn cue, from the instruction ("Turn left now"). */
function turnPhrase(cue: CuePoint): string {
  if (isArrival(cue)) return 'You have arrived';
  if (isTurnaround(cue)) return 'Turn around now';
  const m = /^turn\s+([a-zäöå ]+?)(?:\s+onto\b|\s+on\b|$)/i.exec(cue.instruction);
  if (m) return `Turn ${m[1].trim().toLowerCase()} now`;
  return `${cue.instruction} now`;
}

function formatDistance(m: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    const feet = m * 3.28084;
    return `${Math.max(50, Math.round(feet / 50) * 50)} feet`;
  }
  const rounded = m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
  return `${rounded} metres`;
}

/**
 * One-shot cue scheduler. Feed monotonic progress + speed; get back the cues to speak this tick,
 * each fired exactly once. `rearm` swaps the cue set after a reroute (WR-015 hook).
 */
export class CueScheduler {
  private cues: CuePoint[];
  private readonly unit: UnitSystem;
  private prepared = new Set<number>();
  private turned = new Set<number>();

  constructor(cues: CuePoint[], unit: UnitSystem = 'metric') {
    this.cues = cues;
    this.unit = unit;
    this.applySuppression();
  }

  /**
   * Pre-mark the cues markChains folded away, reusing the same "already fired" bookkeeping the
   * one-shot logic uses — so suppression needs no special case in the hot loop.
   */
  private applySuppression(): void {
    for (const cue of this.cues) {
      if (cue.suppress === 'all') {
        this.prepared.add(cue.stepIndex);
        this.turned.add(cue.stepIndex);
      } else if (cue.suppress === 'prepare') {
        this.prepared.add(cue.stepIndex);
      }
    }
  }

  update(progressM: number, speedMs: number): Cue[] {
    const out: Cue[] = [];
    const prepareTrigger = scaledTriggerDistanceM(CUE_PREPARE_M, speedMs);
    const turnTrigger = scaledTriggerDistanceM(CUE_TURN_M, speedMs);
    for (const cue of this.cues) {
      // Imminent-turn cue takes priority: if we've reached it, speak it and suppress its prepare.
      if (!this.turned.has(cue.stepIndex) && progressM >= cue.turnDistanceM - turnTrigger) {
        this.turned.add(cue.stepIndex);
        this.prepared.add(cue.stepIndex);
        // Silently skip a turn we've already ridden well past (e.g. a +300 m progress jump after a
        // GPS dropout) — announcing "Turn left now" for a passed maneuver would mislead.
        if (progressM <= cue.turnDistanceM + CUE_STALE_SLACK_M) {
          out.push({
            stepIndex: cue.stepIndex,
            kind: 'turn',
            text: withThen(turnPhrase(cue), cue),
            turnDistanceM: cue.turnDistanceM,
          });
        }
        continue;
      }
      if (!this.prepared.has(cue.stepIndex) && progressM >= cue.turnDistanceM - prepareTrigger) {
        this.prepared.add(cue.stepIndex);
        if (progressM < cue.turnDistanceM) {
          const remaining = formatDistance(cue.turnDistanceM - progressM, this.unit);
          // Turnarounds need their own wording: shortenInstruction strips the leading verb, which
          // would leave "In 200 metres, around and ride back".
          const text = isArrival(cue)
            ? `In ${remaining}, you'll arrive`
            : isTurnaround(cue)
              ? `In ${remaining}, turn around and ride back`
              : `In ${remaining}, ${shortenInstruction(cue.instruction)}`;
          out.push({
            stepIndex: cue.stepIndex,
            kind: 'prepare',
            text: withThen(text, cue),
            turnDistanceM: cue.turnDistanceM,
          });
        }
      }
    }
    return out;
  }

  /**
   * Replace the cue set after a reroute; cues already behind `progressM` are marked done.
   * WR-015 should also call `announcer.stop()` so a cue queued for the OLD route isn't spoken.
   */
  rearm(cues: CuePoint[], progressM: number): void {
    this.cues = cues;
    this.prepared = new Set();
    this.turned = new Set();
    for (const cue of cues) {
      if (cue.turnDistanceM <= progressM) {
        this.prepared.add(cue.stepIndex);
        this.turned.add(cue.stepIndex);
      }
    }
    this.applySuppression(); // the new cue set has its own chains (WR-056)
  }
}
