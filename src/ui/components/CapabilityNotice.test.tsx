import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useKeychainStore } from '../../state/keychainStore';
import { CapabilityNotice } from './CapabilityNotice';

beforeEach(() => {
  useKeychainStore.setState({ keys: {}, aiProvider: null, liveApis: false });
});

describe('CapabilityNotice (ai)', () => {
  it('shows the reason + a Kit → AI link when AI is not set up', () => {
    render(<CapabilityNotice capability="ai" />);
    expect(screen.getByText(/pick an ai provider/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Kit → AI/i });
    expect(link).toHaveAttribute('href', '#/kit');
  });

  it('renders nothing once AI is set up', () => {
    useKeychainStore.setState({ keys: { ai: 'k' }, aiProvider: 'anthropic', liveApis: false });
    const { container } = render(<CapabilityNotice capability="ai" />);
    expect(container).toBeEmptyDOMElement();
  });
});
