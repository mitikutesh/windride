import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyScreen } from './PrivacyScreen';

describe('PrivacyScreen (WR-042)', () => {
  it('states what is stored, the export/delete rights, and that keys never leave the browser', () => {
    render(<PrivacyScreen />);
    expect(screen.getByRole('heading', { level: 1, name: /privacy/i })).toBeInTheDocument();
    expect(screen.getByText(/never store your API keys/i)).toBeInTheDocument();
    expect(screen.getByText('Export your data')).toBeInTheDocument(); // the bold action label
    expect(screen.getByText('Delete your account')).toBeInTheDocument();
  });
});
