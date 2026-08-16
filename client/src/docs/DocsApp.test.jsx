import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocsApp from './DocsApp.jsx';
import { Specimen } from './DocsPages.jsx';

beforeEach(() => {
  window.history.replaceState({}, '', '/docs');
  window.scrollTo = vi.fn();
  window.requestAnimationFrame = (callback) => callback();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('DocsApp', () => {
  it('renders a real documentation home with grouped navigation and available components', async () => {
    render(<DocsApp />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Design for serious work.' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Design system sections' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: /TitleBlock/ })[0]).toHaveAttribute('href', '/docs/components/title-block');
    expect(screen.getByRole('heading', { level: 2, name: 'The Slate promise' })).toBeVisible();
  });

  it('opens a component deep link with the real production specimen and detailed contract', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/docs/components/status-indicator');
    render(<DocsApp />);

    expect(await screen.findByRole('heading', { level: 1, name: 'StatusIndicator' })).toBeVisible();
    expect(screen.getByText('Component 02 · Primitive')).toBeVisible();
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 2, name: 'Composition boundary' })).toBeVisible();
    expect(screen.getByText(/StatusSummary is a related concept, not a production component/)).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Copy code' })[0]);
    expect(screen.getByRole('button', { name: 'Code copied' })).toBeVisible();
  });

  it('preserves guidance and recovers when a specimen fails', async () => {
    const user = userEvent.setup();
    const expectedError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldFail = true;
    function RecoveringSpecimen() {
      if (shouldFail) throw new Error('Expected specimen failure');
      return <span>Restored specimen</span>;
    }
    render(<Specimen><RecoveringSpecimen /></Specimen>);

    expect(screen.getByRole('alert')).toHaveTextContent('The example could not be displayed.');
    expect(screen.getByText(/The written contract and code remain available/)).toBeVisible();

    shouldFail = false;
    await user.click(screen.getByRole('button', { name: 'Retry example' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Restored specimen')).toBeVisible();
    expectedError.mockRestore();
  });

  it('navigates between clean paths without leaving the docs shell', async () => {
    const user = userEvent.setup();
    render(<DocsApp />);

    const navigation = screen.getByRole('navigation', { name: 'Design system sections' });
    await user.click(within(navigation).getByRole('link', { name: /MetadataLine/ }));

    expect(window.location.pathname).toBe('/docs/components/metadata-line');
    expect(await screen.findByRole('heading', { level: 1, name: 'MetadataLine' })).toBeVisible();
    expect(within(navigation).getByRole('link', { name: /MetadataLine/ })).toHaveAttribute('aria-current', 'page');
  });

  it('supports local search, an honest no-results state, and keyboard result navigation', async () => {
    const user = userEvent.setup();
    render(<DocsApp />);
    await screen.findByRole('heading', { level: 1, name: 'Design for serious work.' });

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Documentation search' });
    const search = within(dialog).getByRole('searchbox', { name: 'Search documentation' });
    await user.type(search, 'nothing-matches-this');
    expect(within(dialog).getByText(/No documentation found for/)).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Clear search' }));
    await user.type(search, 'status indicator');
    const result = within(dialog).getByRole('link', { name: /StatusIndicator/ });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(result).toHaveFocus();
    await user.click(result);

    expect(window.location.pathname).toBe('/docs/components/status-indicator');
    expect(await screen.findByRole('heading', { level: 1, name: 'StatusIndicator' })).toBeVisible();
  });

  it('offers a recoverable docs-specific not-found page', async () => {
    window.history.replaceState({}, '', '/docs/components/not-real');
    render(<DocsApp />);

    expect(await screen.findByRole('heading', { level: 1, name: 'That page isn’t in the library.' })).toBeVisible();
    expect(screen.getByText('/docs/components/not-real')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open overview' })).toHaveAttribute('href', '/docs/getting-started/overview');
  });

  it('closes the mobile navigation with Escape and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(<DocsApp />);
    await screen.findByRole('heading', { level: 1, name: 'Design for serious work.' });

    const trigger = screen.getByRole('button', { name: 'Open documentation navigation' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Mobile documentation navigation' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Mobile documentation navigation' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
