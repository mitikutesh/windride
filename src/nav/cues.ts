/**
 * nav/cues.ts — turn-cue engine (WR-014, NAVIGATION_SPEC §4). PURE: maps provider steps to track
 * distances, then fires each cue exactly once as progress approaches, at 200 m and 40 m before the
 * maneuver (scaled ±40% with speed). No audio, no DOM — the Announcer (announcer.ts) does output.
 *
 * The provider `instruction` string is the source of truth for direction + street name; the numeric
 * `type` is used only structurally (depart=11 is skipped, arrival=10 speaks "you have arrived"),
 * because provider `type` codes can disagree with the localized instruction text.
 */
import type { TurnStep } from '../domain';
import type { Track } from './snap';

export type CueKind = 'prepare' | 'turn';
export type UnitSystem = 'metric' | 'imperial';

export const CUE_PREPARE_M = 200;
export const CUE_TURN_M = 40;
export const CUE_SPEED_SCALE = 0.4; // ±40%
export const CUE_NOMINAL_SPEED_MS = 5.5; // ~20 km/h reference cadence

/** A maneuver bound to a progress distance along the route. */
export interface CuePoint {
  stepIndex: number;
  /** Progress distance (m) along the route where the maneuver occurs. */
  turnDistanceM: number;
  instruction: string;
  type?: number;
}

/** A cue ready to be announced. */
export interface Cue {
  stepIndex: number;
  kind: CueKind;
  text: string;
  turnDistanceM: number;
}

const ORS_DEPART = 11;
const ORS_ARRIVAL = 10;

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
  return cues;
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

/** "Turn left onto Metsäpolku" -> "left onto Metsäpolku" (drop the leading verb for the prepare cue). */
function shortenInstruction(instruction: string): string {
  return instruction.replace(/^(turn|make|take)\s+/i, '');
}

/** Direction phrase for the imminent-turn cue, from the instruction ("Turn left now"). */
function turnPhrase(cue: CuePoint): string {
  if (isArrival(cue)) return 'You have arrived';
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
        out.push({
          stepIndex: cue.stepIndex,
          kind: 'turn',
          text: turnPhrase(cue),
          turnDistanceM: cue.turnDistanceM,
        });
        continue;
      }
      if (!this.prepared.has(cue.stepIndex) && progressM >= cue.turnDistanceM - prepareTrigger) {
        this.prepared.add(cue.stepIndex);
        if (progressM < cue.turnDistanceM) {
          const remaining = formatDistance(cue.turnDistanceM - progressM, this.unit);
          const text = isArrival(cue)
            ? `In ${remaining}, you'll arrive`
            : `In ${remaining}, ${shortenInstruction(cue.instruction)}`;
          out.push({
            stepIndex: cue.stepIndex,
            kind: 'prepare',
            text,
            turnDistanceM: cue.turnDistanceM,
          });
        }
      }
    }
    return out;
  }

  /** Replace the cue set after a reroute; cues already behind `progressM` are marked done. */
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
  }
}
