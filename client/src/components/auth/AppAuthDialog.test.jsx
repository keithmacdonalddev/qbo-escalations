import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppAuthProvider } from '../../context/AppAuthContext.jsx';
import AppAuthDialog from './AppAuthDialog.jsx';

const authMocks = vi.hoisted(() => ({
  beginTicketSnitchSignIn: vi.fn(),
  consumeTicketSnitchAuthReturn: vi.fn(),
  loadAppSession: vi.fn(),
  signInToApp: vi.fn(),
  signOutOfApp: vi.fn(),
}));

vi.mock('../../api/appAuth.js', () => authMocks);

beforeEach(() => {
  sessionStorage.clear();
  authMocks.beginTicketSnitchSignIn.mockReset();
  authMocks.consumeTicketSnitchAuthReturn.mockReset().mockReturnValue(null);
  authMocks.loadAppSession.mockReset().mockResolvedValue({
    ok: true,
    enabled: true,
    configured: true,
    mode: 'password',
    authenticated: false,
    user: null,
  });
  authMocks.signInToApp.mockReset().mockResolvedValue({
    ok: true,
    enabled: true,
    configured: true,
    authenticated: true,
    user: { id: 'qbo-user-1', displayName: 'Taylor QBO', email: 'taylor@example.test' },
    expiresAt: Date.now() + 60_000,
  });
  authMocks.signOutOfApp.mockReset().mockResolvedValue({ ok: true, authenticated: false });
});

it('uses the Ticket Snitch account without collecting its password in QBO', async () => {
  authMocks.loadAppSession.mockResolvedValue({
    ok: true,
    enabled: true,
    configured: true,
    mode: 'ticket-snitch',
    authenticated: false,
    user: null,
  });
  const user = userEvent.setup();
  renderDialog();
  expect(await screen.findByRole('button', { name: 'Continue to Ticket Snitch' })).toBeVisible();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Continue to Ticket Snitch' }));
  expect(authMocks.beginTicketSnitchSignIn).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem('qbo-open-report-after-sign-in')).toBe('1');
});

function renderDialog(props = {}) {
  return render(
    <AppAuthProvider>
      <AppAuthDialog open onClose={() => {}} {...props} />
    </AppAuthProvider>,
  );
}

it('shows disabled reporting identity without inventing a user', async () => {
  authMocks.loadAppSession.mockResolvedValue({ ok: true, enabled: false, configured: true, authenticated: false, user: null });
  renderDialog();
  expect(await screen.findByText('QBO sign-in is not enabled on this server.')).toBeVisible();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
});

it('shows an honest offline state and retries the session check', async () => {
  const offline = Object.assign(new Error('QBO Escalations could not reach its sign-in server.'), {
    code: 'QBO_AUTH_OFFLINE',
  });
  authMocks.loadAppSession.mockRejectedValueOnce(offline).mockResolvedValue({
    ok: true,
    enabled: false,
    configured: true,
    authenticated: false,
    user: null,
  });
  const user = userEvent.setup();
  renderDialog();
  expect(await screen.findByText('The QBO sign-in server could not be reached.')).toBeVisible();
  expect(screen.queryByText('QBO sign-in is not enabled on this server.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('QBO sign-in is not enabled on this server.')).toBeVisible();
  expect(authMocks.loadAppSession).toHaveBeenCalledTimes(2);
});

it('signs in, keeps the password masked, and reports the trusted account', async () => {
  const user = userEvent.setup();
  const onSignedIn = vi.fn();
  renderDialog({ onSignedIn });
  const password = await screen.findByLabelText('Password');
  expect(password).toHaveAttribute('type', 'password');
  await user.type(password, 'private-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(authMocks.signInToApp).toHaveBeenCalledWith('private-password'));
  expect(onSignedIn).toHaveBeenCalledOnce();
  expect(await screen.findByText('Taylor QBO')).toBeVisible();
  expect(screen.getByText('taylor@example.test')).toBeVisible();
});

it('shows a generic invalid-password error and retains a retry path', async () => {
  authMocks.signInToApp.mockRejectedValue(Object.assign(new Error('The password is incorrect.'), {
    code: 'QBO_AUTH_INVALID_CREDENTIALS',
    status: 401,
    requestId: 'invalid-auth-request',
  }));
  const user = userEvent.setup();
  renderDialog();
  await user.type(await screen.findByLabelText('Password'), 'wrong-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('That password is incorrect. Try again.')).toBeVisible();
  expect(screen.getByText('Request ID: invalid-auth-request')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

it('signs out explicitly from the visible account state', async () => {
  authMocks.loadAppSession.mockResolvedValue({
    ok: true,
    enabled: true,
    configured: true,
    authenticated: true,
    user: { id: 'qbo-user-1', displayName: 'Taylor QBO', email: '' },
  });
  const user = userEvent.setup();
  renderDialog();
  await user.click(await screen.findByRole('button', { name: 'Sign out of feedback' }));
  await waitFor(() => expect(authMocks.signOutOfApp).toHaveBeenCalledOnce());
});

it('keeps keyboard focus inside the modal until it closes', async () => {
  const user = userEvent.setup();
  renderDialog();
  const close = await screen.findByRole('button', { name: 'Close QBO account dialog' });
  const submit = screen.getByRole('button', { name: 'Sign in' });
  await waitFor(() => expect(screen.getByLabelText('Password')).toHaveFocus());
  submit.focus();
  await user.tab();
  expect(close).toHaveFocus();
  await user.tab({ shift: true });
  expect(submit).toHaveFocus();
});
