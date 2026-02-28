import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { transitions, fade } from './utils/motion.js';
import Sidebar from './components/Sidebar.jsx';
import { ChatView } from './components/Chat.jsx';
import EscalationDashboard from './components/EscalationDashboard.jsx';
import PlaybookEditor from './components/PlaybookEditor.jsx';
import TemplateLibrary from './components/TemplateLibrary.jsx';
import Analytics from './components/Analytics.jsx';
import DevMode from './components/DevMode.jsx';
import DevMiniWidget from './components/DevMiniWidget.jsx';
import ChatMiniWidget from './components/ChatMiniWidget.jsx';
import EscalationDetail from './components/EscalationDetail.jsx';
import Settings from './components/Settings.jsx';
import useTheme from './hooks/useTheme.js';
import useAiSettings from './hooks/useAiSettings.js';
import { useChat } from './hooks/useChat.js';
import { useDevChat } from './hooks/useDevChat.js';

function parseHashRoute() {
  const hash = window.location.hash || '#/chat';
  if (hash.startsWith('#/chat/')) {
    return { view: 'chat', conversationId: hash.slice(7) };
  }
  if (hash === '#/chat' || hash === '#/' || hash === '#') {
    return { view: 'chat', conversationId: null };
  }
  if (hash.startsWith('#/escalations/')) {
    return { view: 'escalation-detail', escalationId: hash.slice(14) };
  }
  if (hash === '#/dashboard' || hash === '#/escalations') return { view: 'dashboard' };
  if (hash === '#/playbook') return { view: 'playbook' };
  if (hash === '#/templates') return { view: 'templates' };
  if (hash === '#/analytics') return { view: 'analytics' };
  if (hash === '#/dev') return { view: 'dev' };
  if (hash === '#/settings') return { view: 'settings' };
  return { view: 'chat', conversationId: null };
}

function App() {
  const [route, setRoute] = useState(parseHashRoute);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const themeProps = useTheme();
  const aiProps = useAiSettings();
  const chat = useChat({ aiSettings: aiProps.aiSettings });
  const devChat = useDevChat();
  const previousHashRef = useRef('#/chat');
  const settingsOpen = route.view === 'settings';

  const toggleSettings = useCallback(() => {
    if (settingsOpen) {
      window.location.hash = previousHashRef.current || '#/chat';
    } else {
      previousHashRef.current = window.location.hash || '#/chat';
      window.location.hash = '#/settings';
    }
  }, [settingsOpen]);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Set default hash if empty
  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = '#/chat';
    }
  }, []);

  const motionProps = useMemo(() => shouldReduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
        transition: { duration: 0.15 },
      }, [shouldReduceMotion]);

  const renderNonChatView = useCallback(() => {
    switch (route.view) {
      case 'dashboard':
        return (
          <motion.div key="dashboard" {...motionProps}>
            <EscalationDashboard />
          </motion.div>
        );
      case 'escalation-detail':
        return (
          <motion.div key="escalation-detail" {...motionProps}>
            <EscalationDetail escalationId={route.escalationId} />
          </motion.div>
        );
      case 'playbook':
        return (
          <motion.div key="playbook" {...motionProps}>
            <PlaybookEditor />
          </motion.div>
        );
      case 'templates':
        return (
          <motion.div key="templates" {...motionProps}>
            <TemplateLibrary />
          </motion.div>
        );
      case 'analytics':
        return (
          <motion.div key="analytics" {...motionProps}>
            <Analytics />
          </motion.div>
        );
      case 'settings':
        return (
          <motion.div key="settings" {...motionProps} style={{ height: '100%' }}>
            <Settings themeProps={themeProps} aiProps={aiProps} />
          </motion.div>
        );
      default:
        return null;
    }
  }, [route, motionProps, themeProps, aiProps]);

  const isFullHeightView = route.view === 'chat' || route.view === 'dev' || route.view === 'settings';

  return (
    <MotionConfig reducedMotion="user">
    <div className={`app${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}>
      {/* Mobile sidebar toggle */}
      <button
        className="btn btn-ghost btn-icon sidebar-toggle"
        onClick={() => setSidebarOpen(prev => !prev)}
        aria-label="Toggle sidebar"
        type="button"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="sidebar-overlay"
            className="sidebar-overlay"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
            {...fade}
            transition={transitions.fast}
          />
        )}
      </AnimatePresence>

      <Sidebar
        currentRoute={route.view === 'chat' && route.conversationId ? `#/chat/${route.conversationId}` : `#/${route.view}`}
        conversationId={route.conversationId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
      />

      <main
        className="app-content"
        style={isFullHeightView ? { padding: 0, display: 'flex', flexDirection: 'column' } : {}}
      >
        {/* Chat — always mounted so streaming persists when navigating away */}
        <div style={{ display: route.view === 'chat' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ChatView conversationIdFromRoute={route.conversationId} chat={chat} />
        </div>

        {/* DevMode — always mounted, hidden when not the active view */}
        <div style={{ display: route.view === 'dev' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <DevMode {...devChat} />
        </div>

        {/* All other views use AnimatePresence for transitions */}
        {route.view !== 'chat' && route.view !== 'dev' && (
          <AnimatePresence mode="wait">
            {renderNonChatView()}
          </AnimatePresence>
        )}
      </main>

      {/* Floating mini widget — regular chat streaming monitor outside Chat view */}
      {route.view !== 'chat' && (
        <ChatMiniWidget
          isStreaming={chat.isStreaming}
          streamingText={chat.streamingText}
          parallelStreaming={chat.parallelStreaming}
          streamProvider={chat.streamProvider}
          provider={chat.provider}
          mode={chat.mode}
          conversationId={chat.conversationId}
          error={chat.error}
          abortStream={chat.abortStream}
        />
      )}

      {/* Floating mini widget — visible on non-dev tabs when dev mode is streaming */}
      {route.view !== 'dev' && (
        <DevMiniWidget
          isStreaming={devChat.isStreaming}
          streamingText={devChat.streamingText}
          streamProvider={devChat.streamProvider}
          provider={devChat.provider}
          toolEvents={devChat.toolEvents}
          error={devChat.error}
          abortStream={devChat.abortStream}
        />
      )}
      {/* Floating settings gear — top right, no layout impact */}
      <motion.button
        className={`app-settings-btn${settingsOpen ? ' is-active' : ''}`}
        onClick={toggleSettings}
        type="button"
        aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
        title={settingsOpen ? 'Close settings' : 'Settings'}
        whileHover={{ scale: 1.12 }}
        whileTap={{ scale: 0.88 }}
      >
        <motion.svg
          width="18"
          height="18"
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
    </MotionConfig>
  );
}

export default App;
