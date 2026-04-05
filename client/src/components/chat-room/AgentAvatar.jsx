import { useEffect, useMemo, useRef, useState } from 'react';

function getAgentId(agent) {
  return agent?.id || agent?._id || agent?.agentId || '';
}

function getAgentName(agent) {
  return agent?.name || agent?.profile?.displayName || getAgentId(agent) || 'Agent';
}

function getAgentProfile(agent) {
  return agent?.profile || {};
}

function getInitials(label) {
  const parts = String(label || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'AI';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export default function AgentAvatar({
  agent,
  size = 24,
  showName = false,
  interactive = false,
  onNudge,
  onAvatarRefresh,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const agentId = getAgentId(agent);
  const agentName = getAgentName(agent);
  const profile = getAgentProfile(agent);
  const avatarUrl = profile.avatarUrl || agent?.avatarUrl || '';
  const avatarEmoji = profile.avatarEmoji || agent?.avatarEmoji || '';
  const avatarPrompt = profile.avatarPrompt || agent?.avatarPrompt || '';
  const profileHref = agentId ? `#/agents/${agentId}` : '#/agents';
  const initials = useMemo(() => getInitials(agentName), [agentName]);
  const compact = size <= 20;
  const large = size >= 28;
  const roleTitle = profile.roleTitle || '';

  useEffect(() => {
    if (!menuOpen) return undefined;
    const updateMenuPosition = () => {
      const rootRect = rootRef.current?.getBoundingClientRect();
      if (!rootRect) return;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const menuWidth = menuRef.current?.offsetWidth || 240;
      const menuHeight = menuRef.current?.offsetHeight || 260;
      const gap = 10;

      let left = rootRect.left;
      if (left + menuWidth > viewportWidth - 12) {
        left = Math.max(12, rootRect.right - menuWidth);
      }
      left = Math.max(12, Math.min(left, viewportWidth - menuWidth - 12));

      let top = rootRect.bottom + gap;
      if (top + menuHeight > viewportHeight - 12) {
        top = Math.max(12, rootRect.top - menuHeight - gap);
      }
      top = Math.max(12, Math.min(top, viewportHeight - menuHeight - 12));

      setMenuPosition({ top, left });
    };

    updateMenuPosition();
    const handlePointerDown = (event) => {
      if (
        !rootRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  async function handleCopyMention() {
    if (!agentId || !navigator?.clipboard?.writeText) return;
    await navigator.clipboard.writeText(`@${agentId}`);
    setMenuOpen(false);
  }

  async function handleCopyAvatarPrompt() {
    if (!avatarPrompt || !navigator?.clipboard?.writeText) return;
    await navigator.clipboard.writeText(avatarPrompt);
    setMenuOpen(false);
  }

  const classes = [
    'agent-avatar',
    compact ? 'agent-avatar--compact' : '',
    large ? 'agent-avatar--large' : '',
    interactive ? 'agent-avatar--interactive' : '',
  ].filter(Boolean).join(' ');

  const circle = (
    <span
      className="agent-avatar-circle"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="agent-avatar-image" />
      ) : avatarEmoji ? (
        <span className="agent-avatar-emoji">{avatarEmoji}</span>
      ) : (
        <span className="agent-avatar-initials">{initials}</span>
      )}
    </span>
  );

  if (!interactive) {
    return (
      <span className={classes}>
        {circle}
        <span className="agent-avatar-hovercard" aria-hidden="true">
          <span className="agent-avatar-hovercard-name">{agentName}</span>
          {roleTitle ? (
            <span className="agent-avatar-hovercard-role">{roleTitle}</span>
          ) : null}
        </span>
        {showName ? <span className="agent-avatar-name">{agentName}</span> : null}
      </span>
    );
  }

  return (
    <span className={classes} ref={rootRef}>
      <button
        type="button"
        className="agent-avatar-trigger"
        aria-label={`${agentName} options`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen((current) => !current);
        }}
      >
        {circle}
        <span className="agent-avatar-hovercard" aria-hidden="true">
          <span className="agent-avatar-hovercard-name">{agentName}</span>
          {roleTitle ? (
            <span className="agent-avatar-hovercard-role">{roleTitle}</span>
          ) : null}
        </span>
        {showName ? <span className="agent-avatar-name">{agentName}</span> : null}
      </button>

      {menuOpen ? (
        <div
          ref={menuRef}
          className="agent-avatar-menu"
          style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
          role="menu"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="agent-avatar-menu-header">
            <span className="agent-avatar-menu-title">{agentName}</span>
            <span className="agent-avatar-menu-subtitle">{profile.roleTitle || 'Agent'}</span>
          </div>

          <button
            type="button"
            className="agent-avatar-menu-item"
            role="menuitem"
            onClick={() => {
              window.location.hash = profileHref;
              setMenuOpen(false);
            }}
          >
            View Profile
          </button>

          <button
            type="button"
            className="agent-avatar-menu-item"
            role="menuitem"
            onClick={handleCopyMention}
            disabled={!agentId}
          >
            Copy Mention
          </button>

          <button
            type="button"
            className="agent-avatar-menu-item"
            role="menuitem"
            onClick={() => {
              onNudge?.(agent);
              setMenuOpen(false);
            }}
            disabled={!onNudge}
          >
            Nudge To Chime In
          </button>

          <button
            type="button"
            className="agent-avatar-menu-item"
            role="menuitem"
            onClick={() => {
              onAvatarRefresh?.(agent);
              setMenuOpen(false);
            }}
            disabled={!onAvatarRefresh}
          >
            Ask For Fresh Avatar
          </button>

          <button
            type="button"
            className="agent-avatar-menu-item"
            role="menuitem"
            onClick={handleCopyAvatarPrompt}
            disabled={!avatarPrompt}
          >
            Copy Avatar Prompt
          </button>
        </div>
      ) : null}
    </span>
  );
}
