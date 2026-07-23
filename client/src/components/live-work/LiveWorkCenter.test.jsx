import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import LiveWorkCenter from './LiveWorkCenter.jsx';

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  value: null,
}));

vi.mock('../../context/LiveWorkContext.jsx', () => ({
  useLiveWork: () => mocks.value,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '#/chat';
  mocks.value = {
    activeWork: [{
      id: 'local:qbo-workflow:1',
      source: 'local-workflow',
      kind: 'qbo-workflow',
      title: 'QBO case 42',
      owner: 'Triage Agent',
      status: 'running',
      phaseLabel: 'Classifying the escalation',
      conversationId: 'conversation-1',
      updatedAt: new Date().toISOString(),
      stages: [
        { key: 'parser', label: 'Image Parser', status: 'done' },
        { key: 'inv', label: 'INV Search Agent', status: 'done' },
        { key: 'triage', label: 'Triage Agent', status: 'running' },
        { key: 'main', label: 'QBO Assistant', status: 'pending' },
      ],
    }],
    recentWork: [],
    attention: {
      items: [{
        _id: 'attention-1',
        kind: 'knowledge-review',
        severity: 'warning',
        title: 'Knowledge draft needs review',
        summary: 'Confirm the reusable steps before publishing.',
        sourceEscalationId: { _id: 'escalation-1' },
        updatedAt: new Date().toISOString(),
      }],
      total: 1,
      counts: { open: 1 },
      kindCounts: { 'knowledge-review': 1 },
      severityCounts: { warning: 1 },
      loading: false,
      error: '',
    },
    status: 'connected',
    retry: mocks.retry,
  };
});

it('opens a global work and attention panel with a visible agent handoff', async () => {
  const user = userEvent.setup();
  render(<LiveWorkCenter />);
  await user.click(screen.getByRole('button', { name: /Open Live Work Center/i }));

  expect(screen.getByRole('dialog', { name: 'Live Work Center' })).toBeVisible();
  expect(screen.getByText('Knowledge draft needs review')).toBeVisible();
  expect(screen.getByText('QBO case 42')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Agent handoff progress' })).toHaveTextContent('Image Parser');
  expect(screen.getByRole('list', { name: 'Agent handoff progress' })).toHaveTextContent('Triage Agent');
  expect(screen.getByText('Safe to leave this screen')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Review' }));
  expect(window.location.hash).toBe('#/escalations/escalation-1');
  expect(screen.queryByRole('dialog', { name: 'Live Work Center' })).not.toBeInTheDocument();
});

it('keeps the last confirmed information visible while updates are paused and offers retry', async () => {
  const user = userEvent.setup();
  mocks.value = { ...mocks.value, status: 'stale' };
  render(<LiveWorkCenter />);
  await user.click(screen.getByRole('button', { name: /Open Live Work Center/i }));
  expect(screen.getByText('Updates paused')).toBeVisible();
  expect(screen.getByText('Knowledge draft needs review')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});
