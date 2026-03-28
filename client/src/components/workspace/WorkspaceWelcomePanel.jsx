export default function WorkspaceWelcomePanel({
  compact = false,
  quickActions = [],
  onQuickAction,
}) {
  return (
    <div className={`workspace-agent-welcome${compact ? ' is-compact' : ''}`}>
      <div className="workspace-agent-welcome-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </div>
      <p className="workspace-agent-welcome-text">
        I can manage your email and calendar. Send emails, create events, search your inbox, check your schedule, and more.
      </p>
      <div className="workspace-agent-quick-actions">
        {quickActions.map((action, i) => (
          <button
            key={i}
            className="workspace-agent-quick-btn"
            onClick={() => onQuickAction?.(action.prompt)}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
