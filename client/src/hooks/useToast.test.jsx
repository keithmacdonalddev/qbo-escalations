import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './useToast.jsx';

function Harness({ onOpen }) {
  const toast = useToast();
  const show = () => toast.success('Knowledge draft ready for case CASE-42.', {
    groupKey: 'knowledge:case-42:created',
    actionLabel: 'Open case',
    onAction: onOpen,
  });
  return (
    <div>
      <button type="button" onClick={show}>Show once</button>
      <button type="button" onClick={show}>Show duplicate</button>
    </div>
  );
}

it('deduplicates a notification group and runs its direct action', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(<ToastProvider><Harness onOpen={onOpen} /></ToastProvider>);

  await user.click(screen.getByRole('button', { name: 'Show once' }));
  await user.click(screen.getByRole('button', { name: 'Show duplicate' }));
  expect(screen.getAllByText('Knowledge draft ready for case CASE-42.')).toHaveLength(1);

  await user.click(screen.getByRole('button', { name: 'Open case' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
});
