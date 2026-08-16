import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import Button from './Button.jsx';
import { Button as ExportedButton } from '../index.js';

describe('Button', () => {
  it('renders the governed native secondary medium default', () => {
    render(<Button>Review details</Button>);

    const button = screen.getByRole('button', { name: 'Review details' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-priority', 'secondary');
    expect(button).toHaveAttribute('data-tone', 'neutral');
    expect(button).toHaveAttribute('data-size', 'medium');
    expect(button).not.toBeDisabled();
  });

  it('combines priority, tone, size, and width without flattening state into a variant', () => {
    render(<Button priority="primary" tone="destructive" size="large" fullWidth>Delete item</Button>);

    const button = screen.getByRole('button', { name: 'Delete item' });
    expect(button).toHaveAttribute('data-priority', 'primary');
    expect(button).toHaveAttribute('data-tone', 'destructive');
    expect(button).toHaveAttribute('data-size', 'large');
    expect(button).toHaveAttribute('data-full-width', 'true');
  });

  it('renders both width-reservation states and keeps focus, busy semantics, and the click guard through loading', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button loadingLabel="Saving changes…" onClick={onClick}>Save changes</Button>);
    const restingButton = screen.getByRole('button');
    restingButton.focus();
    const restingWidthStates = screen.getByRole('button').querySelectorAll('.qds-button__state');

    expect(restingWidthStates).toHaveLength(2);
    rerender(<Button loading loadingLabel="Saving changes…" onClick={onClick}>Save changes</Button>);

    const button = screen.getByRole('button', { name: 'Saving changes…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    expect(button.querySelectorAll('.qds-button__state')).toHaveLength(2);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('uses native Enter and Space activation once while active and blocks both while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save changes</Button>);
    let button = screen.getByRole('button', { name: 'Save changes' });
    button.focus();

    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);

    rerender(<Button loading loadingLabel="Saving changes…" onClick={onClick}>Save changes</Button>);
    button = screen.getByRole('button', { name: 'Saving changes…' });
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('preserves explicit native submit and reset behavior', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event) => event.preventDefault());
    const { rerender } = render(<form onSubmit={onSubmit}><Button type="submit">Save changes</Button></form>);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    rerender(<form><input aria-label="Example field" defaultValue="Original" /><Button type="reset">Reset form</Button></form>);
    const field = screen.getByRole('textbox', { name: 'Example field' });
    await user.clear(field);
    await user.type(field, 'Changed');
    await user.click(screen.getByRole('button', { name: 'Reset form' }));
    expect(field).toHaveValue('Original');
  });

  it('uses native disabled behavior when unavailable and does not call the action', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Continue</Button>);

    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('gives loading precedence over contradictory disabled input', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Button loading disabled loadingLabel="Saving changes…">Save changes</Button>);

    const button = screen.getByRole('button', { name: 'Saving changes…' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Loading takes precedence'));
    warning.mockRestore();
  });

  it('falls back from invalid controlled values and reports the contract error in development', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Button priority="loud" tone="success" size="hero" type="magic">Save changes</Button>);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-priority', 'secondary');
    expect(button).toHaveAttribute('data-tone', 'neutral');
    expect(button).toHaveAttribute('data-size', 'medium');
    expect(button).toHaveAttribute('type', 'button');
    expect(warning).toHaveBeenCalledTimes(4);
    warning.mockRestore();
  });

  it('requires visible text and keeps an optional icon decorative', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, rerender } = render(<Button>{null}</Button>);
    expect(container).toBeEmptyDOMElement();

    rerender(<Button icon={<svg data-testid="button-icon" />} iconPosition="trailing">Continue</Button>);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByTestId('button-icon').closest('[aria-hidden="true"]')).toBeInTheDocument();
    warning.mockRestore();
  });

  it('ignores a non-element icon instead of creating an ungoverned text slot', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Button icon="decorative text">Continue</Button>);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(document.querySelector('.qds-button__icon')).not.toBeInTheDocument();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('one passive inline SVG tree'));
    warning.mockRestore();
  });

  it('rejects interactive, focusable, event-bearing, or opaque component icon trees', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alternateAction = vi.fn();
    const OpaqueIcon = () => <svg />;
    const { rerender } = render(<Button icon={<svg onClick={alternateAction} />}>Continue</Button>);

    expect(document.querySelector('.qds-button__icon')).not.toBeInTheDocument();
    rerender(<Button icon={<svg><a href="/elsewhere"><path /></a></svg>}>Continue</Button>);
    expect(document.querySelector('.qds-button__icon')).not.toBeInTheDocument();
    rerender(<Button icon={<svg tabIndex="0"><path /></svg>}>Continue</Button>);
    expect(document.querySelector('.qds-button__icon')).not.toBeInTheDocument();
    rerender(<Button icon={<OpaqueIcon />}>Continue</Button>);
    expect(document.querySelector('.qds-button__icon')).not.toBeInTheDocument();
    expect(alternateAction).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(4);
    warning.mockRestore();
  });

  it('forwards refs and safe native attributes', () => {
    const ref = createRef();
    render(<Button ref={ref} id="save-button" name="save" form="settings-form" data-testid="safe-button" aria-describedby="save-help">Save changes</Button>);

    expect(ref.current).toBe(screen.getByRole('button'));
    expect(ref.current).toHaveAttribute('id', 'save-button');
    expect(ref.current).toHaveAttribute('name', 'save');
    expect(ref.current).toHaveAttribute('form', 'settings-form');
    expect(ref.current).toHaveAttribute('data-testid', 'safe-button');
    expect(ref.current).toHaveAttribute('aria-describedby', 'save-help');
  });

  it('ignores styling and semantic escape hatches', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alternateAction = vi.fn();
    render(
      <Button
        className="feature-button"
        style={{ color: 'pink' }}
        as="a"
        href="/elsewhere"
        role="switch"
        aria-label="Different action"
        aria-disabled="true"
        aria-hidden="true"
        aria-pressed="true"
        tabIndex={-1}
        onDoubleClick={alternateAction}
        onKeyDown={alternateAction}
      >
        Save changes
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toHaveClass('qds-button');
    expect(button).not.toHaveClass('feature-button');
    expect(button).not.toHaveAttribute('style');
    expect(button).not.toHaveAttribute('href');
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-hidden');
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(button).not.toHaveAttribute('tabindex');
    fireEvent.doubleClick(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(alternateAction).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it('is exported from the design-system barrel', () => {
    expect(ExportedButton).toBe(Button);
  });
});
