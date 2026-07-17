import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { App } from '../../App';
import { KitScreen } from './KitScreen';

describe('kit route (component gallery)', () => {
  it('has no axe a11y violations across the whole route (shell + kit)', async () => {
    window.location.hash = '#/kit';
    const { container } = render(<App />);
    // color-contrast needs real layout/pixels, which jsdom cannot compute — disable it and
    // check the structural rules (roles, names, aria state) over header, nav, footer and kit.
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('flips the switch when toggled', async () => {
    const user = userEvent.setup();
    render(<KitScreen />);
    const toggle = screen.getByRole('switch', { name: 'Home before dark' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});
