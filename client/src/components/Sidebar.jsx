import './Sidebar.css';
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { onCircuitChange } from '../api/http.js';
import { transitions } from '../utils/motion.js';

const NAV_ITEMS = [
  { hash: '#/chat', label: 'Chat', short: 'Chat', icon: IconChat },
  { hash: '#/sessions', label: 'Sessions', short: 'Sess', icon: IconSessions },
  { hash: '#/dashboard', label: 'Dashboard', short: 'Dash', icon: IconDashboard },
  { hash: '#/attention', label: 'Attention', short: 'Attn', icon: IconBell },
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

export default function Sidebar({ currentRoute, isOpen, onClose, collapsed, onToggleCollapse, hoverExpand, showLabels, extraNavItems = [] }) {
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimerRef = useRef(null);
  const mouseOverRef = useRef(false);
  const collapsibleRef = useRef(null);
  const [circuitState, setCircuitState] = useState({ status: 'closed', failures: 0 });
  const navItems = [...NAV_ITEMS, ...extraNavItems.map((item) => ({ ...item, icon: item.icon || IconTerminal }))];

  const handleMouseEnter = useCallback(() => {
    mouseOverRef.current = true;
    if (!collapsed || !hoverExpand) return;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverExpanded(true), 200);
  }, [collapsed, hoverExpand]);

  const handleMouseLeave = useCallback(() => {
    mouseOverRef.current = false;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverExpanded(false), 300);
  }, []);

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

  // Finding 4: Remove collapsed sidebar from tab order using inert attribute.
  // React doesn't support inert as a JSX prop, so we use a ref-based approach.
  useEffect(() => {
    if (collapsibleRef.current) {
      if (collapsed && !hoverExpanded) {
        collapsibleRef.current.setAttribute('inert', '');
        collapsibleRef.current.setAttribute('aria-hidden', 'true');
      } else {
        collapsibleRef.current.removeAttribute('inert');
        collapsibleRef.current.removeAttribute('aria-hidden');
      }
    }
  }, [collapsed, hoverExpanded]);

  return (
    <aside
      className={`sidebar${isOpen ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}${hoverExpanded ? ' is-hover-expanded' : ''}`}
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
            onToggleCollapse();
          }}
          aria-label={collapsed && !hoverExpanded ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed && !hoverExpanded ? 'Expand sidebar' : 'Collapse sidebar'}
          type="button"
        >
          <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            {/* Outer frame */}
            <rect x="3" y="3" width="18" height="18" rx="2" />
            {/* Sidebar divider */}
            <line x1="9" y1="3" x2="9" y2="21" />
            {collapsed && !hoverExpanded ? (
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
          const isActive = currentRoute === item.hash ||
            (item.hash === '#/chat' && currentRoute.startsWith('#/chat')) ||
            (item.hash === '#/sessions' && currentRoute.startsWith('#/sessions')) ||
            (item.hash === '#/workspace' && currentRoute.startsWith('#/workspace')) ||
            (item.hash === '#/rooms' && currentRoute.startsWith('#/rooms')) ||
            (item.hash === '#/agents' && currentRoute.startsWith('#/agents'));
          return (
            <a
              key={item.hash}
              href={item.hash}
              className={`sidebar-nav-item${isActive ? ' is-active' : ''}`}
              onClick={onClose}
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
              {collapsed && showLabels && !hoverExpanded && (
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
    </aside>
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

function IconBell({ size = 16 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
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
