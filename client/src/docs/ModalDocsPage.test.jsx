import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import ModalPage from './ModalDocsPage.jsx';
import { findDocItem } from './docsNavigation.js';

const MODAL_ROUTE = {
  path: '/docs/components/modal',
  name: 'Modal',
};

afterEach(() => cleanup());

describe('Modal', () => {
  it('registers the searchable Available route and teaches with live production specimens', () => {
    const item = findDocItem(MODAL_ROUTE.path);

    expect(item).toMatchObject({
      path: '/docs/components/modal',
      title: MODAL_ROUTE.name,
      status: 'Available',
    });
    expect(item.searchTerms).toContain('focus trap');

    render(<ModalPage currentItem={item} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Modal' })).toBeInTheDocument();
    expect(screen.getByText('Canonical default')).toBeInTheDocument();
    expect(screen.getByText('Modal public properties')).toBeInTheDocument();
  });

  it('opens the public production component and exposes the governed dismissal result', async () => {
    const user = userEvent.setup();
    render(<ModalPage currentItem={findDocItem(MODAL_ROUTE.path)} />);

    await user.click(screen.getByRole('button', { name: 'Open canonical Modal' }));
    expect(screen.getByRole('dialog', { name: 'Review proposed change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Last dismissal: escape')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open canonical Modal' })).toHaveFocus();
  });

  it('reconfigures compact structural omission without creating alternate layer semantics', async () => {
    const user = userEvent.setup();
    render(<ModalPage currentItem={findDocItem(MODAL_ROUTE.path)} />);

    await user.selectOptions(screen.getByLabelText('Size'), 'compact');
    await user.click(screen.getByLabelText('Description'));
    await user.click(screen.getByLabelText('Footer'));
    await user.click(screen.getByRole('button', { name: 'Open configured Modal' }));

    const layer = screen.getByRole('dialog', { name: 'Review proposed change' });
    expect(layer).toHaveAttribute('data-size', 'compact');
    expect(layer).not.toHaveAttribute('aria-describedby');
    expect(document.querySelector('.qds-focus-layer__foot')).not.toBeInTheDocument();
  });
});
