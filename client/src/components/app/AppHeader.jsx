import { motion } from 'framer-motion';
import { transitions } from '../../utils/motion.js';
import useUnreadEmailCount from '../../hooks/useUnreadEmailCount.js';

export default function AppHeader({ settingsOpen, toggleSettings, setSidebarOpen }) {
  const unreadCount = useUnreadEmailCount();
  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <header className="app-header">
      <div className="app-header-left">
        {/* Mobile sidebar toggle — only visible on small screens via CSS */}
        <button
          className="sidebar-toggle-header"
          onClick={() => setSidebarOpen(prev => !prev)}
          aria-label="Toggle sidebar"
          type="button"
        >
          <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>
      <div className="app-header-right">
        {/* Mail inbox */}
        <motion.button
          className="app-header-icon-btn app-header-mail-btn"
          onClick={() => { window.location.hash = '#/gmail'; }}
          type="button"
          aria-label={unreadCount > 0 ? `${unreadCount} unread emails` : 'Inbox'}
          title={unreadCount > 0 ? `${unreadCount} unread` : 'Inbox'}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
        >
          <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M22 4l-10 8L2 4" />
          </svg>
          {unreadCount > 0 && (
            <span className="app-header-mail-badge">{badgeLabel}</span>
          )}
        </motion.button>
        {/* Test suite */}
        <motion.button
          className="app-header-icon-btn"
          onClick={() => window.open('/prototypes/test-dashboard/index.html', '_blank')}
          type="button"
          aria-label="Test suite"
          title="Test Suite"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
        >
          <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3h6v5l4 9H5l4-9V3z" />
            <line x1="9" y1="3" x2="15" y2="3" />
            <path d="M10 17a2 2 0 104 0" />
          </svg>
        </motion.button>
        {/* Settings gear */}
        <motion.button
          className={`app-header-icon-btn${settingsOpen ? ' is-active' : ''}`}
          onClick={toggleSettings}
          type="button"
          aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
          title={settingsOpen ? 'Close settings' : 'Settings'}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
        >
          <motion.svg
            aria-hidden="true"
            focusable="false"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={{ rotate: settingsOpen ? 135 : 0 }}
            transition={transitions.springSnappy}
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </motion.svg>
        </motion.button>
      </div>
    </header>
  );
}
