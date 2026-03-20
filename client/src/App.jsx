// @refresh reset — force full remount on HMR (many hooks, HMR can't reconcile)
import { useState, useEffect, useCallback, useMemo, useRef, Profiler } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { transitions, fade } from './utils/motion.js';
import Sidebar from './components/Sidebar.jsx';
import { ChatView } from './components/Chat.jsx';
import EscalationDashboard from './components/EscalationDashboard.jsx';
import PlaybookEditor from './components/PlaybookEditor.jsx';
import TemplateLibrary from './components/TemplateLibrary.jsx';
import Analytics from './components/Analytics.jsx';
import ImageGallery from './components/ImageGallery.jsx';
import UsageDashboard from './components/UsageDashboard.jsx';
import DevMode from './components/DevMode.jsx';
import WorkspaceShell from './components/WorkspaceShell.jsx';
import ModelLab from './components/ModelLab.jsx';
import DevMiniWidget from './components/DevMiniWidget.jsx';
import ChatMiniWidget from './components/ChatMiniWidget.jsx';
import EscalationDetail from './components/EscalationDetail.jsx';
import Settings from './components/Settings.jsx';
import InvestigationsView from './components/InvestigationsView.jsx';
import RightSidebar from './components/RightSidebar.jsx';
import RequestWaterfall from './components/RequestWaterfall.jsx';
import HealthBanner from './components/HealthBanner.jsx';
import HealthToast from './components/HealthToast.jsx';
import AgentDock from './components/AgentDock.jsx';
import useTheme from './hooks/useTheme.js';
import useAiSettings from './hooks/useAiSettings.js';
import { useChat } from './hooks/useChat.js';
import { DevAgentProvider } from './context/DevAgentContext.jsx';
import { WorkspaceMonitorProvider } from './context/WorkspaceMonitorContext.jsx';
import { useRequestWaterfall } from './hooks/useRequestWaterfall.js';
import { useRenderFlame } from './hooks/useRenderFlame.js';
import FlameBar from './components/FlameBar.jsx';
import { tel, TEL, setTelemetryLogging } from './lib/devTelemetry.js';
import { updateAgentSession } from './lib/agentSessions.js';

function getDefaultDockTabForRoute(view) {
  if (view === 'dev') return 'dev';
  if (view === 'workspace') return 'workspace';
  return 'chat';
}

function normalizeWorkspaceView(rawView) {
  switch (String(rawView || '').toLowerCase()) {
    case '':
    case 'overview':
      return 'overview';
    case 'inbox':
    case 'gmail':
      return 'inbox';
    case 'calendar':
      return 'calendar';
    case 'tasks':
      return 'tasks';
    case 'projects':
      return 'projects';
    default:
      return 'overview';
  }
}

function parseHashRoute() {
  const hash = window.location.hash || '#/chat';
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryIndex = normalized.indexOf('?');
  const path = queryIndex >= 0 ? normalized.slice(0, queryIndex) : normalized;
  const query = new URLSearchParams(queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '');

  if (path.startsWith('/chat/')) {
    return { view: 'chat', conversationId: path.slice(6) };
  }
  if (path === '/chat' || path === '/' || path === '') {
    return { view: 'chat', conversationId: null };
  }
  if (path.startsWith('/escalations/')) {
    return { view: 'escalation-detail', escalationId: path.slice(13) };
  }
  if (path === '/dashboard' || path === '/escalations') return { view: 'dashboard' };
  if (path === '/playbook') return { view: 'playbook' };
  if (path === '/templates') return { view: 'templates' };
  if (path === '/analytics') return { view: 'analytics' };
  if (path === '/model-lab') return { view: 'model-lab' };
  if (path === '/gallery') return { view: 'gallery' };
  if (path === '/usage') {
    return {
      view: 'usage',
      usageTab: query.get('tab') === 'traces' ? 'traces' : 'usage',
      traceConversationId: query.get('conversationId') || '',
      traceId: query.get('traceId') || '',
    };
  }
  if (path === '/dev') return { view: 'dev' };
  if (path === '/workspace') {
    return { view: 'workspace', workspaceView: 'overview' };
  }
  if (path.startsWith('/workspace/')) {
    return {
      view: 'workspace',
      workspaceView: normalizeWorkspaceView(path.slice('/workspace/'.length)),
    };
  }
  if (path === '/gmail') return { view: 'workspace', workspaceView: 'inbox' };
  if (path === '/calendar') return { view: 'workspace', workspaceView: 'calendar' };
  if (path === '/investigations') return { view: 'investigations' };
  if (path === '/settings') return { view: 'settings' };
  return { view: 'chat', conversationId: null };
}

/**
 * AppHeader — renders the top bar with the mobile sidebar toggle and settings gear.
 */
function AppHeader({ settingsOpen, toggleSettings, setSidebarOpen }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    const fetchUnread = () => {
      // Dynamically read the current default email each poll cycle
      const defaultEmail = window.localStorage.getItem('qbo-default-gmail-account') || '';
      fetch('/api/gmail/unified/unread-counts')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!active || !data?.ok) return;
          const counts = data.counts || {};
          // Use the default email's count, or fall back to total
          const count = defaultEmail && counts[defaultEmail] != null
            ? counts[defaultEmail]
            : (counts.total ?? 0);
          setUnreadCount(count);
        })
        .catch(() => {});
    };
    fetchUnread();
    const id = setInterval(fetchUnread, 60_000);
    // Listen for storage changes (e.g. from Settings panel) to refresh immediately
    const onStorage = (e) => {
      if (e.key === 'qbo-default-gmail-account') fetchUnread();
    };
    window.addEventListener('storage', onStorage);
    // Also listen for a custom event so same-tab changes trigger a refresh
    const onDefaultChange = () => fetchUnread();
    window.addEventListener('default-email-changed', onDefaultChange);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('default-email-changed', onDefaultChange);
    };
  }, []);

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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M22 4l-10 8L2 4" />
          </svg>
          {unreadCount > 0 && (
            <span className="app-header-mail-badge">{badgeLabel}</span>
          )}
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

function App() {
  const [route, setRoute] = useState(() => parseHashRoute());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
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
  const [flameBarEnabled, setFlameBarEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('flameBarEnabled')) ?? true; } catch { return true; }
  });
  const [networkTabEnabled, setNetworkTabEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('networkTabEnabled')) ?? true; } catch { return true; }
  });
  const [devWidgetEnabled, setDevWidgetEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('devWidgetEnabled')) ?? true; } catch { return true; }
  });
  const [telemetryEnabled, setTelemetryEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('telemetryEnabled')) ?? true; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem('sidebarHoverExpand', JSON.stringify(sidebarHoverExpand)); } catch {} }, [sidebarHoverExpand]);
  useEffect(() => { try { localStorage.setItem('sidebarShowLabels', JSON.stringify(sidebarShowLabels)); } catch {} }, [sidebarShowLabels]);
  useEffect(() => { try { localStorage.setItem('ledIntensity', JSON.stringify(ledIntensity)); } catch {} }, [ledIntensity]);
  useEffect(() => { try { localStorage.setItem('ledMode', ledMode); } catch {} }, [ledMode]);
  useEffect(() => { try { localStorage.setItem('ledSpeed', JSON.stringify(ledSpeed)); } catch {} }, [ledSpeed]);
  useEffect(() => { try { localStorage.setItem('waterfallDefaultView', waterfallView); } catch {} }, [waterfallView]);
  useEffect(() => { try { localStorage.setItem('flameBarEnabled', JSON.stringify(flameBarEnabled)); } catch {} }, [flameBarEnabled]);
  useEffect(() => { try { localStorage.setItem('networkTabEnabled', JSON.stringify(networkTabEnabled)); } catch {} }, [networkTabEnabled]);
  useEffect(() => { try { localStorage.setItem('devWidgetEnabled', JSON.stringify(devWidgetEnabled)); } catch {} }, [devWidgetEnabled]);
  useEffect(() => { try { localStorage.setItem('telemetryEnabled', JSON.stringify(telemetryEnabled)); } catch {} }, [telemetryEnabled]);
  useEffect(() => { setTelemetryLogging(telemetryEnabled); }, [telemetryEnabled]);
  useEffect(() => { if (!networkTabEnabled) setNetworkOpen(false); }, [networkTabEnabled]);
  const shouldReduceMotion = useReducedMotion();
  const themeProps = useTheme();
  const aiProps = useAiSettings();
  const chat = useChat({ aiSettings: aiProps.aiSettings });
  const waterfall = useRequestWaterfall();
  const flame = useRenderFlame();
  const [networkOpen, setNetworkOpen] = useState(false);
  const [globalDockTab, setGlobalDockTab] = useState(() => getDefaultDockTabForRoute(route.view));
  const [dockContexts, setDockContexts] = useState(() => ({
    workspace: { view: 'workspace', subview: 'overview' },
  }));
  const [dockOpenByView, setDockOpenByView] = useState(() => ({
    workspace: true,
  }));
  const networkActiveCount = useMemo(
    () => waterfall.requests.filter(r => r.state === 'pending' || r.state === 'streaming' || r.state === 'headers').length,
    [waterfall.requests],
  );
  const previousHashRef = useRef('#/chat');
  const previousChatRouteConversationIdRef = useRef(route.view === 'chat' ? route.conversationId || null : null);
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
    const onHashChange = () => {
      const next = parseHashRoute();
      tel(TEL.ROUTE_CHANGE, `Navigated to ${next.view}`, { from: route.view, to: next.view });
      setRoute(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [route.view]);

  // App mount telemetry + set default hash if empty
  useEffect(() => {
    tel(TEL.MOUNT, 'App mounted');
    if (!window.location.hash) {
      window.location.hash = '#/chat';
    }
  }, []);

  // Sync conversationId to URL hash so reloads restore the active chat
  useEffect(() => {
    const previousRouteConversationId = previousChatRouteConversationIdRef.current;
    const userJustClearedChatRoute = route.view === 'chat'
      && previousRouteConversationId
      && route.conversationId === null;

    if (!chat.conversationId || route.view !== 'chat' || userJustClearedChatRoute) {
      previousChatRouteConversationIdRef.current = route.view === 'chat'
        ? route.conversationId || null
        : null;
      return;
    }

    const expected = `#/chat/${chat.conversationId}`;
    if (window.location.hash !== expected) {
      window.location.hash = expected;
    }

    previousChatRouteConversationIdRef.current = route.view === 'chat'
      ? route.conversationId || null
      : null;
  }, [chat.conversationId, route.conversationId, route.view]);

  useEffect(() => {
    updateAgentSession('chat:main', {}, {
      type: 'chat',
      mounted: true,
      conversationId: chat.conversationId || null,
      provider: chat.provider,
      mode: chat.mode,
      fallbackProvider: chat.fallbackProvider || null,
      reasoningEffort: chat.reasoningEffort || null,
      isStreaming: chat.isStreaming === true,
      streamProvider: chat.streamProvider || null,
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
      streamingText: chat.streamingText || '',
      thinkingText: chat.thinkingText || '',
      updatedAt: Date.now(),
    });
  }, [
    chat.conversationId,
    chat.provider,
    chat.mode,
    chat.fallbackProvider,
    chat.reasoningEffort,
    chat.isStreaming,
    chat.streamProvider,
    chat.messages,
    chat.streamingText,
    chat.thinkingText,
  ]);

  useEffect(() => {
    setGlobalDockTab(getDefaultDockTabForRoute(route.view));
  }, [route.view]);

  useEffect(() => {
    if (route.view !== 'chat') return;
    if (chat.isStreaming !== true) return;
    setGlobalDockTab((current) => (current === 'chat' ? current : 'chat'));
  }, [route.view, chat.isStreaming]);

  const updateDockContext = useCallback((view, nextContext) => {
    if (!view) return;
    setDockContexts((prev) => {
      const fallbackContext = { view };
      const normalized = nextContext && typeof nextContext === 'object'
        ? { ...fallbackContext, ...nextContext }
        : fallbackContext;
      const current = prev[view];
      if (JSON.stringify(current) === JSON.stringify(normalized)) {
        return prev;
      }
      return {
        ...prev,
        [view]: normalized,
      };
    });
  }, []);

  const setRouteDockOpen = useCallback((view, nextValue) => {
    if (!view) return;
    setDockOpenByView((prev) => {
      const current = prev[view] ?? true;
      const next = typeof nextValue === 'function' ? nextValue(current) : nextValue;
      if (current === !!next) return prev;
      return {
        ...prev,
        [view]: !!next,
      };
    });
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
          <Profiler id="Dashboard" onRender={flame.onRender}>
          <motion.div key="dashboard" {...motionProps}>
            <EscalationDashboard />
          </motion.div>
          </Profiler>
        );
      case 'escalation-detail':
        return (
          <motion.div key="escalation-detail" {...motionProps} style={{ height: '100%' }}>
            <EscalationDetail escalationId={route.escalationId} />
          </motion.div>
        );
      case 'playbook':
        return (
          <Profiler id="Playbook" onRender={flame.onRender}>
          <motion.div key="playbook" {...motionProps}>
            <PlaybookEditor />
          </motion.div>
          </Profiler>
        );
      case 'templates':
        return (
          <Profiler id="Templates" onRender={flame.onRender}>
          <motion.div key="templates" {...motionProps}>
            <TemplateLibrary />
          </motion.div>
          </Profiler>
        );
      case 'analytics':
        return (
          <Profiler id="Analytics" onRender={flame.onRender}>
          <motion.div key="analytics" {...motionProps}>
            <Analytics />
          </motion.div>
          </Profiler>
        );
      case 'model-lab':
        return (
          <Profiler id="ModelLab" onRender={flame.onRender}>
          <motion.div key="model-lab" {...motionProps}>
            <ModelLab />
          </motion.div>
          </Profiler>
        );
      case 'gallery':
        return (
          <Profiler id="Gallery" onRender={flame.onRender}>
          <motion.div key="gallery" {...motionProps}>
            <ImageGallery />
          </motion.div>
          </Profiler>
        );
      case 'usage':
        return (
          <Profiler id="Usage" onRender={flame.onRender}>
          <motion.div key="usage" {...motionProps}>
            <UsageDashboard
              initialTab={route.usageTab || 'usage'}
              initialTraceConversationId={route.traceConversationId || ''}
              initialTraceId={route.traceId || ''}
            />
          </motion.div>
          </Profiler>
        );
      case 'workspace':
        return (
          <Profiler id="Workspace" onRender={flame.onRender}>
          <motion.div key={`workspace-${route.workspaceView || 'overview'}`} {...motionProps} style={{ height: '100%' }}>
            <WorkspaceShell
              chat={chat}
              subview={route.workspaceView || 'overview'}
              agentDock={{
                managed: true,
                open: dockOpenByView.workspace ?? true,
                setOpen: (nextValue) => setRouteDockOpen('workspace', nextValue),
                setActiveTab: setGlobalDockTab,
                onContextChange: (nextContext) => updateDockContext('workspace', nextContext),
              }}
            />
          </motion.div>
          </Profiler>
        );
      case 'investigations':
        return (
          <Profiler id="Investigations" onRender={flame.onRender}>
          <motion.div key="investigations" {...motionProps} style={{ height: '100%' }}>
            <InvestigationsView />
          </motion.div>
          </Profiler>
        );
      case 'settings':
        return (
          <Profiler id="Settings" onRender={flame.onRender}>
          <motion.div key="settings" {...motionProps} style={{ height: '100%' }}>
            <Settings themeProps={themeProps} aiProps={aiProps} layoutProps={{ sidebarHoverExpand, setSidebarHoverExpand, sidebarShowLabels, setSidebarShowLabels, ledIntensity, setLedIntensity, ledMode, setLedMode, ledSpeed, setLedSpeed, waterfallView, setWaterfallView, flameBarEnabled, setFlameBarEnabled, networkTabEnabled, setNetworkTabEnabled, devWidgetEnabled, setDevWidgetEnabled, telemetryEnabled, setTelemetryEnabled }} />
          </motion.div>
          </Profiler>
        );
      default:
        return null;
    }
  }, [route, motionProps, themeProps, aiProps, chat, dockOpenByView.workspace, setRouteDockOpen, setGlobalDockTab, updateDockContext, sidebarHoverExpand, setSidebarHoverExpand, sidebarShowLabels, setSidebarShowLabels, ledIntensity, setLedIntensity, ledMode, setLedMode, ledSpeed, setLedSpeed, waterfallView, setWaterfallView, flameBarEnabled, setFlameBarEnabled, networkTabEnabled, setNetworkTabEnabled, devWidgetEnabled, setDevWidgetEnabled, telemetryEnabled, setTelemetryEnabled, flame.onRender]);

  const isFullHeightView = route.view === 'chat' || route.view === 'dev' || route.view === 'settings' || route.view === 'workspace' || route.view === 'investigations' || route.view === 'escalation-detail';
  const dockDefaultTab = getDefaultDockTabForRoute(route.view);
  const dockViewContext = useMemo(() => {
    if (route.view === 'workspace') {
      const routeSubview = route.workspaceView || 'overview';
      if (dockContexts.workspace?.subview === routeSubview) {
        return dockContexts.workspace;
      }
      return { view: 'workspace', subview: routeSubview };
    }
    if (route.view === 'escalation-detail') {
      return { view: route.view, escalationId: route.escalationId || null };
    }
    return { view: route.view };
  }, [route.view, route.workspaceView, route.escalationId, dockContexts.workspace]);
  const showGlobalDock = route.view !== 'settings'
    && (route.view !== 'workspace' ? true : (dockOpenByView.workspace ?? true));
  const dockCloseHandler = useMemo(() => {
    if (route.view !== 'workspace') return undefined;
    return () => setRouteDockOpen('workspace', false);
  }, [route.view, setRouteDockOpen]);
  const usesEdgeToEdgeShell = isFullHeightView || route.view === 'model-lab';
  const mainStyle = useMemo(() => ({
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    ...(usesEdgeToEdgeShell ? { padding: 0 } : {}),
  }), [usesEdgeToEdgeShell]);

  const devMonitorsEnabled = route.view === 'dev';
  const workspaceMonitorEnabled = route.view === 'workspace'
    || (showGlobalDock && globalDockTab === 'workspace');
  const sidebarCurrentRoute = useMemo(() => {
    if (route.view === 'chat' && route.conversationId) {
      return `#/chat/${route.conversationId}`;
    }
    if (route.view === 'workspace') {
      return route.workspaceView && route.workspaceView !== 'overview'
        ? `#/workspace/${route.workspaceView}`
        : '#/workspace';
    }
    return `#/${route.view}`;
  }, [route.view, route.conversationId, route.workspaceView]);

  return (
    <Profiler id="app" onRender={flame.onRender}>
    <MotionConfig reducedMotion="user">
    <DevAgentProvider aiSettings={aiProps.aiSettings} monitorsEnabled={devMonitorsEnabled}>
    <WorkspaceMonitorProvider enabled={workspaceMonitorEnabled}>
    <div className={`app${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}>
      {/* Health banner — always visible at the very top */}
      <HealthBanner requests={waterfall.requests} slowThreshold={waterfall.slowThreshold} />

      {/* Render flame bar — dev only, toggleable in Settings */}
      {import.meta.env.DEV && flameBarEnabled && <FlameBar {...flame} />}

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
        currentRoute={sidebarCurrentRoute}
        conversationId={route.conversationId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
        hoverExpand={sidebarHoverExpand}
        showLabels={sidebarShowLabels}
      />

      <div className="app-content-area">
      <AppHeader
        settingsOpen={settingsOpen}
        toggleSettings={toggleSettings}
        setSidebarOpen={setSidebarOpen}
      />

      <main
        className="app-content"
        style={mainStyle}
      >
        <div className="app-shell-body">
          <div className="app-shell-main-column">
            {/* Chat — always mounted so streaming persists when navigating away */}
            <Profiler id="Chat" onRender={flame.onRender}>
            <div style={{ display: route.view === 'chat' ? 'flex' : 'none', height: '100%' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <ChatView conversationIdFromRoute={route.conversationId} chat={chat} aiSettings={aiProps.aiSettings} />
              </div>
            </div>
            </Profiler>

            {/* DevMode — always mounted, hidden when not the active view */}
            <Profiler id="DevMode" onRender={flame.onRender}>
            <div style={{ display: route.view === 'dev' ? 'flex' : 'none', height: '100%' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <DevMode chat={chat} />
              </div>
            </div>
            </Profiler>

            {/* All other views use AnimatePresence for transitions */}
            {route.view !== 'chat' && route.view !== 'dev' && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={`dock-shell-${route.view}-${route.workspaceView || 'default'}`}
                  className="app-shell-view"
                  {...motionProps}
                >
                  <div className={`app-shell-view-region${isFullHeightView ? ' app-shell-view-region--managed' : ' app-shell-view-region--scroll'}`}>
                    {renderNonChatView()}
                  </div>
                </motion.div>
              </AnimatePresence>
            )}
          </div>
          {showGlobalDock && (
            <div className="gmail-agent-dock-wrapper app-global-dock-wrapper">
              <AgentDock
                chat={chat}
                activeTab={globalDockTab}
                onActiveTabChange={setGlobalDockTab}
                defaultTab={dockDefaultTab}
                viewContext={dockViewContext}
                onClose={dockCloseHandler}
              />
            </div>
          )}
        </div>
      </main>
      </div>{/* end .app-content-area */}

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
      {devWidgetEnabled && route.view !== 'dev' && (
        <DevMiniWidget />
      )}


      {/* Toast notifications for failures */}
      <HealthToast requests={waterfall.requests} />

      {/* Network waterfall — edge tab + right sidebar overlay */}
      {networkTabEnabled && (
        <>
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
        </>
      )}
    </div>
    </WorkspaceMonitorProvider>
    </DevAgentProvider>
    </MotionConfig>
    </Profiler>
  );
}

export default App;
