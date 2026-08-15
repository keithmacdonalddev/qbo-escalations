import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentHealthBanner from './AgentHealthBanner.jsx';
import { showHealthToast } from './HealthToast.jsx';

const registryState = vi.hoisted(() => ({ current: null }));

vi.mock('../context/AgentRegistryContext.jsx', () => ({
  useAgentRegistry: () => registryState.current,
}));

vi.mock('./HealthToast.jsx', () => ({
  showHealthToast: vi.fn(),
}));

function parserEntry(healthOverrides = {}) {
  return {
    profile: { profile: { displayName: 'Image Parser' } },
    health: {
      status: 'degraded',
      code: 'TIMEOUT',
      diagnostic: 'Google Gemini API health check did not respond before the timeout',
      provider: 'gemini',
      providerLabel: 'Google Gemini API',
      model: 'gemini-3.6-flash',
      checkedAt: '2026-08-15T17:39:34.000Z',
      lastSuccessAt: '2026-08-15T17:38:32.000Z',
      consecutiveFailures: 1,
      confirmationThreshold: 2,
      ...healthOverrides,
    },
  };
}

function setRegistry(healthOverrides = {}) {
  registryState.current = {
    agents: { 'escalation-template-parser': parserEntry(healthOverrides) },
    refreshAll: vi.fn().mockResolvedValue(undefined),
  };
  return registryState.current;
}

describe('AgentHealthBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '#/chat';
  });

  it('presents one timeout as uncertain, with recovery actions and evidence on demand', async () => {
    const user = userEvent.setup();
    const registry = setRegistry();
    render(<AgentHealthBanner />);

    expect(screen.getByRole('heading', { name: 'Image Parser is responding slowly' })).toBeInTheDocument();
    expect(screen.getAllByText(/New screenshots may still work/i)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/did not respond before the timeout/i)).toBeInTheDocument();
    expect(screen.getByText('1 of 2 failed checks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check Google status' })).toHaveAttribute(
      'href',
      'https://aistudio.google.com/status',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('link', { name: 'Check Google status' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(registry.refreshAll).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Check completed/i)).toBeInTheDocument();
  });

  it('dismisses to a compact unresolved indicator that can be restored', async () => {
    const user = userEvent.setup();
    setRegistry();
    render(<AgentHealthBanner />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('heading', { name: /Image Parser/i })).not.toBeInTheDocument();

    const restore = screen.getByRole('button', { name: /Show warning: Image Parser is responding slowly/i });
    expect(restore).toBeInTheDocument();
    await user.click(restore);
    expect(screen.getByRole('heading', { name: 'Image Parser is responding slowly' })).toBeInTheDocument();
  });

  it('routes configuration failures to AI Management instead of encouraging futile retries', async () => {
    const user = userEvent.setup();
    setRegistry({
      status: 'offline',
      code: 'INVALID_KEY',
      diagnostic: 'Google Gemini API key rejected',
      consecutiveFailures: 1,
      confirmationThreshold: 1,
    });
    render(<AgentHealthBanner />);

    expect(screen.queryByRole('button', { name: 'Retry now' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(window.location.hash).toBe('#/settings');
  });

  it('explains rate limits without inviting an immediate retry', () => {
    setRegistry({
      status: 'degraded',
      code: 'RATE_LIMITED',
      diagnostic: 'The provider request limit was reached.',
    });
    render(<AgentHealthBanner />);

    expect(screen.getByRole('heading', { name: 'Image Parser reached its provider limit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review usage' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry now' })).not.toBeInTheDocument();
  });

  it('uses confirmed guidance after repeated timeout failures', async () => {
    const user = userEvent.setup();
    setRegistry({
      status: 'offline',
      code: 'TIMEOUT',
      consecutiveFailures: 2,
      confirmationThreshold: 2,
    });
    render(<AgentHealthBanner />);

    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/Repeated checks exceeded their response window/i)).toBeInTheDocument();
    expect(screen.queryByText(/one timeout does not prove an outage/i)).not.toBeInTheDocument();
  });

  it('announces confirmed failure and recovery transitions without alarming on a single slow check', () => {
    setRegistry({ status: 'online', code: 'OK' });
    const { rerender } = render(<AgentHealthBanner />);

    setRegistry({ status: 'degraded', code: 'TIMEOUT' });
    rerender(<AgentHealthBanner />);
    expect(showHealthToast).not.toHaveBeenCalled();

    setRegistry({ status: 'offline', code: 'TIMEOUT', consecutiveFailures: 2 });
    rerender(<AgentHealthBanner />);
    expect(showHealthToast).toHaveBeenCalledWith({ message: 'Image Parser is unavailable' });

    setRegistry({ status: 'online', code: 'OK', consecutiveFailures: 0 });
    rerender(<AgentHealthBanner />);
    expect(showHealthToast).toHaveBeenLastCalledWith({
      message: 'Image Parser recovered',
      tone: 'success',
    });
  });
});
