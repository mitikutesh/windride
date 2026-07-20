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

  it('describes the account as optional and keys as never synced (WR-043)', () => {
    render(<HelpScreen />);
    expect(screen.getByRole('heading', { name: /optional account/i })).toBeInTheDocument();
    expect(screen.getByText(/never need to sign in/i)).toBeInTheDocument(); // progressive/anonymous
    expect(screen.getByText(/never touches your API keys/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Privacy/i }).length).toBeGreaterThan(0);
  });

  it('no longer claims "no server and no account" or "built for one person" (WR-043)', () => {
    render(<HelpScreen />);
    expect(screen.queryByText(/no server and no account/i)).toBeNull();
    expect(screen.queryByText(/built for one person/i)).toBeNull();
  });
});
