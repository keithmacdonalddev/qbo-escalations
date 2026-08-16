import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TitleBlock from './TitleBlock.jsx';

describe('TitleBlock', () => {
  it('renders a deliberate heading level with optional icon and subtitle', () => {
    render(
      <TitleBlock
        as="h1"
        title="Workspace"
        subtitle="Current context"
        icon={<svg data-testid="title-icon" />}
        headingId="workspace-heading"
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Workspace' })).toHaveAttribute('id', 'workspace-heading');
    expect(screen.getByText('Current context')).toBeInTheDocument();
    expect(screen.getByTestId('title-icon').closest('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('removes optional regions and their space when content is absent', () => {
    const { container } = render(<TitleBlock title="Evidence" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Evidence' })).toBeInTheDocument();
    expect(container.querySelector('.qds-heading-block__icon')).not.toBeInTheDocument();
    expect(container.querySelector('.qds-heading-block__subtitle')).not.toBeInTheDocument();
  });

  it('normalizes controlled container treatments into a complete composition', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <TitleBlock
        title="Contained heading"
        surface="raised"
        border="subtle"
        padding="none"
        width="full"
      />,
    );
    const root = container.firstElementChild;

    expect(root).toHaveAttribute('data-surface', 'raised');
    expect(root).toHaveAttribute('data-border', 'subtle');
    expect(root).toHaveAttribute('data-padding', 'regular');
    expect(root).toHaveAttribute('data-width', 'full');
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it('does not invent interaction behavior', () => {
    const onClick = vi.fn();
    const { container } = render(<TitleBlock title="Static identity" onClick={onClick} />);

    container.firstElementChild.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
