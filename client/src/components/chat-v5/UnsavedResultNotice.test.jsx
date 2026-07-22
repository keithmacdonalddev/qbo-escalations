import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnsavedResultNotice from './UnsavedResultNotice.jsx';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(window.URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(window.URL, 'revokeObjectURL');

function restoreProperty(target, property, descriptor) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    delete target[property];
  }
}

function readBlobAsText(blob) {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}

afterEach(() => {
  restoreProperty(navigator, 'clipboard', originalClipboard);
  restoreProperty(window.URL, 'createObjectURL', originalCreateObjectURL);
  restoreProperty(window.URL, 'revokeObjectURL', originalRevokeObjectURL);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('UnsavedResultNotice', () => {
  it('shows the Not saved label and the save failure message', () => {
    render(
      <UnsavedResultNotice
        text="Visible analyst answer"
        error="The analyst answer could not be saved."
        onDismiss={() => {}}
        resultLabel="analyst answer"
        ariaLabel="Analyst answer not saved"
      />,
    );

    const notice = screen.getByRole('region', { name: 'Analyst answer not saved' });
    expect(screen.getByText('Not saved')).toBeVisible();
    expect(screen.getByText('The analyst answer could not be saved.')).toBeVisible();
    expect(notice).toContainElement(screen.getByRole('button', { name: 'Copy' }));
  });

  it('copies the exact visible result text through the clipboard API', async () => {
    const user = userEvent.setup();
    const text = 'Triage result line one\nExact visible line two';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<UnsavedResultNotice text={text} error="Save failed." onDismiss={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(text);
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('downloads the exact visible content through a Blob without a network or AI call', async () => {
    const user = userEvent.setup();
    const text = 'Unsaved answer preserved exactly.\nSecond line.';
    const createObjectURL = vi.fn(() => 'blob:unsaved-result');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    let clickedLink;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clickedLink = this;
    });
    render(
      <UnsavedResultNotice
        text={text}
        error="Save failed."
        onDismiss={() => {}}
        downloadName="unsaved-analyst-answer.txt"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    const [blob] = createObjectURL.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain;charset=utf-8');
    await expect(readBlobAsText(blob)).resolves.toBe(text);
    expect(clickedLink.download).toBe('unsaved-analyst-answer.txt');
    expect(clickedLink.href).toBe('blob:unsaved-result');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:unsaved-result');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Downloaded');
  });

  it('requires confirmation before dismissing the warning', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<UnsavedResultNotice text="Only copy" error="Save failed." onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Triage card not saved' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
