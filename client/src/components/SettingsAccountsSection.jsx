import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ConnectedAccountCard from './connected-accounts/ConnectedAccountCard.jsx';
import AnchoredSettingsControl from './connected-accounts/AnchoredSettingsControl.jsx';
import QuestradeConnectedAccount, { QuestradeAccountDetails } from './investments/QuestradeConnectedAccount.jsx';

function GoogleLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function ChevronLeft() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9.5 4-4 4 4 4" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>;
}

function Checkmark() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3.5 8.25 2.75 2.75 6.25-6.25" /></svg>;
}

function formatAccess(value) {
  if (!value) return 'Not yet confirmed';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet confirmed';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function accountHealth(account) {
  const missingCount = account?.missingPermissions?.length || 0;
  const hasMail = Boolean(account?.lastGmailAccessAt);
  const hasCalendar = Boolean(account?.lastCalendarAccessAt);

  if (missingCount > 0) {
    return {
      key: 'partial',
      label: 'Needs attention',
      tone: 'warning',
      title: 'Access needs repair',
      description: `${missingCount} ${missingCount === 1 ? 'permission is' : 'permissions are'} missing. Repair access to restore the complete Mail and Calendar connection.`,
    };
  }
  if (hasMail && hasCalendar) {
    return {
      key: 'healthy',
      label: 'Verified',
      tone: 'connected',
      title: 'Mail and Calendar are ready',
      description: 'Both services have completed a successful access check.',
    };
  }
  if (hasMail || hasCalendar) {
    return {
      key: 'partial-verification',
      label: 'Partially verified',
      tone: 'warning',
      title: 'Verification is incomplete',
      description: hasMail
        ? 'Mail has been confirmed. Calendar has not recorded a successful access yet.'
        : 'Calendar has been confirmed. Mail has not recorded a successful access yet.',
    };
  }
  return {
    key: 'unverified',
    label: 'Not yet verified',
    tone: 'neutral',
    title: 'Access has not been verified yet',
    description: 'Permission is present, but successful Mail and Calendar use has not been recorded yet.',
  };
}

function getGoogleConnectionHealth(googleAuth, accounts) {
  if (googleAuth.loading) return { label: 'Checking', tone: 'loading', key: 'loading' };
  if (!googleAuth.connected) {
    return googleAuth.appConfigured === false
      ? { label: 'Unavailable', tone: 'unavailable', key: 'unavailable' }
      : { label: 'Not connected', tone: 'disconnected', key: 'disconnected' };
  }
  if (googleAuth.verificationError) return { label: 'Offline', tone: 'warning', key: 'offline' };
  if (accounts.some((account) => accountHealth(account).key === 'partial')) {
    return { label: 'Needs attention', tone: 'warning', key: 'partial' };
  }
  if (accounts.length > 0 && accounts.every((account) => accountHealth(account).key === 'healthy')) {
    return { label: 'Verified', tone: 'connected', key: 'healthy' };
  }
  if (accounts.some((account) => accountHealth(account).key === 'partial-verification')) {
    return { label: 'Partially verified', tone: 'warning', key: 'partial-verification' };
  }
  return { label: 'Not yet verified', tone: 'disconnected', key: 'unverified' };
}

const PURPOSES = Object.freeze([
  { kind: 'email', title: 'Inbox', description: 'Read and organize mail' },
  { kind: 'sending', title: 'Sending', description: 'Send messages and create drafts' },
  { kind: 'calendar', title: 'Calendar', description: 'Read and manage events' },
]);

const ACCOUNT_PANEL_MOTION_MS = 300;

function focusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
}

function PurposeChooser({ purpose, accounts, selectedValue, onChoose, onBack, busy, error, backRef }) {
  return (
    <section className="settings-account-chooser" aria-labelledby="account-chooser-title">
      <header className="settings-account-subview-header">
        <button ref={backRef} type="button" className="settings-account-back" onClick={onBack} disabled={busy}>
          <ChevronLeft />
          Google
        </button>
        <div>
          <h3 id="account-chooser-title">Choose {purpose.title.toLowerCase()} account</h3>
          <p>{purpose.description}. You can change this at any time.</p>
        </div>
      </header>

      {error && <p className="settings-account-inline-error" role="alert">{error}</p>}

      <div className="settings-account-choice-list" role="radiogroup" aria-label={`${purpose.title} account`}>
        <button
          type="button"
          role="radio"
          aria-checked={selectedValue === ''}
          className={selectedValue === '' ? 'is-selected' : ''}
          disabled={busy}
          onClick={() => onChoose('')}
        >
          <span><strong>Automatic</strong><small>Uses the first connected account.</small></span>
          <span className="settings-account-choice-check">{selectedValue === '' && <Checkmark />}</span>
        </button>
        {accounts.map((account) => (
          <button
            type="button"
            role="radio"
            aria-checked={selectedValue === account.email}
            className={selectedValue === account.email ? 'is-selected' : ''}
            disabled={busy}
            onClick={() => onChoose(account.email)}
            key={account.email}
          >
            <span><strong>{account.email}</strong><small>Google account</small></span>
            <span className="settings-account-choice-check">{selectedValue === account.email && <Checkmark />}</span>
          </button>
        ))}
      </div>
      {busy && <div className="settings-account-saving" role="status"><span className="settings-accounts-spinner" /> Saving choice…</div>}
    </section>
  );
}

export default function SettingsAccountsSection({
  googleAuth,
  connectedAccounts,
  selectedDefaultEmailAccount,
  selectedDefaultSendingAccount,
  selectedDefaultCalendarAccount,
  missingDefaultEmailAccount,
  missingDefaultSendingAccount,
  missingDefaultCalendarAccount,
  savedFlash,
  savingDefault,
  connectionFeedback = '',
  onGoogleConnect,
  onGoogleReauthorize,
  onGoogleDisconnect,
  onGoogleRefresh,
  googleConnecting,
  googleDisconnecting,
  googleRefreshing = false,
  onDefaultEmailAccountChange,
  onDefaultSendingAccountChange,
  onDefaultCalendarAccountChange,
  questradeConnection = null,
  initialView = 'overview',
}) {
  const [view, setView] = useState(initialView);
  const [chooserKind, setChooserKind] = useState('');
  const [choiceSaving, setChoiceSaving] = useState(false);
  const [chooserError, setChooserError] = useState('');
  const [disconnectPromptOpen, setDisconnectPromptOpen] = useState(false);
  const [panelOrigin, setPanelOrigin] = useState(null);
  const [returnFocusTarget, setReturnFocusTarget] = useState('');
  const googleOpenRef = useRef(null);
  const googleConnectRef = useRef(null);
  const questradeOpenRef = useRef(null);
  const questradeBackRef = useRef(null);
  const previousConnectedRef = useRef(googleAuth.connected);
  const detailBackRef = useRef(null);
  const chooserBackRef = useRef(null);
  const purposeButtonRefs = useRef({});
  const disconnectTriggerRef = useRef(null);
  const disconnectCancelRef = useRef(null);
  const disconnectConfirmRef = useRef(null);
  const accountModalBackdropRef = useRef(null);
  const accountModalRef = useRef(null);
  const accountModalContentRef = useRef(null);
  const closingAnimationRef = useRef(false);

  const accounts = useMemo(() => {
    if (Array.isArray(connectedAccounts) && connectedAccounts.length > 0) return connectedAccounts;
    if (!googleAuth.email) return [];
    return [{
      email: googleAuth.email,
      lastGmailAccessAt: googleAuth.lastGmailAccessAt,
      lastCalendarAccessAt: googleAuth.lastCalendarAccessAt,
      permissions: googleAuth.permissions,
      missingPermissions: googleAuth.missingPermissions,
    }];
  }, [connectedAccounts, googleAuth]);
  const connectionHealth = getGoogleConnectionHealth(googleAuth, accounts);
  const selectedValues = {
    email: selectedDefaultEmailAccount,
    sending: selectedDefaultSendingAccount,
    calendar: selectedDefaultCalendarAccount,
  };
  const missingValues = {
    email: missingDefaultEmailAccount,
    sending: missingDefaultSendingAccount,
    calendar: missingDefaultCalendarAccount,
  };
  const changeHandlers = {
    email: onDefaultEmailAccountChange,
    sending: onDefaultSendingAccountChange,
    calendar: onDefaultCalendarAccountChange,
  };
  const activePurpose = PURPOSES.find((purpose) => purpose.kind === chooserKind);
  useEffect(() => {
    const wasConnected = previousConnectedRef.current;
    previousConnectedRef.current = googleAuth.connected;

    if (view === 'questrade') return;

    if (wasConnected && !googleAuth.connected) {
      setView('overview');
      setChooserKind('');
      setDisconnectPromptOpen(false);
      window.requestAnimationFrame(() => googleConnectRef.current?.focus());
    } else if (!wasConnected && googleAuth.connected) {
      setView('overview');
      setChooserKind('');
      window.requestAnimationFrame(() => googleOpenRef.current?.focus());
    }
  }, [googleAuth.connected, view]);

  useEffect(() => {
    if (view === 'google' && !chooserKind) detailBackRef.current?.focus();
  }, [view, chooserKind]);

  useEffect(() => {
    if (chooserKind) chooserBackRef.current?.focus();
  }, [chooserKind]);

  useEffect(() => {
    if (view !== 'overview' || !returnFocusTarget) return;
    const targetRef = returnFocusTarget === 'google' ? googleOpenRef : questradeOpenRef;
    targetRef.current?.focus();
    setReturnFocusTarget('');
  }, [view, returnFocusTarget]);

  useEffect(() => {
    if (!disconnectPromptOpen) return undefined;
    disconnectCancelRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !googleDisconnecting) {
        setDisconnectPromptOpen(false);
        disconnectTriggerRef.current?.focus();
        return;
      }
      if (event.key === 'Tab') {
        const cancel = disconnectCancelRef.current;
        const confirm = disconnectConfirmRef.current;
        if (event.shiftKey && document.activeElement === cancel) {
          event.preventDefault();
          confirm?.focus();
        } else if (!event.shiftKey && document.activeElement === confirm) {
          event.preventDefault();
          cancel?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disconnectPromptOpen, googleDisconnecting]);

  useEffect(() => () => {
    accountModalRef.current?.getAnimations?.().forEach((animation) => animation.cancel());
    accountModalBackdropRef.current?.getAnimations?.().forEach((animation) => animation.cancel());
  }, []);

  useEffect(() => {
    if (view === 'overview') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (disconnectPromptOpen) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        if (chooserKind) {
          closeChooser();
        } else if (view === 'questrade') {
          closeQuestradeDetails();
        } else {
          closeGoogleDetails();
        }
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = focusableElements(accountModalRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [view, chooserKind, disconnectPromptOpen, googleDisconnecting]);

  useLayoutEffect(() => {
    if (view === 'overview') return;

    const panel = accountModalRef.current;
    const content = accountModalContentRef.current;
    if (!panel || typeof panel.animate !== 'function') return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    const finalRect = panel.getBoundingClientRect();
    const origin = panelOrigin || {
      left: finalRect.left + (finalRect.width * 0.06),
      top: finalRect.top + (finalRect.height * 0.06),
      width: finalRect.width * 0.88,
      height: finalRect.height * 0.88,
    };
    const offsetX = origin.left - finalRect.left;
    const offsetY = origin.top - finalRect.top;
    const scaleX = Math.max(0.08, origin.width / finalRect.width);
    const scaleY = Math.max(0.08, origin.height / finalRect.height);

    panel.dataset.motion = 'opening';
    const openAnimation = panel.animate([
      {
        opacity: 0.82,
        transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`,
        borderRadius: '10px',
      },
      { opacity: 1, transform: 'translate(0, 0) scale(1, 1)', borderRadius: '16px' },
    ], {
      duration: ACCOUNT_PANEL_MOTION_MS,
      easing: 'cubic-bezier(0.22, 0.82, 0.2, 1)',
    });
    openAnimation.finished
      .catch(() => undefined)
      .finally(() => {
        if (panel.dataset.motion === 'opening') delete panel.dataset.motion;
      });

    content?.animate([
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], {
      duration: 180,
      delay: 95,
      easing: 'cubic-bezier(0.22, 0.82, 0.2, 1)',
      fill: 'backwards',
    });
  }, [view, panelOrigin]);

  function rememberPanelOrigin(event, fallbackRef) {
    const source = event?.currentTarget || fallbackRef.current;
    const rect = source?.getBoundingClientRect?.();
    setPanelOrigin(rect ? {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    } : null);
  }

  function finishPanelClose(returnFocusRef) {
    closingAnimationRef.current = false;
    setReturnFocusTarget(returnFocusRef === googleOpenRef ? 'google' : 'questrade');
    setView('overview');
    setChooserKind('');
  }

  function closePanel(returnFocusRef) {
    if (closingAnimationRef.current) return;

    const panel = accountModalRef.current;
    const content = accountModalContentRef.current;
    const backdrop = accountModalBackdropRef.current;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!panel || typeof panel.animate !== 'function' || reducedMotion || !panelOrigin) {
      finishPanelClose(returnFocusRef);
      return;
    }

    closingAnimationRef.current = true;
    panel.getAnimations().forEach((animation) => animation.cancel());
    content?.getAnimations?.().forEach((animation) => animation.cancel());
    backdrop?.getAnimations?.().forEach((animation) => animation.cancel());
    panel.dataset.motion = 'closing';

    const finalRect = panel.getBoundingClientRect();
    const offsetX = panelOrigin.left - finalRect.left;
    const offsetY = panelOrigin.top - finalRect.top;
    const scaleX = Math.max(0.08, panelOrigin.width / finalRect.width);
    const scaleY = Math.max(0.08, panelOrigin.height / finalRect.height);
    content?.animate([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(6px)' },
    ], { duration: 120, easing: 'ease-in', fill: 'forwards' });
    backdrop?.animate([
      { opacity: 1 },
      { opacity: 0 },
    ], { duration: 230, easing: 'ease-in', fill: 'forwards' });
    const closeAnimation = panel.animate([
      { opacity: 1, transform: 'translate(0, 0) scale(1, 1)', borderRadius: '16px' },
      {
        opacity: 0.78,
        transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`,
        borderRadius: '10px',
      },
    ], {
      duration: 260,
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
      fill: 'forwards',
    });

    closeAnimation.finished
      .catch(() => undefined)
      .finally(() => finishPanelClose(returnFocusRef));
  }

  function openGoogleDetails(event) {
    rememberPanelOrigin(event, googleOpenRef);
    setView('google');
    setChooserKind('');
  }

  function closeGoogleDetails() {
    closePanel(googleOpenRef);
  }

  function openQuestradeDetails(event) {
    rememberPanelOrigin(event, questradeOpenRef);
    setView('questrade');
    setChooserKind('');
  }

  function closeQuestradeDetails() {
    closePanel(questradeOpenRef);
  }

  function closeChooser() {
    const previousKind = chooserKind;
    setChooserKind('');
    setChooserError('');
    window.requestAnimationFrame(() => purposeButtonRefs.current[previousKind]?.focus());
  }

  async function chooseDefault(value) {
    if (!activePurpose || choiceSaving || savingDefault) return;
    setChooserError('');
    setChoiceSaving(true);
    try {
      const saved = await changeHandlers[activePurpose.kind]?.({ target: { value } });
      if (saved === false) {
        setChooserError('That choice was not saved. Your previous account is still in use. Try again.');
        return;
      }
      closeChooser();
    } catch {
      setChooserError('That choice was not saved. Your previous account is still in use. Try again.');
    } finally {
      setChoiceSaving(false);
    }
  }

  const overview = (
      <div className="settings-panel settings-accounts-stage" data-account-view="overview">
        <header className="settings-v2-heading settings-accounts-heading">
          <div>
            <h2>Connected Accounts</h2>
            <p>Manage account access and see what each provider can do.</p>
          </div>
        </header>

        {connectionFeedback && (
          <p className="settings-accounts-feedback" role="status">
            <Checkmark />
            <span>{connectionFeedback}</span>
          </p>
        )}

        <div className="settings-accounts-grid">
          <ConnectedAccountCard
            className="google-account-card"
            icon={<GoogleLogo size={22} />}
            providerName="Google"
            providerDescription="Inbox, sending, and calendar"
            statusLabel={connectionHealth.label}
            statusTone={connectionHealth.tone}
            openButtonRef={googleOpenRef}
            onOpen={!googleAuth.loading && googleAuth.connected ? openGoogleDetails : undefined}
            openLabel="Manage"
            notice={googleAuth.appConfigured === false ? (
              <p role="status"><strong>Google sign-in needs setup.</strong><span>Configure the Google connection on the server, then refresh this page.</span></p>
            ) : undefined}
            action={!googleAuth.loading && !googleAuth.connected && googleAuth.appConfigured !== false ? (
              <button
                ref={googleConnectRef}
                className="settings-accounts-primary-action"
                onClick={onGoogleConnect}
                disabled={googleConnecting}
                type="button"
                aria-label={googleConnecting ? 'Connecting Google account' : 'Connect Google account'}
                aria-busy={googleConnecting || undefined}
              >
                {googleConnecting ? <><span className="settings-accounts-spinner" /> Connecting…</> : <>Connect</>}
              </button>
            ) : undefined}
          />
          {questradeConnection && (
            <QuestradeConnectedAccount
              connection={questradeConnection}
              onOpen={openQuestradeDetails}
              openButtonRef={questradeOpenRef}
            />
          )}
        </div>
      </div>
  );

  if (view === 'overview') {
    return overview;
  }

  function renderLayeredAccountView(content, providerName, onClose) {
    const layeredView = (
      <div
        ref={accountModalBackdropRef}
        className="settings-account-layer"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !chooserKind && !disconnectPromptOpen) onClose();
        }}
      >
        <section
          ref={accountModalRef}
          className="settings-account-sheet"
          data-provider={providerName.toLowerCase()}
          role="dialog"
          aria-modal="true"
          aria-label={`${providerName} account settings`}
        >
          <div ref={accountModalContentRef} className="settings-account-sheet-content">
            {content}
          </div>
        </section>
      </div>
    );

    return (
      <>
        <div className="settings-account-overview-underlay" aria-hidden="true" inert>
          {overview}
        </div>
        {typeof document === 'undefined' ? layeredView : createPortal(layeredView, document.body)}
      </>
    );
  }

  if (view === 'questrade') {
    return renderLayeredAccountView(
      <QuestradeAccountDetails
        connection={questradeConnection}
        onBack={closeQuestradeDetails}
        backRef={questradeBackRef}
      />,
      'Questrade',
      closeQuestradeDetails,
    );
  }

  if (activePurpose) {
    return renderLayeredAccountView(
      <div className="settings-panel settings-accounts-stage" data-account-view="chooser">
        <PurposeChooser
          purpose={activePurpose}
          accounts={accounts}
          selectedValue={selectedValues[activePurpose.kind] || ''}
          onChoose={chooseDefault}
          onBack={closeChooser}
          busy={choiceSaving || savingDefault === activePurpose.kind}
          error={chooserError}
          backRef={chooserBackRef}
        />
      </div>,
      'Google',
      closeGoogleDetails,
    );
  }

  const singleAccount = accounts.length === 1 ? accounts[0] : null;
  const singleHealth = singleAccount ? accountHealth(singleAccount) : null;
  const multiHealth = (() => {
    if (accounts.length < 2) return null;
    const healthStates = accounts.map(accountHealth);
    const repairCount = healthStates.filter((health) => health.key === 'partial').length;
    if (repairCount > 0) {
      return {
        tone: 'warning',
        ready: false,
        title: `${repairCount} ${repairCount === 1 ? 'account needs' : 'accounts need'} attention`,
        description: 'Repair the missing access shown below to restore the complete connection.',
      };
    }
    if (healthStates.every((health) => health.key === 'healthy')) {
      return {
        tone: 'connected',
        ready: true,
        title: 'All accounts are ready',
        description: `Mail and Calendar have been verified for all ${accounts.length} connected accounts.`,
      };
    }
    return {
      tone: 'neutral',
      ready: false,
      title: 'Some access is not yet verified',
      description: 'The account list below shows which services have completed a successful access check.',
    };
  })();
  const permissionsByAccount = accounts.map((account) => ({
    email: account.email,
    permissions: Array.isArray(account.permissions) && account.permissions.length > 0
      ? account.permissions
      : (googleAuth.permissions || []),
  }));

  return renderLayeredAccountView(
    <div className="settings-panel settings-accounts-stage" data-account-view="google">
      <header className="settings-account-detail-header">
        <div className="settings-account-detail-title">
          <span className="settings-account-detail-logo"><GoogleLogo size={24} /></span>
          <div><h2>Google</h2><p>Mail and Calendar for this workspace</p></div>
        </div>
        <button
          ref={detailBackRef}
          type="button"
          className="settings-account-detail-close"
          onClick={closeGoogleDetails}
          aria-label="Close Google account settings"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="settings-account-detail-surface">
        {googleAuth.verificationError ? (
          <section className="settings-account-health-summary is-offline" aria-labelledby="google-health-title">
            <div className="settings-account-health-symbol" aria-hidden="true">!</div>
            <div>
              <h3 id="google-health-title">Status could not be refreshed</h3>
              <p>Showing the last confirmed account details. Check your connection and try again.</p>
            </div>
            <button type="button" className="settings-account-secondary-action" onClick={onGoogleRefresh} disabled={googleRefreshing} aria-busy={googleRefreshing || undefined}>
              {googleRefreshing ? <><span className="settings-accounts-spinner" /> Checking…</> : 'Try again'}
            </button>
          </section>
        ) : singleHealth ? (
          <section className={`settings-account-health-summary is-${singleHealth.tone}`} aria-labelledby="google-health-title">
            <div className="settings-account-health-symbol" aria-hidden="true">{singleHealth.key === 'healthy' ? <Checkmark /> : singleHealth.key === 'unverified' ? '?' : '!'}</div>
            <div>
              <h3 id="google-health-title">{singleHealth.title}</h3>
              <p>{singleHealth.description}</p>
            </div>
            {singleHealth.key === 'partial' && (
              <button type="button" className="settings-account-secondary-action" onClick={() => onGoogleReauthorize(singleAccount.email)} disabled={googleConnecting} aria-busy={googleConnecting || undefined}>
                {googleConnecting ? <><span className="settings-accounts-spinner" /> Opening…</> : 'Repair access'}
              </button>
            )}
          </section>
        ) : multiHealth ? (
          <section className={`settings-account-health-summary is-${multiHealth.tone}`} aria-labelledby="google-health-title">
            <div className="settings-account-health-symbol" aria-hidden="true">{multiHealth.ready ? <Checkmark /> : multiHealth.tone === 'neutral' ? '?' : '!'}</div>
            <div><h3 id="google-health-title">{multiHealth.title}</h3><p>{multiHealth.description}</p></div>
          </section>
        ) : (
          <section className="settings-account-health-summary is-warning" aria-labelledby="google-health-title">
            <div className="settings-account-health-symbol" aria-hidden="true">!</div>
            <div><h3 id="google-health-title">Account details are unavailable</h3><p>Refresh the connection status before making account changes.</p></div>
            <button type="button" className="settings-account-secondary-action" onClick={onGoogleRefresh} disabled={googleRefreshing}>Try again</button>
          </section>
        )}

        {singleAccount ? (
          <section className="settings-account-section settings-account-profile" aria-labelledby="connected-google-account">
            <div className="settings-account-profile-identity">
              <span>Connected account</span>
              <h3 id="connected-google-account">{singleAccount.email}</h3>
              <p>This account handles inbox, sending, and calendar.</p>
            </div>
            <dl className="settings-account-access-evidence">
              <div><dt>Mail confirmed</dt><dd>{formatAccess(singleAccount.lastGmailAccessAt)}</dd></div>
              <div><dt>Calendar confirmed</dt><dd>{formatAccess(singleAccount.lastCalendarAccessAt)}</dd></div>
            </dl>
          </section>
        ) : accounts.length > 1 ? (
          <section className="settings-account-section" aria-labelledby="connected-google-accounts">
            <div className="settings-account-section-heading">
              <div><h3 id="connected-google-accounts">Connected accounts</h3><p>Health and last confirmed access for each account.</p></div>
            </div>
            <div className="settings-account-health-list">
              {accounts.map((account) => {
                const health = accountHealth(account);
                return (
                  <div className="settings-account-health-row" key={account.email}>
                    <div className="settings-account-health-name"><strong>{account.email}</strong><span>{health.label}</span></div>
                    <div className="settings-account-health-copy"><span>{health.description}</span><small>Mail: {formatAccess(account.lastGmailAccessAt)} · Calendar: {formatAccess(account.lastCalendarAccessAt)}</small></div>
                    {health.key === 'partial' && <button type="button" className="settings-account-text-action" onClick={() => onGoogleReauthorize(account.email)} disabled={googleConnecting}>Repair access</button>}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {accounts.length > 1 && (
          <section className="settings-account-section" aria-labelledby="account-uses-title">
            <div className="settings-account-section-heading">
              <div><h3 id="account-uses-title">Account uses</h3><p>Choose which Google account handles each kind of work.</p></div>
            </div>
            <div className="settings-account-purpose-list">
              {PURPOSES.map((purpose) => {
                const selected = selectedValues[purpose.kind];
                const missing = missingValues[purpose.kind];
                return (
                  <button
                    ref={(node) => { purposeButtonRefs.current[purpose.kind] = node; }}
                    type="button"
                    key={purpose.kind}
                    onClick={() => { setChooserError(''); setChooserKind(purpose.kind); }}
                    className={missing ? 'has-warning' : ''}
                    disabled={Boolean(savingDefault)}
                  >
                    <span><strong>{purpose.title}</strong><small>{purpose.description}</small></span>
                    <span className="settings-account-purpose-value">
                      {savedFlash === purpose.kind && <em><Checkmark /> Saved</em>}
                      <b>{missing ? 'Automatic · saved account unavailable' : selected || 'Automatic'}</b>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6.5 4.5 3.5 3.5-3.5 3.5" /></svg>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="settings-account-action-bar" role="group" aria-label="Google account actions">
          <AnchoredSettingsControl
            label="Permissions…"
            accessibleLabel="View Google permissions"
            popoverLabel="Google permissions"
            placement="start"
          >
            <strong className="anchored-settings-heading">Mail and Calendar access</strong>
            <p className="settings-account-flyout-description">Only the access listed below is requested.</p>
            <div className="settings-account-permissions">
              {permissionsByAccount.map(({ email, permissions }) => (
                <div key={email}>
                  {permissionsByAccount.length > 1 && <strong className="settings-account-permission-email">{email}</strong>}
                  <ul>
                    {permissions.map((permission) => (
                      <li key={permission.id} className={permission.granted ? '' : 'is-missing'}><span aria-hidden="true">{permission.granted ? <Checkmark /> : '!'}</span>{permission.label}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </AnchoredSettingsControl>
          <button type="button" className="settings-account-secondary-action" onClick={onGoogleConnect} disabled={googleConnecting} aria-busy={googleConnecting || undefined}>
            {googleConnecting ? <><span className="settings-accounts-spinner" /> Opening…</> : 'Add another account'}
          </button>
          <button ref={disconnectTriggerRef} type="button" className="settings-accounts-disconnect-btn" onClick={() => setDisconnectPromptOpen(true)}>Disconnect…</button>
        </div>
      </div>

      {disconnectPromptOpen && (
        <div className="settings-account-dialog-backdrop">
          <div className="settings-account-dialog" role="dialog" aria-modal="true" aria-labelledby="disconnect-dialog-title" aria-describedby="disconnect-dialog-description">
            <span className="settings-account-dialog-icon" aria-hidden="true">!</span>
            <h3 id="disconnect-dialog-title">Disconnect Google?</h3>
            <p id="disconnect-dialog-description">QBO Escalations will lose access to connected Gmail and Calendar accounts in this workspace. Your email, events, and Google account stay unchanged.</p>
            <div className="settings-account-dialog-actions">
              <button ref={disconnectCancelRef} type="button" className="settings-account-dialog-cancel" onClick={() => { setDisconnectPromptOpen(false); disconnectTriggerRef.current?.focus(); }} disabled={googleDisconnecting}>Cancel</button>
              <button ref={disconnectConfirmRef} type="button" className="settings-account-dialog-confirm" onClick={onGoogleDisconnect} disabled={googleDisconnecting} aria-busy={googleDisconnecting || undefined}>
                {googleDisconnecting ? <><span className="settings-accounts-spinner" /> Disconnecting…</> : 'Disconnect Google'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    ,
    'Google',
    closeGoogleDetails,
  );
}
