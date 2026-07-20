import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BasemapSwitcher } from './BasemapSwitcher';

describe('BasemapSwitcher', () => {
  it('renders a button per basemap and marks the active one pressed', () => {
    render(<BasemapSwitcher value="cycling" onChange={() => {}} />);
    for (const label of ['Streets', 'Cycling', 'Satellite', 'Terrain']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Cycling' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Streets' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onChange with the picked basemap id', () => {
    const onChange = vi.fn();
    render(<BasemapSwitcher value="streets" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    expect(onChange).toHaveBeenCalledWith('satellite');
  });
});
