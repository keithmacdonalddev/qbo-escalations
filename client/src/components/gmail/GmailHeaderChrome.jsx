import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getAccountColor } from '../../lib/gmail/gmailInboxHelpers.jsx';

function AccountSwitcher({
  accounts,
  activeAccount,
  onSwitch,
  onAdd,
  onDisconnect,
  isUnifiedMode,
  onToggleUnified,
  unifiedUnreadTotal,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handle = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  if (!accounts || accounts.length === 0) return null;

  const activeEmail = activeAccount || (accounts[0] && accounts[0].email) || '';
  const initial = isUnifiedMode ? '*' : (activeEmail ? activeEmail[0].toUpperCase() : '?');
  const triggerLabel = isUnifiedMode ? 'All Inboxes' : activeEmail;
  const triggerBg = isUnifiedMode ? 'var(--accent)' : getAccountColor(activeEmail);

  return (
    <div className="gmail-account-switcher" ref={ref}>
      <button
        className="gmail-account-trigger"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
        title={isUnifiedMode ? 'Unified Inbox - all accounts' : `Active account: ${activeEmail}`}
        aria-label="Switch Gmail account"
      >
        <span className="gmail-account-avatar" style={{ background: triggerBg }}>
          {initial}
        </span>
        <span className="gmail-account-trigger-email">{triggerLabel}</span>
        {isUnifiedMode && unifiedUnreadTotal > 0 && (
          <span className="gmail-unified-badge">{unifiedUnreadTotal}</span>
        )}
        <svg
          className={`gmail-account-chevron${open ? ' is-open' : ''}`}
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="gmail-account-dropdown"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.12 }}
          >
            <div className="gmail-account-dropdown-header">Accounts</div>
            {accounts.length >= 2 && (
              <button
                className={`gmail-account-item${isUnifiedMode ? ' is-active' : ''}`}
                onClick={() => {
                  onToggleUnified();
                  setOpen(false);
                }}
                type="button"
              >
                <span className="gmail-account-avatar gmail-account-avatar-sm gmail-unified-avatar" style={{ background: 'var(--accent)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                  </svg>
                </span>
                <span className="gmail-account-item-email">All Inboxes</span>
                {unifiedUnreadTotal > 0 && (
                  <span className="gmail-unified-badge gmail-unified-badge-dropdown">{unifiedUnreadTotal}</span>
                )}
                {isUnifiedMode && (
                  <svg className="gmail-account-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )}
            {accounts.length >= 2 && <div className="gmail-account-divider" />}
            {accounts.map((acc) => {
              const isActive = !isUnifiedMode && acc.email === activeEmail;
              const accInitial = acc.email ? acc.email[0].toUpperCase() : '?';
              return (
                <div
                  key={acc.email}
                  className={`gmail-account-item${isActive ? ' is-active' : ''}`}
                >
                  <button
                    className="gmail-account-item-main"
                    onClick={() => {
                      if (!isActive || isUnifiedMode) {
                        onSwitch(acc.email);
                      }
                      setOpen(false);
                    }}
                    type="button"
                  >
                    <span className="gmail-account-avatar gmail-account-avatar-sm" style={{ background: getAccountColor(acc.email) }}>
                      {accInitial}
                    </span>
                    <span className="gmail-account-item-email">{acc.email}</span>
                    {isActive && (
                      <svg className="gmail-account-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                  <button
                    className="gmail-account-item-disconnect"
                    onClick={() => {
                      onDisconnect(acc.email);
                      setOpen(false);
                    }}
                    type="button"
                    title={`Disconnect ${acc.email}`}
                    aria-label={`Disconnect ${acc.email}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              );
            })}
            <button
              className="gmail-account-add"
              onClick={() => {
                onAdd();
                setOpen(false);
              }}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add another account
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function GmailHeaderChrome({
  accounts,
  activeAccount,
  profile,
  isUnifiedMode,
  unifiedUnreadTotal,
  density,
  onDensityChange,
  pageSize,
  onPageSizeChange,
  onRefresh,
  showUnsubPanel,
  onToggleSubscriptions,
  onCompose,
  showAiPanel,
  onToggleAiPanel,
  onDisconnectAccount,
  onSwitchAccount,
  onAddAccount,
  onToggleUnified,
}) {
  const [showDensityMenu, setShowDensityMenu] = useState(false);
  const densityRef = useRef(null);

  useEffect(() => {
    if (!showDensityMenu) return undefined;
    const handle = (event) => {
      if (densityRef.current && !densityRef.current.contains(event.target)) {
        setShowDensityMenu(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showDensityMenu]);

  return (
    <div className="gmail-header gmail-header-shadow">
      <div className="gmail-header-left">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        <span className="gmail-header-title">Gmail{isUnifiedMode ? ' - Unified' : ''}</span>
        {accounts.length > 0 ? (
          <AccountSwitcher
            accounts={accounts}
            activeAccount={activeAccount}
            onSwitch={onSwitchAccount}
            onAdd={onAddAccount}
            onDisconnect={onDisconnectAccount}
            isUnifiedMode={isUnifiedMode}
            onToggleUnified={onToggleUnified}
            unifiedUnreadTotal={unifiedUnreadTotal}
          />
        ) : profile && (
          <span className="gmail-header-email-badge">
            <span className="gmail-header-email-dot" />
            {profile.email}
          </span>
        )}
      </div>
      <div className="gmail-header-right">
        <div className="gmail-density-wrap" ref={densityRef}>
          <button
            className="gmail-btn-icon"
            onClick={() => setShowDensityMenu((prev) => !prev)}
            type="button"
            title="Display density"
            aria-label="Display density"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {showDensityMenu && (
            <div className="gmail-density-dropdown">
              {['comfortable', 'default', 'compact'].map((option) => (
                <button
                  key={option}
                  className={`gmail-density-option${density === option ? ' is-active' : ''}`}
                  onClick={() => {
                    onDensityChange(option);
                    setShowDensityMenu(false);
                  }}
                  type="button"
                >
                  <span className="gmail-density-check">{density === option ? '\u2713' : ''}</span>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="gmail-pagesize-wrap">
          <select
            className="gmail-pagesize-select"
            value={pageSize}
            onChange={(event) => onPageSizeChange(event.target.value)}
            title="Emails per page"
            aria-label="Emails per page"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <button className="gmail-btn-icon" onClick={onRefresh} type="button" title="Refresh" aria-label="Refresh">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </button>
        <button
          className={`gmail-btn-icon${showUnsubPanel ? ' is-active' : ''}`}
          onClick={onToggleSubscriptions}
          type="button"
          title="Manage Subscriptions"
          aria-label="Manage Subscriptions"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <line x1="2" y1="14" x2="22" y2="14" />
            <line x1="8" y1="18" x2="16" y2="18" />
          </svg>
        </button>
        <button className="gmail-btn gmail-btn-compose" onClick={onCompose} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Compose
        </button>
        <button
          className={`workspace-agent-toggle${showAiPanel ? ' is-active' : ''}`}
          onClick={onToggleAiPanel}
          type="button"
          title={showAiPanel ? 'Close Workspace Agent' : 'Open Workspace Agent'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Agent
        </button>
        <button
          className="gmail-btn gmail-btn-disconnect"
          onClick={() => onDisconnectAccount(activeAccount)}
          type="button"
          title="Disconnect Gmail account"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
