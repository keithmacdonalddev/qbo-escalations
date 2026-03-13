import { useCallback, useMemo, useState } from 'react';
import RightSidebar from './RightSidebar.jsx';
import AgentDock from './AgentDock.jsx';

const buttonBaseStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  border: '1px solid var(--line-subtle)',
  background: 'var(--bg-raised)',
  color: 'var(--ink)',
  borderRadius: '999px',
  padding: '8px 12px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
};

function AgentButton({ label, active = false, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...buttonBaseStyle,
        borderColor: active ? 'var(--accent)' : 'var(--line-subtle)',
        background: active ? 'var(--accent-subtle)' : 'var(--bg-raised)',
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export default function GlobalAgentLauncher({ currentRoute, chat, viewContext }) {
  const [dockOpen, setDockOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('workspace');

  const workspaceViewContext = useMemo(() => {
    if (viewContext && typeof viewContext === 'object') return viewContext;
    if (currentRoute === 'gmail') return { view: 'gmail' };
    if (currentRoute === 'calendar') return { view: 'calendar' };
    return { view: 'workspace' };
  }, [currentRoute, viewContext]);

  const openTab = useCallback((tabId) => {
    setActiveTab(tabId);
    setDockOpen(true);
  }, []);

  return (
    <>
      <div
        style={{
          position: 'fixed',
          left: '16px',
          bottom: '18px',
          zIndex: 910,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          alignItems: 'flex-start',
        }}
      >
        <AgentButton label="Chat" active={dockOpen && activeTab === 'chat'} onClick={() => openTab('chat')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </AgentButton>
        <AgentButton label="Dev Agent" active={dockOpen && activeTab === 'dev'} onClick={() => openTab('dev')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </AgentButton>
        <AgentButton label="Workspace" active={dockOpen && activeTab === 'workspace'} onClick={() => openTab('workspace')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 8h10" />
            <path d="M7 12h6" />
          </svg>
        </AgentButton>
        <AgentButton label="Co-pilot" active={dockOpen && activeTab === 'copilot'} onClick={() => openTab('copilot')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3 7h7l-5.5 4.2L18.5 21 12 16.8 5.5 21l2-7.8L2 9h7z" />
          </svg>
        </AgentButton>
      </div>

      <RightSidebar open={dockOpen} onClose={() => setDockOpen(false)} title="Agent Dock" width={430}>
        <div style={{ height: '100%', minHeight: 0 }}>
          <AgentDock
            chat={chat}
            defaultTab={activeTab}
            viewContext={workspaceViewContext}
            onClose={() => setDockOpen(false)}
          />
        </div>
      </RightSidebar>
    </>
  );
}
