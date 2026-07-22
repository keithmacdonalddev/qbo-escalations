import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AgentTestModalProvider, useAgentTestModal } from './AgentTestModalProvider.jsx';

vi.mock('./AgentTestModal.jsx', () => ({
  default: ({ request, onClose }) => {
    if (request.agentId === 'throwing-agent') throw new Error('controlled lazy modal render failure');
    return (
      <section aria-label="Loaded agent test">
        <span>{request.agentId}</span>
        <button type="button" onClick={onClose}>Close loaded test</button>
      </section>
    );
  },
}));

function OpenTestButton({ agentId }) {
  const { openAgentTest } = useAgentTestModal();
  return <button type="button" onClick={() => openAgentTest({ agentId })}>Open {agentId}</button>;
}

it('loads an explicitly opened agent test without replacing surrounding content', async () => {
  const user = userEvent.setup();
  render(
    <AgentTestModalProvider>
      <span>Existing workspace remains</span>
      <OpenTestButton agentId="triage-agent" />
    </AgentTestModalProvider>,
  );

  await user.click(screen.getByRole('button', { name: 'Open triage-agent' }));
  expect(await screen.findByRole('region', { name: 'Loaded agent test' })).toBeVisible();
  expect(screen.getByText('Existing workspace remains')).toBeVisible();
});

it('contains an agent-test render failure and offers a local close action', async () => {
  const user = userEvent.setup();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <AgentTestModalProvider>
      <span>Existing workspace remains</span>
      <OpenTestButton agentId="throwing-agent" />
    </AgentTestModalProvider>,
  );

  await user.click(screen.getByRole('button', { name: 'Open throwing-agent' }));
  const failure = await screen.findByRole('alert', { name: 'Agent test could not open' });
  expect(failure).toHaveTextContent('Couldn’t open the agent test.');
  expect(screen.getByText('Existing workspace remains')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('alert', { name: 'Agent test could not open' })).not.toBeInTheDocument();
  consoleError.mockRestore();
});
