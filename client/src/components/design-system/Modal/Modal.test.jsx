import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Modal from './Modal.jsx';
import { Modal as ExportedModal } from '../index.js';

function ControlledModal({ initialFocusRef, onReason = () => {}, size = 'regular' }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="background">
      <button type="button" onClick={() => setOpen(true)}>Open task</button>
      <Modal
        open={open}
        title="Review escalation"
        description="Confirm the bounded handoff."
        size={size}
        initialFocusRef={initialFocusRef}
        onRequestClose={(reason) => {
          onReason(reason);
          setOpen(false);
        }}
        footer={<button type="button">Save handoff</button>}
      >
        <label htmlFor="note">Note</label>
        <input id="note" />
      </Modal>
    </div>
  );
}

afterEach(() => {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
  [...document.body.children].forEach((element) => {
    element.removeAttribute('inert');
    element.removeAttribute('aria-hidden');
  });
});

describe('Modal', () => {
  it('renders the regular accessible boundary through the public export', () => {
    expect(ExportedModal).toBe(Modal);
    render(
      <Modal open title="Review escalation" description="Confirm the handoff." onRequestClose={() => {}}>
        <p>Case details</p>
      </Modal>,
    );

    const layer = screen.getByRole('dialog', { name: 'Review escalation' });
    expect(layer).toHaveAttribute('aria-modal', 'true');
    expect(layer).toHaveAttribute('data-size', 'regular');
    expect(layer).toHaveAccessibleDescription('Confirm the handoff.');
    expect(layer).toHaveFocus();
  });

  it('rejects an incomplete accessible boundary', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = render(<Modal open title="" onRequestClose={() => {}}><p>Content</p></Modal>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<Modal open title="Named"><p>Content</p></Modal>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('title must be a visible, non-empty string'));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('onRequestClose must be a function'));
    warning.mockRestore();
  });

  it('reports each governed dismissal reason', () => {
    const onRequestClose = vi.fn();
    render(<Modal open title="Review escalation" onRequestClose={onRequestClose}><p>Content</p></Modal>);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onRequestClose).toHaveBeenLastCalledWith('escape');

    const veil = document.querySelector('.qds-focus-veil');
    fireEvent.pointerDown(veil);
    fireEvent.pointerUp(veil);
    expect(onRequestClose).toHaveBeenLastCalledWith('backdrop');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onRequestClose).toHaveBeenLastCalledWith('close-button');
    expect(onRequestClose).toHaveBeenCalledTimes(3);
  });

  it('requires pointer down and up on the veil before requesting dismissal', () => {
    const onRequestClose = vi.fn();
    render(<Modal open title="Review escalation" onRequestClose={onRequestClose}><p>Content</p></Modal>);
    const veil = document.querySelector('.qds-focus-veil');
    const layer = screen.getByRole('dialog');

    fireEvent.pointerDown(layer);
    fireEvent.pointerUp(veil);
    fireEvent.pointerDown(veil);
    fireEvent.pointerUp(layer);
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it('contains keyboard focus and restores the opener', async () => {
    const user = userEvent.setup();
    render(<ControlledModal />);
    const opener = screen.getByRole('button', { name: 'Open task' });
    await user.click(opener);

    const layer = screen.getByRole('dialog');
    expect(layer).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Save handoff' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('honors a valid contained initial focus reference', () => {
    const target = createRef();
    render(
      <Modal open title="Review escalation" initialFocusRef={target} onRequestClose={() => {}}>
        <button ref={target} type="button">Begin review</button>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Begin review' })).toHaveFocus();
  });

  it('falls back from a hidden initial target and preserves current focus when the close callback identity changes', () => {
    const target = createRef();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = render(
      <Modal open title="Review escalation" initialFocusRef={target} onRequestClose={() => {}}>
        <button ref={target} style={{ display: 'none' }} type="button">Hidden action</button>
        <input aria-label="Review note" />
      </Modal>,
    );

    const layer = screen.getByRole('dialog');
    expect(layer).toHaveFocus();
    const note = screen.getByRole('textbox', { name: 'Review note' });
    note.focus();
    rerender(
      <Modal open title="Review escalation" initialFocusRef={target} onRequestClose={vi.fn()}>
        <button ref={target} style={{ display: 'none' }} type="button">Hidden action</button>
        <input aria-label="Review note" />
      </Modal>,
    );
    expect(note).toHaveFocus();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('initialFocusRef must point to a visible, enabled target'));
    warning.mockRestore();
  });

  it('locks page scroll and makes background content inert', () => {
    render(<ControlledModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }));

    const appRoot = screen.getByTestId('background').parentElement;
    expect(document.body.style.overflow).toBe('hidden');
    expect(appRoot).toHaveAttribute('inert');
    expect(appRoot).toHaveAttribute('aria-hidden', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
    expect(appRoot).not.toHaveAttribute('inert');
    expect(appRoot).not.toHaveAttribute('aria-hidden');
  });

  it('blocks a second simultaneous layer', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <>
        <Modal open title="First task" onRequestClose={() => {}}><p>First</p></Modal>
        <Modal open title="Second task" onRequestClose={() => {}}><p>Second</p></Modal>
      </>,
    );

    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByRole('dialog', { name: 'First task' })).toBeInTheDocument();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('second simultaneous Modal'));
    warning.mockRestore();
  });

  it('falls back from an unsupported size and ignores semantic or styling escape hatches', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <Modal
        open
        title="Review escalation"
        size="wide"
        className="feature-shell"
        role="alertdialog"
        aria-label="Override"
        onRequestClose={() => {}}
      >
        <p>Content</p>
      </Modal>,
    );

    const layer = screen.getByRole('dialog', { name: 'Review escalation' });
    expect(layer).toHaveAttribute('data-size', 'regular');
    expect(layer).not.toHaveClass('feature-shell');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Unsupported size'));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('className is not part'));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('role is not part'));
    warning.mockRestore();
  });

  it('omits invalid optional description and footer data without weakening the task boundary', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <Modal open title="Review escalation" description="  " footer="Save" onRequestClose={() => {}}>
        <p>Content</p>
      </Modal>,
    );

    const layer = screen.getByRole('dialog', { name: 'Review escalation' });
    expect(layer).not.toHaveAttribute('aria-describedby');
    expect(document.querySelector('.qds-focus-layer__foot')).not.toBeInTheDocument();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('description must be a non-empty string'));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('footer must contain one ReactElement'));
    warning.mockRestore();
  });
});
