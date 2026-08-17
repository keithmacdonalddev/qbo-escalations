import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TitleBlock from './TitleBlock.jsx';
import { TitleBlock as ExportedTitleBlock } from '../index.js';

describe('TitleBlock', () => {
  it('renders the governed page-scale default with deliberate heading semantics', () => {
    render(<TitleBlock headingLevel={1} title="Operations workspace" />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Operations workspace' });
    expect(heading.closest('.qds-title-block')).toHaveAttribute('data-scale', 'page');
  });

  it('keeps semantic heading level independent from visual scale', () => {
    const { rerender } = render(<TitleBlock headingLevel={3} scale="fluid" title="Operational intelligence" />);
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading').closest('.qds-title-block')).toHaveAttribute('data-scale', 'fluid');

    rerender(<TitleBlock headingLevel={1} scale="section" title="Recent decisions" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading').closest('.qds-title-block')).toHaveAttribute('data-scale', 'section');
  });

  it('renders and omits the optional description without leaving placeholder markup', () => {
    const { container, rerender } = render(
      <TitleBlock headingLevel={2} title="Evidence review" description="Compare source quality before deciding." />,
    );
    expect(screen.getByText('Compare source quality before deciding.')).toHaveClass('qds-title-block__description');

    rerender(<TitleBlock headingLevel={2} title="Evidence review" />);
    expect(container.querySelector('.qds-title-block__description')).not.toBeInTheDocument();
  });

  it('requires a visible title and renders no unnamed heading', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, rerender } = render(<TitleBlock headingLevel={1} title="   " />);
    expect(container).toBeEmptyDOMElement();

    rerender(<TitleBlock headingLevel={1} title={<span>Not a string</span>} />);
    expect(container).toBeEmptyDOMElement();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('visible, non-empty string'));
    error.mockRestore();
  });

  it('falls back to page scale and h2 for unsupported governed values', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TitleBlock headingLevel={9} scale="hero" title="Safe fallback" />);

    const heading = screen.getByRole('heading', { level: 2, name: 'Safe fallback' });
    expect(heading.closest('.qds-title-block')).toHaveAttribute('data-scale', 'page');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Unsupported scale'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('headingLevel must be 1, 2, or 3'));
    warning.mockRestore();
    error.mockRestore();
  });

  it('normalizes invalid heading identifiers and keeps a valid ID on the heading', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = render(<TitleBlock headingId=" evidence-title " headingLevel={2} title="Evidence" />);
    expect(screen.getByRole('heading')).toHaveAttribute('id', 'evidence-title');

    rerender(<TitleBlock headingId="   " headingLevel={2} title="Evidence" />);
    expect(screen.getByRole('heading')).not.toHaveAttribute('id');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('headingId'));
    warning.mockRestore();
  });

  it('ignores an empty description and warns without hiding valid content', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<TitleBlock description="   " headingLevel={2} title="Evidence" />);
    expect(screen.getByRole('heading', { name: 'Evidence' })).toBeInTheDocument();
    expect(container.querySelector('.qds-title-block__description')).not.toBeInTheDocument();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('description'));
    warning.mockRestore();
  });

  it('ignores blocked styling and interaction props', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onClick = vi.fn();
    const { container } = render(
      <TitleBlock
        className="feature-title"
        style={{ color: 'pink' }}
        as="button"
        icon={<svg />}
        subtitle="Legacy subtitle"
        onClick={onClick}
        role="button"
        id="wrong-root-id"
        data-testid="escape-hatch"
        headingLevel={2}
        title="Static identity"
      >
        Alternate children
      </TitleBlock>,
    );

    const root = container.firstElementChild;
    expect(root).toHaveClass('qds-title-block');
    expect(root).not.toHaveClass('feature-title');
    expect(root).not.toHaveAttribute('style');
    expect(root).not.toHaveAttribute('role');
    expect(root).not.toHaveAttribute('id');
    expect(root).not.toHaveAttribute('data-testid');
    expect(screen.queryByText('Legacy subtitle')).not.toBeInTheDocument();
    expect(screen.queryByText('Alternate children')).not.toBeInTheDocument();
    fireEvent.click(root);
    expect(onClick).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it('is exported from the public design-system barrel', () => {
    expect(ExportedTitleBlock).toBe(TitleBlock);
  });
});
