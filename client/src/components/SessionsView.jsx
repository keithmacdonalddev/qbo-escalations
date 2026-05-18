import './SessionsView.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteConversation,
  exportConversation,
  getConversation,
  getEventStats,
  listConversations,
  updateConversation,
} from '../api/chatApi.js';
import { getConversationTraces } from '../api/traceApi.js';
import { getProviderLabel } from '../lib/providerCatalog.js';
import { useToast } from '../hooks/useToast.jsx';
import ConfirmModal from './ConfirmModal.jsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'messages', label: 'Messages' },
  { id: 'events', label: 'Events' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'io', label: 'Inputs & Outputs' },
  { id: 'latency', label: 'Latency' },
  { id: 'agents', label: 'Agents' },
  { id: 'cost', label: 'Cost' },
  { id: 'attachments', label: 'Attachments' },
  { id: 'triage', label: 'Triage' },
  { id: 'audit', label: 'Audit' },
  { id: 'planned', label: 'Planned' },
];

const PLANNED_FIELDS = [
  'Full agent task timeline',
  'Private reasoning retention policy',
  'Prompt template versions',
  'Tool calls and tool results',
  'Human edits and overrides',
  'Escalation outcome linkage',
  'Model comparison branches',
  'Confidence and validation history',
  'Replayable event log',
  'Session ownership and handoff trail',
];

function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '--';
  return n.toLocaleString();
}

function formatCostMicros(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '--';
  return `$${(n / 1_000_000).toFixed(4)}`;
}

function getSessionTitle(session) {
  const title = typeof session?.title === 'string' ? session.title.trim() : '';
  if (title) return title;
  const preview = typeof session?.lastMessage?.preview === 'string'
    ? session.lastMessage.preview.trim()
    : '';
  return preview || 'Untitled session';
}

function getTraceLatency(trace) {
  return Number(trace?.outcome?.totalMs) || 0;
}

function getTraceCostMicros(trace) {
  return Number(trace?.usage?.totalCostMicros) || 0;
}

function getTraceTokenTotal(trace) {
  const usage = trace?.usage || {};
  return Number(usage.totalTokens) || (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
}

function getProviderIconPath(provider) {
  const value = String(provider || '').toLowerCase();
  if (value.includes('openai') || value.includes('codex') || value.includes('gpt')) return '/provider-icons/openai-dark.svg';
  if (value.includes('claude') || value.includes('anthropic')) return '/provider-icons/anthropic.png';
  if (value.includes('gemini') || value.includes('google')) return '/provider-icons/gemini.svg';
  if (value.includes('kimi') || value.includes('moonshot')) return '/provider-icons/kimi.ico';
  if (value.includes('lm-studio')) return '/provider-icons/lm-studio.webp';
  return '';
}

function getCaseValue(session, key, fallback = 'Unlinked') {
  const value = session?.escalation?.[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function PlannedBadge({ children }) {
  return <span className="session-planned-badge">{children}</span>;
}

export default function SessionsView({ sessionId = null }) {
  const toast = useToast();
  const [sessions, setSessions] = useState([]);
  const [search, setSearch] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [activeSession, setActiveSession] = useState(null);
  const [traces, setTraces] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  // All-time pipeline event totals + moving-average per stage. Surfaces
  // "Total events" and "Avg events / session" on the list page header and
  // feeds the same denominator the live workflow uses, so operators can see
  // where the progress bar's "expected total" comes from.
  const [eventStats, setEventStats] = useState({ byStage: {}, totals: { allTime: 0, perSession: 0, sessionCount: 0 }, windowSize: 0 });
  const fetchGenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getEventStats().then((stats) => {
      if (!cancelled) setEventStats(stats);
    }).catch(() => { /* keep zero defaults */ });
    return () => { cancelled = true; };
  }, []);

  const loadSessions = useCallback(async (searchTerm = search) => {
    const gen = ++fetchGenRef.current;
    setLoadingList(true);
    try {
      const list = await listConversations(200, 0, searchTerm);
      if (gen === fetchGenRef.current) setSessions(list);
    } catch {
      if (gen === fetchGenRef.current) setSessions([]);
      toast.error('Failed to load sessions');
    } finally {
      if (gen === fetchGenRef.current) setLoadingList(false);
    }
  }, [search, toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadSessions(search);
    }, 180);
    return () => clearTimeout(timer);
  }, [loadSessions, search]);

  useEffect(() => {
    if (!sessionId) {
      setActiveSession(null);
      setTraces([]);
      setActiveTab('overview');
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    setActiveTab('overview');
    Promise.all([
      getConversation(sessionId),
      getConversationTraces(sessionId).catch(() => []),
    ]).then(([session, traceList]) => {
      if (cancelled) return;
      setActiveSession(session);
      setTraces(Array.isArray(traceList) ? traceList : []);
    }).catch(() => {
      if (cancelled) return;
      setActiveSession(null);
      setTraces([]);
      toast.error('Failed to load session details');
    }).finally(() => {
      if (!cancelled) setLoadingDetail(false);
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId, toast]);

  const selectedListSession = useMemo(
    () => sessions.find((item) => String(item._id) === String(sessionId)) || null,
    [sessions, sessionId],
  );

  const summary = useMemo(() => {
    const messages = activeSession?.messages || [];
    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    const userMessages = messages.filter((message) => message.role === 'user');
    const totalTraceMs = traces.reduce((sum, trace) => sum + getTraceLatency(trace), 0);
    const totalTokens = traces.reduce((sum, trace) => sum + getTraceTokenTotal(trace), 0);
    const totalCostMicros = traces.reduce((sum, trace) => sum + getTraceCostMicros(trace), 0);
    const pipelineRuns = Array.isArray(activeSession?.caseIntake?.runs)
      ? activeSession.caseIntake.runs
      : [];
    const pipelineEventCount = pipelineRuns.reduce((sum, run) => {
      const explicit = Number(run?.eventCount);
      if (Number.isFinite(explicit) && explicit > 0) return sum + explicit;
      // Legacy fallback: exclude UI-category events so historical noise
      // doesn't inflate the per-session total displayed on the detail page.
      const events = Array.isArray(run?.events) ? run.events : [];
      return sum + events.filter((ev) => ev?.category !== 'ui').length;
    }, 0);
    return {
      messageCount: messages.length,
      assistantMessages: assistantMessages.length,
      userMessages: userMessages.length,
      traceCount: traces.length,
      totalTraceMs,
      totalTokens,
      totalCostMicros,
      eventCount: traces.reduce((sum, trace) => sum + (Array.isArray(trace.events) ? trace.events.length : 0), 0),
      pipelineEventCount,
      pipelineRunCount: pipelineRuns.length,
      reasoningCount: messages.filter((message) => typeof message.thinking === 'string' && message.thinking.trim()).length,
    };
  }, [activeSession, traces]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteConversation(deleteTarget);
      setSessions((prev) => prev.filter((item) => String(item._id) !== String(deleteTarget)));
      if (String(sessionId) === String(deleteTarget)) window.location.hash = '#/sessions';
    } catch {
      toast.error('Failed to delete session');
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, sessionId, toast]);

  const submitRename = useCallback(async () => {
    if (!editingId) return;
    const nextTitle = editTitle.trim();
    if (!nextTitle) {
      setEditingId(null);
      return;
    }
    try {
      const updated = await updateConversation(editingId, { title: nextTitle });
      setSessions((prev) => prev.map((item) => (
        String(item._id) === String(editingId) ? { ...item, title: nextTitle } : item
      )));
      if (String(activeSession?._id) === String(editingId)) {
        setActiveSession((prev) => ({ ...prev, title: updated.title || nextTitle }));
      }
    } catch {
      toast.error('Failed to rename session');
    } finally {
      setEditingId(null);
    }
  }, [activeSession?._id, editTitle, editingId, toast]);

  const copySession = useCallback(async (session) => {
    try {
      const text = await exportConversation(session._id);
      await navigator.clipboard.writeText(text);
      toast.success('Session copied to clipboard.');
    } catch {
      toast.error('Failed to copy session');
    }
  }, [toast]);

  const displayedDetail = activeSession || selectedListSession;

  return (
    <div className="sessions-page">
      <header className="sessions-header">
        <div>
          <div className="eyebrow">Session History</div>
          <h1>Sessions</h1>
        </div>
        <div className="sessions-header-actions">
          <a className="btn btn-secondary" href="#/chat">New Session</a>
          {sessionId ? <a className="btn btn-ghost" href="#/sessions">All Sessions</a> : null}
        </div>
      </header>

      {!sessionId ? (
        <section className="sessions-list-card">
          <EventStatsStrip stats={eventStats} />
          <div className="sessions-toolbar">
            <div className="sessions-search">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search session titles and message content..."
                aria-label="Search sessions by title and content"
              />
            </div>
            <span className="sessions-count">{loadingList ? 'Loading...' : `${sessions.length} session${sessions.length === 1 ? '' : 's'}`}</span>
          </div>
          <SessionsTable
            sessions={sessions}
            loading={loadingList}
            editingId={editingId}
            editTitle={editTitle}
            setEditTitle={setEditTitle}
            startRename={(session) => {
              setEditingId(session._id);
              setEditTitle(getSessionTitle(session));
            }}
            submitRename={submitRename}
            cancelRename={() => setEditingId(null)}
            copySession={copySession}
            setDeleteTarget={setDeleteTarget}
          />
        </section>
      ) : (
        <SessionDetail
          session={displayedDetail}
          traces={traces}
          summary={summary}
          loading={loadingDetail}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Session"
        message="This session and all saved messages will be permanently deleted. This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function SessionsTable({
  sessions,
  loading,
  editingId,
  editTitle,
  setEditTitle,
  startRename,
  submitRename,
  cancelRename,
  copySession,
  setDeleteTarget,
}) {
  if (loading && sessions.length === 0) {
    return <div className="sessions-empty">Loading sessions...</div>;
  }

  if (!loading && sessions.length === 0) {
    return <div className="sessions-empty">No sessions found.</div>;
  }

  return (
    <div className="sessions-table-wrap">
      <table className="table sessions-table">
        <thead>
          <tr>
            <th>Case #</th>
            <th>COID</th>
            <th>Agent</th>
            <th>Customer</th>
            <th>Provider</th>
            <th>Messages</th>
            <th>Events</th>
            <th>Updated</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session._id}
              className="table-clickable-row"
              onClick={() => { window.location.hash = `#/sessions/${session._id}`; }}
            >
              <td>
                {editingId === session._id ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={submitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitRename();
                      if (event.key === 'Escape') cancelRename();
                    }}
                    autoFocus
                  />
                ) : (
                  <div>
                    <div className="sessions-title">{getCaseValue(session, 'caseNumber')}</div>
                    <div className="sessions-preview">{session.escalation?.category || getSessionTitle(session)}</div>
                  </div>
                )}
              </td>
              <td>{getCaseValue(session, 'coid', '--')}</td>
              <td>{getCaseValue(session, 'agentName', '--')}</td>
              <td>{getCaseValue(session, 'clientContact', '--')}</td>
              <td><ProviderLogo provider={session.provider} /></td>
              <td>{session.messageCount || 0}</td>
              <td>{session.totalEventCount || 0}</td>
              <td>{formatDateTime(session.updatedAt)}</td>
              <td>
                <div className="sessions-row-actions">
                  <button className="session-action-btn" type="button" onClick={(event) => { event.stopPropagation(); startRename(session); }} title="Rename session" aria-label="Rename session">
                    <IconEdit />
                  </button>
                  <button className="session-action-btn" type="button" onClick={(event) => { event.stopPropagation(); copySession(session); }} title="Copy session" aria-label="Copy session">
                    <IconCopy />
                  </button>
                  <button className="session-action-btn session-action-btn--danger" type="button" onClick={(event) => { event.stopPropagation(); setDeleteTarget(session._id); }} title="Delete session" aria-label="Delete session">
                    <IconTrash />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventStatsStrip({ stats }) {
  const totals = stats?.totals || {};
  const byStage = stats?.byStage || {};
  const allTime = Number(totals.allTime) || 0;
  const perSession = Number(totals.perSession) || 0;
  const sessionCount = Number(totals.sessionCount) || 0;
  const windowSize = Number(stats?.windowSize) || 0;
  const stageLabels = [
    { key: 'parser', label: 'Image Parser' },
    { key: 'inv', label: 'INV Search' },
    { key: 'triage', label: 'Triage' },
    { key: 'main', label: 'QBO Assistant' },
  ];
  const stageHint = windowSize > 0 ? `Moving avg over the last ${windowSize} completed runs.` : 'No completed runs yet.';
  return (
    <div className="sessions-event-stats" aria-label="Pipeline event totals">
      <div className="sessions-event-stats__totals">
        <div className="stat-card">
          <div className="stat-card-value">{allTime.toLocaleString()}</div>
          <div className="stat-card-label">Total events (all sessions)</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{perSession.toLocaleString()}</div>
          <div className="stat-card-label">Avg events / session</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{sessionCount.toLocaleString()}</div>
          <div className="stat-card-label">Sessions with events</div>
        </div>
      </div>
      <div className="sessions-event-stats__per-stage" title={stageHint}>
        <span className="sessions-event-stats__per-stage-label">Avg per stage:</span>
        {stageLabels.map(({ key, label }) => {
          const avg = Number(byStage?.[key]?.avg) || 0;
          const samples = Number(byStage?.[key]?.samples) || 0;
          return (
            <span
              key={key}
              className={`sessions-event-stats__pill sessions-event-stats__pill--${key}`}
              title={samples > 0 ? `${label}: avg ${avg} (n=${samples})` : `${label}: no samples yet`}
            >
              <span className="sessions-event-stats__pill-label">{label}</span>
              <span className="sessions-event-stats__pill-value">{avg}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ProviderLogo({ provider }) {
  const iconPath = getProviderIconPath(provider);
  const label = getProviderLabel(provider || '');
  return (
    <span className="session-provider-logo" title={label} aria-label={label}>
      {iconPath ? <img src={iconPath} alt="" /> : <span>{label.slice(0, 2).toUpperCase()}</span>}
    </span>
  );
}

function SessionDetail({ session, traces, summary, loading, activeTab, setActiveTab }) {
  if (loading && !session) {
    return <div className="sessions-empty">Loading session...</div>;
  }

  if (!session) {
    return <div className="sessions-empty">Session not found.</div>;
  }

  return (
    <section className="session-detail">
      <div className="session-detail-hero">
        <div>
          <div className="eyebrow">Session</div>
          <h2>{getSessionTitle(session)}</h2>
          <div className="session-id mono">{session._id}</div>
        </div>
        <div className="session-detail-actions">
          <a className="btn btn-secondary" href={`#/chat/${session._id}`}>Open in Chat</a>
          <a className="btn btn-ghost" href="#/sessions">Back to Sessions</a>
        </div>
      </div>

      <div className="session-stat-grid">
        <div className="stat-card"><div className="stat-card-value">{summary.messageCount}</div><div className="stat-card-label">Messages</div></div>
        <div className="stat-card"><div className="stat-card-value">{summary.traceCount}</div><div className="stat-card-label">AI traces</div></div>
        <div className="stat-card"><div className="stat-card-value">{summary.pipelineEventCount}</div><div className="stat-card-label">Pipeline events</div></div>
        <div className="stat-card"><div className="stat-card-value">{summary.eventCount}</div><div className="stat-card-label">Trace events</div></div>
        <div className="stat-card"><div className="stat-card-value">{formatDuration(summary.totalTraceMs)}</div><div className="stat-card-label">Tracked latency</div></div>
      </div>

      <div className="session-tabs" role="tablist" aria-label="Session metadata tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`session-tab${activeTab === tab.id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="session-tab-panel">
        {renderTab(activeTab, session, traces, summary)}
      </div>
    </section>
  );
}

function renderTab(tab, session, traces, summary) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  if (tab === 'overview') return <OverviewTab session={session} summary={summary} />;
  if (tab === 'messages') return <MessagesTab messages={messages} />;
  if (tab === 'events') return <EventsTab traces={traces} />;
  if (tab === 'reasoning') return <ReasoningTab messages={messages} traces={traces} />;
  if (tab === 'io') return <InputsOutputsTab messages={messages} traces={traces} />;
  if (tab === 'latency') return <LatencyTab traces={traces} />;
  if (tab === 'agents') return <AgentsTab session={session} traces={traces} />;
  if (tab === 'cost') return <CostTab traces={traces} summary={summary} />;
  if (tab === 'attachments') return <AttachmentsTab messages={messages} traces={traces} />;
  if (tab === 'triage') return <TriageTab session={session} traces={traces} />;
  if (tab === 'audit') return <AuditTab session={session} traces={traces} />;
  return <PlannedTab />;
}

function OverviewTab({ session, summary }) {
  return (
    <div className="session-grid-two">
      <MetadataTable rows={[
        ['Title', getSessionTitle(session)],
        ['Provider', getProviderLabel(session.provider || '')],
        ['Created', formatDateTime(session.createdAt)],
        ['Updated', formatDateTime(session.updatedAt)],
        ['Linked escalation', session.escalationId || 'None'],
        ['Forked from', session.forkedFrom || 'None'],
        ['Fork message index', session.forkMessageIndex ?? 'None'],
      ]} />
      <MetadataTable rows={[
        ['User messages', summary.userMessages],
        ['Assistant messages', summary.assistantMessages],
        ['Reasoning captures', summary.reasoningCount],
        ['Trace events', summary.eventCount],
        ['Total tokens', formatTokens(summary.totalTokens)],
        ['Estimated cost', formatCostMicros(summary.totalCostMicros)],
      ]} />
    </div>
  );
}

function MessagesTab({ messages }) {
  if (messages.length === 0) return <EmptyPanel text="No saved messages in this session." />;
  return (
    <div className="session-message-list">
      {messages.map((message, index) => (
        <article key={`${message.timestamp || index}-${message.role}`} className="session-message">
          <header>
            <span className="session-chip">{message.role}</span>
            <span>{formatDateTime(message.timestamp)}</span>
            {message.provider ? <span>{getProviderLabel(message.provider)}</span> : null}
          </header>
          <p>{message.content || '(empty message)'}</p>
        </article>
      ))}
    </div>
  );
}

function EventsTab({ traces }) {
  const events = traces.flatMap((trace) => (trace.events || []).map((event) => ({ ...event, traceId: trace._id || trace.id, service: trace.service })));
  if (events.length === 0) return <EmptyPanel text="No trace events are stored for this session yet." planned="Future event storage should include every agent task event, tool event, UI event, and recovery event." />;
  return (
    <table className="table">
      <thead><tr><th>Time</th><th>Service</th><th>Event</th><th>Status</th><th>Elapsed</th></tr></thead>
      <tbody>
        {events.map((event, index) => (
          <tr key={`${event.traceId}-${event.key}-${index}`}>
            <td>{formatDateTime(event.at)}</td>
            <td>{event.service}</td>
            <td>{event.label || event.key || '--'}</td>
            <td>{event.status || 'info'}</td>
            <td>{formatDuration(event.elapsedMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReasoningTab({ messages, traces }) {
  const reasoningMessages = messages.filter((message) => typeof message.thinking === 'string' && message.thinking.trim());
  const firstThinking = traces.filter((trace) => Number(trace?.outcome?.firstThinkingMs) > 0);
  return (
    <div className="session-stack">
      {reasoningMessages.length > 0 ? reasoningMessages.map((message, index) => (
        <div className="session-code-panel" key={`${message.timestamp || index}-thinking`}>
          <div className="session-code-title">Captured assistant reasoning · {formatDateTime(message.timestamp)}</div>
          <pre>{message.thinking}</pre>
        </div>
      )) : (
        <EmptyPanel text="No reasoning text is stored on the saved messages." planned="Future session history should separate visible answer text from private reasoning policy, summaries, and agent thinking checkpoints." />
      )}
      {firstThinking.length > 0 ? (
        <MetadataTable rows={firstThinking.map((trace) => [
          trace.requestId || trace._id,
          `First reasoning token: ${formatDuration(trace.outcome.firstThinkingMs)}`,
        ])} />
      ) : null}
    </div>
  );
}

function InputsOutputsTab({ messages, traces }) {
  const rows = messages.map((message, index) => [
    `#${index + 1} ${message.role}`,
    `${(message.content || '').length.toLocaleString()} chars`,
    message.images?.length ? `${message.images.length} image(s)` : 'No images',
    message.modelUsed || message.provider || '--',
  ]);
  return (
    <div className="session-stack">
      <MetadataTable rows={[
        ['Stored message turns', messages.length],
        ['Trace prompt previews', traces.filter((trace) => trace.promptPreview).length],
        ['Image traces', traces.filter((trace) => trace.hasImages).length],
      ]} />
      <table className="table">
        <thead><tr><th>Turn</th><th>Content</th><th>Attachments</th><th>Model/provider</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function LatencyTab({ traces }) {
  if (traces.length === 0) return <EmptyPanel text="No latency traces are stored for this session yet." planned="Planned latency history should include queue time, tool time, model time, stream time, UI render delay, and retry delay." />;
  return (
    <table className="table">
      <thead><tr><th>Trace</th><th>Status</th><th>Total</th><th>First reasoning</th><th>First output</th><th>Completed</th></tr></thead>
      <tbody>
        {traces.map((trace) => (
          <tr key={trace._id || trace.id}>
            <td className="mono">{trace.requestId || trace._id}</td>
            <td>{trace.status}</td>
            <td>{formatDuration(trace.outcome?.totalMs)}</td>
            <td>{formatDuration(trace.outcome?.firstThinkingMs)}</td>
            <td>{formatDuration(trace.outcome?.firstChunkMs)}</td>
            <td>{formatDateTime(trace.outcome?.completedAt || trace.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AgentsTab({ session, traces }) {
  const agentRows = [
    ['Main chat agent', session.provider ? getProviderLabel(session.provider) : 'Tracked as session provider', 'Current'],
    ['Parser agent', traces.some((trace) => trace.service === 'parse') ? 'Trace-backed' : 'No parse trace for this session', traces.some((trace) => trace.service === 'parse') ? 'Current' : 'Planned'],
    ['Router / copilot agents', 'Per-agent task history not persisted here yet', 'Planned'],
    ['Room agents', 'Agent-to-agent task events and handoff metadata', 'Planned'],
  ];
  return <MetadataTable rows={agentRows} />;
}

function CostTab({ traces, summary }) {
  return (
    <div className="session-stack">
      <MetadataTable rows={[
        ['Tracked tokens', formatTokens(summary.totalTokens)],
        ['Tracked cost', formatCostMicros(summary.totalCostMicros)],
        ['Usage-bearing traces', traces.filter((trace) => getTraceTokenTotal(trace) > 0).length],
      ]} />
      <table className="table">
        <thead><tr><th>Trace</th><th>Model</th><th>Input</th><th>Output</th><th>Total</th><th>Cost</th></tr></thead>
        <tbody>
          {traces.map((trace) => (
            <tr key={trace._id || trace.id}>
              <td className="mono">{trace.requestId || trace._id}</td>
              <td>{trace.outcome?.modelUsed || trace.requested?.primaryModel || '--'}</td>
              <td>{formatTokens(trace.usage?.inputTokens)}</td>
              <td>{formatTokens(trace.usage?.outputTokens)}</td>
              <td>{formatTokens(trace.usage?.totalTokens)}</td>
              <td>{formatCostMicros(trace.usage?.totalCostMicros)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttachmentsTab({ messages, traces }) {
  const messageImages = messages.reduce((sum, message) => sum + (Array.isArray(message.images) ? message.images.length : 0), 0);
  const traceImages = traces.flatMap((trace) => trace.images || []);
  return (
    <div className="session-stack">
      <MetadataTable rows={[
        ['Saved message images', messageImages],
        ['Trace image records', traceImages.length],
        ['Prepared image bytes tracked', traces.some((trace) => trace.imageStats?.preparedBytesTotal) ? 'Yes' : 'Not yet'],
      ]} />
      {traceImages.length === 0 ? <EmptyPanel text="No detailed attachment metadata is stored for this session." planned="Planned attachment metadata should include source filename, OCR text, transformations, retention status, and evidence links." /> : (
        <table className="table">
          <thead><tr><th>Name</th><th>Type</th><th>Original</th><th>Prepared</th></tr></thead>
          <tbody>{traceImages.map((image, index) => <tr key={`${image.name}-${index}`}><td>{image.name || `Image ${index + 1}`}</td><td>{image.mimeType || '--'}</td><td>{image.originalBytes || '--'} bytes</td><td>{image.preparedBytes || '--'} bytes</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

function TriageTab({ session, traces }) {
  const intake = session.caseIntake || {};
  const triageTraces = traces.filter((trace) => trace.triage || trace.postParse);
  return (
    <div className="session-stack">
      <MetadataTable rows={[
        ['Case intake status', intake.status || 'none'],
        ['Follow-ups tracked', Array.isArray(intake.followUps) ? intake.followUps.length : 0],
        ['Runs tracked', Array.isArray(intake.runs) ? intake.runs.length : 0],
        ['Triage traces', triageTraces.length],
      ]} />
      {triageTraces.length === 0 ? <EmptyPanel text="No triage trace details are attached to this session." planned="Planned triage history should preserve extracted fields, validation issues, confidence changes, and final case creation decisions." /> : null}
    </div>
  );
}

function AuditTab({ session, traces }) {
  return (
    <div className="session-stack">
      <MetadataTable rows={[
        ['Session created', formatDateTime(session.createdAt)],
        ['Session updated', formatDateTime(session.updatedAt)],
        ['Trace count', traces.length],
        ['Request IDs', traces.map((trace) => trace.requestId).filter(Boolean).join(', ') || 'None'],
      ]} />
      <EmptyPanel text="User-visible audit history is only partially represented today." planned="Planned audit should include actor, source surface, rename/delete/export actions, policy decisions, and immutable event IDs." />
    </div>
  );
}

function PlannedTab() {
  return (
    <div className="session-planned-grid">
      {PLANNED_FIELDS.map((field) => (
        <div className="session-planned-item" key={field}>
          <PlannedBadge>Future planned</PlannedBadge>
          <strong>{field}</strong>
        </div>
      ))}
    </div>
  );
}

function MetadataTable({ rows }) {
  return (
    <table className="table session-metadata-table">
      <tbody>
        {rows.map((row) => (
          <tr key={`${row[0]}-${row[1]}-${row[2] || ''}`}>
            <td>{row[0]}</td>
            <td>{row[1]}</td>
            {row.length > 2 ? <td><PlannedBadge>{row[2]}</PlannedBadge></td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyPanel({ text, planned = '' }) {
  return (
    <div className="session-empty-panel">
      <div>{text}</div>
      {planned ? <p>{planned}</p> : null}
    </div>
  );
}

function IconSearch() {
  return (
    <svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}
