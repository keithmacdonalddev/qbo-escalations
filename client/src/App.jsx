import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Sidebar from './components/Sidebar.jsx';
import Chat from './components/Chat.jsx';
import EscalationDashboard from './components/EscalationDashboard.jsx';
import PlaybookEditor from './components/PlaybookEditor.jsx';
import TemplateLibrary from './components/TemplateLibrary.jsx';
import Analytics from './components/Analytics.jsx';
import DevMode from './components/DevMode.jsx';
import EscalationDetail from './components/EscalationDetail.jsx';

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
  return { view: 'chat', conversationId: null };
}

function App() {
  const [route, setRoute] = useState(parseHashRoute);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

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

  const motionProps = shouldReduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
        transition: { duration: 0.15 },
      };

  const renderView = useCallback(() => {
    switch (route.view) {
      case 'chat':
        return (
          <motion.div key="chat" {...motionProps} style={{ height: '100%' }}>
            <Chat conversationIdFromRoute={route.conversationId} />
          </motion.div>
        );
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
      case 'dev':
        return (
          <motion.div key="dev" {...motionProps} style={{ height: '100%' }}>
            <DevMode />
          </motion.div>
        );
      default:
        return (
          <motion.div key="chat-default" {...motionProps} style={{ height: '100%' }}>
            <Chat />
          </motion.div>
        );
    }
  }, [route, motionProps]);

  const isFullHeightView = route.view === 'chat' || route.view === 'dev';

  return (
    <div className="app">
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
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        currentRoute={window.location.hash || '#/chat'}
        conversationId={route.conversationId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main
        className="app-content"
        style={isFullHeightView ? { padding: 0, display: 'flex', flexDirection: 'column' } : {}}
      >
        <AnimatePresence mode="wait">
          {renderView()}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;
