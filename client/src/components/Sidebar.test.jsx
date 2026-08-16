import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import Sidebar from './Sidebar.jsx';

function renderSidebar(overrides = {}) {
  const props = {
    currentRoute: '#/chat',
    isOpen: true,
    onClose: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
    hoverExpand: true,
    onHoverExpandChange: vi.fn(),
    showLabels: false,
    onShowLabelsChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<Sidebar {...props} />), props };
}

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

it('opens a bottom settings flyout without navigating and exposes settings and docs destinations', async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, '', '/#/chat');
  renderSidebar();

  const trigger = screen.getByRole('button', { name: 'Open sidebar settings menu' });
  await user.click(trigger);

  expect(window.location.hash).toBe('#/chat');
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu', { name: 'Sidebar settings' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Open Settings' })).toHaveAttribute('href', '#/settings');
  expect(screen.getByRole('menuitem', { name: 'Design system' })).toHaveAttribute('href', '/docs');
});

it('keeps a collapsed sidebar at the same width while the settings menu opens and closes', async () => {
  vi.useFakeTimers();
  try {
    const { container } = renderSidebar({ collapsed: true, showLabels: true });
    const sidebar = container.querySelector('.sidebar');
    const trigger = screen.getByRole('button', { name: 'Open sidebar settings menu' });
    const shortLabelCount = container.querySelectorAll('.sidebar-nav-short-label').length;
    expect(shortLabelCount).toBeGreaterThan(0);

    fireEvent.mouseEnter(sidebar);
    fireEvent.click(trigger);
    await act(async () => vi.advanceTimersByTimeAsync(250));

    expect(sidebar).toHaveClass('is-collapsed', 'is-settings-open');
    expect(sidebar).not.toHaveClass('is-hover-expanded');
    expect(container.querySelectorAll('.sidebar-nav-short-label')).toHaveLength(shortLabelCount);

    fireEvent.click(trigger);

    expect(sidebar).toHaveClass('is-collapsed');
    expect(sidebar).not.toHaveClass('is-hover-expanded', 'is-settings-open');
    expect(container.querySelectorAll('.sidebar-nav-short-label')).toHaveLength(shortLabelCount);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps sidebar preferences in the flyout and leaves it open while a preference changes', async () => {
  const user = userEvent.setup();
  const { props } = renderSidebar({ hoverExpand: true, showLabels: false });
  await user.click(screen.getByRole('button', { name: 'Open sidebar settings menu' }));

  const hoverPreference = screen.getByRole('menuitemcheckbox', { name: 'Expand on hover' });
  const labelPreference = screen.getByRole('menuitemcheckbox', { name: 'Show collapsed labels' });
  expect(hoverPreference).toHaveAttribute('aria-checked', 'true');
  expect(labelPreference).toHaveAttribute('aria-checked', 'false');

  await user.click(hoverPreference);
  await user.click(labelPreference);

  expect(props.onHoverExpandChange).toHaveBeenCalledWith(false);
  expect(props.onShowLabelsChange).toHaveBeenCalledWith(true);
  expect(screen.getByRole('menu', { name: 'Sidebar settings' })).toBeVisible();
});

it('supports arrow-key movement and returns focus to the trigger after Escape', async () => {
  const user = userEvent.setup();
  renderSidebar();
  const trigger = screen.getByRole('button', { name: 'Open sidebar settings menu' });
  await user.click(trigger);

  const openSettings = screen.getByRole('menuitem', { name: 'Open Settings' });
  const designSystem = screen.getByRole('menuitem', { name: 'Design system' });
  await waitFor(() => expect(openSettings).toHaveFocus());
  fireEvent.keyDown(openSettings, { key: 'ArrowDown' });
  expect(designSystem).toHaveFocus();

  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('menu', { name: 'Sidebar settings' })).not.toBeInTheDocument();
});

it('closes the settings flyout on an outside pointer interaction', async () => {
  const user = userEvent.setup();
  renderSidebar();
  const trigger = screen.getByRole('button', { name: 'Open sidebar settings menu' });
  await user.click(trigger);
  fireEvent.pointerDown(document.body);

  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('menu', { name: 'Sidebar settings' })).not.toBeInTheDocument();
});
