import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';

const UNSUB_STORAGE_KEY = 'qbo-gmail-unsubscribed';

function getProcessedSenders() {
  try {
    return JSON.parse(localStorage.getItem(UNSUB_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setProcessedSender(domain, done) {
  const current = getProcessedSenders();
  if (done) {
    current[domain] = Date.now();
  } else {
    delete current[domain];
  }
  try {
    localStorage.setItem(UNSUB_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore storage failures
  }
  return current;
}

export function parseListUnsubscribe(header) {
  if (!header) return { url: null, mailto: null };
  let url = null;
  let mailto = null;
  const matches = header.match(/<([^>]+)>/g);
  if (matches) {
    for (const m of matches) {
      const val = m.slice(1, -1);
      if (val.startsWith('http://') || val.startsWith('https://')) {
        url = val;
      } else if (val.startsWith('mailto:')) {
        mailto = val.replace('mailto:', '');
      }
    }
  }
  return { url, mailto };
}

export default function GmailUnsubscribePanel({ apiFetch, onClose, showToast, activeAccount }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [scannedCount, setScannedCount] = useState(0);
  const [processed, setProcessed] = useState(getProcessedSenders);
  const [hideProcessed, setHideProcessed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch('/subscriptions?maxScan=300', {}, activeAccount || undefined)
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error || 'Failed to scan subscriptions');
          setLoading(false);
          return;
        }
        setSubscriptions(data.subscriptions || []);
        setScannedCount(data.scannedCount || 0);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccount, apiFetch]);

  const handleMarkProcessed = useCallback((domain) => {
    const updated = setProcessedSender(domain, !processed[domain]);
    setProcessed({ ...updated });
    showToast?.(processed[domain] ? `Unmarked ${domain}` : `Marked ${domain} as processed`);
  }, [processed, showToast]);

  const handleUnsubscribe = useCallback((sub) => {
    const { url, mailto } = parseListUnsubscribe(sub.listUnsubscribe);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      showToast?.(`Opening unsubscribe page for ${sub.domain}`);
    } else if (mailto) {
      window.open(`mailto:${mailto}?subject=Unsubscribe`, '_blank');
      showToast?.(`Opening email to unsubscribe from ${sub.domain}`);
    } else {
      showToast?.('No unsubscribe link found for this sender');
    }
  }, [showToast]);

  const processedCount = useMemo(() => {
    return subscriptions.filter((s) => processed[s.domain]).length;
  }, [subscriptions, processed]);

  const sortedSubs = useMemo(() => {
    const subs = hideProcessed ? subscriptions.filter((s) => !processed[s.domain]) : [...subscriptions];
    subs.sort((a, b) => {
      const aProc = processed[a.domain] ? 1 : 0;
      const bProc = processed[b.domain] ? 1 : 0;
      if (aProc !== bProc) return aProc - bProc;
      return b.count - a.count;
    });
    return subs;
  }, [subscriptions, processed, hideProcessed]);

  return (
    <motion.div
      className="gmail-unsub-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <motion.div
        className="gmail-unsub-panel"
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gmail-unsub-header">
          <div className="gmail-unsub-header-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <line x1="2" y1="14" x2="22" y2="14" />
              <line x1="8" y1="18" x2="16" y2="18" />
            </svg>
            <h3>Manage Subscriptions</h3>
          </div>
          <button className="gmail-btn-icon" onClick={onClose} type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="gmail-unsub-loading">
            <div className="gmail-spinner" />
            <span>Scanning recent emails for subscriptions...</span>
          </div>
        ) : error ? (
          <div className="gmail-unsub-error">
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div className="gmail-unsub-summary">
              <span>{subscriptions.length} subscription sender{subscriptions.length !== 1 ? 's' : ''} found from {scannedCount} emails scanned</span>
              {processedCount > 0 && <span className="gmail-unsub-summary-done">{processedCount} processed</span>}
            </div>

            <div className="gmail-unsub-toggle">
              <label className="gmail-unsub-toggle-label">
                <input
                  type="checkbox"
                  checked={hideProcessed}
                  onChange={(e) => setHideProcessed(e.target.checked)}
                />
                <span>Hide processed</span>
              </label>
            </div>

            <div className="gmail-unsub-list">
              {sortedSubs.length === 0 ? (
                <div className="gmail-unsub-empty">
                  {hideProcessed ? 'All senders have been processed!' : 'No subscription senders found.'}
                </div>
              ) : (
                sortedSubs.map((sub) => {
                  const isProcessed = !!processed[sub.domain];
                  const { url, mailto } = parseListUnsubscribe(sub.listUnsubscribe);
                  const hasUnsub = !!(url || mailto);

                  return (
                    <div key={sub.domain} className={`gmail-unsub-row${isProcessed ? ' is-processed' : ''}`}>
                      <div className="gmail-unsub-row-info">
                        <div className="gmail-unsub-row-top">
                          <span className="gmail-unsub-domain">{sub.domain}</span>
                          <span className="gmail-unsub-badge">{sub.count}</span>
                        </div>
                        <div className="gmail-unsub-row-meta">
                          <span className="gmail-unsub-from" title={sub.fromEmail}>{sub.fromName || sub.fromEmail}</span>
                          <span className="gmail-unsub-subject" title={sub.latestSubject}>{sub.latestSubject}</span>
                        </div>
                      </div>
                      <div className="gmail-unsub-row-actions">
                        {hasUnsub ? (
                          <button
                            className="gmail-unsub-btn"
                            onClick={() => handleUnsubscribe(sub)}
                            type="button"
                            title={url ? 'Open unsubscribe page' : `Email ${mailto} to unsubscribe`}
                          >
                            {url ? 'Unsubscribe' : 'Email to unsub'}
                          </button>
                        ) : (
                          <span className="gmail-unsub-no-link" title="No List-Unsubscribe header found">No link</span>
                        )}
                        <button
                          className={`gmail-unsub-done${isProcessed ? ' is-done' : ''}`}
                          onClick={() => handleMarkProcessed(sub.domain)}
                          type="button"
                          title={isProcessed ? 'Mark as not processed' : 'Mark as processed'}
                          aria-label={isProcessed ? 'Mark as not processed' : 'Mark as processed'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
