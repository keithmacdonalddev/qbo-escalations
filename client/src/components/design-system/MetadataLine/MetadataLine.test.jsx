import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MetadataLine from './MetadataLine.jsx';
import { MetadataLine as ExportedMetadataLine } from '../index.js';

describe('MetadataLine', () => {
  it('renders the canonical bare facts with labels, values, and quiet separators', () => {
    const { container } = render(
      <MetadataLine
        items={[
          { label: 'Observed', value: '3 min ago' },
          { label: 'Fetched', value: '2 min ago' },
        ]}
      />,
    );

    expect(screen.getByText('Observed')).toBeVisible();
    expect(screen.getByText('3 min ago')).toBeVisible();
    expect(screen.getByText('Fetched')).toBeVisible();
    expect(screen.getByText('2 min ago')).toBeVisible();
    expect(container.querySelectorAll('.qds-metadata-line__separator')).toHaveLength(1);
    expect(container.querySelector('.qds-metadata-line__separator')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.qds-metadata-line__icon')).not.toBeInTheDocument();
  });

  it('supports a compact root, an optional decorative group icon, and semantic time values', () => {
    const { container } = render(
      <MetadataLine
        as="div"
        size="compact"
        icon={<svg data-testid="clock-icon" />}
        items={[
          {
            label: 'Last verified',
            value: 'Aug 15, 2026, 3:54 PM',
            dateTime: '2026-08-15T15:54:00-03:00',
          },
          { value: 'Local evidence' },
        ]}
        data-purpose="verification-context"
      />,
    );
    const root = container.firstElementChild;

    expect(root.tagName).toBe('DIV');
    expect(root).toHaveAttribute('data-size', 'compact');
    expect(root).toHaveAttribute('data-purpose', 'verification-context');
    expect(screen.getByTestId('clock-icon').closest('[aria-hidden="true"]')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-08-15T15:54:00-03:00');
  });

  it('warns beyond four facts but renders every value rather than hiding information', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <MetadataLine items={['One', 'Two', 'Three', 'Four', 'Five'].map((value) => ({ value }))} />,
    );

    expect(screen.getByText('Five')).toBeVisible();
    expect(container.firstElementChild).toHaveAttribute('data-fact-count', '5');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('governed for one to four facts'));
    warning.mockRestore();
  });

  it('removes invalid facts and returns no empty component when no visible values remain', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, rerender } = render(
      <MetadataLine items={[{ value: '' }, null, { label: 'Missing' }]} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(warning).toHaveBeenCalled();

    rerender(<MetadataLine items={[{ value: 0 }]} />);
    expect(screen.getByText('0')).toBeVisible();
    warning.mockRestore();
  });

  it('is static, silent, and available from the public design-system export', () => {
    const onClick = vi.fn();
    const { container } = render(
      <MetadataLine items={[{ value: 'Local evidence' }]} onClick={onClick} />,
    );
    const root = container.firstElementChild;

    fireEvent.click(root);
    expect(root).not.toHaveAttribute('aria-live');
    expect(root).not.toHaveAttribute('role', 'status');
    expect(onClick).not.toHaveBeenCalled();
    expect(ExportedMetadataLine).toBe(MetadataLine);
  });
});
