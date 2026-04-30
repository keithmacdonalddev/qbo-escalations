// @refresh reset — force full remount on HMR (many hooks, HMR can't reconcile)
import { useState, useEffect, useCallback, useMemo, Profiler } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { transitions, fade } from './utils/motion.js';
import Sidebar from './components/Sidebar.jsx';
import { ChatView } from './components/Chat.jsx';
import EscalationDashboard from './components/EscalationDashboard.jsx';
import PlaybookEditor from './components/PlaybookEditor.jsx';
import AgentsView from './components/AgentsView.jsx';
import TemplateLibrary from './components/TemplateLibrary.jsx';
import Analytics from './components/Analytics.jsx';
import ImageGallery from './components/ImageGallery.jsx';
import UsageDashboard from './components/UsageDashboard.jsx';
import WorkspaceShell from './components/WorkspaceShell.jsx';
import ChatMiniWidget from './components/ChatMiniWidget.jsx';
import EscalationDetail from './components/EscalationDetail.jsx';
import Settings from './components/Settings.jsx';
import InvestigationsView from './components/InvestigationsView.jsx';
import ChatRoom from './components/ChatRoom.jsx';
import RightSidebar from './components/RightSidebar.jsx';
import RequestWaterfall from './components/RequestWaterfall.jsx';
import HealthBanner from './components/HealthBanner.jsx';
import HealthToast from './components/HealthToast.jsx';
import AgentDock from './components/AgentDock.jsx';
import AppHeader from './components/app/AppHeader.jsx';
import useTheme from './hooks/useTheme.js';
import useAiSettings from './hooks/useAiSettings.js';
import useShellPreferences from './hooks/useShellPreferences.js';
import useDockShellState from './hooks/useDockShellState.js';
import useAppRouteState from './hooks/useAppRouteState.js';
import useAppShellRuntime from './hooks/useAppShellRuntime.js';
import { useChat } from './hooks/useChat.js';
import { WorkspaceMonitorProvider } from './context/WorkspaceMonitorContext.jsx';
import { useRequestWaterfall } from './hooks/useRequestWaterfall.js';
import { useRenderFlame } from './hooks/useRenderFlame.js';
import FlameBar from './components/FlameBar.jsx';
import { getSidebarCurrentRoute } from './lib/appRoute.js';
import { tel, TEL } from './lib/devTelemetry.js';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed');
      return saved !== null ? saved === 'true' : true;
    } catch { return true; }
  });
  const [dockOverlayOpen, setDockOverlayOpen] = useState(false);
  const [devToolsEnabled, setDevToolsEnabled] = useState(() => {
    try { return localStorage.getItem('dev-tools-enabled') === 'true'; } catch { return false; }
  });
  const {
    sidebarHoverExpand,
    setSidebarHoverExpand,
    sidebarShowLabels,
    setSidebarShowLabels,
    ledIntensity,
    setLedIntensity,
    ledMode,
    setLedMode,
    ledSpeed,
    setLedSpeed,
    waterfallView,
    setWaterfallView,
    flameBarEnabled,
    setFlameBarEnabled,
    networkTabEnabled,
    setNetworkTabEnabled,
  } = useShellPreferences();
  const shouldReduceMotion = useReducedMotion();
  const themeProps = useTheme();
  const aiProps = useAiSettings();
  const chat = useChat({ aiSettings: aiProps.aiSettings });
  const waterfall = useRequestWaterfall();
  const flame = useRenderFlame();
  const {
    networkOpen,
    setNetworkOpen,
    onRouteChange,
  } = useAppShellRuntime({
    chat,
    networkTabEnabled,
  });
  const {
    route,
    settingsOpen,
    toggleSettings,
  } = useAppRouteState({
    chatConversationId: chat.conversationId,
    onRouteChange,
  });
  const {
    globalDockTab,
    setGlobalDockTab,
    dockDefaultTab,
    dockViewContext,
    dockCloseHandler,
    showGlobalDock,
    workspaceAgentDock,
    workspaceMonitorEnabled,
  } = useDockShellState({
    routeView: route.view,
    routeWorkspaceView: route.workspaceView,
    routeEscalationId: route.escalationId,
    chatIsStreaming: chat.isStreaming,
  });
  const networkActiveCount = useMemo(
    () => waterfall.requests.filter(r => r.state === 'pending' || r.state === 'streaming' || r.state === 'headers').length,
    [waterfall.requests],
  );

  // Persist sidebar collapsed state
  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed)); } catch {}
  }, [sidebarCollapsed]);

  // Persist dev tools flag
  useEffect(() => {
    try { localStorage.setItem('dev-tools-enabled', String(devToolsEnabled)); } catch {}
  }, [devToolsEnabled]);

  // App mount telemetry
  useEffect(() => {
    tel(TEL.MOUNT, 'App mounted');
  }, []);

  useEffect(() => {
    if (!dockOverlayOpen) return;
    const handler = (e) => { if (e.key === 'Escape') setDockOverlayOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dockOverlayOpen]);

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
      case 'agents':
        return (
          <Profiler id="Agents" onRender={flame.onRender}>
          <motion.div key="agents" {...motionProps}>
            <AgentsView agentIdFromRoute={route.agentId || null} />
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
            <WorkspaceShell chat={chat} subview={route.workspaceView || 'overview'} agentDock={workspaceAgentDock} />
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
            <Settings themeProps={themeProps} aiProps={aiProps} layoutProps={{ sidebarHoverExpand, setSidebarHoverExpand, sidebarShowLabels, setSidebarShowLabels, ledIntensity, setLedIntensity, ledMode, setLedMode, ledSpeed, setLedSpeed, waterfallView, setWaterfallView, flameBarEnabled, setFlameBarEnabled, networkTabEnabled, setNetworkTabEnabled, devToolsEnabled, setDevToolsEnabled }} />
          </motion.div>
          </Profiler>
        );
      case 'rooms':
        return (
          <Profiler id="rooms" onRender={flame.onRender}>
          <motion.div key="rooms" {...motionProps} style={{ height: '100%' }}>
            <ChatRoom roomId={route.roomId} />
          </motion.div>
          </Profiler>
        );
      default:
        return null;
    }
  }, [route, motionProps, themeProps, aiProps, chat, workspaceAgentDock, sidebarHoverExpand, setSidebarHoverExpand, sidebarShowLabels, setSidebarShowLabels, ledIntensity, setLedIntensity, ledMode, setLedMode, ledSpeed, setLedSpeed, waterfallView, setWaterfallView, flameBarEnabled, setFlameBarEnabled, networkTabEnabled, setNetworkTabEnabled, devToolsEnabled, setDevToolsEnabled, flame.onRender]);

  const isFullHeightView = route.view === 'chat' || route.view === 'settings' || route.view === 'workspace' || route.view === 'investigations' || route.view === 'escalation-detail' || route.view === 'rooms';
  const usesEdgeToEdgeShell = isFullHeightView;
  const mainStyle = useMemo(() => ({
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    ...(usesEdgeToEdgeShell ? { padding: 0 } : {}),
  }), [usesEdgeToEdgeShell]);

  const sidebarCurrentRoute = getSidebarCurrentRoute(route);

  return (
    <Profiler id="app" onRender={flame.onRender}>
    <MotionConfig reducedMotion="user">
    <WorkspaceMonitorProvider enabled={workspaceMonitorEnabled}>
    <div className={`app${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}>
      <a href="#main-content" className="skip-nav-link">Skip to main content</a>
      {/* Health banner — always visible at the very top */}
      <HealthBanner requests={waterfall.requests} slowThreshold={waterfall.slowThreshold} />

      {/* Render flame bar — dev only, toggleable in Settings */}
      {devToolsEnabled && import.meta.env.DEV && flameBarEnabled && <FlameBar {...flame} />}

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
        id="main-content"
        className="app-content"
        style={mainStyle}
      >
        <div className="app-shell-body">
          <div className="app-shell-main-column">
            {/* Chat — always mounted so streaming persists when navigating away */}
            <Profiler id="Chat" onRender={flame.onRender}>
            <div style={{ display: route.view === 'chat' ? 'flex' : 'none', height: '100%' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <ChatView conversationIdFromRoute={route.conversationId} chat={chat} aiSettings={aiProps.aiSettings} routeView={route.view} />
              </div>
            </div>
            </Profiler>

            {/* All other views use AnimatePresence for transitions */}
            {route.view !== 'chat' && (
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
            <button
              className="dock-toggle-btn"
              onClick={() => setDockOverlayOpen(o => !o)}
              type="button"
              aria-label={dockOverlayOpen ? 'Close agent dock' : 'Open agent dock'}
              aria-expanded={dockOverlayOpen}
            >
              <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </button>
          )}
          {showGlobalDock && (
            <aside className={`gmail-agent-dock-wrapper app-global-dock-wrapper${dockOverlayOpen ? ' dock-overlay-open' : ''}`} aria-label="Agent dock">
              <AgentDock
                chat={chat}
                activeTab={globalDockTab}
                onActiveTabChange={setGlobalDockTab}
                defaultTab={dockDefaultTab}
                viewContext={dockViewContext}
                onClose={dockCloseHandler}
              />
            </aside>
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


      {/* Toast notifications for failures */}
      <HealthToast requests={waterfall.requests} />

      {/* Network waterfall — edge tab + right sidebar overlay */}
      {devToolsEnabled && networkTabEnabled && (
        <>
          <button
            className={`network-edge-tab${networkOpen ? ' is-active' : ''}${networkActiveCount > 0 && ledMode === 'icon' ? ' led-icon-glow' : ''}`}
            style={{ '--led-intensity': ledIntensity / 100, '--led-speed': `${ledSpeed}s` }}
            onClick={() => setNetworkOpen(o => !o)}
            onKeyDown={(e) => { if (e.key === 'Escape') setNetworkOpen(false); }}
            type="button"
            aria-label="Toggle network waterfall"
            aria-expanded={networkOpen}
            aria-controls="network-waterfall-panel"
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
            id="network-waterfall-panel"
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
    </MotionConfig>
    </Profiler>
  );
}

export default App;
