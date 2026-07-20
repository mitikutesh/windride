import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpScreen } from './HelpScreen';

describe('<HelpScreen />', () => {
  it('renders the guide with the Plan→Results→Ride flow and a Kit link', () => {
    render(<HelpScreen />);
    expect(
      screen.getByRole('heading', { level: 1, name: /how to use windride/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Plan → Results → Ride/i })).toBeInTheDocument();
    // Links riders to where the keys are entered.
    expect(screen.getAllByRole('link', { name: /Kit/i }).length).toBeGreaterThan(0);
  });

  it('states that API keys stay in the browser (privacy promise)', () => {
    render(<HelpScreen />);
    expect(screen.getByText(/only in this browser/i)).toBeInTheDocument();
    expect(screen.getByText(/IndexedDB/i)).toBeInTheDocument();
  });

  it('has an expandable FAQ', () => {
    render(<HelpScreen />);
    const q = screen.getByText(/Why do I need my own API keys/i);
    expect(q.tagName.toLowerCase()).toBe('summary'); // native <details> accordion, no JS needed
    fireEvent.click(q); // toggling must not throw
  });
});
