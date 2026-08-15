import { useMemo, useState } from 'react';
import SettingsAccountsSection from '../SettingsAccountsSection.jsx';
import { useQuestradeSimulation } from '../../hooks/useQuestradeSimulation.js';
import { useQuestradeConnection } from '../../hooks/useQuestradeConnection.js';
import { QuestradeAccountDetails } from '../investments/QuestradeConnectedAccount.jsx';

const PERMISSIONS = Object.freeze([
  { id: 'gmail-read', label: 'Read email and inbox details', granted: true },
  { id: 'gmail-send', label: 'Send email', granted: true },
  { id: 'gmail-compose', label: 'Create and manage drafts', granted: true },
  { id: 'gmail-organize', label: 'Organize email, labels, and filters', granted: true },
  { id: 'calendar', label: 'Read and manage calendar events', granted: true },
  { id: 'profile-email', label: 'Know which Google account is connected', granted: true },
]);

const CONFIRMED_AT = '2026-08-14T20:00:00.000Z';

function previewAccount(email, overrides = {}) {
  return {
    email,
    lastGmailAccessAt: CONFIRMED_AT,
    lastCalendarAccessAt: CONFIRMED_AT,
    permissions: PERMISSIONS,
    missingPermissions: [],
    ...overrides,
  };
}

function fixtureFor(scenario) {
  const first = previewAccount('alex@example.test');
  const second = previewAccount('jordan@example.test');

  if (scenario === 'partial') {
    const permissions = PERMISSIONS.map((permission) => (
      ['gmail-compose', 'calendar'].includes(permission.id) ? { ...permission, granted: false } : permission
    ));
    return {
      connected: true,
      appConfigured: true,
      email: first.email,
      accounts: [previewAccount(first.email, {
        lastCalendarAccessAt: null,
        permissions,
        missingPermissions: ['Create and manage drafts', 'Read and manage calendar events'],
      })],
      permissions,
      missingPermissions: ['Create and manage drafts', 'Read and manage calendar events'],
    };
  }

  if (scenario === 'unverified') {
    const account = previewAccount(first.email, { lastGmailAccessAt: null, lastCalendarAccessAt: null });
    return { connected: true, appConfigured: true, email: account.email, accounts: [account], permissions: PERMISSIONS, missingPermissions: [] };
  }

  if (scenario === 'offline') {
    return {
      connected: true,
      appConfigured: true,
      email: first.email,
      accounts: [first],
      permissions: PERMISSIONS,
      missingPermissions: [],
      verificationError: 'Google status could not be refreshed. Check your connection and try again.',
    };
  }

  if (scenario === 'disconnected') {
    return {
      connected: false,
      appConfigured: true,
      email: null,
      accounts: [],
      permissions: [],
      missingPermissions: [],
    };
  }

  if (scenario === 'multiple' || scenario === 'save-error' || scenario === 'save-waiting') {
    return {
      connected: true,
      appConfigured: true,
      email: first.email,
      accounts: [first, second],
      permissions: PERMISSIONS,
      missingPermissions: [],
    };
  }

  return {
    connected: true,
    appConfigured: true,
    email: first.email,
    accounts: [first],
    permissions: PERMISSIONS,
    missingPermissions: [],
  };
}

function LiveAccountsPreview({ googleProps, initialView = 'overview' }) {
  const connection = useQuestradeConnection();

  return (
    <div data-development-only="connected-accounts-preview">
      <SettingsAccountsSection {...googleProps} questradeConnection={connection} initialView={initialView} />
    </div>
  );
}

function SimulatedAccountsPreview({ googleProps, initialView = 'overview' }) {
  const connection = useQuestradeSimulation();
  return (
    <div data-development-only="connected-accounts-preview">
      <SettingsAccountsSection {...googleProps} questradeConnection={connection} initialView={initialView} />
    </div>
  );
}

function GoogleAccountsPreview({ scenario, initialView = 'overview' }) {
  const questradeConnection = useQuestradeSimulation();
  const initialFixture = useMemo(() => fixtureFor(scenario), [scenario]);
  const [googleAuth, setGoogleAuth] = useState(initialFixture);
  const [defaults, setDefaults] = useState({ email: '', sending: '', calendar: '' });
  const [savingDefault, setSavingDefault] = useState('');
  const [savedFlash, setSavedFlash] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectionFeedback, setConnectionFeedback] = useState('');

  async function saveDefault(kind, event) {
    setSavingDefault(kind);
    await new Promise((resolve) => window.setTimeout(resolve, scenario === 'save-waiting' ? 4000 : 420));
    setSavingDefault('');
    if (scenario === 'save-error') return false;
    setDefaults((current) => ({ ...current, [kind]: event.target.value }));
    setSavedFlash(kind);
    return true;
  }

  async function refresh() {
    setRefreshing(true);
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    setGoogleAuth(fixtureFor('single'));
    setRefreshing(false);
  }

  async function connect() {
    setConnectionFeedback('');
    setConnecting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 1400));
    setGoogleAuth(fixtureFor('single'));
    setConnectionFeedback('Google is connected again. Mail and Calendar access has been restored.');
    setConnecting(false);
  }

  async function disconnect() {
    setDisconnecting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 1400));
    setGoogleAuth(fixtureFor('disconnected'));
    setConnectionFeedback('Google access was removed from this workspace. You can connect again at any time.');
    setDisconnecting(false);
  }

  return (
    <div data-development-only="connected-accounts-preview">
      <SettingsAccountsSection
        googleAuth={{ loading: false, ...googleAuth }}
        connectedAccounts={googleAuth.accounts}
        selectedDefaultEmailAccount={defaults.email}
        selectedDefaultSendingAccount={defaults.sending}
        selectedDefaultCalendarAccount={defaults.calendar}
        missingDefaultEmailAccount={false}
        missingDefaultSendingAccount={false}
        missingDefaultCalendarAccount={false}
        savedFlash={savedFlash}
        savingDefault={savingDefault}
        connectionFeedback={connectionFeedback}
        onGoogleConnect={connect}
        onGoogleReauthorize={() => {}}
        onGoogleDisconnect={disconnect}
        onGoogleRefresh={refresh}
        googleConnecting={connecting}
        googleDisconnecting={disconnecting}
        googleRefreshing={refreshing}
        onDefaultEmailAccountChange={(event) => saveDefault('email', event)}
        onDefaultSendingAccountChange={(event) => saveDefault('sending', event)}
        onDefaultCalendarAccountChange={(event) => saveDefault('calendar', event)}
        questradeConnection={questradeConnection}
        initialView={initialView}
      />
    </div>
  );
}

export function QuestradeSimulation() {
  const connection = useQuestradeSimulation();
  return <QuestradeAccountDetails connection={connection} simulator embedded />;
}

export default function ConnectedAccountsPreview({ scenario = 'live', googleProps }) {
  const initialView = scenario === 'questrade' ? 'questrade' : 'overview';
  if (scenario === 'live') return <LiveAccountsPreview googleProps={googleProps} initialView={initialView} />;
  if (scenario === 'questrade') return <SimulatedAccountsPreview googleProps={googleProps} initialView={initialView} />;
  return <GoogleAccountsPreview scenario={scenario} initialView={initialView} />;
}
