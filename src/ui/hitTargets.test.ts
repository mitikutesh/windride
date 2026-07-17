import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guards the DESIGN §5 "glove-first hit targets >= 44 px" rule automatically: jsdom can't
// compute layout, so we assert the CSS contract instead (token = 44px, interactive classes
// pin min-height to it).
const tokens = readFileSync('src/ui/tokens.css', 'utf8');
const components = readFileSync('src/ui/components/components.css', 'utf8');
const global = readFileSync('src/ui/global.css', 'utf8');

describe('hit targets (DESIGN §5)', () => {
  it('defines --hit-min as 44px', () => {
    expect(tokens).toMatch(/--hit-min:\s*44px/);
  });

  it('pins every interactive control to the hit-target minimum', () => {
    // PrimaryButton, interactive Chip, Toggle, and nav links all use min-height: var(--hit-min).
    const usesHitMin = (css: string, selector: string) => {
      const block = new RegExp(`${selector}\\s*\\{[^}]*min-height:\\s*var\\(--hit-min\\)`, 's');
      return block.test(css);
    };
    expect(usesHitMin(components, '\\.wr-btn')).toBe(true);
    expect(usesHitMin(components, '\\.wr-chip--btn')).toBe(true);
    expect(usesHitMin(components, '\\.wr-toggle')).toBe(true);
    expect(usesHitMin(global, '\\.wr-navlink')).toBe(true);
  });
});

describe('reduced motion (DESIGN §5)', () => {
  it('neutralises animation and transition under prefers-reduced-motion', () => {
    expect(global).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(global).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
    expect(global).toMatch(/transition-duration:\s*0\.001ms\s*!important/);
  });
});
