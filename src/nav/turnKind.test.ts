import { describe, expect, it } from 'vitest';
import realSmallRaw from '../../fixtures/ors/real-small.json?raw';
import { shortDirection, turnKindOf, type TurnKind } from './turnKind';

describe('turnKindOf — provider code', () => {
  // The codes as confirmed against the real capture (see the fixture assertions at the bottom).
  const cases: Array<[number, string, TurnKind]> = [
    [0, 'Turn left', 'left'],
    [1, 'Turn right', 'right'],
    [2, 'Turn sharp left', 'sharp-left'],
    [3, 'Turn sharp right', 'sharp-right'],
    [4, 'Turn slight left', 'slight-left'],
    [5, 'Turn slight right onto Siperianpolku', 'slight-right'],
    [6, 'Continue straight', 'straight'],
    [7, 'Enter the roundabout and take the 2nd exit', 'roundabout'],
    [8, 'Exit the roundabout onto Kehätie', 'roundabout'],
    [9, 'Turn around and ride back', 'uturn'],
    [10, 'Arrive at Tillinmäentie, on the right', 'arrive'],
    [12, 'Keep left', 'keep-left'],
    [13, 'Keep right', 'keep-right'],
  ];

  it.each(cases)('code %i (%s) -> %s', (type, instruction, expected) => {
    expect(turnKindOf({ type, instruction })).toBe(expected);
  });

  it('distinguishes the four left-ish maneuvers that used to share one arrow', () => {
    const kinds = [0, 2, 4, 12].map((type) => turnKindOf({ type, instruction: 'x left' }));
    expect(new Set(kinds).size).toBe(4);
  });

  it('reads a roundabout as a roundabout, not as straight ahead', () => {
    // The pre-WR-056 keyword match found no left/right in this sentence and drew "straight".
    const instruction = 'Enter the roundabout and take the 2nd exit onto Kehätie';
    expect(turnKindOf({ type: 7, instruction })).toBe('roundabout');
    expect(turnKindOf({ instruction })).toBe('roundabout'); // and without a code too
  });
});

describe('turnKindOf — fallbacks and the agreement guard', () => {
  it('falls back to the wording when the step carries no code', () => {
    expect(turnKindOf({ instruction: 'Turn sharp right onto X' })).toBe('sharp-right');
    expect(turnKindOf({ instruction: 'Keep left at the fork' })).toBe('keep-left');
    expect(turnKindOf({ instruction: 'Continue on the path' })).toBe('straight');
  });

  it('falls back for an unknown code', () => {
    expect(turnKindOf({ type: 99, instruction: 'Turn left onto X' })).toBe('left');
  });

  it('prefers the WORDING when a code sends the rider the opposite way', () => {
    // Exactly the fixture bug WR-054 found: ORS 1 = right, on a step that says "left".
    expect(turnKindOf({ type: 1, instruction: 'Turn left onto Metsapolku' })).toBe('left');
    expect(turnKindOf({ type: 0, instruction: 'Turn right onto Metsapolku' })).toBe('right');
  });

  it('keeps the code when the wording gives no verdict', () => {
    // No side named: the code is all there is, and the sharpness only it knows must survive.
    expect(turnKindOf({ type: 2, instruction: 'Käänny jyrkästi' })).toBe('sharp-left');
    // Both sides named: still no verdict, so the code stands.
    expect(turnKindOf({ type: 12, instruction: 'Keep left, then right' })).toBe('keep-left');
  });

  it('keeps sideless kinds even when the wording mentions a side', () => {
    // "Arrive ... on the right" says 'right' but is not a right turn.
    expect(turnKindOf({ type: 10, instruction: 'Arrive at Tillinmäentie, on the right' })).toBe(
      'arrive',
    );
  });
});

describe('turnKindOf — against the real ORS capture', () => {
  const steps = (
    JSON.parse(realSmallRaw) as {
      features: Array<{
        properties: { segments: Array<{ steps: Array<{ type: number; instruction: string }> }> };
      }>;
    }
  ).features[0].properties.segments.flatMap((s) => s.steps);

  it('agrees with the wording on every step of a real 22.5 km route', () => {
    // This is the assertion that justifies trusting `type` at all (WR-056 / DEC-064). If a future
    // capture disagrees, the guard keeps the render correct but this test tells us the premise moved.
    expect(steps.length).toBeGreaterThan(100);
    for (const step of steps) {
      const withCode = turnKindOf(step);
      const fromText = turnKindOf({ instruction: step.instruction });
      const side = (k: TurnKind) => (k.endsWith('left') ? 'L' : k.endsWith('right') ? 'R' : null);
      // Where the text names a side, it must be the same side the code gives.
      if (side(fromText) !== null && side(withCode) !== null) {
        expect(side(withCode)).toBe(side(fromText));
      }
    }
  });
});

describe('shortDirection', () => {
  it('gives a speakable phrase for every kind', () => {
    const kinds: TurnKind[] = [
      'left',
      'right',
      'slight-left',
      'slight-right',
      'sharp-left',
      'sharp-right',
      'keep-left',
      'keep-right',
      'straight',
      'uturn',
      'roundabout',
      'arrive',
    ];
    for (const k of kinds) expect(shortDirection(k)).toMatch(/^[a-z ]+$/);
  });
});
