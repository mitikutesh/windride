import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BasemapSwitcher } from './BasemapSwitcher';

describe('BasemapSwitcher', () => {
  it('collapses to one layers toggle; expanding shows a button per basemap, active pressed', () => {
    render(<BasemapSwitcher value="cycling" onChange={() => {}} />);
    // Collapsed by default (DEC-055): only the round layers toggle overlays the map.
    expect(screen.queryByRole('button', { name: 'Cycling' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Base map layers' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    for (const label of ['Streets', 'Cycling', 'Satellite', 'Terrain']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Cycling' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Streets' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onChange with the picked basemap id and collapses again', () => {
    const onChange = vi.fn();
    render(<BasemapSwitcher value="streets" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Base map layers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    expect(onChange).toHaveBeenCalledWith('satellite');
    // Picking an option puts the map back in front — the list must not linger over it.
    expect(screen.queryByRole('button', { name: 'Streets' })).not.toBeInTheDocument();
  });
});
