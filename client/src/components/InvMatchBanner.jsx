import { useState, useCallback } from 'react';

const CONFIDENCE_LABELS = {
  exact: 'Exact Match',
  likely: 'Likely Match',
  possible: 'Possible Match',
};

const CONFIDENCE_COLORS = {
  exact: '#b45309',
  likely: '#d97706',
  possible: '#92400e',
};

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for older browsers
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// InvMatchBanner — shows known issue matches during triage (existing)
// ---------------------------------------------------------------------------

export default function InvMatchBanner({ matches }) {
  const [copiedInv, setCopiedInv] = useState(null);

  const handleCopy = useCallback((invNumber) => {
    copyToClipboard(invNumber).then(() => {
      setCopiedInv(invNumber);
      setTimeout(() => setCopiedInv(null), 1500);
    });
  }, []);

  if (!Array.isArray(matches) || matches.length === 0) return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.icon}>!</span>
        <span style={styles.title}>Known Issue Match</span>
        <span style={styles.count}>{matches.length} INV{matches.length > 1 ? 's' : ''} matched</span>
      </div>
      <div style={styles.matchList}>
        {matches.map((match) => (
          <div key={match._id || match.invNumber} style={styles.matchRow}>
            <div style={styles.matchTop}>
              <button
                style={styles.invNumber}
                onClick={() => handleCopy(match.invNumber)}
                title="Click to copy INV number"
              >
                {match.invNumber}
                {copiedInv === match.invNumber && (
                  <span style={styles.copiedBadge}>Copied</span>
                )}
              </button>
              <span style={{
                ...styles.confidenceBadge,
                backgroundColor: CONFIDENCE_COLORS[match.confidence] || CONFIDENCE_COLORS.possible,
              }}>
                {CONFIDENCE_LABELS[match.confidence] || 'Possible Match'}
              </span>
              {match.category && (
                <span style={styles.categoryBadge}>{match.category}</span>
              )}
            </div>
            <div style={styles.subject}>{match.subject}</div>
            {match.workaround && (
              <div style={styles.workaround}>
                <span style={styles.workaroundLabel}>Workaround:</span> {match.workaround}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={styles.instructions}>
        Give the agent the INV number. Tell them to add the customer to affected users.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DuplicateInvBanner — shows when INVs are skipped because they already exist
// ---------------------------------------------------------------------------

export function DuplicateInvBanner({ duplicates, onDismiss }) {
  if (!Array.isArray(duplicates) || duplicates.length === 0) return null;

  return (
    <div style={dupStyles.container}>
      <div style={dupStyles.header}>
        <span style={dupStyles.icon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        </span>
        <span style={dupStyles.title}>
          {duplicates.length} Duplicate{duplicates.length > 1 ? 's' : ''} Skipped
        </span>
        {onDismiss && (
          <button style={dupStyles.dismiss} onClick={onDismiss} type="button" title="Dismiss">
            &times;
          </button>
        )}
      </div>
      <div style={dupStyles.list}>
        {duplicates.map((invNum) => (
          <span key={invNum} style={dupStyles.badge}>{invNum}</span>
        ))}
      </div>
      <div style={dupStyles.note}>
        These INV numbers already exist in the database and were not re-added.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SimilarInvBanner — shows similar existing INVs after adding new ones
// ---------------------------------------------------------------------------

export function SimilarInvBanner({ matches, onDismiss }) {
  const [copiedInv, setCopiedInv] = useState(null);

  const handleCopy = useCallback((invNumber) => {
    copyToClipboard(invNumber).then(() => {
      setCopiedInv(invNumber);
      setTimeout(() => setCopiedInv(null), 1500);
    });
  }, []);

  if (!Array.isArray(matches) || matches.length === 0) return null;

  return (
    <div style={simStyles.container}>
      <div style={simStyles.header}>
        <span style={simStyles.icon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <span style={simStyles.title}>Similar Existing INVs</span>
        <span style={simStyles.count}>
          {matches.length} similar investigation{matches.length > 1 ? 's' : ''} found
        </span>
        {onDismiss && (
          <button style={simStyles.dismiss} onClick={onDismiss} type="button" title="Dismiss">
            &times;
          </button>
        )}
      </div>
      <div style={simStyles.matchList}>
        {matches.map((match) => (
          <div key={match._id || match.invNumber} style={simStyles.matchRow}>
            <div style={simStyles.matchTop}>
              <button
                style={simStyles.invNumber}
                onClick={() => handleCopy(match.invNumber)}
                title="Click to copy INV number"
              >
                {match.invNumber}
                {copiedInv === match.invNumber && (
                  <span style={styles.copiedBadge}>Copied</span>
                )}
              </button>
              <span style={{
                ...simStyles.confidenceBadge,
                backgroundColor: CONFIDENCE_COLORS[match.confidence] || CONFIDENCE_COLORS.possible,
              }}>
                {CONFIDENCE_LABELS[match.confidence] || 'Possible'}
              </span>
              {match.status && (
                <span style={simStyles.statusBadge}>{match.status}</span>
              )}
              {match.affectedCount > 0 && (
                <span style={simStyles.affectedBadge}>{match.affectedCount} affected</span>
              )}
            </div>
            <div style={simStyles.subject}>{match.subject}</div>
            {match.workaround && (
              <div style={styles.workaround}>
                <span style={styles.workaroundLabel}>Workaround:</span> {match.workaround}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={simStyles.note}>
        These existing investigations have similar scope. Consider linking them or checking for overlap.
      </div>
    </div>
  );
}

const styles = {
  container: {
    border: '2px solid #d97706',
    borderRadius: '8px',
    backgroundColor: '#fffbeb',
    padding: '12px 16px',
    marginBottom: '12px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    lineHeight: '1.45',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: '#d97706',
    color: '#fff',
    fontWeight: 700,
    fontSize: '12px',
    flexShrink: 0,
  },
  title: {
    fontWeight: 700,
    color: '#92400e',
    fontSize: '14px',
  },
  count: {
    marginLeft: 'auto',
    fontSize: '11px',
    color: '#b45309',
    fontWeight: 500,
  },
  matchList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  matchRow: {
    backgroundColor: '#fef3c7',
    borderRadius: '6px',
    padding: '8px 10px',
    border: '1px solid #fcd34d',
  },
  matchTop: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '4px',
  },
  invNumber: {
    fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", monospace',
    fontWeight: 700,
    fontSize: '13px',
    color: '#92400e',
    background: 'none',
    border: '1px solid #d97706',
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 0.15s',
  },
  copiedBadge: {
    position: 'absolute',
    top: '-18px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '10px',
    color: '#065f46',
    backgroundColor: '#d1fae5',
    padding: '1px 6px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    fontWeight: 600,
  },
  confidenceBadge: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#fff',
    padding: '2px 6px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  categoryBadge: {
    fontSize: '10px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    padding: '2px 6px',
    borderRadius: '3px',
  },
  subject: {
    color: '#1f2937',
    fontSize: '12px',
  },
  workaround: {
    marginTop: '4px',
    fontSize: '12px',
    color: '#065f46',
    backgroundColor: '#ecfdf5',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #a7f3d0',
  },
  workaroundLabel: {
    fontWeight: 600,
  },
  instructions: {
    marginTop: '8px',
    fontSize: '11px',
    color: '#6b7280',
    fontStyle: 'italic',
  },
};

// --- Duplicate banner styles ---
const dupStyles = {
  container: {
    border: '2px solid #9ca3af',
    borderRadius: '8px',
    backgroundColor: '#f9fafb',
    padding: '10px 14px',
    marginBottom: '10px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    lineHeight: '1.45',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    color: '#6b7280',
    flexShrink: 0,
  },
  title: {
    fontWeight: 700,
    color: '#374151',
    fontSize: '13px',
  },
  dismiss: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    color: '#9ca3af',
    padding: '0 4px',
    lineHeight: 1,
  },
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '6px',
  },
  badge: {
    fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", monospace',
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    backgroundColor: '#e5e7eb',
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px solid #d1d5db',
  },
  note: {
    fontSize: '11px',
    color: '#9ca3af',
    fontStyle: 'italic',
  },
};

// --- Similar match banner styles ---
const simStyles = {
  container: {
    border: '2px solid #3b82f6',
    borderRadius: '8px',
    backgroundColor: '#eff6ff',
    padding: '12px 16px',
    marginBottom: '10px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    lineHeight: '1.45',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    color: '#2563eb',
    flexShrink: 0,
  },
  title: {
    fontWeight: 700,
    color: '#1e40af',
    fontSize: '14px',
  },
  count: {
    marginLeft: 'auto',
    fontSize: '11px',
    color: '#3b82f6',
    fontWeight: 500,
  },
  dismiss: {
    marginLeft: '8px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    color: '#93c5fd',
    padding: '0 4px',
    lineHeight: 1,
  },
  matchList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  matchRow: {
    backgroundColor: '#dbeafe',
    borderRadius: '6px',
    padding: '8px 10px',
    border: '1px solid #93c5fd',
  },
  matchTop: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '4px',
  },
  invNumber: {
    fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", monospace',
    fontWeight: 700,
    fontSize: '13px',
    color: '#1e40af',
    background: 'none',
    border: '1px solid #3b82f6',
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 0.15s',
  },
  confidenceBadge: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#fff',
    padding: '2px 6px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  statusBadge: {
    fontSize: '10px',
    fontWeight: 500,
    color: '#1e40af',
    backgroundColor: '#bfdbfe',
    padding: '2px 6px',
    borderRadius: '3px',
    textTransform: 'capitalize',
  },
  affectedBadge: {
    fontSize: '10px',
    fontWeight: 500,
    color: '#92400e',
    backgroundColor: '#fef3c7',
    padding: '2px 6px',
    borderRadius: '3px',
  },
  subject: {
    color: '#1f2937',
    fontSize: '12px',
  },
  note: {
    marginTop: '8px',
    fontSize: '11px',
    color: '#6b7280',
    fontStyle: 'italic',
  },
};
