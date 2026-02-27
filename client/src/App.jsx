import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Chat from './components/Chat.jsx';

function parseHashRoute() {
  const hash = window.location.hash || '#/chat';
  if (hash.startsWith('#/chat/')) {
    return { view: 'chat', conversationId: hash.slice(7) };
  }
  if (hash === '#/chat' || hash === '#/' || hash === '#') {
    return { view: 'chat', conversationId: null };
  }
  if (hash === '#/dashboard') return { view: 'dashboard' };
  if (hash.startsWith('#/escalations/')) {
    return { view: 'escalation-detail', escalationId: hash.slice(14) };
  }
  if (hash === '#/playbook') return { view: 'playbook' };
  if (hash === '#/templates') return { view: 'templates' };
  if (hash === '#/analytics') return { view: 'analytics' };
  return { view: 'chat', conversationId: null };
}

function App() {
  const [route, setRoute] = useState(parseHashRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const renderView = useCallback(() => {
    switch (route.view) {
      case 'chat':
        return <Chat conversationIdFromRoute={route.conversationId} />;
      case 'dashboard':
        return <PlaceholderPage title="Escalation Dashboard" desc="Escalation tracking coming in Phase 2." />;
      case 'escalation-detail':
        return <PlaceholderPage title="Escalation Detail" desc="Detail view coming in Phase 2." />;
      case 'playbook':
        return <PlaceholderPage title="Playbook Editor" desc="Playbook management coming in Phase 3." />;
      case 'templates':
        return <PlaceholderPage title="Template Library" desc="Response templates coming in Phase 3." />;
      case 'analytics':
        return <PlaceholderPage title="Analytics" desc="Pattern tracking coming in Phase 4." />;
      default:
        return <Chat />;
    }
  }, [route]);

  return (
    <div className="app">
      <Sidebar
        currentRoute={window.location.hash || '#/chat'}
        conversationId={route.conversationId}
      />
      <main className="app-content">
        {renderView()}
      </main>
    </div>
  );
}

function PlaceholderPage({ title, desc }) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-desc">{desc}</div>
    </div>
  );
}

export default App;
