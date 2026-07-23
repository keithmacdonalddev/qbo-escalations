import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { listAttentionItems } from '../api/escalationsApi.js';
import { getSharedRealtimeClient } from '../api/realtime.js';

const EMPTY_ATTENTION = Object.freeze({
  items: [],
  total: 0,
  counts: { open: 0, resolved: 0, dismissed: 0, split: 0 },
  kindCounts: {},
  severityCounts: { critical: 0, warning: 0, info: 0 },
  loading: true,
  error: '',
  lastConfirmedAt: null,
});

const DEFAULT_VALUE = Object.freeze({
  workItems: [],
  activeWork: [],
  recentWork: [],
  attention: EMPTY_ATTENTION,
  attentionRevision: 0,
  connection: { state: 'closed', connected: false },
  status: 'reconnecting',
  sidebarBadges: {},
  refreshAttention: async () => {},
  reportLocalWorkflow: () => {},
  retry: () => {},
});

const LiveWorkContext = createContext(DEFAULT_VALUE);
const MAX_SERVER_WORK_ITEMS = 80;
const ATTENTION_REFRESH_COALESCE_MS = 120;

function isActive(item) {
  return item?.status === 'running';
}

function sortWorkItems(items) {
  return [...items].sort((left, right) => {
    if (isActive(left) !== isActive(right)) return isActive(left) ? -1 : 1;
    return Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || '');
  });
}

function deriveConnectionStatus(connection, attentionError, channelError) {
  if (connection?.state === 'offline') return 'offline';
  if (attentionError || channelError || ['stale', 'degraded'].includes(connection?.state)) return 'stale';
  if (connection?.connected && connection?.state === 'connected') return 'connected';
  return 'reconnecting';
}

export function LiveWorkProvider({ children }) {
  const [serverWorkItems, setServerWorkItems] = useState([]);
  const [localWorkflow, setLocalWorkflow] = useState(null);
  const [attention, setAttention] = useState(EMPTY_ATTENTION);
  const [attentionRevision, setAttentionRevision] = useState(0);
  const [connection, setConnection] = useState(() => getSharedRealtimeClient().getStateSnapshot());
  const [channelError, setChannelError] = useState('');
  const mountedRef = useRef(false);
  const attentionGenerationRef = useRef(0);
  const attentionTimerRef = useRef(0);

  const refreshAttention = useCallback(async ({ background = true } = {}) => {
    const generation = ++attentionGenerationRef.current;
    if (!background) {
      setAttention((current) => ({ ...current, loading: true, error: '' }));
    }
    try {
      const data = await listAttentionItems({ status: 'open', sort: 'priority', limit: 12 });
      if (!mountedRef.current || generation !== attentionGenerationRef.current) return null;
      const confirmedAt = Date.now();
      setAttention({
        items: Array.isArray(data.items) ? data.items : [],
        total: Number(data.total || 0),
        counts: { ...EMPTY_ATTENTION.counts, ...(data.counts || {}) },
        kindCounts: data.kindCounts || {},
        severityCounts: { ...EMPTY_ATTENTION.severityCounts, ...(data.severityCounts || {}) },
        loading: false,
        error: '',
        lastConfirmedAt: confirmedAt,
      });
      return data;
    } catch (error) {
      if (!mountedRef.current || generation !== attentionGenerationRef.current) return null;
      setAttention((current) => ({
        ...current,
        loading: false,
        error: error?.message || 'The latest attention queue could not be confirmed.',
      }));
      return null;
    }
  }, []);

  const scheduleAttentionRefresh = useCallback((immediate = false) => {
    if (attentionTimerRef.current) window.clearTimeout(attentionTimerRef.current);
    attentionTimerRef.current = window.setTimeout(() => {
      attentionTimerRef.current = 0;
      void refreshAttention({ background: true });
    }, immediate ? 0 : ATTENTION_REFRESH_COALESCE_MS);
  }, [refreshAttention]);

  useEffect(() => {
    mountedRef.current = true;
    // Attention is durable HTTP data, so confirm it even when the realtime
    // channel is temporarily unavailable or the running server still needs a
    // restart to learn this newer channel.
    void refreshAttention({ background: false });
    const realtime = getSharedRealtimeClient();
    const unsubscribeConnection = realtime.subscribeConnectionState(setConnection);
    const unsubscribeChannel = realtime.subscribe({
      channel: 'work-center',
      key: 'all',
      onSubscribed() {
        setChannelError('');
        scheduleAttentionRefresh(true);
      },
      onEvent(eventType, data) {
        if (eventType === 'snapshot') {
          setChannelError('');
          setServerWorkItems(sortWorkItems(Array.isArray(data?.workItems) ? data.workItems : []));
          scheduleAttentionRefresh(true);
          return;
        }
        if (eventType === 'work.changed' && data?.workItem?.id) {
          setServerWorkItems((current) => sortWorkItems([
            data.workItem,
            ...current.filter((item) => item?.id !== data.workItem.id),
          ]).slice(0, MAX_SERVER_WORK_ITEMS));
          return;
        }
        if (eventType === 'work.removed' && data?.workItemId) {
          setServerWorkItems((current) => current.filter((item) => item?.id !== data.workItemId));
          return;
        }
        if (eventType === 'attention.changed') {
          setAttentionRevision((current) => current + 1);
          scheduleAttentionRefresh(false);
        }
      },
      onError(message) {
        if (message?.code === 'REALTIME_DISCONNECTED' || message?.code === 'REALTIME_ERROR') return;
        setChannelError(message?.error || 'Live work updates could not be confirmed.');
      },
    });

    return () => {
      mountedRef.current = false;
      attentionGenerationRef.current += 1;
      if (attentionTimerRef.current) window.clearTimeout(attentionTimerRef.current);
      attentionTimerRef.current = 0;
      unsubscribeChannel();
      unsubscribeConnection();
    };
  }, [refreshAttention, scheduleAttentionRefresh]);

  const reportLocalWorkflow = useCallback((workItem) => {
    setLocalWorkflow(workItem?.id ? workItem : null);
  }, []);

  const workItems = useMemo(() => {
    let serverItems = serverWorkItems;
    if (localWorkflow && isActive(localWorkflow)) {
      serverItems = serverItems.filter((item) => !(
        item?.source === 'ai-runtime'
        && ['chat', 'parse'].includes(item?.kind)
        && (!item.conversationId || !localWorkflow.conversationId || item.conversationId === localWorkflow.conversationId)
      ));
    }
    return sortWorkItems(localWorkflow
      ? [localWorkflow, ...serverItems.filter((item) => item?.id !== localWorkflow.id)]
      : serverItems);
  }, [localWorkflow, serverWorkItems]);

  const activeWork = useMemo(() => workItems.filter(isActive), [workItems]);
  const recentWork = useMemo(() => workItems.filter((item) => !isActive(item)).slice(0, 8), [workItems]);
  const status = deriveConnectionStatus(connection, attention.error, channelError);
  const sidebarBadges = useMemo(() => ({
    '#/chat': {
      count: activeWork.filter((item) => ['qbo-workflow', 'chat', 'parse'].includes(item?.kind)).length,
      tone: 'live',
      label: 'active chat or QBO workflow',
    },
    '#/sessions': {
      count: activeWork.filter((item) => item?.source === 'agent-session').length,
      tone: 'live',
      label: 'active agent session',
    },
    '#/attention': {
      count: Number(attention.counts.open || attention.total || 0),
      tone: Number(attention.severityCounts.critical || 0) > 0 ? 'critical' : 'attention',
      label: 'open attention item',
    },
    '#/knowledge': {
      count: Number(attention.kindCounts['knowledge-review'] || 0),
      tone: 'review',
      label: 'knowledge review item',
    },
  }), [activeWork, attention]);

  const retry = useCallback(() => {
    setChannelError('');
    getSharedRealtimeClient().reconnectNow('Retrying live work updates');
    void refreshAttention({ background: false });
  }, [refreshAttention]);

  const value = useMemo(() => ({
    workItems,
    activeWork,
    recentWork,
    attention,
    attentionRevision,
    connection,
    status,
    sidebarBadges,
    refreshAttention,
    reportLocalWorkflow,
    retry,
  }), [
    activeWork,
    attention,
    attentionRevision,
    connection,
    recentWork,
    refreshAttention,
    reportLocalWorkflow,
    retry,
    sidebarBadges,
    status,
    workItems,
  ]);

  return <LiveWorkContext.Provider value={value}>{children}</LiveWorkContext.Provider>;
}

export function useLiveWork() {
  return useContext(LiveWorkContext);
}
