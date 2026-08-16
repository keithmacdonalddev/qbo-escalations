import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatusIndicator from './StatusIndicator.jsx';

const CASES = [
  ['neutral', 'Status unknown', 'neutral'],
  ['connected', 'Connected', 'success'],
  ['delayed', 'Delayed', 'warning'],
  ['attention', 'Needs attention', 'warning'],
  ['unavailable', 'Unavailable', 'neutral'],
  ['failed', 'Failed', 'danger'],
  ['syncing', 'Syncing', 'info'],
];

describe('StatusIndicator', () => {
  it.each(CASES)('renders %s with text, a non-color icon, and its governed tone', (state, label, tone) => {
    const { container } = render(<StatusIndicator state={state} />);
    const root = container.firstElementChild;

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(root).toHaveAttribute('data-tone', tone);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('is static and silent by default', () => {
    const onClick = vi.fn();
    const { container } = render(<StatusIndicator state="connected" onClick={onClick} />);
    const root = container.firstElementChild;

    fireEvent.click(root);
    expect(root).not.toHaveAttribute('role');
    expect(root).not.toHaveAttribute('aria-live');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('announces only when the parent explicitly requests it', () => {
    const { rerender } = render(<StatusIndicator state="syncing" announce="polite" />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    rerender(<StatusIndicator state="failed" announce="assertive" />);
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('supports a controlled custom status without arbitrary presentation', () => {
    const { container } = render(
      <StatusIndicator
        state="custom"
        tone="info"
        label="Queued"
        appearance="contained"
        size="compact"
        icon={<svg data-testid="custom-icon" />}
        data-purpose="background-work"
      />,
    );
    const root = container.firstElementChild;

    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    expect(root).toHaveAttribute('data-tone', 'info');
    expect(root).toHaveAttribute('data-appearance', 'contained');
    expect(root).toHaveAttribute('data-size', 'compact');
    expect(root).toHaveAttribute('data-purpose', 'background-work');
  });

  it('fails safely to neutral when a state is unknown', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<StatusIndicator state="healthy-ish" />);

    expect(screen.getByText('Status unknown')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('data-state', 'neutral');
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'neutral');
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
