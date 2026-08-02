/**
 * nav/turnKind.ts — what KIND of maneuver a step is (WR-056). Pure.
 *
 * The Ride screen used to pick its turn arrow by substring-matching the instruction for
 * 'left'/'right'/'u-turn', which drew the same arrow for "Turn left", "Keep left" and "Sharp left" —
 * and drew "straight ahead" for "Enter the roundabout and take the 2nd exit", because that sentence
 * contains none of those words.
 *
 * The provider already sends the taxonomy. A real 22.5 km ORS capture (WR-056 probe) confirmed every
 * code matches its own text, so `TurnStep.type` is the source of truth for the KIND while the
 * instruction text stays the source of truth for the WORDING (street names, phrasing).
 *
 * Two safety nets, because neither source is guaranteed:
 *  - no code (curated/AI routes ship no steps at all; synthetic steps may omit it) → keyword fallback;
 *  - a code whose left/right sense CONTRADICTS an unambiguous "left"/"right" in the text → the text
 *    wins. That is exactly the shape of the bug WR-054 found sitting in the hand-made fixture
 *    (`type: 1` = right on "Turn left onto Metsapolku"), and drawing a left arrow for a right turn is
 *    the worst thing this module could do.
 */
import {
  ORS_ARRIVAL,
  ORS_CONTINUE,
  ORS_KEEP_LEFT,
  ORS_KEEP_RIGHT,
  ORS_LEFT,
  ORS_RIGHT,
  ORS_ROUNDABOUT_ENTER,
  ORS_ROUNDABOUT_EXIT,
  ORS_SHARP_LEFT,
  ORS_SHARP_RIGHT,
  ORS_SLIGHT_LEFT,
  ORS_SLIGHT_RIGHT,
  ORS_UTURN,
} from '../domain';

export type TurnKind =
  | 'left'
  | 'slight-left'
  | 'sharp-left'
  | 'keep-left'
  | 'right'
  | 'slight-right'
  | 'sharp-right'
  | 'keep-right'
  | 'straight'
  | 'uturn'
  | 'roundabout'
  | 'arrive';

const KIND_BY_CODE: Record<number, TurnKind> = {
  [ORS_LEFT]: 'left',
  [ORS_RIGHT]: 'right',
  [ORS_SHARP_LEFT]: 'sharp-left',
  [ORS_SHARP_RIGHT]: 'sharp-right',
  [ORS_SLIGHT_LEFT]: 'slight-left',
  [ORS_SLIGHT_RIGHT]: 'slight-right',
  [ORS_CONTINUE]: 'straight',
  [ORS_ROUNDABOUT_ENTER]: 'roundabout',
  [ORS_ROUNDABOUT_EXIT]: 'roundabout',
  [ORS_UTURN]: 'uturn',
  [ORS_ARRIVAL]: 'arrive',
  [ORS_KEEP_LEFT]: 'keep-left',
  [ORS_KEEP_RIGHT]: 'keep-right',
};

/** Which way a kind sends the rider, for the text-vs-code agreement check. */
function sideOf(kind: TurnKind): 'left' | 'right' | null {
  if (kind.endsWith('left')) return 'left';
  if (kind.endsWith('right')) return 'right';
  return null;
}

/** The side an instruction unambiguously names, or null when it says neither or both. */
function sideFromText(instruction: string): 'left' | 'right' | null {
  const s = instruction.toLowerCase();
  const left = s.includes('left');
  const right = s.includes('right');
  if (left === right) return null; // neither, or both ("keep left, then right") — no verdict
  return left ? 'left' : 'right';
}

/** Best-effort kind from the instruction wording alone (the pre-WR-056 behaviour, kept as fallback). */
function kindFromText(instruction: string): TurnKind {
  const s = instruction.toLowerCase();
  if (/roundabout|rotary/.test(s)) return 'roundabout';
  if (/u-turn|turn around/.test(s)) return 'uturn';
  if (/arriv|destination|goal/.test(s)) return 'arrive';
  const side = sideFromText(s);
  if (side === null) return 'straight';
  if (s.includes('sharp')) return side === 'left' ? 'sharp-left' : 'sharp-right';
  if (s.includes('slight')) return side === 'left' ? 'slight-left' : 'slight-right';
  if (s.includes('keep')) return side === 'left' ? 'keep-left' : 'keep-right';
  return side;
}

/** The maneuver kind of a step or cue point: provider code first, wording as the check and fallback. */
export function turnKindOf(step: { instruction: string; type?: number }): TurnKind {
  const coded = step.type === undefined ? undefined : KIND_BY_CODE[step.type];
  if (coded === undefined) return kindFromText(step.instruction);
  const codedSide = sideOf(coded);
  const textSide = sideFromText(step.instruction);
  // A code that sends the rider the opposite way from what they are being told is not trustworthy.
  if (codedSide !== null && textSide !== null && codedSide !== textSide) {
    return kindFromText(step.instruction);
  }
  return coded;
}

/** Short spoken direction for a chained maneuver — "…, then <this>" (WR-056). */
export function shortDirection(kind: TurnKind): string {
  switch (kind) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'slight-left':
      return 'slight left';
    case 'slight-right':
      return 'slight right';
    case 'sharp-left':
      return 'sharp left';
    case 'sharp-right':
      return 'sharp right';
    case 'keep-left':
      return 'keep left';
    case 'keep-right':
      return 'keep right';
    case 'uturn':
      return 'turn around';
    case 'roundabout':
      return 'the roundabout';
    case 'arrive':
      return 'arrive';
    default:
      return 'straight on';
  }
}
