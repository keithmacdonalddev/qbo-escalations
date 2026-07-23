import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Sidebar from './Sidebar.jsx';

it('announces live badge counts and links Attention to its actionable view', () => {
  render(
    <Sidebar
      currentRoute="#/chat"
      isOpen
      onClose={vi.fn()}
      collapsed={false}
      onToggleCollapse={vi.fn()}
      hoverExpand={false}
      showLabels
      badges={{
        '#/attention': { count: 3, tone: 'attention', label: 'open attention item' },
        '#/knowledge': { count: 2, tone: 'review', label: 'knowledge review item' },
      }}
    />,
  );

  const attention = screen.getByRole('link', { name: 'Attention, 3 open attention items' });
  expect(attention).toHaveAttribute('href', '#/attention');
  expect(attention).toHaveTextContent('3');
  const knowledge = screen.getByRole('link', { name: 'Knowledge, 2 knowledge review items' });
  expect(knowledge).toHaveAttribute('href', '#/knowledge');
  expect(knowledge).toHaveTextContent('2');
});
