import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDefaultDockTabForRoute } from '../lib/appRoute.js';

const DEFAULT_WORKSPACE_DOCK_CONTEXT = {
  view: 'workspace',
  subview: 'overview',
};

export default function useDockShellState({
  routeView,
  routeWorkspaceView,
  routeEscalationId,
  chatIsStreaming,
}) {
  const [globalDockTab, setGlobalDockTab] = useState(() => getDefaultDockTabForRoute(routeView));
  const [dockContexts, setDockContexts] = useState(() => ({
    workspace: DEFAULT_WORKSPACE_DOCK_CONTEXT,
  }));
  const [dockOpenByView, setDockOpenByView] = useState(() => ({
    workspace: true,
  }));

  useEffect(() => {
    setGlobalDockTab(getDefaultDockTabForRoute(routeView));
  }, [routeView]);

  useEffect(() => {
    if (routeView !== 'chat') return;
    if (chatIsStreaming !== true) return;
    setGlobalDockTab((current) => (current === 'chat' ? current : 'chat'));
  }, [routeView, chatIsStreaming]);

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

  const dockDefaultTab = getDefaultDockTabForRoute(routeView);
  const dockViewContext = useMemo(() => {
    if (routeView === 'workspace') {
      const routeSubview = routeWorkspaceView || 'overview';
      if (dockContexts.workspace?.subview === routeSubview) {
        return dockContexts.workspace;
      }
      return { view: 'workspace', subview: routeSubview };
    }
    if (routeView === 'escalation-detail') {
      return { view: routeView, escalationId: routeEscalationId || null };
    }
    return { view: routeView };
  }, [routeView, routeWorkspaceView, routeEscalationId, dockContexts.workspace]);

  const dockCloseHandler = useMemo(() => {
    if (routeView !== 'workspace') return undefined;
    return () => setRouteDockOpen('workspace', false);
  }, [routeView, setRouteDockOpen]);

  const showGlobalDock = routeView !== 'settings'
    && (routeView !== 'workspace' ? true : (dockOpenByView.workspace ?? true));
  const workspaceDockOpen = dockOpenByView.workspace ?? true;
  const workspaceMonitorEnabled = routeView === 'workspace'
    || (showGlobalDock && globalDockTab === 'workspace');
  const workspaceAgentDock = useMemo(() => ({
    managed: true,
    open: workspaceDockOpen,
    setOpen: (nextValue) => setRouteDockOpen('workspace', nextValue),
    setActiveTab: setGlobalDockTab,
    onContextChange: (nextContext) => updateDockContext('workspace', nextContext),
  }), [workspaceDockOpen, setRouteDockOpen, setGlobalDockTab, updateDockContext]);

  return {
    globalDockTab,
    setGlobalDockTab,
    dockOpenByView,
    setRouteDockOpen,
    updateDockContext,
    dockDefaultTab,
    dockViewContext,
    dockCloseHandler,
    showGlobalDock,
    workspaceAgentDock,
    workspaceMonitorEnabled,
  };
}
