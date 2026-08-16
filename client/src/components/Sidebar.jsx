import './Sidebar.css';
import { useState, useEffect, useCallback, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { onCircuitChange } from '../api/http.js';
import { transitions } from '../utils/motion.js';

const NAV_ITEMS = [
  { hash: '#/chat', label: 'Chat', short: 'Chat', icon: IconChat },
  { hash: '#/sessions', label: 'Sessions', short: 'Sess', icon: IconSessions },
  { hash: '#/escalations', label: 'Escalations', short: 'Esc', icon: IconDashboard },
  { hash: '#/attention', label: 'Attention', short: 'Need', icon: IconAttention },
  { hash: '#/knowledge', label: 'Knowledge', short: 'Know', icon: IconKnowledge },
  { hash: '#/investigations', label: 'Investigations', short: 'INV', icon: IconInvestigation },
  { hash: '#/agents', label: 'Agents', short: 'Agt', icon: IconUsers },
  { hash: '#/playbook', label: 'Playbook', short: 'Book', icon: IconBook },
  { hash: '#/templates', label: 'Templates', short: 'Tmpl', icon: IconTemplate },
  { hash: '#/analytics', label: 'Analytics', short: 'Stats', icon: IconChart },
  { hash: '#/gallery', label: 'Gallery', short: 'Gal', icon: IconImage },
  { hash: '#/usage', label: 'Usage', short: 'Usage', icon: IconDollar },
  { hash: '#/workspace', label: 'Workspace', short: 'Work', icon: IconWorkspace },
  { hash: '#/rooms', label: 'Rooms', short: 'Rm', icon: IconRooms },
];

export default function Sidebar({
  currentRoute,
  isOpen,
  onClose,
  collapsed,
  onToggleCollapse,
  hoverExpand,
  onHoverExpandChange,
  showLabels,
  onShowLabelsChange,
  extraNavItems = [],
  badges = {},
}) {
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPosition, setSettingsPosition] = useState(null);
  const hoverTimerRef = useRef(null);
  const mouseOverRef = useRef(false);
  const collapsibleRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const settingsFlyoutRef = useRef(null);
  const settingsFlyoutId = useId();
  const [circuitState, setCircuitState] = useState({ status: 'closed', failures: 0 });
  const navItems = [...NAV_ITEMS, ...extraNavItems.map((item) => ({ ...item, icon: item.icon || IconTerminal }))];
  const visuallyExpanded = hoverExpanded || settingsOpen;

  const handleMouseEnter = useCallback(() => {
    mouseOverRef.current = true;
    if (!collapsed || !hoverExpand) return;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverExpanded(true), 200);
  }, [collapsed, hoverExpand]);

  const handleMouseLeave = useCallback(() => {
    mouseOverRef.current = false;
    clearTimeout(hoverTimerRef.current);
    if (settingsOpen) return;
    hoverTimerRef.current = setTimeout(() => setHoverExpanded(false), 300);
  }, [settingsOpen]);

  // When collapsed changes, reset hover state or re-trigger if mouse is still over
  useEffect(() => {
    if (!collapsed) {
      setHoverExpanded(false);
    } else if (mouseOverRef.current && hoverExpand) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => setHoverExpanded(true), 200);
    }
  }, [collapsed, hoverExpand]);

  useEffect(() => onCircuitChange(setCircuitState), []);

  useEffect(() => {
    if (settingsOpen || mouseOverRef.current) return;
    clearTimeout(hoverTimerRef.current);
    setHoverExpanded(false);
  }, [settingsOpen]);

  useLayoutEffect(() => {
    if (!settingsOpen) {
      setSettingsPosition(null);
      return undefined;
    }

    const updatePosition = () => {
      const trigger = settingsTriggerRef.current;
      const flyout = settingsFlyoutRef.current;
      if (!trigger || !flyout) return;

      const triggerRect = trigger.getBoundingClientRect();
      const flyoutRect = flyout.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const edge = 12;
      const gap = 8;
      const isMobileDrawer = viewportWidth <= 900;
      const width = isMobileDrawer
        ? Math.min(triggerRect.width, viewportWidth - (edge * 2))
        : Math.min(272, viewportWidth - (edge * 2));
      const measuredHeight = flyoutRect.height;
      const maxTop = Math.max(edge, viewportHeight - measuredHeight - edge);
      const top = Math.min(Math.max(edge, triggerRect.bottom - measuredHeight), maxTop);

      if (isMobileDrawer) {
        const drawerTop = Math.min(
          Math.max(edge, triggerRect.top - measuredHeight - gap),
          maxTop,
        );
        setSettingsPosition({
          left: Math.min(Math.max(edge, triggerRect.left), viewportWidth - width - edge),
          top: drawerTop,
          width,
          placement: 'drawer',
        });
        return;
      }

      const preferredRight = triggerRect.right + gap;
      const preferredLeft = triggerRect.left - width - gap;
      const left = preferredRight + width <= viewportWidth - edge
        ? preferredRight
        : Math.max(edge, preferredLeft);
      setSettingsPosition({ left, top, width, placement: 'side' });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [settingsOpen, visuallyExpanded]);

  useEffect(() => {
    if (!settingsOpen) return undefined;

    const focusFirstItem = window.requestAnimationFrame(() => {
      settingsFlyoutRef.current?.querySelector('[role^="menuitem"]')?.focus();
    });
    const closeWithoutFocusReturn = () => setSettingsOpen(false);
    const handlePointerDown = (event) => {
      if (settingsTriggerRef.current?.contains(event.target) || settingsFlyoutRef.current?.contains(event.target)) return;
      closeWithoutFocusReturn();
    };
    const handleFocusIn = (event) => {
      if (settingsTriggerRef.current?.contains(event.target) || settingsFlyoutRef.current?.contains(event.target)) return;
      closeWithoutFocusReturn();
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setSettingsOpen(false);
      window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('hashchange', closeWithoutFocusReturn);
    return () => {
      window.cancelAnimationFrame(focusFirstItem);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('hashchange', closeWithoutFocusReturn);
    };
  }, [settingsOpen]);

  // Finding 4: Remove collapsed sidebar from tab order using inert attribute.
  // React doesn't support inert as a JSX prop, so we use a ref-based approach.
  useEffect(() => {
    if (collapsibleRef.current) {
      if (collapsed && !visuallyExpanded) {
        collapsibleRef.current.setAttribute('inert', '');
        collapsibleRef.current.setAttribute('aria-hidden', 'true');
      } else {
        collapsibleRef.current.removeAttribute('inert');
        collapsibleRef.current.removeAttribute('aria-hidden');
      }
    }
  }, [collapsed, visuallyExpanded]);

  const closeForDestination = () => {
    setSettingsOpen(false);
    onClose?.();
  };

  const handleSettingsMenuKeyDown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(settingsFlyoutRef.current?.querySelectorAll('[role^="menuitem"]') || [])];
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const settingsFlyout = settingsOpen ? createPortal(
    <div
      ref={settingsFlyoutRef}
      id={settingsFlyoutId}
      className="sidebar-settings-flyout"
      role="menu"
      aria-label="Sidebar settings"
      data-placement={settingsPosition?.placement || 'side'}
      onKeyDown={handleSettingsMenuKeyDown}
      style={{
        left: settingsPosition ? `${settingsPosition.left}px` : '0px',
        top: settingsPosition ? `${settingsPosition.top}px` : '0px',
        width: settingsPosition ? `${settingsPosition.width}px` : '272px',
        visibility: settingsPosition ? undefined : 'hidden',
      }}
    >
      <a
        className={`sidebar-settings-action${currentRoute === '#/settings' ? ' is-current' : ''}`}
        href="#/settings"
        role="menuitem"
        aria-current={currentRoute === '#/settings' ? 'page' : undefined}
        onClick={closeForDestination}
      >
        <span className="sidebar-settings-action-icon"><IconSliders size={16} /></span>
        <span>Open Settings</span>
      </a>
      <a className="sidebar-settings-action" href="/docs" role="menuitem" onClick={closeForDestination}>
        <span className="sidebar-settings-action-icon"><IconBook size={16} /></span>
        <span>Design system</span>
      </a>
      <div className="sidebar-settings-separator" role="separator" />
      <div className="sidebar-settings-group-label">Sidebar</div>
      <button
        type="button"
        className="sidebar-settings-action"
        role="menuitemcheckbox"
        aria-checked={hoverExpand}
        onClick={() => onHoverExpandChange?.(!hoverExpand)}
      >
        <span className="sidebar-settings-check" aria-hidden="true">{hoverExpand ? <IconCheck size={15} /> : null}</span>
        <span>Expand on hover</span>
      </button>
      <button
        type="button"
        className="sidebar-settings-action"
        role="menuitemcheckbox"
        aria-checked={showLabels}
        onClick={() => onShowLabelsChange?.(!showLabels)}
      >
        <span className="sidebar-settings-check" aria-hidden="true">{showLabels ? <IconCheck size={15} /> : null}</span>
        <span>Show collapsed labels</span>
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <aside
        className={`sidebar${isOpen ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}${visuallyExpanded ? ' is-hover-expanded' : ''}${settingsOpen ? ' is-settings-open' : ''}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
      <div className="sidebar-header">
        <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <h1 className="sidebar-brand-title">QBO Assist</h1>
        <button
          className="sidebar-collapse-btn"
          onClick={() => {
            if (hoverExpanded) setHoverExpanded(false);
            if (settingsOpen) setSettingsOpen(false);
            onToggleCollapse();
          }}
          aria-label={collapsed && !visuallyExpanded ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed && !visuallyExpanded ? 'Expand sidebar' : 'Collapse sidebar'}
          type="button"
        >
          <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            {/* Outer frame */}
            <rect x="3" y="3" width="18" height="18" rx="2" />
            {/* Sidebar divider */}
            <line x1="9" y1="3" x2="9" y2="21" />
            {collapsed && !visuallyExpanded ? (
              /* Expand arrow in content area */
              <polyline points="13 10 16 12 13 14" strokeWidth="2" />
            ) : (
              /* Three sidebar content lines */
              <>
                <line x1="5.5" y1="8" x2="7" y2="8" strokeWidth="2" />
                <line x1="5.5" y1="12" x2="7" y2="12" strokeWidth="2" />
                <line x1="5.5" y1="16" x2="7" y2="16" strokeWidth="2" />
              </>
            )}
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(item => {
          const Icon = item.icon;
          const badge = badges[item.hash];
          const badgeCount = Number(badge?.count || 0);
          const isActive = currentRoute === item.hash ||
            (item.hash === '#/chat' && currentRoute.startsWith('#/chat')) ||
            (item.hash === '#/sessions' && currentRoute.startsWith('#/sessions')) ||
            (item.hash === '#/workspace' && currentRoute.startsWith('#/workspace')) ||
            (item.hash === '#/rooms' && currentRoute.startsWith('#/rooms')) ||
            (item.hash === '#/agents' && currentRoute.startsWith('#/agents')) ||
            (item.hash === '#/knowledge' && currentRoute.startsWith('#/knowledge'));
          return (
            <a
              key={item.hash}
              href={item.hash}
              className={`sidebar-nav-item${isActive ? ' is-active' : ''}`}
              onClick={onClose}
              aria-label={badgeCount > 0 ? `${item.label}, ${badgeCount} ${badge?.label || 'item'}${badgeCount === 1 ? '' : 's'}` : item.label}
              title={badgeCount > 0 ? `${item.label} · ${badgeCount} ${badge?.label || 'item'}${badgeCount === 1 ? '' : 's'}` : item.label}
              style={{ position: 'relative' }}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-nav-indicator"
                  className="sidebar-nav-indicator-bg"
                  transition={transitions.layout}
                />
              )}
              <Icon size={16} />
              <span>{item.label}</span>
              {badgeCount > 0 && (
                <span className={`sidebar-nav-badge is-${badge?.tone || 'attention'}`} aria-hidden="true">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
              {collapsed && showLabels && !visuallyExpanded && (
                <span className="sidebar-nav-short-label">{item.short}</span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="sidebar-collapsible sidebar-collapsible--empty" ref={collapsibleRef} />

      {circuitState.status !== 'closed' && (
        <div className="sidebar-circuit-indicator" title={
          circuitState.status === 'open'
            ? 'Backend unavailable — requests paused'
            : `Backend degraded — ${circuitState.failures} consecutive failure${circuitState.failures !== 1 ? 's' : ''}`
        }>
          <span
            className="sidebar-circuit-dot"
            style={{
              background: circuitState.status === 'open' ? 'var(--red, #ef4444)' : 'var(--amber, #f59e0b)',
              boxShadow: circuitState.status === 'open'
                ? '0 0 6px var(--red, #ef4444)'
                : '0 0 6px var(--amber, #f59e0b)',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--ink-secondary)' }}>
            {circuitState.status === 'open' ? 'Backend unavailable' : 'Backend degraded'}
          </span>
        </div>
      )}

      <div className="sidebar-settings-footer">
        <button
          ref={settingsTriggerRef}
          type="button"
          className={`sidebar-settings-trigger${settingsOpen ? ' is-open' : ''}`}
          aria-label="Open sidebar settings menu"
          aria-haspopup="menu"
          aria-expanded={settingsOpen}
          aria-controls={settingsFlyoutId}
          title="Settings"
          onClick={() => setSettingsOpen((current) => !current)}
        >
          <IconSettings size={17} />
          <span className="sidebar-settings-trigger-label">Settings</span>
          <IconChevronRight className="sidebar-settings-trigger-chevron" size={15} />
        </button>
      </div>
      </aside>
      {settingsFlyout}
    </>
  );
}

// --- SVG Icon Components ---

function IconChat({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function IconAttention({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.6 2.4 17.2A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.8L13.7 3.6a2 2 0 0 0-3.4 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconDashboard({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function IconSessions({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18" />
      <path d="M3 12h18" />
      <path d="M3 19h18" />
      <path d="M7 5v14" />
    </svg>
  );
}

function IconBook({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}

function IconKnowledge({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M9 7h7" />
      <path d="M9 11h7" />
      <path d="M9 15h4" />
    </svg>
  );
}

function IconTemplate({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconChart({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconDollar({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 6.5c0-1.93-2.24-3.5-5-3.5S7 4.57 7 6.5 9.24 10 12 10s5 1.57 5 3.5S14.76 17 12 17s-5-1.57-5-3.5" />
    </svg>
  );
}

function IconSettings({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.1A1.7 1.7 0 0 0 8.4 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.55h.3A1.7 1.7 0 0 0 4 8.4a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.46 3.6l.06.06A1.7 1.7 0 0 0 8.4 4a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 9.8 2H14v.3A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.3V14h-.3a1.7 1.7 0 0 0-1.7 1Z" />
    </svg>
  );
}

function IconSliders({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" fill="var(--bg-floating)" />
      <circle cx="15" cy="12" r="2" fill="var(--bg-floating)" />
      <circle cx="11" cy="18" r="2" fill="var(--bg-floating)" />
    </svg>
  );
}

function IconCheck({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5 12.5 9.5 17 19 7.5" />
    </svg>
  );
}

function IconChevronRight({ size = 16, className = '' }) {
  return (
    <svg className={className} aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 5 16 12 9 19" />
    </svg>
  );
}


function IconTerminal({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function IconWorkspace({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="10" x2="8" y2="20" />
    </svg>
  );
}

function IconMail({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function IconCalendar({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconInvestigation({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function IconImage({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function IconRooms({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M17 20h5v-2a3 3 0 0 0-5.356-1.857" />
      <path d="M7 20H2v-2a3 3 0 0 1 5.356-1.857" />
      <circle cx="12" cy="7" r="4" />
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function IconUsers({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconLab({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2v7.31" />
      <path d="M14 2v7.31" />
      <path d="M8.5 2h7" />
      <path d="M5 15a4 4 0 003.2 3.92A22.53 22.53 0 0012 19.25c1.33 0 2.6-.11 3.8-.33A4 4 0 0019 15l-4.1-6.84a2 2 0 00-1.72-.98h-2.36a2 2 0 00-1.72.98L5 15z" />
      <path d="M8 14h8" />
    </svg>
  );
}
