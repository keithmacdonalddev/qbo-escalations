export default function ChatConversationChrome({
  linkedEscalation,
  handleResolveEscalation,
  resolvingEscalation,
  forkInfo,
  children,
}) {
  return (
    <>
      {linkedEscalation && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-3)',
          padding: 'var(--sp-2) var(--sp-5)',
          background: 'var(--bg-sunken)',
          borderBottom: '1px solid var(--line)',
          fontSize: 'var(--text-sm)',
        }}>
          <span className={`badge badge-${linkedEscalation.status === 'open' ? 'open' : linkedEscalation.status === 'in-progress' ? 'progress' : linkedEscalation.status === 'resolved' ? 'resolved' : 'escalated'}`}>
            {linkedEscalation.status}
          </span>
          <span style={{ flex: 1, color: 'var(--ink-secondary)' }}>
            Linked escalation
            {linkedEscalation.coid && <span className="mono" style={{ marginLeft: 'var(--sp-2)' }}>COID: {linkedEscalation.coid}</span>}
            {linkedEscalation.category && (
              <span className={`cat-badge cat-${linkedEscalation.category}`} style={{ marginLeft: 'var(--sp-2)', fontSize: 'var(--text-xs)' }}>
                {linkedEscalation.category.replace('-', ' ')}
              </span>
            )}
          </span>
          {linkedEscalation.status !== 'resolved' && (
            <button
              className="btn btn-sm btn-primary"
              onClick={handleResolveEscalation}
              disabled={resolvingEscalation}
              type="button"
            >
              {resolvingEscalation ? 'Resolving...' : 'Mark Resolved'}
            </button>
          )}
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => { window.location.hash = '#/dashboard'; }}
            type="button"
          >
            View
          </button>
        </div>
      )}

      {forkInfo && (
        <div className="fork-banner">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 01-9 9" />
          </svg>
          <span>
            Forked from message #{(forkInfo.forkMessageIndex ?? 0) + 1} of{' '}
            <a
              className="fork-banner-link"
              onClick={() => { window.location.hash = `#/chat/${forkInfo.forkedFrom}`; }}
              style={{ cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
            >
              parent conversation
            </a>
          </span>
        </div>
      )}

      {children}
    </>
  );
}
