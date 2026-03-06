import { useState, useEffect, useCallback, useMemo, useRef, Profiler } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { transitions, fade } from './utils/motion.js';
import Sidebar from './components/Sidebar.jsx';
import { ChatView } from './components/Chat.jsx';
import EscalationDashboard from './components/EscalationDashboard.jsx';
import PlaybookEditor from './components/PlaybookEditor.jsx';
import TemplateLibrary from './components/TemplateLibrary.jsx';
import Analytics from './components/Analytics.jsx';
import UsageDashboard from './components/UsageDashboard.jsx';
import DevMode from './components/DevMode.jsx';
import PolicyLab from './components/PolicyLab.jsx';
import DevMiniWidget from './components/DevMiniWidget.jsx';
import ChatMiniWidget from './components/ChatMiniWidget.jsx';
import EscalationDetail from './components/EscalationDetail.jsx';
import Settings from './components/Settings.jsx';
import RightSidebar from './components/RightSidebar.jsx';
import RequestWaterfall from './components/RequestWaterfall.jsx';
import useTheme from './hooks/useTheme.js';
import useAiSettings from './hooks/useAiSettings.js';
import { useChat } from './hooks/useChat.js';
import { DevAgentProvider } from './context/DevAgentContext.jsx';
import { useRequestWaterfall } from './hooks/useRequestWaterfall.js';
import { useRenderFlame } from './hooks/useRenderFlame.js';
import FlameBar from './components/FlameBar.jsx';

function parseHashRoute(policyLabEnabled) {
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
  if (hash === '#/usage') return { view: 'usage' };
  if (hash === '#/dev') return { view: 'dev' };
  if (policyLabEnabled && hash === '#/policy-lab') return { view: 'policy-lab' };
  if (hash === '#/settings') return { view: 'settings' };
  return { view: 'chat', conversationId: null };
}

function App() {
  const [policyLabEnabled, setPolicyLabEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('policyLabEnabled')) ?? true; } catch { return true; }
  });
  const [route, setRoute] = useState(() => parseHashRoute(policyLabEnabled));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHoverExpand, setSidebarHoverExpand] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sidebarHoverExpand')) ?? true; } catch { return true; }
  });
  const [sidebarShowLabels, setSidebarShowLabels] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sidebarShowLabels')) ?? false; } catch { return false; }
  });
  // Network indicator settings: intensity 0-100, mode 'dot' | 'icon', speed in seconds
  const [ledIntensity, setLedIntensity] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ledIntensity')) ?? 70; } catch { return 70; }
  });
  const [ledMode, setLedMode] = useState(() => {
    try { return localStorage.getItem('ledMode') || 'dot'; } catch { return 'dot'; }
  });
  const [ledSpeed, setLedSpeed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ledSpeed')) ?? 2; } catch { return 2; }
  });
  const [waterfallView, setWaterfallView] = useState(() => {
    try { return localStorage.getItem('waterfallDefaultView') || 'timeline'; } catch { return 'timeline'; }
  });
  useEffect(() => { try { localStorage.setItem('sidebarHoverExpand', JSON.stringify(sidebarHoverExpand)); } catch {} }, [sidebarHoverExpand]);
  useEffect(() => { try { localStorage.setItem('sidebarShowLabels', JSON.stringify(sidebarShowLabels)); } catch {} }, [sidebarShowLabels]);
  useEffect(() => { try { localStorage.setItem('ledIntensity', JSON.stringify(ledIntensity)); } catch {} }, [ledIntensity]);
  useEffect(() => { try { localStorage.setItem('ledMode', ledMode); } catch {} }, [ledMode]);
  useEffect(() => { try { localStorage.setItem('ledSpeed', JSON.stringify(ledSpeed)); } catch {} }, [ledSpeed]);
  useEffect(() => { try { localStorage.setItem('waterfallDefaultView', waterfallView); } catch {} }, [waterfallView]);
  useEffect(() => { try { localStorage.setItem('policyLabEnabled', JSON.stringify(policyLabEnabled)); } catch {} }, [policyLabEnabled]);
  const shouldReduceMotion = useReducedMotion();
  const themeProps = useTheme();
  const aiProps = useAiSettings();
  const chat = useChat({ aiSettings: aiProps.aiSettings });
  const waterfall = useRequestWaterfall();
  const flame = useRenderFlame();
  const [networkOpen, setNetworkOpen] = useState(false);
  const networkActiveCount = useMemo(
    () => waterfall.requests.filter(r => r.state === 'pending' || r.state === 'streaming' || r.state === 'headers').length,
    [waterfall.requests],
  );
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
    const onHashChange = () => setRoute(parseHashRoute(policyLabEnabled));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [policyLabEnabled]);

  // Set default hash if empty
  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = '#/chat';
    }
  }, []);

  useEffect(() => {
    if (!policyLabEnabled && route.view === 'policy-lab') {
      window.location.hash = '#/chat';
      return;
    }
    setRoute(parseHashRoute(policyLabEnabled));
  }, [policyLabEnabled, route.view]);

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
      case 'usage':
        return (
          <motion.div key="usage" {...motionProps}>
            <UsageDashboard />
          </motion.div>
        );
      case 'policy-lab':
        return (
          <motion.div key="policy-lab" {...motionProps}>
            <PolicyLab />
          </motion.div>
        );
      case 'settings':
        return (
          <motion.div key="settings" {...motionProps} style={{ height: '100%' }}>
            <Settings themeProps={themeProps} aiProps={aiProps} layoutProps={{ sidebarHoverExpand, setSidebarHoverExpand, sidebarShowLabels, setSidebarShowLabels, ledIntensity, setLedIntensity, ledMode, setLedMode, ledSpeed, setLedSpeed, waterfallView, setWaterfallView, policyLabEnabled, setPolicyLabEnabled }} />
          </motion.div>
        );
      default:
        return null;
    }
  }, [route, motionProps, themeProps, aiProps, sidebarHoverExpand, setSidebarHoverExpand, sidebarShowLabels, setSidebarShowLabels]);

  const isFullHeightView = route.view === 'chat' || route.view === 'dev' || route.view === 'settings';

  return (
    <Profiler id="app" onRender={flame.onRender}>
    <MotionConfig reducedMotion="user">
    <DevAgentProvider aiSettings={aiProps.aiSettings}>
    <div className={`app${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}>
      {/* Render flame bar — dev only */}
      {import.meta.env.DEV && <FlameBar {...flame} />}

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
        hoverExpand={sidebarHoverExpand}
        showLabels={sidebarShowLabels}
        extraNavItems={policyLabEnabled ? [{ hash: '#/policy-lab', label: 'Policy Lab', short: 'Eval' }] : []}
      />

      <main
        className="app-content"
        style={isFullHeightView ? { padding: 0, display: 'flex', flexDirection: 'column' } : {}}
      >
        {/* Chat — always mounted so streaming persists when navigating away */}
        <div style={{ display: route.view === 'chat' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ChatView conversationIdFromRoute={route.conversationId} chat={chat} aiSettings={aiProps.aiSettings} />
        </div>

        {/* DevMode — always mounted, hidden when not the active view */}
        <div style={{ display: route.view === 'dev' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <DevMode />
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
        <DevMiniWidget />
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

      {/* Network waterfall — edge tab + right sidebar overlay */}
      <button
        className={`network-edge-tab${networkOpen ? ' is-active' : ''}${networkActiveCount > 0 && ledMode === 'icon' ? ' led-icon-glow' : ''}`}
        style={{ '--led-intensity': ledIntensity / 100, '--led-speed': `${ledSpeed}s` }}
        onClick={() => setNetworkOpen(o => !o)}
        type="button"
        aria-label="Toggle network waterfall"
      >
        {networkActiveCount > 0 && ledMode === 'dot' && <span className="network-edge-dot" />}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        <span className="network-edge-tooltip">
          <div className="tooltip-title">Network Waterfall</div>
          <div className="tooltip-desc">Monitor API request timing and spot pileups without browser DevTools.</div>
          <div className="tooltip-status">
            <span className={`tooltip-dot${networkActiveCount === 0 ? ' tooltip-dot--idle' : ''}`} />
            {networkActiveCount > 0
              ? `${networkActiveCount} active request${networkActiveCount > 1 ? 's' : ''}`
              : waterfall.requests.length > 0
                ? `${waterfall.requests.length} recorded`
                : 'No activity'}
          </div>
          <div className="tooltip-legend">
            <div className="tooltip-legend-row"><span className="tooltip-legend-dot tooltip-legend-dot--active" />Glowing = requests in flight</div>
            <div className="tooltip-legend-row"><span className="tooltip-legend-dot tooltip-legend-dot--idle" />Dim = idle, no active requests</div>
            <div className="tooltip-legend-row"><span className="tooltip-legend-dot tooltip-legend-dot--error" />Red = errors detected</div>
          </div>
        </span>
      </button>

      <RightSidebar
        open={networkOpen}
        onClose={() => setNetworkOpen(false)}
        title="Network"
        width={380}
        badge={
          <>
            {waterfall.requests.length > 0 && (
              <span className="wf-count">{waterfall.requests.length}</span>
            )}
            {networkActiveCount > 0 && (
              <span className="wf-active-badge">{networkActiveCount} active</span>
            )}
          </>
        }
      >
        <RequestWaterfall {...waterfall} defaultView={waterfallView} />
      </RightSidebar>
    </div>
    </DevAgentProvider>
    </MotionConfig>
    </Profiler>
  );
}

export default App;
