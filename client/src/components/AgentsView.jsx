import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createAgentIdentity,
  getAgentIdentity,
  getAgentIdentityHistory,
  importAgentIdentities,
  deleteImageParserTestResult,
  listAgentTestAssets,
  listImageParserTestResults,
  listImageParserHistory,
  listTriageTestResults,
  listTriageTestCases,
  listAgentIdentities,
  programmaticCheckImageParserTestResult,
  recordAgentHarnessRun,
  recordAgentReview,
  retestImageParserTestResult,
  updateImageParserTestResult,
  updateTriageTestResult,
  updateAgentIdentity,
  updateAgentEnabled,
  updateAgentRuntime,
  uploadImageParserTestAsset,
} from '../api/agentIdentitiesApi.js';
import {
  getAgentPrompt,
  getAgentPromptVersion,
  listAgentPromptVersions,
  updateAgentPrompt,
} from '../api/agentPromptsApi.js';
import {
  getEventStats,
  listConversationStageEvents,
} from '../api/chatApi.js';
import {
  dispatchAgentRuntimeDefaultsApplied,
  getAgentRuntimeDefinition,
  getAgentRuntimeEffectiveModel,
  getAgentRuntimeModelPlaceholder,
  getAgentRuntimeModelSuggestions,
  getAgentRuntimeProviderLabel,
  getAgentRuntimeSummary,
  normalizeAgentRuntimeState,
  readAgentRuntimeState,
  writeAgentRuntimeState,
} from '../lib/agentRuntimeSettings.js';
import { dispatchAgentProfileUpdated } from '../lib/agentIdentityEvents.js';
import {
  getImageParserDeterminismProfile,
} from '../lib/imageParserCatalog.js';
import {
  CODEX_SERVICE_TIER_OPTIONS,
  PROVIDER_OPTIONS,
  getProviderIconPath,
  getProviderMeta,
  getReasoningEffortOptions,
  isProviderModelEnabled,
  providerSupportsCodexServiceTier,
} from '../lib/providerCatalog.js';
import useProviderKeyStatus from '../hooks/useProviderKeyStatus.js';
import useTriageBatchRun from '../hooks/useTriageBatchRun.js';
import { isProviderMissingApiKey } from '../lib/providerKeyStatus.js';
import { useAgentRegistry } from '../context/AgentRegistryContext.jsx';
import { useAgentTestModal } from './agent-tests/AgentTestModalProvider.jsx';
import { isAgentTestSupported } from './agent-tests/agentTestHarnesses.js';
import ConfirmModal from './ConfirmModal.jsx';
import WorkspaceAgentOperationsTab from './WorkspaceAgentOperationsTab.jsx';
import { getAgentProfileTabs, resolveAgentProfileTab } from './agentProfileTabs.js';
// healthStatusToOperationalToken converts the registry's health.status tokens
// (online/offline/disabled/unknown) into the legacy operational tokens
// (active/degraded/disabled/idle) that drive the status-dot-* CSS classes
// declared in AgentsView.css. Shared with PipelineSidebar (Step 5), the
// upcoming boot overlay (Step 7), and inline save-time recheck (Step 6).
import {
  healthStatusToOperationalToken,
  buildDotTooltip,
  healthStatusLabel,
  formatLastChecked,
} from '../lib/agentStatus.js';
import {
  PIPELINE_TOPOLOGY,
  pipelineNodeLabel,
  pipelinePosition,
} from './chat-v5/pipelineRuntime.js';
import { STAGE_LABELS } from './chat-v5/mockData.js';
import './AgentsView.css';
import './AgentOverviewTab.css';

const PROFILE_FIELDS = [
  { key: 'roleTitle', label: 'Agent name', type: 'text' },
  { key: 'displayName', label: 'Short display alias', type: 'text' },
  { key: 'headline', label: 'Headline', type: 'textarea' },
  { key: 'tone', label: 'Tone', type: 'text' },
  { key: 'conversationalStyle', label: 'Conversation style', type: 'textarea' },
  { key: 'quirks', label: 'Quirks', type: 'textarea' },
  { key: 'boundaries', label: 'Boundaries', type: 'textarea' },
  { key: 'initiativeLevel', label: 'Initiative level', type: 'text' },
  { key: 'socialStyle', label: 'Social style', type: 'textarea' },
  { key: 'communityStyle', label: 'Community style', type: 'textarea' },
  { key: 'selfImprovementStyle', label: 'Self-improvement style', type: 'textarea' },
  { key: 'soul', label: 'Agent soul', type: 'textarea' },
  { key: 'routingBias', label: 'Routing bias', type: 'textarea' },
  { key: 'avatarEmoji', label: 'Avatar emoji', type: 'text' },
  { key: 'avatarPrompt', label: 'Avatar prompt', type: 'textarea' },
];

const emptyProfile = PROFILE_FIELDS.reduce((acc, field) => {
  acc[field.key] = '';
  return acc;
}, {});

const AGENT_OPERATION_META = {
  chat: {
    department: 'Conversation Ops',
    owner: 'Ava Chen',
    team: 'Escalation Desk',
    risk: 'Medium',
    trust: 4.7,
    reviewStatus: 'Human-reviewed',
    permissions: 'Read/write: conversations, notes, workspace context',
    escalationPolicy: 'Hands off to expert review when confidence drops below 0.72.',
    workflows: ['Escalation Intake', 'Live Expert Assist', 'Context Builder', 'Response Drafting', 'Follow-up Capture'],
    channels: ['Web', 'Workspace', 'API'],
    harnessType: 'Conversation orchestration',
    latencyTarget: '< 10s',
  },
  'escalation-template-parser': {
    department: 'Intake Reliability',
    owner: 'Maya Patel',
    team: 'Parser Ops',
    risk: 'Low',
    trust: 4.8,
    reviewStatus: 'Deterministic',
    permissions: 'Read: submitted escalation text',
    escalationPolicy: 'Reject ambiguous extraction rather than inventing missing fields.',
    workflows: ['Template Intake', 'Form Normalization', 'Evidence Mapping', 'Parser QA'],
    channels: ['API', 'Workspace'],
    harnessType: 'Deterministic parser checks',
    latencyTarget: '< 2s',
  },
  'known-issue-search-agent': {
    department: 'Knowledge Ops',
    owner: 'David Park',
    team: 'Investigation Support',
    risk: 'Low',
    trust: 4.5,
    reviewStatus: 'Human-reviewed',
    permissions: 'Read: investigations, known issue records, evidence references',
    escalationPolicy: 'Surface likely matches with evidence and confidence bands.',
    workflows: ['Issue Search', 'Evidence Lookup', 'Duplicate Detection', 'Knowledge Update'],
    channels: ['Workspace', 'API'],
    harnessType: 'Retrieval quality checks',
    latencyTarget: '< 8s',
  },
  'follow-up-chat-parser': {
    department: 'Follow-up Ops',
    owner: 'Noah Kim',
    team: 'Escalation Desk',
    risk: 'Low',
    trust: 4.2,
    reviewStatus: 'Human-reviewed',
    permissions: 'Read: follow-up thread content',
    escalationPolicy: 'Route only explicit next actions and unresolved blockers.',
    workflows: ['Thread Intake', 'Action Extraction', 'Owner Routing', 'Follow-up Review'],
    channels: ['Chat', 'Workspace'],
    harnessType: 'Conversation parse regression',
    latencyTarget: '< 5s',
  },
  workspace: {
    department: 'Workspace Automation',
    owner: 'Ava Chen',
    team: 'Platform Ops',
    risk: 'High',
    trust: 4.4,
    reviewStatus: 'Human-reviewed',
    permissions: 'Read/write: workspace actions, memory, messages, calendar hooks',
    escalationPolicy: 'Request review before irreversible workspace mutations.',
    workflows: ['Workspace Memory', 'Notification Center', 'Task Routing', 'Auto Action Review', 'Shipment Tracker'],
    channels: ['Workspace', 'Gmail', 'Calendar', 'API'],
    harnessType: 'Action safety harness',
    latencyTarget: '< 15s',
  },
  copilot: {
    department: 'Guided Operations',
    owner: 'Maya Patel',
    team: 'Expert Desk',
    risk: 'Medium',
    trust: 4.5,
    reviewStatus: 'Human-reviewed',
    permissions: 'Read: current workspace and escalation context',
    escalationPolicy: 'Recommend next action, defer execution to the operator.',
    workflows: ['Next Step Coaching', 'Evidence Checklist', 'Draft Review', 'Operator Handoff'],
    channels: ['Workspace', 'Web'],
    harnessType: 'Guidance quality review',
    latencyTarget: '< 10s',
  },
  'image-analyst': {
    department: 'Visual Evidence',
    owner: 'David Park',
    team: 'Parser Ops',
    risk: 'Medium',
    trust: 4.1,
    reviewStatus: 'Review overdue',
    permissions: 'Read: uploaded screenshots and OCR output',
    escalationPolicy: 'Never infer sensitive fields without visual evidence.',
    workflows: ['Screenshot Intake', 'OCR Assist', 'Evidence Extraction', 'Human Verification'],
    channels: ['Image Upload', 'Workspace', 'API'],
    harnessType: 'Vision extraction review',
    latencyTarget: '< 20s',
  },
};

const STATUS_LABELS = {
  active: 'Active',
  idle: 'Idle',
  review: 'Needs Attention',
  degraded: 'Degraded',
  disabled: 'Off',
};

function AgentsView({ agentIdFromRoute = null, profileTabFromRoute = null }) {
  const { openAgentTest } = useAgentTestModal();
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState(agentIdFromRoute);
  const [currentAgent, setCurrentAgent] = useState(null);
  const [query, setQuery] = useState('');
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [error, setError] = useState(null);
  const [profileDraft, setProfileDraft] = useState(emptyProfile);
  const [profileSummary, setProfileSummary] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [enabledSaving, setEnabledSaving] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [promptState, setPromptState] = useState(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSummary, setPromptSummary] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState(null);
  const [previewVersion, setPreviewVersion] = useState(null);
  const [runtimeSelections, setRuntimeSelections] = useState({});
  const [runtimeSaveStatus, setRuntimeSaveStatus] = useState(null);
  // Inline save-time recheck result shown in RuntimeSettingsPanel beside the
  // Save button (Step 6 of the agent-registry-bootstrap plan). Shape:
  //   { agentId, status, message, latencyMs }
  // status is one of: 'checking' | 'online' | 'offline' | 'disabled'
  //                   | 'unknown' | 'failed'
  // `checking` is the in-flight state shown while we await the forced refresh.
  // The result auto-clears 10 seconds after a terminal state lands so stale
  // messages from earlier saves don't pile up in the panel.
  const [runtimeRecheckResult, setRuntimeRecheckResult] = useState(null);
  const runtimeRecheckTimeoutRef = useRef(null);
  const [activeProfileTab, setActiveProfileTab] = useState(
    resolveAgentProfileTab(agentIdFromRoute, profileTabFromRoute)
  );
  const [registryModalMode, setRegistryModalMode] = useState(null);
  const [registrySaving, setRegistrySaving] = useState(false);
  const [registryMessage, setRegistryMessage] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [harnessSaving, setHarnessSaving] = useState(false);
  const [parserTestResults, setParserTestResults] = useState({ results: [], stats: null, dbAvailable: true });
  const [parserTestResultsLoading, setParserTestResultsLoading] = useState(false);
  const [parserTestResultsError, setParserTestResultsError] = useState(null);
  const [parserResultPreview, setParserResultPreview] = useState(null);
  const [parserDeleteTarget, setParserDeleteTarget] = useState(null);
  const [parserDeleteSaving, setParserDeleteSaving] = useState(false);
  // Stage 4 Triage Agent results state. Mirrors the parser state above so
  // the new TriageAgentTestResultsTab can reuse the same loading/error/stats
  // patterns.
  const [triageTestResults, setTriageTestResults] = useState({ results: [], stats: null, dbAvailable: true });
  const [triageTestResultsLoading, setTriageTestResultsLoading] = useState(false);
  const [triageTestResultsError, setTriageTestResultsError] = useState(null);
  const [testAssetsByAgentId, setTestAssetsByAgentId] = useState({});
  const [testAssetsLoading, setTestAssetsLoading] = useState(false);
  const [testAssetsError, setTestAssetsError] = useState(null);
  const [testAssetUploadState, setTestAssetUploadState] = useState({ saving: false, error: '', message: '' });
  const testAssetFileInputRef = useRef(null);
  const [parserHistory, setParserHistory] = useState({ results: [], total: 0 });
  const [parserSavedEvents, setParserSavedEvents] = useState([]);
  const [parserHistoryLoading, setParserHistoryLoading] = useState(false);
  const [parserHistoryError, setParserHistoryError] = useState(null);
  const [parserEventStats, setParserEventStats] = useState(null);
  const [parserSessions, setParserSessions] = useState([]);
  const [parserSessionsLoading, setParserSessionsLoading] = useState(false);
  const [parserSessionsError, setParserSessionsError] = useState(null);
  const [lifecycleModal, setLifecycleModal] = useState(null);
  const selectedAgentRequestRef = useRef(0);

  const loadAgents = useCallback(async () => {
    try {
      setLoadingAgents(true);
      const nextAgents = await listAgentIdentities();
      setAgents(nextAgents);
      const nextRuntimeSelections = {};
      nextAgents.forEach((agent) => {
        if (agent?.agentId) {
          nextRuntimeSelections[agent.agentId] =
            agent.runtime || readAgentRuntimeState(agent.agentId);
        }
      });
      setRuntimeSelections(nextRuntimeSelections);
      setError(null);
      if (!selectedAgentId && nextAgents.length) {
        setSelectedAgentId(agentIdFromRoute || nextAgents[0].agentId);
      }
    } catch (err) {
      setError(err.message || 'Failed to load agent identities.');
    } finally {
      setLoadingAgents(false);
    }
  }, [agentIdFromRoute, selectedAgentId]);

  const loadSelectedAgent = useCallback(
    async (agentId) => {
      const requestId = selectedAgentRequestRef.current + 1;
      selectedAgentRequestRef.current = requestId;

      if (!agentId) {
        setCurrentAgent(null);
        return;
      }
      try {
        setLoadingCurrent(true);
        setCurrentAgent(null);
        const agent = await getAgentIdentity(agentId);
        if (selectedAgentRequestRef.current !== requestId) return;
        setCurrentAgent(agent || null);
        if (agent?.agentId) {
          setRuntimeSelections((previous) => ({
            ...previous,
            [agent.agentId]:
              agent.runtime || readAgentRuntimeState(agent.agentId),
          }));
        }
        setError(null);
      } catch (err) {
        if (selectedAgentRequestRef.current !== requestId) return;
        setError(err.message || 'Failed to load selected agent.');
      } finally {
        if (selectedAgentRequestRef.current === requestId) {
          setLoadingCurrent(false);
        }
      }
    },
    []
  );

  const loadParserTestResults = useCallback(async () => {
    try {
      setParserTestResultsLoading(true);
      const data = await listImageParserTestResults({ limit: 80 });
      setParserTestResults({
        results: data.results || [],
        stats: data.stats || null,
        dbAvailable: data.dbAvailable !== false,
      });
      setParserTestResultsError(null);
    } catch (err) {
      setParserTestResultsError(err.message || 'Failed to load parser test results.');
    } finally {
      setParserTestResultsLoading(false);
    }
  }, []);

  const loadTriageTestResults = useCallback(async () => {
    try {
      setTriageTestResultsLoading(true);
      const data = await listTriageTestResults({ limit: 80 });
      setTriageTestResults({
        results: data.results || [],
        stats: data.stats || null,
        dbAvailable: data.dbAvailable !== false,
      });
      setTriageTestResultsError(null);
    } catch (err) {
      setTriageTestResultsError(err.message || 'Failed to load triage test results.');
    } finally {
      setTriageTestResultsLoading(false);
    }
  }, []);

  // "Run all" batch runner for the triage test surface. Runs every approved
  // escalation case sequentially (the server enforces single-flight) and shows
  // live progress. We refresh the results table when the batch finishes so the
  // operator sees all the new runs without a manual refresh.
  const handleTriageBatchCaseComplete = useCallback(() => {
    // Intentionally light: a per-case refetch of 15 results would thrash the
    // table. The batch's done-handler below refreshes once at the end.
  }, []);
  const triageBatch = useTriageBatchRun({ onCaseComplete: handleTriageBatchCaseComplete });
  const triageBatchRunningRef = useRef(false);
  useEffect(() => {
    // When the batch transitions running -> done, refresh the results table once.
    if (triageBatch.progress.running) {
      triageBatchRunningRef.current = true;
      return;
    }
    if (triageBatchRunningRef.current && triageBatch.progress.done) {
      triageBatchRunningRef.current = false;
      loadTriageTestResults();
    }
  }, [triageBatch.progress.running, triageBatch.progress.done, loadTriageTestResults]);

  const loadTestAssetsForAgent = useCallback(async (agentId = selectedAgentId) => {
    const cleanAgentId = String(agentId || '').trim();
    if (!cleanAgentId) return null;
    try {
      setTestAssetsLoading(true);
      const data = await listAgentTestAssets(cleanAgentId);
      setTestAssetsByAgentId((previous) => ({
        ...previous,
        [cleanAgentId]: data || { ok: true, agentId: cleanAgentId, assets: [], stats: {} },
      }));
      setTestAssetsError(null);
      return data;
    } catch (err) {
      setTestAssetsError(err.message || 'Failed to load test assets.');
      return null;
    } finally {
      setTestAssetsLoading(false);
    }
  }, [selectedAgentId]);

  const loadParserEventStreams = useCallback(async () => {
    try {
      setParserHistoryLoading(true);
      setParserHistoryError(null);
      const [historyData, eventStats, stageEvents] = await Promise.all([
        listImageParserHistory({ limit: 25 }),
        getEventStats(),
        listConversationStageEvents('parser', 100),
      ]);
      setParserHistory({
        results: Array.isArray(historyData?.results) ? historyData.results : [],
        total: historyData?.total || 0,
      });
      setParserSavedEvents(buildParserSavedEvents(stageEvents?.events || []));
      setParserSessions(stageEvents?.sessions || []);
      setParserEventStats(eventStats || null);
    } catch (err) {
      setParserHistoryError(err.message || 'Failed to load image parser event streams.');
    } finally {
      setParserHistoryLoading(false);
    }
  }, []);

  const loadParserChatSessions = useCallback(async () => {
    try {
      setParserSessionsLoading(true);
      setParserSessionsError(null);
      const stageEvents = await listConversationStageEvents('parser', 100);
      setParserSessions((stageEvents?.sessions || []).slice(0, 25));
    } catch (err) {
      setParserSessionsError(err.message || 'Failed to load image parser chat sessions.');
    } finally {
      setParserSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (agentIdFromRoute && agentIdFromRoute !== selectedAgentId) {
      setSelectedAgentId(agentIdFromRoute);
    }
  }, [agentIdFromRoute, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId !== 'escalation-template-parser' && activeProfileTab === 'test-results') {
      setActiveProfileTab('overview');
    }
  }, [activeProfileTab, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId !== 'triage-agent' && activeProfileTab === 'triage-test-results') {
      setActiveProfileTab('overview');
    }
  }, [activeProfileTab, selectedAgentId]);

  useEffect(() => {
    if (
      selectedAgentId !== 'escalation-template-parser'
      && (activeProfileTab === 'event-streams' || activeProfileTab === 'chat-sessions')
    ) {
      setActiveProfileTab('overview');
    }
  }, [activeProfileTab, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId) {
      loadSelectedAgent(selectedAgentId);
    }
  }, [loadSelectedAgent, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId === 'escalation-template-parser' && activeProfileTab === 'test-results') {
      loadParserTestResults();
    }
  }, [activeProfileTab, loadParserTestResults, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId === 'triage-agent' && activeProfileTab === 'triage-test-results') {
      loadTriageTestResults();
    }
  }, [activeProfileTab, loadTriageTestResults, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId && activeProfileTab === 'test-assets') {
      loadTestAssetsForAgent(selectedAgentId);
    }
  }, [activeProfileTab, loadTestAssetsForAgent, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId === 'escalation-template-parser' && activeProfileTab === 'event-streams') {
      loadParserEventStreams();
    }
  }, [activeProfileTab, loadParserEventStreams, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId === 'escalation-template-parser' && activeProfileTab === 'chat-sessions') {
      loadParserChatSessions();
    }
  }, [activeProfileTab, loadParserChatSessions, selectedAgentId]);

  useEffect(() => {
    setHistory(null);
    setHistoryError(null);
    setPromptState(null);
    setPromptDraft('');
    setPromptSummary('');
    setPromptError(null);
    setPreviewVersion(null);
    setRuntimeSaveStatus(null);
    setRuntimeRecheckResult(null);
    setTestAssetsError(null);
    setTestAssetUploadState({ saving: false, error: '', message: '' });
    if (runtimeRecheckTimeoutRef.current) {
      clearTimeout(runtimeRecheckTimeoutRef.current);
      runtimeRecheckTimeoutRef.current = null;
    }
    setActiveProfileTab(resolveAgentProfileTab(selectedAgentId, profileTabFromRoute));
  }, [profileTabFromRoute, selectedAgentId]);

  useEffect(() => {
    if (!currentAgent) {
      setProfileDraft(emptyProfile);
      setProfileSummary('');
      return;
    }
    setProfileDraft({ ...emptyProfile, ...(currentAgent.profile || {}) });
    setProfileSummary('');
  }, [currentAgent]);

  // Clear any pending inline-recheck auto-dismiss timer on unmount so the
  // setState callback can't fire on a torn-down component.
  useEffect(() => () => {
    if (runtimeRecheckTimeoutRef.current) {
      clearTimeout(runtimeRecheckTimeoutRef.current);
      runtimeRecheckTimeoutRef.current = null;
    }
  }, []);

  const selectedAgent = currentAgent?.agentId === selectedAgentId
    ? currentAgent
    : agents.find((agent) => agent.agentId === selectedAgentId) || null;
  const selectedRuntimeState = selectedAgent?.agentId ? runtimeSelections[selectedAgent.agentId] : null;
  const selectedRuntimeDefinition = selectedAgent?.agentId
    ? getAgentRuntimeDefinition(selectedAgent.agentId)
    : null;

  // Subscribe to the agent registry so every status dot on this page reflects
  // real provider reachability instead of the static AGENT_OPERATION_META
  // table. We read the registry once here (a single hook call at the top of
  // the component) so we don't violate the Rules of Hooks inside the agent
  // list's render loop. The map below converts the registry's health.status
  // tokens into the legacy operational tokens that the rest of this file
  // (CSS classes, attention-list filter, sparkline tone) already understands.
  const agentRegistry = useAgentRegistry();
  // Build the live-status map by iterating the page's `agents` list (the
  // authoritative set of visible rows), NOT the registry's keys. Reason:
  // an agent that the API list returned but the registry hasn't observed yet
  // (custom agent added mid-session, or any agent before the registry's first
  // poll lands) would otherwise be missing from this map, and the downstream
  // CSS class becomes `status-dot-undefined` — an unstyled, invisible dot.
  // Iterating over `agents` guarantees every rendered row gets a defined
  // operational token; healthStatusToOperationalToken falls back to 'idle'
  // for any registry entry whose health hasn't been populated yet. See
  // cto-review finding H2.
  const liveStatusByAgentId = useMemo(() => {
    const map = {};
    const registryAgents = agentRegistry?.agents || {};
    for (const agent of agents) {
      const id = agent?.agentId;
      if (!id) continue;
      map[id] = healthStatusToOperationalToken(
        registryAgents[id]?.health?.status,
      );
    }
    return map;
  }, [agentRegistry, agents]);

  // Raw per-agent health (status + checkedAt) plumbed through to dot
  // tooltips so they can render "Online · last checked 12s ago" per AC#13.
  // The legacy operational token (above) only carries the *color* category;
  // tooltips need the registry's raw `status` (online/offline/...) plus the
  // `checkedAt` ISO timestamp from the health service.
  const registryHealthById = useMemo(() => {
    const map = {};
    const registryAgents = agentRegistry?.agents || {};
    for (const agent of agents) {
      const id = agent?.agentId;
      if (!id) continue;
      const health = registryAgents[id]?.health || null;
      map[id] = {
        status: health?.status || 'unknown',
        checkedAt: health?.checkedAt || null,
      };
    }
    return map;
  }, [agentRegistry, agents]);

  const operationalProfiles = useMemo(
    () =>
      agents.map((agent) =>
        buildOperationalProfile(
          agent,
          runtimeSelections[agent.agentId],
          liveStatusByAgentId[agent.agentId],
        )
      ),
    [agents, runtimeSelections, liveStatusByAgentId]
  );

  const operationById = useMemo(() => {
    const map = new Map();
    operationalProfiles.forEach((operation) => map.set(operation.agentId, operation));
    return map;
  }, [operationalProfiles]);

  const selectedOperation = useMemo(() => {
    if (!selectedAgent) {
      return null;
    }
    return buildOperationalProfile(
      selectedAgent,
      selectedRuntimeState,
      liveStatusByAgentId[selectedAgent.agentId],
    );
  }, [selectedAgent, selectedRuntimeState, liveStatusByAgentId]);

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return agents.filter((agent) => {
      const operation = operationById.get(agent.agentId);
      const matchesQuery = !normalizedQuery || agentSearchText(agent, operation).includes(normalizedQuery);
      return matchesQuery;
    });
  }, [agents, operationById, query]);

  async function loadHistoryForSelectedAgent() {
    if (!selectedAgent?.agentId) {
      return;
    }
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      const historyPayload = await getAgentIdentityHistory(selectedAgent.agentId);
      setHistory(buildIdentityHistoryState(historyPayload));
    } catch (err) {
      setHistoryError(err.message || 'Failed to load identity history.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadPromptForSelectedAgent() {
    if (!selectedAgent?.agentId) {
      return;
    }
    if (!selectedAgent.promptId) {
      setPromptError('This agent does not have an editable prompt surface.');
      setPromptState(null);
      setPromptDraft('');
      return;
    }
    try {
      setPromptLoading(true);
      setPromptError(null);
      const promptPayload = await getAgentPrompt(selectedAgent.promptId);
      const versions = await listAgentPromptVersions(selectedAgent.promptId);
      const prompt = buildPromptState(promptPayload, versions);
      setPromptState(prompt);
      setPromptDraft(prompt.content || '');
      setPreviewVersion(null);
    } catch (err) {
      setPromptError(err.message || 'Failed to load editable prompt.');
    } finally {
      setPromptLoading(false);
    }
  }

  async function handleSaveProfile() {
    if (!selectedAgent?.agentId) {
      return;
    }
    try {
      setProfileSaving(true);
      const updated = await updateAgentIdentity(selectedAgent.agentId, profileDraft, profileSummary);
      if (updated) {
        setCurrentAgent(updated);
        setAgents((previous) =>
          previous.map((agent) => (agent.agentId === updated.agentId ? updated : agent))
        );
        dispatchAgentProfileUpdated(updated);
      }
      setProfileSummary('');
    } catch (err) {
      setError(err.message || 'Failed to save profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  // Schedule the inline recheck banner to auto-clear after 10s so the panel
  // doesn't accumulate stale "Saved" messages from earlier edits. Any newer
  // recheck attempt (call to scheduleRecheckClear or to runSaveTimeRecheck)
  // resets this timer.
  function scheduleRecheckClear(forAgentId) {
    if (runtimeRecheckTimeoutRef.current) {
      clearTimeout(runtimeRecheckTimeoutRef.current);
      runtimeRecheckTimeoutRef.current = null;
    }
    runtimeRecheckTimeoutRef.current = setTimeout(() => {
      // Only clear if the still-visible result belongs to the same agent; if
      // the user has since switched agents (which resets state anyway) this
      // is a no-op.
      setRuntimeRecheckResult((previous) =>
        previous && previous.agentId === forAgentId ? null : previous,
      );
      runtimeRecheckTimeoutRef.current = null;
    }, 10_000);
  }

  // Run a forced single-agent reachability recheck after a runtime-affecting
  // save and surface the result inline next to the Save button. Honors the
  // memory rule "reachability must be checked at every layer — save-time,
  // per-request pre-flight, AND background monitor."
  //
  //   options.disabled  — true when the user just turned the agent off; we
  //                       skip latency timing because an intentionally-off
  //                       agent is expected to be unreachable.
  async function runSaveTimeRecheck(agentId, options = {}) {
    if (!agentId) return;
    // Show the "Rechecking..." pill immediately so the user sees feedback
    // even before the network roundtrip completes.
    if (runtimeRecheckTimeoutRef.current) {
      clearTimeout(runtimeRecheckTimeoutRef.current);
      runtimeRecheckTimeoutRef.current = null;
    }
    setRuntimeRecheckResult({
      agentId,
      status: 'checking',
      message: 'Rechecking provider...',
      latencyMs: null,
    });
    const startedAt = performance.now();
    let fresh = null;
    try {
      // refreshOne now returns the fresh single-agent payload directly. We
      // MUST read the result from this return value, NOT from
      // agentRegistry?.agents?.[agentId]?.health afterwards. The reason:
      // refreshOne updates the registry via setLocalHealth, but state updates
      // are batched — the closure-captured `agentRegistry` reference in this
      // function still points at the PRE-refresh render's snapshot. Reading
      // the registry here would surface the previous poll's status dressed up
      // as a "Saved · ..." confirmation, falsely confirming saves of broken
      // configs. See cto-review finding H1.
      fresh = await agentRegistry.refreshOne(agentId);
    } catch (err) {
      setRuntimeRecheckResult({
        agentId,
        status: 'failed',
        message: `Saved · Recheck failed: ${err?.message || 'unknown error'}`,
        latencyMs: null,
      });
      scheduleRecheckClear(agentId);
      return;
    }
    const latencyMs = Math.round(performance.now() - startedAt);

    if (options.disabled) {
      setRuntimeRecheckResult({
        agentId,
        status: 'disabled',
        message: 'Saved · Agent disabled',
        latencyMs: null,
      });
      scheduleRecheckClear(agentId);
      return;
    }

    // Health-service responses use `message` for the human-readable detail;
    // the registry's merged shape renames it to `diagnostic`. Accept either
    // because `fresh` here is the raw server payload returned by refreshOne,
    // which uses `message`, not `diagnostic`.
    const status = fresh?.status || 'unknown';
    const updatedDiagnostic = fresh?.diagnostic ?? fresh?.message ?? null;
    if (status === 'online') {
      setRuntimeRecheckResult({
        agentId,
        status,
        message: `Saved · Provider responding at ${latencyMs}ms`,
        latencyMs,
      });
    } else if (status === 'offline') {
      const diagnostic = updatedDiagnostic || 'no diagnostic available';
      setRuntimeRecheckResult({
        agentId,
        status,
        message: `Saved · Provider unreachable: ${diagnostic}`,
        latencyMs,
      });
    } else if (status === 'disabled') {
      setRuntimeRecheckResult({
        agentId,
        status,
        message: 'Saved · Agent disabled',
        latencyMs: null,
      });
    } else if (status === 'degraded') {
      // Server's outer health-refresh ceiling fired (AGENT_HEALTH_REFRESH_TIMEOUT).
      // The save itself persisted; we just couldn't confirm reachability fast
      // enough. Background polling will retry — don't alarm the user.
      setRuntimeRecheckResult({
        agentId,
        status,
        message: 'Saved · Provider reachability still verifying...',
        latencyMs,
      });
    } else {
      // 'unknown' — defensive; awaiting refreshOne should have produced a
      // concrete status, but if the polling engine hasn't merged yet we still
      // show a sensible message rather than a blank pill.
      setRuntimeRecheckResult({
        agentId,
        status: 'unknown',
        message: 'Saved · Recheck pending...',
        latencyMs,
      });
    }
    scheduleRecheckClear(agentId);
  }

  async function handleSaveRuntime(nextRuntime) {
    if (!selectedAgent?.agentId) {
      return;
    }
    const agentId = selectedAgent.agentId;
    try {
      setRuntimeSaveStatus('Saving runtime defaults...');
      const localRuntime = writeAgentRuntimeState(agentId, nextRuntime);
      const updated = await updateAgentRuntime(
        agentId,
        localRuntime,
        `Updated runtime defaults for ${selectedAgent.profile?.roleTitle || agentId}.`
      );
      const updatedRuntime = updated?.runtime || localRuntime;
      setRuntimeSelections((previous) => ({
        ...previous,
        [agentId]: updatedRuntime,
      }));
      applyUpdatedAgent(updated);
      dispatchAgentRuntimeDefaultsApplied({
        [agentId]: updatedRuntime,
      });
      window.dispatchEvent(new CustomEvent('agent-health-refresh'));
      setRuntimeSaveStatus('Runtime defaults saved to server.');
      // Save succeeded; immediately recheck this agent's reachability so the
      // user sees within ~8 seconds whether the new provider/model config
      // actually works. Awaited but not propagated — recheck failures don't
      // back out the save (the runSaveTimeRecheck helper catches its own
      // errors and surfaces them inline).
      runSaveTimeRecheck(agentId);
    } catch (err) {
      setRuntimeSaveStatus(err.message || 'Failed to save runtime defaults.');
      // Save itself failed — leave the inline recheck pill empty so the only
      // visible feedback is the existing save-error message.
    }
  }

  async function handleToggleAgentEnabled(nextEnabled) {
    if (!selectedAgent?.agentId) return;
    const agentLabel = selectedAgent.profile?.roleTitle || selectedAgent.agentId;
    const startedAt = new Date().toISOString();
    const clientLifecycleRun = {
      runId: `client-agent-lifecycle-${Date.now()}`,
      agentId: selectedAgent.agentId,
      direction: nextEnabled ? 'startup' : 'shutdown',
      targetEnabled: nextEnabled,
      status: 'running',
      startedAt,
      completedAt: null,
      durationMs: null,
      counts: { success: 0, warning: 0, error: 0, info: 1 },
      steps: [
        {
          stepId: `client-step-${Date.now()}`,
          sequence: 1,
          name: 'Receive profile toggle change',
          functionName: 'AgentProfileDetailPage.onChange',
          check: 'User changed the agent status control',
          status: 'info',
          summary: `${agentLabel} ${nextEnabled ? 'startup' : 'shutdown'} requested from the profile header.`,
          detail: '',
          startedAt,
          completedAt: startedAt,
          durationMs: 0,
          metadata: { agentId: selectedAgent.agentId, targetEnabled: nextEnabled },
        },
      ],
    };
    setLifecycleModal({ run: clientLifecycleRun, agentName: agentLabel, requestState: 'running' });
    try {
      setEnabledSaving(true);
      const result = await updateAgentEnabled(
        selectedAgent.agentId,
        nextEnabled,
        `${nextEnabled ? 'Enabled' : 'Disabled'} ${agentLabel} globally.`,
        {
          clientSteps: clientLifecycleRun.steps,
          onLifecycleEvent: (event) => {
            setLifecycleModal((previous) => mergeLifecycleStreamEvent(previous, event, agentLabel));
          },
        }
      );
      const updated = result?.agent || result;
      applyUpdatedAgent(updated);
      if (result?.lifecycleRun) {
        setLifecycleModal({ run: result.lifecycleRun, agentName: agentLabel, requestState: 'complete' });
      }
      setHistory((previous) => mergeLifecycleRunIntoHistory(previous, result?.lifecycleRun));
      window.dispatchEvent(new CustomEvent('agent-health-refresh'));
      // Enabled-flag changes affect whether the provider should even be
      // contacted, so trigger a save-time recheck for parity with
      // handleSaveRuntime. When the user just disabled the agent we mark the
      // result as 'disabled' instead of reporting reachability — an
      // intentionally-off agent is expected to be unreachable, and showing
      // "Provider unreachable" would be misleading.
      runSaveTimeRecheck(selectedAgent.agentId, { disabled: nextEnabled === false });
    } catch (err) {
      if (err.lifecycleRun) {
        setLifecycleModal({ run: err.lifecycleRun, agentName: agentLabel, requestState: 'error' });
      } else {
        setLifecycleModal((previous) => completeClientLifecycleRun(previous, err.message || 'Failed to update agent status.'));
      }
      setError(err.message || 'Failed to update agent status.');
    } finally {
      setEnabledSaving(false);
    }
  }

  async function handleSavePrompt() {
    if (!selectedAgent?.agentId || !selectedAgent.promptId) {
      return;
    }
    try {
      setPromptSaving(true);
      setPromptError(null);
      const updatedPrompt = await updateAgentPrompt(
        selectedAgent.promptId,
        promptDraft,
        promptSummary
      );
      const versions = await listAgentPromptVersions(selectedAgent.promptId);
      setPromptState(buildPromptState({ prompt: updatedPrompt, content: promptDraft }, versions));
      setPromptDraft(promptDraft);
      setPromptSummary('');
      setPreviewVersion(null);
    } catch (err) {
      setPromptError(err.message || 'Failed to save prompt.');
    } finally {
      setPromptSaving(false);
    }
  }

  function applyUpdatedAgent(updated) {
    if (!updated?.agentId) {
      return;
    }
    setCurrentAgent((previous) =>
      previous?.agentId === updated.agentId ? updated : previous
    );
    setAgents((previous) => {
      const exists = previous.some((agent) => agent.agentId === updated.agentId);
      if (!exists) {
        return [...previous, updated];
      }
      return previous.map((agent) => (agent.agentId === updated.agentId ? updated : agent));
    });
  }

  async function handleCreateAgent(payload) {
    try {
      setRegistrySaving(true);
      setRegistryMessage('');
      const created = await createAgentIdentity(payload);
      applyUpdatedAgent(created);
      setRegistryModalMode(null);
      setRegistryMessage(`Created ${created.profile?.roleTitle || created.agentId}.`);
      handleSelectAgent(created.agentId);
    } catch (err) {
      setRegistryMessage(err.message || 'Failed to create agent.');
      throw err;
    } finally {
      setRegistrySaving(false);
    }
  }

  async function handleImportAgents(payload) {
    try {
      setRegistrySaving(true);
      setRegistryMessage('');
      const result = await importAgentIdentities(payload);
      result.agents.forEach(applyUpdatedAgent);
      setRegistryModalMode(null);
      const failedCount = result.failed?.length || 0;
      setRegistryMessage(
        failedCount
          ? `Imported ${result.agents.length} agent${result.agents.length === 1 ? '' : 's'}; ${failedCount} failed.`
          : `Imported ${result.agents.length} agent${result.agents.length === 1 ? '' : 's'}.`
      );
    } catch (err) {
      setRegistryMessage(err.message || 'Failed to import agents.');
      throw err;
    } finally {
      setRegistrySaving(false);
    }
  }

  async function handleMarkReviewed(review = {}) {
    if (!selectedAgent?.agentId) {
      return;
    }
    try {
      setReviewSaving(true);
      const updated = await recordAgentReview(selectedAgent.agentId, {
        surface: review.surface || activeProfileTab || 'overall',
        status: review.status || 'approved',
        summary:
          review.summary
          || `Approved ${selectedAgent.profile?.roleTitle || selectedAgent.agentId} ${activeProfileTab || 'profile'} review.`,
        versionRef: review.versionRef || activeProfileTab || 'profile',
        metadata: {
          tab: activeProfileTab,
          agentId: selectedAgent.agentId,
          ...(review.metadata || {}),
        },
      });
      applyUpdatedAgent(updated);
      setHistory(buildIdentityHistoryState(updated.history?.entries || []));
    } catch (err) {
      setError(err.message || 'Failed to record review approval.');
    } finally {
      setReviewSaving(false);
    }
  }

  async function handleRecordHarnessRun() {
    if (!selectedAgent?.agentId) {
      return;
    }
    const cases = (selectedOperation?.harnessCases || []).map((testCase) => ({
      id: testCase.id,
      name: testCase.name,
      status: testCase.status,
      expected: testCase.expected,
      actual: testCase.actual || testCase.expected,
      detail: 'Recorded from Agent Mission Control.',
    }));
    try {
      setHarnessSaving(true);
      const updated = await recordAgentHarnessRun(selectedAgent.agentId, {
        source: 'agent-profile-ui',
        summary: `Recorded manual harness run for ${selectedAgent.profile?.roleTitle || selectedAgent.agentId}.`,
        cases,
      });
      applyUpdatedAgent(updated);
      setHistory(buildIdentityHistoryState(updated.history?.entries || []));
    } catch (err) {
      setError(err.message || 'Failed to record harness run.');
    } finally {
      setHarnessSaving(false);
    }
  }

  function handleRunAgentTest(agent = selectedAgent) {
    const agentId = agent?.agentId || selectedAgent?.agentId || '';
    if (!agentId) return;
    if (!isAgentTestSupported(agentId)) {
      setError(`No test harness is registered for ${agent?.profile?.roleTitle || agentId} yet.`);
      return;
    }
    openAgentTest({
      agentId,
      launchSurface: 'agent-profile',
      context: {
        activeProfileTab,
      },
      onRecorded: () => {
        if (agentId === 'escalation-template-parser') {
          loadParserTestResults();
        }
        if (agentId === 'triage-agent') {
          loadTriageTestResults();
        }
      },
    });
  }

  // Run the triage agent against ONE specific approved escalation case, opening
  // the rich result modal. `caseId` rides along on the modal request so the
  // modal's "New Test" button re-runs the same case.
  function handleRunTriageCase(caseId) {
    const cleanCaseId = typeof caseId === 'string' ? caseId.trim() : '';
    if (!cleanCaseId) return;
    openAgentTest({
      agentId: 'triage-agent',
      caseId: cleanCaseId,
      launchSurface: 'triage-test-assets',
      onRecorded: () => loadTriageTestResults(),
    });
  }

  // Run the triage agent against one RANDOM approved case (server picks from the
  // real approved pool when no caseId is sent). Opens the rich result modal.
  function handleRunRandomTriageCase() {
    openAgentTest({
      agentId: 'triage-agent',
      launchSurface: 'triage-test-assets',
      onRecorded: () => loadTriageTestResults(),
    });
  }

  // Run EVERY approved case sequentially, headless, with live progress. Fetches
  // the current real approved pool first so "Run all" always reflects the
  // latest approvals without relying on a stale prop.
  async function handleRunAllTriageCases() {
    if (triageBatch.isRunning) return;
    try {
      const { cases } = await listTriageTestCases();
      if (!cases.length) {
        setError('No approved escalation cases are available to run yet.');
        return;
      }
      triageBatch.runAll(cases.map((entry) => ({ id: entry.id, label: entry.label })));
    } catch (err) {
      setError(err.message || 'Failed to load approved triage cases.');
    }
  }

  async function handleUpdateParserTestResult(id, status) {
    try {
      const result = await updateImageParserTestResult(id, {
        status,
        operatorNote: status === 'fail'
          ? 'Operator marked this parser test result as incorrect from the agent profile.'
          : 'Operator marked this parser test result as correct from the agent profile.',
      });
      setParserTestResults((prev) => ({
        ...prev,
        results: (prev.results || []).map((entry) => (entry.id === result.id ? result : entry)),
      }));
      loadParserTestResults();
      return result;
    } catch (err) {
      setParserTestResultsError(err.message || 'Failed to update parser test result.');
      throw err;
    }
  }

  async function handleProgrammaticCheckParserTestResult(id) {
    try {
      const data = await programmaticCheckImageParserTestResult(id);
      if (data?.result) {
        setParserTestResults((prev) => ({
          ...prev,
          results: (prev.results || []).map((entry) => (entry.id === data.result.id ? data.result : entry)),
        }));
      }
      loadParserTestResults();
      return data;
    } catch (err) {
      setParserTestResultsError(err.message || 'Failed to run parser output check.');
      throw err;
    }
  }

  async function handleRetestParserTestResult(result) {
    try {
      const data = await retestImageParserTestResult(result);
      loadParserTestResults();
      return data;
    } catch (err) {
      setParserTestResultsError(err.message || 'Failed to retest parser image.');
      throw err;
    }
  }

  async function handleDeleteParserTestResult(id) {
    try {
      const data = await deleteImageParserTestResult(id);
      setParserTestResults((prev) => ({
        ...prev,
        results: (prev.results || []).filter((entry) => entry.id !== id),
      }));
      if (parserResultPreview?.id === id) {
        setParserResultPreview(null);
      }
      loadParserTestResults();
      return data;
    } catch (err) {
      setParserTestResultsError(err.message || 'Failed to delete parser test result.');
      throw err;
    }
  }

  function handleOpenParserTestResult(result) {
    const opened = openAgentTest({
      agentId: 'escalation-template-parser',
      completedResult: result,
      onRecorded: ({ result: savedResult } = {}) => {
        if (savedResult?.id) {
          setParserTestResults((prev) => ({
            ...prev,
            results: (prev.results || []).map((entry) => (entry.id === savedResult.id ? savedResult : entry)),
          }));
        }
        loadParserTestResults();
      },
    });
    if (!opened) {
      setParserResultPreview(result);
    }
  }

  function requestDeleteParserTestResult(result) {
    if (!result?.id) return;
    setParserDeleteTarget({
      id: result.id,
      name: result.fixture?.name || 'this parser test run',
    });
  }

  async function confirmDeleteParserTestResult() {
    if (!parserDeleteTarget?.id || parserDeleteSaving) return;
    setParserDeleteSaving(true);
    try {
      await handleDeleteParserTestResult(parserDeleteTarget.id);
      setParserDeleteTarget(null);
    } finally {
      setParserDeleteSaving(false);
    }
  }

  function requestTestAssetUpload() {
    if (selectedAgent?.agentId !== 'escalation-template-parser') {
      return;
    }
    setTestAssetUploadState({ saving: false, error: '', message: '' });
    testAssetFileInputRef.current?.click();
  }

  function readTestAssetFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });
  }

  async function handleTestAssetFileSelected(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file || selectedAgent?.agentId !== 'escalation-template-parser') {
      return;
    }
    try {
      setTestAssetUploadState({ saving: true, error: '', message: '' });
      const dataUrl = await readTestAssetFileAsDataUrl(file);
      const fixture = await uploadImageParserTestAsset({
        fileName: file.name,
        dataUrl,
      });
      setTestAssetUploadState({
        saving: false,
        error: '',
        message: `Added ${fixture?.name || file.name} to parser test assets.`,
      });
      setTestAssetsByAgentId((previous) => {
        const next = { ...previous };
        delete next['triage-agent'];
        return next;
      });
      await loadTestAssetsForAgent('escalation-template-parser');
    } catch (err) {
      setTestAssetUploadState({
        saving: false,
        error: err.message || 'Failed to upload image asset.',
        message: '',
      });
    }
  }

  async function handleUpdateTriageTestResult(id, status) {
    try {
      const result = await updateTriageTestResult(id, {
        status,
        operatorNote: status === 'fail'
          ? 'Operator marked this triage test result as incorrect from the agent profile.'
          : 'Operator marked this triage test result as correct from the agent profile.',
      });
      setTriageTestResults((prev) => ({
        ...prev,
        results: (prev.results || []).map((entry) => (entry.id === result.id ? result : entry)),
      }));
      loadTriageTestResults();
      return result;
    } catch (err) {
      setTriageTestResultsError(err.message || 'Failed to update triage test result.');
      throw err;
    }
  }

  function handleSelectAgent(agentId) {
    if (!agentId) {
      return;
    }
    setSelectedAgentId(agentId);
    if (typeof window !== 'undefined' && window.location) {
      window.location.hash = `/agents/${encodeURIComponent(agentId)}`;
    }
  }

  function handleProfileChange(key, value) {
    setProfileDraft((previous) => ({ ...previous, [key]: value }));
  }

  function handleTabChange(tabId) {
    setActiveProfileTab(tabId);
    if (tabId === 'prompt') {
      loadPromptForSelectedAgent();
    }
    if (tabId === 'activity' || tabId === 'versions') {
      loadHistoryForSelectedAgent();
    }
    if (tabId === 'test-results') {
      loadParserTestResults();
    }
    if (tabId === 'triage-test-results') {
      loadTriageTestResults();
    }
    if (tabId === 'test-assets') {
      loadTestAssetsForAgent();
    }
    if (tabId === 'event-streams') {
      loadParserEventStreams();
    }
    if (tabId === 'chat-sessions') {
      loadParserChatSessions();
    }
  }

  async function handlePreviewPromptVersion(version) {
    if (!selectedAgent?.promptId || !version?.ts) {
      setPreviewVersion(version);
      return;
    }
    try {
      const content = await getAgentPromptVersion(selectedAgent.promptId, version.ts);
      setPreviewVersion({ ...version, content });
    } catch (err) {
      setPromptError(err.message || 'Failed to load prompt version.');
    }
  }

  function restorePreviewVersion() {
    if (!previewVersion?.content) {
      return;
    }
    setPromptDraft(previewVersion.content);
    setPromptSummary(`Restored from ${previewVersion.versionLabel || 'previous version'}`);
    setPreviewVersion(null);
  }

  const profileWorkspaceProps = {
    activeTab: activeProfileTab,
    agent: selectedAgent,
    operation: selectedOperation,
    // Live provider reachability for the selected agent, read from the same
    // agent registry that powers every status dot on this page. Shape:
    //   { status: 'online'|'offline'|'disabled'|'unknown', checkedAt: ISO|null }
    // The Overview ID-badge card reads this to render a truthful health pill
    // instead of inventing a health value. Falls back to a neutral "unknown"
    // entry when the registry hasn't observed this agent yet (boot window).
    selectedHealth: selectedAgent?.agentId
      ? (registryHealthById[selectedAgent.agentId] || { status: 'unknown', checkedAt: null })
      : null,
    history,
    historyLoading,
    historyError,
    promptState,
    promptDraft,
    promptSummary,
    promptLoading,
    promptSaving,
    promptError,
    previewVersion,
    profileDraft,
    profileSummary,
    profileSaving,
    runtimeDefinition: selectedRuntimeDefinition,
    runtimeState: selectedRuntimeState,
    runtimeSaveStatus,
    runtimeRecheckResult,
    reviewSaving,
    harnessSaving,
    parserTestResults,
    parserTestResultsLoading,
    parserTestResultsError,
    parserResultPreview,
    parserHistory,
    parserSavedEvents,
    parserHistoryLoading,
    parserHistoryError,
    parserEventStats,
    parserSessions,
    parserSessionsLoading,
    parserSessionsError,
    triageTestResults,
    triageTestResultsLoading,
    triageTestResultsError,
    testAssets: selectedAgent?.agentId ? testAssetsByAgentId[selectedAgent.agentId] : null,
    testAssetsLoading,
    testAssetsError,
    testAssetUploadState,
    onPromptDraftChange: setPromptDraft,
    onPromptSummaryChange: setPromptSummary,
    onPromptSave: handleSavePrompt,
    onPreviewVersion: handlePreviewPromptVersion,
    onRestorePreview: restorePreviewVersion,
    onProfileChange: handleProfileChange,
    onProfileSummaryChange: setProfileSummary,
    onProfileSave: handleSaveProfile,
    onRuntimeSave: handleSaveRuntime,
    onToggleAgentEnabled: handleToggleAgentEnabled,
    enabledSaving,
    onMarkReviewed: handleMarkReviewed,
    onRecordHarnessRun: handleRecordHarnessRun,
    onRunAgentTest: handleRunAgentTest,
    onLoadParserTestResults: loadParserTestResults,
    onLoadParserEventStreams: loadParserEventStreams,
    onLoadParserChatSessions: loadParserChatSessions,
    onUpdateParserTestResult: handleUpdateParserTestResult,
    onProgrammaticCheckParserTestResult: handleProgrammaticCheckParserTestResult,
    onRetestParserTestResult: handleRetestParserTestResult,
    onDeleteParserTestResult: handleDeleteParserTestResult,
    onOpenParserTestResult: handleOpenParserTestResult,
    onRequestDeleteParserTestResult: requestDeleteParserTestResult,
    onPreviewParserResult: setParserResultPreview,
    onCloseParserResultPreview: () => setParserResultPreview(null),
    onLoadTriageTestResults: loadTriageTestResults,
    onUpdateTriageTestResult: handleUpdateTriageTestResult,
    onLoadTestAssets: () => loadTestAssetsForAgent(selectedAgent?.agentId),
    onRequestTestAssetUpload: requestTestAssetUpload,
    onTestAssetFileSelected: handleTestAssetFileSelected,
    testAssetFileInputRef,
    onRunTriageCase: handleRunTriageCase,
    onRunRandomTriageCase: handleRunRandomTriageCase,
    onRunAllTriageCases: handleRunAllTriageCases,
    onCancelTriageBatch: triageBatch.cancel,
    triageBatchProgress: triageBatch.progress,
    onLoadHistory: loadHistoryForSelectedAgent,
    onLoadPrompt: loadPromptForSelectedAgent,
    // The redesigned Overview tab navigates to sibling tabs (Harness / Test
    // Results) from its "Recent Results" control, and lazily warms the parser
    // test-result + prompt-version data so those sections show real values
    // instead of an empty state. handleTabChange already triggers the matching
    // loader, so reusing it keeps a single navigation+load path.
    onTabChange: handleTabChange,
  };

  if (!agentIdFromRoute) {
    return (
      <AgentsMissionControlPage
        agents={filteredAgents}
        loading={loadingAgents}
        error={error}
        query={query}
        onQueryChange={setQuery}
        operationalProfiles={operationalProfiles}
        operationById={operationById}
        registryHealthById={registryHealthById}
        onSelectAgent={handleSelectAgent}
        registryModalMode={registryModalMode}
        registrySaving={registrySaving}
        registryMessage={registryMessage}
        onOpenCreate={() => {
          setRegistryMessage('');
          setRegistryModalMode('create');
        }}
        onOpenImport={() => {
          setRegistryMessage('');
          setRegistryModalMode('import');
        }}
        onCloseRegistryModal={() => setRegistryModalMode(null)}
        onCreateAgent={handleCreateAgent}
        onImportAgents={handleImportAgents}
      />
    );
  }

  return (
    <>
      <AgentProfileDetailPage
        error={error}
        selectedAgent={selectedAgent}
        selectedOperation={selectedOperation}
        loadingCurrent={loadingCurrent}
        activeProfileTab={activeProfileTab}
        onTabChange={handleTabChange}
        onOpenPrompt={() => handleTabChange('prompt')}
        onOpenConfig={() => handleTabChange('configuration')}
        onOpenHarness={() => handleTabChange('harness')}
        workspaceProps={profileWorkspaceProps}
      />
      {lifecycleModal && (
        <AgentLifecycleRunModal
          run={lifecycleModal.run}
          agentName={lifecycleModal.agentName}
          requestState={lifecycleModal.requestState}
          onClose={() => setLifecycleModal(null)}
        />
      )}
      {registryModalMode && (
        <AgentRegistryModal
          mode={registryModalMode}
          saving={registrySaving}
          onClose={() => setRegistryModalMode(null)}
          onCreate={handleCreateAgent}
          onImport={handleImportAgents}
        />
      )}
      <ConfirmModal
        open={Boolean(parserDeleteTarget)}
        title="Delete Test Run"
        message={`Delete ${parserDeleteTarget?.name || 'this parser test run'} permanently? This removes the saved test record and cannot be undone.`}
        confirmLabel={parserDeleteSaving ? 'Deleting...' : 'Delete'}
        danger
        onConfirm={confirmDeleteParserTestResult}
        onCancel={() => {
          if (!parserDeleteSaving) setParserDeleteTarget(null);
        }}
      />
    </>
  );
}

function AgentsMissionControlPage({
  agents,
  loading,
  error,
  query,
  onQueryChange,
  operationalProfiles,
  operationById,
  registryHealthById,
  onSelectAgent,
  registryModalMode,
  registrySaving,
  registryMessage,
  onOpenCreate,
  onOpenImport,
  onCloseRegistryModal,
  onCreateAgent,
  onImportAgents,
}) {
  const [attentionOpen, setAttentionOpen] = useState(false);
  const attentionItems = useMemo(
    () => buildAttentionItems(operationalProfiles),
    [operationalProfiles]
  );

  return (
    <div className="agent-profiles-page agents-index-page">
      {error && <div className="agent-alert">{error}</div>}
      {registryMessage && <div className="agent-info-alert">{registryMessage}</div>}

      <section className="mission-control-layout">
        <main className="agent-grid-panel">
          <div className="agent-grid-heading">
            <div>
              <h2>Agent Profiles</h2>
            </div>
            <AgentCommandToolbar
              query={query}
              onQueryChange={onQueryChange}
            />
            <div className="agent-grid-header-actions">
              <AgentAttentionMenu
                items={attentionItems}
                open={attentionOpen}
                onToggle={() => setAttentionOpen((previous) => !previous)}
                onClose={() => setAttentionOpen(false)}
                onSelectAgent={onSelectAgent}
              />
              <button type="button" className="agent-add-button" onClick={onOpenCreate}>
                Add Agent
              </button>
            </div>
          </div>

          {loading ? (
            <InlineLoading label="Loading agents..." />
          ) : agents.length ? (
            <AgentMissionGrid
              agents={agents}
              operationById={operationById}
              registryHealthById={registryHealthById}
              onSelectAgent={onSelectAgent}
            />
          ) : (
            <EmptyState title="No matching agents" copy="Adjust the search or filter set." />
          )}
        </main>
      </section>

      {registryModalMode && (
        <AgentRegistryModal
          mode={registryModalMode}
          saving={registrySaving}
          onClose={onCloseRegistryModal}
          onCreate={onCreateAgent}
          onImport={onImportAgents}
        />
      )}
    </div>
  );
}

function AgentRegistryModal({
  mode,
  saving,
  onClose,
  onCreate,
  onImport,
}) {
  const [createDraft, setCreateDraft] = useState({
    agentId: '',
    displayName: '',
    roleTitle: '',
    headline: '',
    tone: '',
    summary: '',
  });
  const [importDraft, setImportDraft] = useState(() =>
    JSON.stringify({
      sourceLabel: 'Agent registry import',
      agents: [
        {
          agentId: 'custom-review-agent',
          profile: {
            displayName: 'Custom Review Agent',
            roleTitle: 'Custom Review Specialist',
            headline: 'Reviews a defined workflow before human handoff.',
          },
        },
      ],
    }, null, 2)
  );
  const [localError, setLocalError] = useState('');
  const isImport = mode === 'import';

  function updateCreateDraft(key, value) {
    setCreateDraft((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLocalError('');
    try {
      if (isImport) {
        const parsed = JSON.parse(importDraft);
        await onImport(parsed);
        return;
      }
      await onCreate({
        agentId: createDraft.agentId,
        profile: {
          displayName: createDraft.displayName,
          roleTitle: createDraft.roleTitle,
          headline: createDraft.headline,
          tone: createDraft.tone,
        },
        summary: createDraft.summary,
      });
    } catch (err) {
      setLocalError(err.message || 'Registry update failed.');
    }
  }

  return (
    <div className="agent-modal-backdrop" role="presentation">
      <form className="agent-registry-modal" onSubmit={handleSubmit}>
        <header>
          <div>
            <span className="mission-kicker">Agent Registry</span>
            <h2>{isImport ? 'Import Agents' : 'Create Agent'}</h2>
          </div>
          <button type="button" className="text-action" onClick={onClose}>
            Close
          </button>
        </header>

        {localError && <div className="agent-alert">{localError}</div>}

        {isImport ? (
          <label className="form-field">
            <span>Import JSON</span>
            <textarea
              className="registry-json-editor"
              value={importDraft}
              onChange={(event) => setImportDraft(event.target.value)}
              spellCheck={false}
            />
          </label>
        ) : (
          <div className="profile-form-grid">
            <FormField
              label="Agent ID"
              value={createDraft.agentId}
              placeholder="billing-audit-agent"
              onChange={(value) => updateCreateDraft('agentId', value)}
            />
            <FormField
              label="Display name"
              value={createDraft.displayName}
              placeholder="Billing Audit Agent"
              onChange={(value) => updateCreateDraft('displayName', value)}
            />
            <FormField
              label="Role title"
              value={createDraft.roleTitle}
              placeholder="Billing Audit Specialist"
              onChange={(value) => updateCreateDraft('roleTitle', value)}
            />
            <FormField
              label="Tone"
              value={createDraft.tone}
              placeholder="Precise and evidence-first"
              onChange={(value) => updateCreateDraft('tone', value)}
            />
            <FormField
              label="Headline"
              type="textarea"
              value={createDraft.headline}
              placeholder="Reviews billing escalations before workflow handoff."
              onChange={(value) => updateCreateDraft('headline', value)}
            />
            <FormField
              label="Change summary"
              type="textarea"
              value={createDraft.summary}
              placeholder="Why this agent is being registered."
              onChange={(value) => updateCreateDraft('summary', value)}
            />
          </div>
        )}

        <div className="form-action-row">
          <button type="button" className="secondary-action" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary-action" disabled={saving}>
            {saving ? 'Saving...' : (isImport ? 'Import Agents' : 'Create Agent')}
          </button>
        </div>
      </form>
    </div>
  );
}

function AgentLifecycleRunModal({ run, agentName, requestState, onClose }) {
  const [selectedStep, setSelectedStep] = useState(null);
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  const directionLabel = run?.direction === 'startup' ? 'Startup' : 'Shutdown';
  const status = normalizeLifecycleStatus(requestState === 'running' ? 'info' : run?.status);
  const statusLabel = requestState === 'running' ? 'Running' : formatLifecycleStatus(run?.status);
  const duration = run?.durationMs ? formatMs(run.durationMs) : 'In progress';
  const counts = countLifecycleStepStatuses(steps);

  function handleSelectStep(step) {
    setSelectedStep(step);
  }

  function handleBackToStream() {
    setSelectedStep(null);
  }

  return (
    <div className="agent-modal-backdrop lifecycle-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <section className="agent-lifecycle-modal" role="dialog" aria-modal="true" aria-label={`${directionLabel} lifecycle stream`}>
        <div className="lifecycle-modal-viewport">
          <div className={`lifecycle-modal-track${selectedStep ? ' showing-detail' : ''}`}>
            <div className="lifecycle-modal-pane" aria-hidden={selectedStep ? 'true' : undefined} inert={selectedStep ? true : undefined}>
              <header>
                <div>
                  <span className="mission-kicker">Agent Lifecycle</span>
                  <h2>{directionLabel} Stream</h2>
                  <p>{agentName || run?.agentId || 'Agent'} lifecycle operation details.</p>
                </div>
                <button type="button" className="text-action" onClick={onClose}>
                  Close
                </button>
              </header>

              <div className="lifecycle-run-summary">
                <LifecycleStatusPill status={status} label={statusLabel} />
                <span>{steps.length} steps</span>
                <span>{duration}</span>
                <span>{counts.error} errors</span>
                <span>{counts.warning} warnings</span>
              </div>

              <LifecycleStepList steps={steps} onStepSelect={handleSelectStep} />
            </div>

            <div className="lifecycle-modal-pane lifecycle-detail-pane" aria-hidden={!selectedStep ? 'true' : undefined} inert={!selectedStep ? true : undefined}>
              <header className="lifecycle-detail-header">
                <button type="button" className="lifecycle-back-button" onClick={handleBackToStream}>
                  <span aria-hidden="true">&lsaquo;</span>
                  Back
                </button>
                <div className="lifecycle-detail-heading">
                  <h2>{selectedStep?.name || 'Lifecycle Item'}</h2>
                </div>
                <button type="button" className="text-action" onClick={onClose}>
                  Close
                </button>
              </header>

              {selectedStep ? (
                <LifecycleStepDetail step={selectedStep} />
              ) : (
                <EmptyState title="No item selected" copy="Choose a lifecycle card to view the stored shape." />
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function AgentMissionGrid({ agents, operationById, registryHealthById, onSelectAgent }) {
  return (
    <div className="agent-card-grid">
      {agents.map((agent, index) => (
        <AgentMissionCard
          key={agent.agentId}
          agent={agent}
          operation={operationById.get(agent.agentId)}
          registryHealth={registryHealthById?.[agent.agentId]}
          rank={index + 1}
          onSelect={() => onSelectAgent(agent.agentId)}
        />
      ))}
    </div>
  );
}

function AgentMissionCard({ agent, operation, registryHealth, rank, onSelect }) {
  // Build the dot tooltip from the registry's raw status (online/offline/...)
  // and checkedAt timestamp so the user sees "Online · last checked 12s ago".
  // Falls back to the legacy STATUS_LABELS for the operational token when no
  // registry health is available yet (boot window). See cto-review finding M3.
  const dotTooltip = registryHealth
    ? buildDotTooltip(registryHealth.status, registryHealth.checkedAt)
    : (STATUS_LABELS[operation?.status] || 'Idle');
  const name = getAgentDisplayName(agent);
  const role = getAgentRoleLabel(agent);
  return (
    <a
      href={`#/agents/${encodeURIComponent(agent.agentId)}`}
      className="agent-mission-card"
      onClick={onSelect}
    >
      <header>
        <span className="rank-pill">{rank}</span>
        <span
          className={`status-dot status-dot-${operation?.status || 'idle'} agent-row-status-dot`}
          title={dotTooltip}
          aria-label={dotTooltip}
        />
      </header>
      {/* "name" (not "title") keeps this class clear of overhaul.css's
          `header [class*="title"]` gradient-text trap by construction. */}
      <div className="agent-mission-card-name">
        <strong>{name}</strong>
        {role ? <span>{role}</span> : null}
      </div>
      <p>{agent.profile?.headline || operation?.promptSummary?.goals}</p>
      {/* Real data only: provider/model summary (runtime config) and tool
          count (agent.tools.available). The fabricated Trust score and
          Workflow Fit bars (AGENT_OPERATION_META) were removed — agent
          profiles show real data or honest empty states. Rendered as plain
          `.agent-chip` spans (not the shared `.agent-badge` Badge) so the
          list page owns its chip styling without "badge" substring risk. */}
      <div className="agent-card-chip-row">
        {operation?.modelLabel ? (
          <span className="agent-chip agent-chip-model">{operation.modelLabel}</span>
        ) : null}
        {operation?.toolSummary ? (
          <span className="agent-chip">{operation.toolSummary}</span>
        ) : null}
      </div>
    </a>
  );
}

// UnifiedAgentHeader — the single, page-level premium header that owns agent
// identity + status + the enable toggle for EVERY profile tab (it sits above
// the tab bar). This is the promoted version of the rich treatment that used
// to live only inside the Overview tab; consolidating it here removes the
// double-header (page top-strip + Overview header) the user flagged.
//
// What it folds in from the old `profile-page-topbar`:
//   - the back/breadcrumb link to the agent directory (kept as a quiet
//     "Back to agents" affordance above the name, so the route is still
//     reachable from every tab),
//   - the REAL enable/disable toggle (same checkbox wiring — value from
//     agent.enabled, change calls onToggleAgentEnabled which runs the existing
//     PATCH /enabled flow; disabled while enabledSaving),
//   - the "Refreshing profile..." loading hint.
//
// HONESTY: every value is real — name = profile.displayName; role =
// profile.roleTitle; purpose = profile.headline; enabled = agent.enabled; health = the SAME registry
// `selectedHealth` ({status, checkedAt}) the status dots use. No fabrication.
//
// CSS DEFENSE: scoped under `.agent-profile-header` (NO class contains the
// substring "title", so overhaul.css's `header [class*="title"]` holographic
// transparent-fill rule can't match). AgentOverviewTab.css carries the
// `-webkit-text-fill-color: currentColor` guard, the explicit pin on the name,
// and a `header::before { content: none }` reset for this header.
function UnifiedAgentHeader({
  selectedAgent,
  selectedHealth,
  loadingCurrent,
  enabledSaving,
  onToggleAgentEnabled,
  onRunAgentTest,
}) {
  if (!selectedAgent) {
    return null;
  }

  const name = getAgentDisplayName(selectedAgent);
  const role = getAgentRoleLabel(selectedAgent);
  const purpose = [role, selectedAgent.profile?.headline].filter(Boolean).join(' · ')
    || 'No purpose described yet.';
  const enabled = selectedAgent.enabled !== false;
  const supportsAgentTest = isAgentTestSupported(selectedAgent.agentId);

  // Live provider health — same registry source as every status dot.
  const health = selectedHealth || { status: 'unknown', checkedAt: null };
  const healthStatus = health.status || 'unknown';
  const healthLabel = healthStatusLabel(healthStatus);
  const healthFresh = formatLastChecked(health.checkedAt);
  const healthTone =
    healthStatus === 'online' ? 'online'
      : healthStatus === 'offline' ? 'offline'
        : 'neutral';

  return (
    <header className="agent-profile-header">
      {/* Compact single-band identity: back affordance + avatar + name + purpose
          all on one horizontal row (no stacked breadcrumb line) so the
          persistent cross-tab header stays a slim strip. */}
      <div className="aph-left">
        <a href="#/agents" className="aph-back" title="Back to Agent Profiles" aria-label="Back to agent profiles">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </a>
        <span className="aph-monogram">
          <AgentAvatar agent={selectedAgent} size="small" />
        </span>
        <div className="aph-text">
          <div className="aph-name">{name}</div>
          <div className="aph-purpose" title={purpose}>{purpose}</div>
        </div>
      </div>

      <div className="aph-right">
        {loadingCurrent && (
          <span className="aph-refreshing">
            <InlineLoading label="Refreshing..." />
          </span>
        )}
        {supportsAgentTest && (
          <button
            type="button"
            className="aph-test-button"
            onClick={() => onRunAgentTest?.(selectedAgent)}
            title={`Run ${name} test`}
            aria-label={`Run ${name} test`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run test
          </button>
        )}
        <div className="aph-status-item">
          <label
            className={`aph-enable-switch${enabled ? ' is-on' : ' is-off'}`}
            aria-label={`${enabled ? 'Disable' : 'Enable'} ${name}`}
          >
            <input
              type="checkbox"
              checked={enabled}
              disabled={enabledSaving}
              onChange={(event) => onToggleAgentEnabled?.(event.target.checked)}
            />
            <span className="aph-status-line">
              <span className="aph-enable-track" aria-hidden="true">
                <span className="aph-enable-thumb" />
              </span>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
          <div className="aph-status-caption">
            {enabledSaving ? 'Saving...' : enabled ? 'Active in pipeline' : 'Turned off'}
          </div>
        </div>

        <div className="aph-divider" aria-hidden="true" />

        <div className="aph-status-item">
          <div
            className="aph-status-line"
            title={buildDotTooltip(healthStatus, health.checkedAt)}
          >
            <span className={`aph-health-dot tone-${healthTone}`} aria-hidden="true" />
            {healthLabel}
          </div>
          <div className="aph-status-caption">
            {healthFresh ? `Checked ${healthFresh}` : 'Not checked yet'}
          </div>
        </div>
      </div>
    </header>
  );
}

function AgentProfileDetailPage({
  error,
  selectedAgent,
  selectedOperation,
  loadingCurrent,
  activeProfileTab,
  onTabChange,
  onOpenPrompt,
  onOpenConfig,
  onOpenHarness,
  workspaceProps,
}) {
  return (
    <div className="agent-profiles-page agent-profile-detail-page">
      <UnifiedAgentHeader
        selectedAgent={selectedAgent}
        selectedHealth={workspaceProps.selectedHealth}
        loadingCurrent={loadingCurrent}
        enabledSaving={workspaceProps.enabledSaving}
        onToggleAgentEnabled={workspaceProps.onToggleAgentEnabled}
        onRunAgentTest={workspaceProps.onRunAgentTest}
      />

      {error && <div className="agent-alert">{error}</div>}

      {selectedAgent ? (
        <main className="profile-detail-shell">
          <AgentProfileTabs
            tabs={getAgentProfileTabs(selectedAgent.agentId)}
            activeTab={activeProfileTab}
            onChange={onTabChange}
          />

          <AgentProfileWorkspace {...workspaceProps} />
        </main>
      ) : (
        <EmptyState title="Agent profile unavailable" copy="Return to mission control and select an agent profile." />
      )}
    </div>
  );
}

function MissionControlHeader({
  mode = 'profile',
  selectedAgent,
  selectedOperation,
  onOpenPrompt,
  onOpenConfig,
  onOpenCreate,
  onOpenImport,
}) {
  return (
    <header className="mission-control-header">
      <div className="mission-title-block">
        <div className="mission-kicker">Agent Mission Control</div>
        <h1>Agent Profiles</h1>
        <p>
          Discover, monitor, tune, and review the agents powering the escalation workflow.
        </p>
      </div>

      <div className="mission-header-actions">
        <div className="system-status-pill">
          <span className="status-dot status-dot-active" />
          System Status: Operational
        </div>
        {mode === 'profile' ? (
          <>
            <div className="selected-agent-chip">
              <AgentAvatar agent={selectedAgent} size="small" />
              <span>
                <strong>{getAgentDisplayName(selectedAgent)}</strong>
                <small>{getAgentRoleLabel(selectedAgent) || selectedOperation?.department || 'Agent profile'}</small>
              </span>
            </div>
            <button type="button" className="secondary-action" onClick={onOpenConfig}>
              Edit Profile
            </button>
            <button type="button" className="primary-action" onClick={onOpenPrompt}>
              Open Prompt
            </button>
          </>
        ) : (
          <>
            <button type="button" className="secondary-action" onClick={onOpenImport}>
              Import
            </button>
            <button type="button" className="primary-action" onClick={onOpenCreate}>
              Create Agent
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function AgentAttentionMenu({
  items,
  open,
  onToggle,
  onClose,
  onSelectAgent,
}) {
  const count = items.length;
  const displayCount = count > 9 ? '9+' : String(count);

  return (
    <>
      <button
        type="button"
        className={`agent-attention-button${open ? ' is-open' : ''}${count > 0 ? ' has-items' : ''}`}
        onClick={onToggle}
        aria-label={count > 0 ? `${count} agents need attention` : 'No agents need attention'}
        aria-expanded={open}
        title={count > 0 ? `${count} agents need attention` : 'No agents need attention'}
      >
        <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && <span className="agent-attention-count">{displayCount}</span>}
      </button>

      {/* "flyout" (not "popover"/"menu") — overhaul.css hijacks any class
          containing those substrings (forced bg/radius/frosted glass/
          animation, box-shadow:none). role="menu" is fine: the traps match
          class substrings, not roles. */}
      {open && (
        <div className="agent-attention-flyout" role="menu">
          <header>
            <strong>Needs Attention</strong>
            <span>{count} {count === 1 ? 'agent' : 'agents'}</span>
          </header>
          {count > 0 ? (
            <div className="agent-attention-list">
              {items.map((item) => (
                <a
                  key={item.agentId}
                  href={`#/agents/${encodeURIComponent(item.agentId)}`}
                  role="menuitem"
                  className="agent-attention-item"
                  onClick={() => {
                    onSelectAgent?.(item.agentId);
                    onClose?.();
                  }}
                >
                  <span className={`status-dot status-dot-${item.status || 'review'}`} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.reason}</small>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="agent-attention-empty">No agents need attention.</div>
          )}
        </div>
      )}
    </>
  );
}

function AgentCommandToolbar({
  query,
  onQueryChange,
}) {
  return (
    <section className="agent-command-toolbar" aria-label="Agent directory search">
      <label className="agent-search-box">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search agents by name, role, tool, workflow, or model..."
        />
      </label>
    </section>
  );
}

function AgentProfileTabs({ tabs, activeTab, onChange }) {
  return (
    <nav className="agent-profile-tabs" aria-label="Agent profile sections">
      {tabs.map((tab) => (
        <button
          type="button"
          className={activeTab === tab.id ? 'active' : ''}
          key={tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function AgentProfileWorkspace(props) {
  const { activeTab } = props;
  const isWorkspace = props.agent?.agentId === 'workspace';

  if (activeTab === 'configuration') {
    return (
      <>
        {isWorkspace && <WorkspaceAgentOperationsTab section="configuration" />}
        <AgentConfigurationTab {...props} />
      </>
    );
  }
  if (activeTab === 'prompt') {
    return <AgentPromptTab {...props} />;
  }
  if (activeTab === 'harness') {
    return <AgentHarnessTab {...props} />;
  }
  if (activeTab === 'test-assets') {
    return <AgentTestAssetsTab {...props} />;
  }
  if (activeTab === 'test-results') {
    return <ImageParserTestResultsTab {...props} />;
  }
  if (activeTab === 'triage-test-results') {
    return <TriageAgentTestResultsTab {...props} />;
  }
  if (activeTab === 'event-streams') {
    return <ImageParserEventStreamsTab {...props} />;
  }
  if (activeTab === 'chat-sessions') {
    return <ImageParserChatSessionsTab {...props} />;
  }
  if (activeTab === 'memory') {
    return <AgentMemoryTab {...props} />;
  }
  if (activeTab === 'monitoring') {
    return (
      <>
        {isWorkspace && <WorkspaceAgentOperationsTab section="monitoring" />}
        <AgentMonitoringTab {...props} />
      </>
    );
  }
  if (activeTab === 'workflows') {
    return <AgentWorkflowsTab {...props} />;
  }
  if (activeTab === 'activity') {
    return <AgentActivityTab {...props} />;
  }
  if (activeTab === 'versions') {
    return <AgentVersionsTab {...props} />;
  }

  return <AgentOverviewTab {...props} />;
}

// ===========================================================================
// AgentOverviewTab — chrome-light overview PAGE (approved mockup at
// prototypes/agent-card/overview-page.html). This SUBSUMES the old stack of
// boxed panels into a single source-of-truth page. The intermediate-step
// components that this page fully replaced — AgentIdentityBadgeCard,
// QualityPerformance, ProfileSourceOfTruthPanel — have been removed as dead
// code. The remaining panel FUNCTIONS defined below (WorkflowFootprint,
// PromptContractPanel, HarnessSummaryPanel, ReviewWorkflowPanel) are still
// rendered by other tabs (Workflows/Prompt/Harness/Configuration), so they
// stay defined — but they are no longer rendered on this page.
//
// HONESTY CONTRACT (see agent-profiles-overhaul/01-overview-page-review.md):
// every value rendered is backed by a REAL field or shows an explicit empty
// state. No per-agent decorative constants (the AGENT_OPERATION_META
// anti-pattern) are read. Fields from the mockup with no real source are
// OMITTED rather than fabricated — documented inline at each section.
//
// CSS defense: the whole subtree is scoped under `.agent-overview-v2`, which
// (a) carries a `-webkit-text-fill-color: currentColor` guard so the global
// `header [class*="title"]` holographic gradient in overhaul.css can't
// transparency-bomb inherited text, and (b) deliberately uses NO class name
// containing the substring "title". See AgentOverviewTab.css.
function AgentOverviewTab({
  agent,
  operation,
  parserTestResults,
  parserTestResultsLoading,
  promptState,
  onTabChange,
  onRunAgentTest,
  onLoadParserTestResults,
  onLoadPrompt,
}) {
  const agentId = agent?.agentId;
  const isParser = agentId === 'escalation-template-parser';
  const supportsModalTest = isAgentTestSupported(agentId);

  // Warm the lazily-loaded real data the Overview needs so its Recent-Results
  // summary and Prompt-version rail item show real values without the user
  // first visiting those tabs. Both loaders are idempotent fetchers.
  useEffect(() => {
    const hasLoadedParserResults = Boolean(
      parserTestResults?.stats || (Array.isArray(parserTestResults?.results) && parserTestResults.results.length > 0)
    );
    if (isParser && !parserTestResultsLoading && !hasLoadedParserResults) {
      onLoadParserTestResults?.();
    }
  }, [isParser, parserTestResults, parserTestResultsLoading, onLoadParserTestResults]);

  useEffect(() => {
    if (agent?.promptId && !promptState) {
      onLoadPrompt?.();
    }
  }, [agent?.promptId, promptState, onLoadPrompt]);

  // NOTE: identity (name / purpose / avatar), the enabled state, and the live
  // provider-health pill are rendered by the page-level UnifiedAgentHeader now
  // (shown above the tab bar on every tab), so the Overview body no longer
  // computes or renders them — it starts at the properties strip below.
  // `purpose` is still derived here because the Behavior section uses it to
  // decide whether the profile headline is distinct enough to show as "Does".
  const purpose = agent?.profile?.headline || 'No purpose described yet.';

  // ---- PROPERTIES STRIP (real) -------------------------------------------
  // Split the real runtime selection into model + provider via the runtime
  // catalog helpers (the combined operation.modelLabel is a single string).
  const runtimeDefinition = agentId ? getAgentRuntimeDefinition(agentId) : null;
  const runtimeState = agent?.runtime || {};
  const providerLabel = runtimeDefinition
    ? getAgentRuntimeProviderLabel(runtimeDefinition, runtimeState)
    : '';
  const modelName = runtimeDefinition
    ? getAgentRuntimeEffectiveModel(runtimeDefinition, runtimeState)
    : '';
  const modelDisplay = modelName || operation?.modelLabel || '';
  const tools = Array.isArray(agent?.tools?.available) ? agent.tools.available : [];

  // PROVIDER LOGO — pick by the agent's REAL runtime PROVIDER (not the model),
  // reusing the canonical catalog mapping (shared/ai-provider-catalog.json via
  // getProviderMeta). The normalized runtime provider id (e.g. "gemini",
  // "openai") matches the catalog id, which carries iconPath/iconLightPath. We
  // do NOT fabricate a logo: providerMeta is only truthy when there is a real
  // runtime selection, and ProviderModelLogo falls back to a neutral monogram
  // when a provider has no icon asset.
  const normalizedRuntime = runtimeDefinition
    ? normalizeAgentRuntimeState(runtimeDefinition, runtimeState)
    : null;
  const providerId = normalizedRuntime?.provider || '';
  const providerMeta = providerId ? getProviderMeta(providerId) : null;
  const determinismProfile = isParser && (providerId || modelName)
    ? getImageParserDeterminismProfile(providerId, modelName)
    : null;

  // ---- PIPELINE (real topology) ------------------------------------------
  const inPipeline = Boolean(agentId && PIPELINE_TOPOLOGY[agentId]);
  const position = agentId ? pipelinePosition(agentId) : null;

  // ---- BEHAVIOR (real profile fields only) -------------------------------
  const headline = agent?.profile?.headline || '';
  const doesText = headline && headline !== purpose ? headline : (isParser ? null : headline || null);
  // The parser's purpose line already states what it does; rather than repeat
  // it verbatim under "Does", we surface its real boundary on the Won't side
  // and only print a Does line when the profile carries a distinct headline.
  const showDoes = Boolean(doesText) && doesText !== purpose;
  const guardrail = agent?.profile?.boundaries || '';

  // ---- RECENT RESULTS (real parser test stats or honest empty) -----------
  const parserStats = parserTestResults?.stats || null;
  const hasParserStats = isParser && parserStats && Number(parserStats.total) > 0;
  const consistencyMetric = determinismProfile
    ? formatParserReliabilityMetric(parserStats, providerId, modelName, parserTestResultsLoading)
    : '';
  const reliabilitySummary = determinismProfile
    ? formatParserReliabilitySummary(parserStats, providerId, modelName, determinismProfile.summary, parserTestResultsLoading)
    : '';

  // ---- ACTIVITY + ATTENTION (real records) -------------------------------
  const activityEntries = Array.isArray(agent?.activity?.entries) ? agent.activity.entries : [];
  const sortedActivity = activityEntries
    .slice()
    .sort((a, b) =>
      new Date(b.createdAt || b.timestamp || 0).getTime()
      - new Date(a.createdAt || a.timestamp || 0).getTime())
    .slice(0, 6);
  const attention = buildIdentityAttention(agent);
  const allClear = attention.tone !== 'down' && attention.tone !== 'warn';

  // ---- INFO RAIL (only items with a real/derivable source) ---------------
  // Transport: cleanly derivable from the runtime kind — image-parser agents
  // use Transport 2 (direct provider API); the CLI-orchestrated legs use
  // Transport 1 (Claude CLI subprocess). Omitted when there is no runtime
  // definition to derive it from.
  const transport = runtimeDefinition
    ? (runtimeDefinition.kind === 'image-parser' ? 'Direct provider API' : 'Claude CLI subprocess')
    : null;
  // Accepts / Returns: there is NO real structured per-agent source for these,
  // so they are OMITTED (documented in the review doc) rather than hardcoded.
  // Prompt version: the prompt store tracks snapshot COUNT, not a semantic
  // "P24". Show the real snapshot count when the prompt has loaded; omit
  // otherwise (no fabricated version number).
  const snapshotCount = promptState?.versions?.length || 0;
  const promptVersionLabel = agent?.promptId && snapshotCount > 0
    ? `${snapshotCount} ${snapshotCount === 1 ? 'snapshot' : 'snapshots'}`
    : null;
  const lastUpdatedIso = latestAgentTimestamp(agent);
  const lastUpdated = lastUpdatedIso ? formatDate(lastUpdatedIso) : null;

  function goToTab(tabId) {
    onTabChange?.(tabId);
  }

  return (
    <div className="agent-overview-v2">
      {/* Identity + status + enable toggle now live in the page-level
          UnifiedAgentHeader (above the tab bar, shown on every tab), so the
          Overview body starts directly at the properties row / pipeline — no
          duplicate header here. */}
      <div className="aov-body-grid">
        <div className="aov-content">
          {/* PROPERTIES STRIP */}
          <section className="aov-props">
            <div className="aov-prop">
              <div className="aov-overline">Agent ID</div>
              <div className="aov-prop-value"><code className="aov-mono">{agentId || 'Unknown'}</code></div>
            </div>
            <div className="aov-prop">
              <div className="aov-overline">Model</div>
              <div className="aov-prop-value">
                {modelDisplay ? (
                  <>
                    <ProviderModelLogo providerMeta={providerMeta} providerLabel={providerLabel} />
                    <code className="aov-mono">{modelDisplay}</code>
                    {providerLabel ? <span className="aov-prop-sub">{providerLabel}</span> : null}
                  </>
                ) : (
                  <span className="aov-prop-muted">Runtime not configured</span>
                )}
              </div>
            </div>
            <div className="aov-prop">
              <div className="aov-overline">Tools</div>
              <div className="aov-prop-value">
                {tools.length === 0 ? (
                  <span className="aov-prop-muted">None &middot; works from its prompt and inputs only</span>
                ) : (
                  <span className="aov-tools-inline">
                    {tools.map((tool, index) => (
                      <span className="aov-chip" key={normalizeToolLabel(tool, index)}>
                        {normalizeToolLabel(tool, index)}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* PIPELINE */}
          <section className="aov-section">
            <div className="aov-overline aov-section-overline">Pipeline</div>
            {inPipeline ? (
              <PipelineDiagram agentId={agentId} />
            ) : (
              <div className="aov-standalone">
                <span className="aov-standalone-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
                </span>
                <div className="aov-standalone-text">
                  <div className="aov-standalone-head">Standalone agent</div>
                  <div className="aov-standalone-sub">Not part of the escalation pipeline — it runs on its own, not fed by or feeding the other escalation agents.</div>
                </div>
              </div>
            )}
          </section>

          {/* BEHAVIOR */}
          {(showDoes || guardrail) && (
            <section className="aov-section">
              <div className="aov-overline aov-section-overline">Behavior</div>
              <div className="aov-behavior">
                {showDoes && (
                  <div className="aov-behavior-block">
                    <div className="aov-behavior-head does">
                      <span className="aov-bico" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      </span>
                      Does
                    </div>
                    <div className="aov-behavior-body">{doesText}</div>
                  </div>
                )}
                {guardrail && (
                  <div className="aov-behavior-block">
                    <div className="aov-behavior-head wont">
                      <span className="aov-bico" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </span>
                      Won't
                    </div>
                    <div className="aov-behavior-body">{guardrail}</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* RECENT RESULTS */}
          <section className="aov-section">
            <div className="aov-overline aov-section-overline">Recent Results</div>
            {hasParserStats ? (
              <div className="aov-results">
                <div className="aov-result-stats">
                  <div className="aov-result-stat">
                    <span className="aov-result-value">{formatRate(parserStats.passRate)}</span>
                    <span className="aov-result-label">Pass rate</span>
                  </div>
                  <div className="aov-result-stat">
                    <span className="aov-result-value">{parserStats.total}</span>
                    <span className="aov-result-label">Tests recorded</span>
                  </div>
                  <div className="aov-result-stat">
                    <span className="aov-result-value">{formatMs(parserStats.avgElapsedMs)}</span>
                    <span className="aov-result-label">Avg time</span>
                  </div>
                </div>
                <div className="aov-result-sub">
                  {parserStats.pass || 0} pass / {parserStats.fail || 0} fail
                  {parserStats.pending ? ` · ${parserStats.pending} pending review` : ''}
                </div>
                {determinismProfile && (
                  <div className="aov-result-note">
                    <div className="aov-overline">Test run check</div>
                    <div className="aov-result-note-body">
                      <span className={`aov-determinism-pill is-${determinismProfile.tone}`}>
                        {determinismProfile.label}
                      </span>
                      <span>{consistencyMetric}</span>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  className="aov-link-action"
                  onClick={() => goToTab('test-results')}
                >
                  View test results
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                </button>
                {isParser && (
                  <button
                    type="button"
                    className="aov-link-action"
                    onClick={() => onRunAgentTest?.(agent)}
                  >
                    Run test
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  </button>
                )}
              </div>
            ) : (
              <div className="aov-empty">
                <span className="aov-empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l3-3 3 2 4-5" /></svg>
                </span>
                <div className="aov-empty-text">
                  <div className="aov-empty-head">
                    {isParser ? 'No transcription tests recorded yet' : 'No harness results recorded yet'}
                  </div>
                  <div className="aov-empty-sub">Results from the harness will appear here once you run a test set.</div>
                </div>
                <button
                  type="button"
                  className="aov-empty-action"
                  onClick={() => (supportsModalTest ? onRunAgentTest?.(agent) : goToTab('harness'))}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  {supportsModalTest ? 'Run test' : 'Open harness'}
                </button>
              </div>
            )}
          </section>

          {/* ACTIVITY */}
          <section className="aov-section">
            <div className="aov-overline aov-section-overline">Activity</div>
            {sortedActivity.length ? (
              <div className="aov-timeline">
                {sortedActivity.map((entry, index) => (
                  <div className="aov-tl-item" key={timelineEntryKey(entry) || index}>
                    <div className="aov-tl-marker">
                      <span className="aov-tl-dot" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                      </span>
                      {index < sortedActivity.length - 1 && <span className="aov-tl-line" aria-hidden="true" />}
                    </div>
                    <div className="aov-tl-body">
                      <div className="aov-tl-head">{entry.summary || entry.event || 'Activity recorded'}</div>
                      <div className="aov-tl-meta">{formatDate(entry.createdAt || entry.timestamp)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="aov-empty-line">No activity recorded for this agent yet.</div>
            )}

            <div className={`aov-allclear ${allClear ? 'is-clear' : 'is-attention'}`}>
              {allClear ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></svg>
              )}
              <span>{allClear ? 'All clear — nothing needs attention.' : attention.text}</span>
            </div>
          </section>
        </div>

        {/* QUIET CONTEXT RAIL — only real/derivable facts */}
        <aside className="aov-rail">
          <div className="aov-rail-group">
            {transport && (
              <div className="aov-rail-row">
                <div className="aov-overline">Transport</div>
                <div className="aov-rail-value">{transport}</div>
              </div>
            )}
            {determinismProfile && (
              <div className="aov-rail-row">
                <div className="aov-overline">Reliability note</div>
                <div className={`aov-rail-value aov-determinism-text is-${determinismProfile.tone}`}>
                  {reliabilitySummary}
                </div>
              </div>
            )}
            {/* Accepts / Returns OMITTED — no honest per-agent source. */}
          </div>

          <div className="aov-rail-group">
            {promptVersionLabel && (
              <div className="aov-rail-row">
                <div className="aov-overline">Prompt version</div>
                <div className="aov-rail-value aov-mono">{promptVersionLabel}</div>
              </div>
            )}
            {lastUpdated && (
              <div className="aov-rail-row">
                <div className="aov-overline">Last updated</div>
                <div className="aov-rail-value">{lastUpdated}</div>
              </div>
            )}
          </div>

          {position && (
            <div className="aov-rail-group">
              <div className="aov-rail-row">
                <div className="aov-overline">Position in pipeline</div>
                <div className="aov-rail-value">
                  Step {position.step} of {position.total}
                  <span className="aov-rail-muted"> &middot; {position.role}</span>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// PipelineDiagram — the PRODUCTION animated dataflow diagram for the escalation
// pipeline, ported faithfully from the user-confirmed prototype
// (prototypes/agent-card/pipeline-animated.html). It renders the REAL
// PIPELINE_TOPOLOGY: Operator screenshot → Image Parser → {INV Search + Triage,
// in parallel} → QBO Assistant. The layout/geometry is FIXED (identical to the
// prototype); only the "this agent" highlight (the glowing node + ★ badge)
// moves to whichever pipeline agent's profile is being viewed.
//
// ----------------------------------------------------------------------------
// CRITICAL RENDERING FIXES carried over VERBATIM from the prototype (these were
// ~6 rounds of hard-won fixes; lose any and the spine/combined pulses go
// invisible or freeze in the user's REAL Chrome — headless verification will
// NOT catch it). See worker memory `svg-flow-animation-gotchas`.
//   1. Every STRAIGHT-LINE flow gradient (#aovG-entry, #aovG-pass,
//      #aovG-combined) uses gradientUnits="userSpaceOnUse" with explicit
//      x1/y1/x2/y2 — NOT the default objectBoundingBox, which is degenerate on
//      a zero-height straight stroke (→ invisible in real Chrome).
//   2. NO SVG blur/filter on ANY animated stroke (GPU-freezes the pulse in real
//      Chrome). There are none here — keep none.
//   3. The fork (branch) flow pulses ORIGINATE at the Image Parser card's right
//      edge (x=544), not at a fork point.
//   4. The 3 merge streams converge → a SINGLE combined pulse continues INTO the
//      final node.
//   5. Gated ignition: the final node holds "Waiting · 3 inputs" then ignites to
//      "Active" after the parallel pair's merge pulses arrive.
//   6. prefers-reduced-motion → static, no motion (handled in JS + CSS).
//   7. Plain `.aov-wire-flow` stroke-dashoffset technique — no comet/head/filter.
// CSS lives in AgentOverviewTab.css, scoped under `.agent-overview-v2 .aov-flow`.
function PipelineDiagram({ agentId }) {
  const label = (id) => pipelineNodeLabel(id, STAGE_LABELS);
  const parserId = 'escalation-template-parser';
  const invId = 'known-issue-search-agent';
  const triageId = 'triage-agent';
  const finalId = 'chat';

  // ref into the live DOM for the entrance + gated-ignition loop (ported from
  // the prototype's vanilla-JS controller, adapted to a React effect).
  const rootRef = useRef(null);
  // ref to the FIXED 1180x343 design canvas that both the wire SVG and the node
  // grid live inside. The wrapper (.aov-flow) is fluid; this inner stage is the
  // one shared coordinate space.
  const stageRef = useRef(null);

  // SHARED-COORDINATE-SPACE SCALING (the alignment fix).
  // ----------------------------------------------------------------------------
  // ROOT CAUSE of the old misalignment: the wire SVG used a fixed viewBox
  // (0 0 1180 343) with preserveAspectRatio="xMidYMid meet" stretched across the
  // panel width, while the node grid was a separate fixed-px column track. At any
  // width other than the prototype's exact 1180x343 stage, the SVG letterboxed
  // and scaled by a DIFFERENT factor than the grid → wires drifted off the node
  // edges (measured offsets up to +73 / -69px).
  //
  // FIX: the SVG and the grid now BOTH live inside a single .aov-flow-stage that
  // is sized at the FIXED design dimensions (1180x343px) — exactly the layout the
  // wire coordinates were tuned against in the prototype. We then scale that whole
  // stage as ONE unit via CSS transform to fit the available width. Because the
  // entire subtree (wires + nodes) scales by the same factor with no reflow, the
  // wires stay glued to the node edges at EVERY width — the alignment is now
  // width-independent by construction, not re-tuned for one width.
  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return undefined;

    const DESIGN_WIDTH = 1180;
    const applyScale = () => {
      // The wrapper's content-box width is the space we have to fit into. On
      // narrow screens the responsive CSS (<=1100px) stacks the grid and hides
      // the wires; there we clear the transform so the stacked layout flows
      // naturally (scale would otherwise shrink the stacked nodes).
      const stacked =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(max-width: 1100px)').matches;
      if (stacked) {
        root.style.removeProperty('--aov-scale');
        return;
      }
      const available = root.clientWidth || DESIGN_WIDTH;
      const scale = Math.min(1, available / DESIGN_WIDTH);
      root.style.setProperty('--aov-scale', String(scale));
    };

    applyScale();
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(applyScale);
      observer.observe(root);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', applyScale);
    }
    return () => {
      if (observer) observer.disconnect();
      else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', applyScale);
      }
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const nodes = Array.prototype.slice.call(root.querySelectorAll('.aov-flow-node'));
    const assistant = root.querySelector('.aov-flow-node.indigo');
    const gateChip = root.querySelector('.aov-flow-gate');

    // Reduced motion: reveal everything, present the TRUTH statically — the
    // Assistant is the final node, so render it already ignited/active.
    if (reduce) {
      nodes.forEach((n) => {
        n.style.opacity = '1';
        n.style.transform = 'none';
      });
      if (assistant) assistant.classList.add('ignited');
      if (gateChip) gateChip.classList.add('live');
      return undefined;
    }

    const timers = [];

    // Staggered entrance: reveal nodes left→right in pipeline order.
    const base = 320;
    const step = 160;
    nodes.forEach((n) => {
      const col = n.closest('.aov-flow-col');
      const order = col ? parseInt(col.getAttribute('data-order'), 10) || 1 : 1;
      timers.push(
        setTimeout(() => {
          n.classList.add('show');
        }, base + (order - 1) * step)
      );
    });

    if (!assistant) {
      return () => {
        timers.forEach(clearTimeout);
      };
    }

    // GATED IGNITION loop — truthful timeline per the verified server flow:
    //   1. Parser fires first; its context pulse leaves early.
    //   2. INV + Triage run in parallel on the parser output.
    //   3. Server awaits Promise.all([inv, triage]); ONLY THEN the Assistant runs.
    // So the Assistant holds a "waiting" state while pulses travel, and only
    // ignites after the gating parallel pair's merge pulses arrive. Loop the
    // cycle so a late-arriving viewer still sees the gating happen.
    const ENTRANCE_DONE = 1500;
    const GATE_WINDOW = 2400;
    const HOLD_LIT = 3600;
    const RESET_FADE = 1300;

    const ignite = () => {
      assistant.classList.add('ignited');
      if (gateChip) gateChip.classList.add('live');
    };
    const idle = () => {
      assistant.classList.remove('ignited');
      if (gateChip) gateChip.classList.remove('live');
    };

    const cycle = () => {
      timers.push(
        setTimeout(() => {
          ignite();
          timers.push(
            setTimeout(() => {
              idle();
              timers.push(setTimeout(cycle, RESET_FADE));
            }, HOLD_LIT)
          );
        }, GATE_WINDOW)
      );
    };

    idle();
    timers.push(setTimeout(cycle, ENTRANCE_DONE));

    return () => {
      timers.forEach(clearTimeout);
    };
    // Re-run when the highlighted agent changes so the loop/refs stay bound to
    // the freshly-rendered nodes.
  }, [agentId]);

  // "this agent" highlight generalizes: whichever pipeline node matches the
  // viewed agentId gets the ★ pin + an is-current ring, ON TOP of its permanent
  // informational role color. Agents not in the pipeline never reach this
  // component (the caller renders the standalone fallback).
  const isCurrent = (id) => agentId === id;
  const pin = (id) =>
    isCurrent(id) ? <span className="aov-flow-pin">&#9733; This agent</span> : null;
  const nodeClass = (id, role) =>
    `aov-flow-node ${role}${isCurrent(id) ? ' is-current' : ''}`;

  return (
    <div className="aov-flow" ref={rootRef}>
      {/* FIXED 1180x343 DESIGN CANVAS — the single shared coordinate space.
          Both the wire SVG and the node grid live inside this stage at the exact
          dimensions the wire coordinates were tuned against (the prototype's
          1180x343 stage). The wrapper scales this whole stage as ONE unit (CSS
          transform driven by the ResizeObserver above), so the wires stay glued
          to the node edges at every container width. See the effect comment. */}
      <div className="aov-flow-stage" ref={stageRef}>
        {/* ===== WIRE LAYER (animated) — sits BEHIND the node grid so wires anchor
             to node edges. Ported VERBATIM from the prototype. viewBox is 1:1 with
             the stage (no stretch, no letterbox). Spine y=172. Branch centers INV
             y=85, Triage y=258. Node edges: Operator right 292 · Parser 348→544 ·
             Branches 608→808 · Assistant left 873. ===== */}
        <svg
          className="aov-flow-wires"
          viewBox="0 0 1180 343"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
        <defs>
          {/* FIX #1: straight-line gradients use userSpaceOnUse + explicit
              coords. #aovG-entry, #aovG-pass and #aovG-combined are horizontal
              strokes (y1=y2) — objectBoundingBox would be degenerate (zero
              height) and render invisible in real Chrome. */}
          <linearGradient id="aovG-entry" gradientUnits="userSpaceOnUse" x1="292" y1="172" x2="348" y2="172">
            <stop offset="0" stopColor="#8b8b93" /><stop offset="1" stopColor="#4d9bff" />
          </linearGradient>
          <linearGradient id="aovG-fork-teal" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#4d9bff" /><stop offset="1" stopColor="#2dd4bf" />
          </linearGradient>
          <linearGradient id="aovG-fork-violet" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#4d9bff" /><stop offset="1" stopColor="#b07cff" />
          </linearGradient>
          <linearGradient id="aovG-merge-teal" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#2dd4bf" /><stop offset="1" stopColor="#7c83ff" />
          </linearGradient>
          <linearGradient id="aovG-merge-violet" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#b07cff" /><stop offset="1" stopColor="#7c83ff" />
          </linearGradient>
          {/* SPINE pulse gradient — userSpaceOnUse across the spine (544→845). */}
          <linearGradient id="aovG-pass" gradientUnits="userSpaceOnUse" x1="544" y1="172" x2="845" y2="172">
            <stop offset="0" stopColor="#8cc0ff" /><stop offset="1" stopColor="#7c83ff" />
          </linearGradient>
          {/* combined entry gradient — userSpaceOnUse across merge→Assistant. */}
          <linearGradient id="aovG-combined" gradientUnits="userSpaceOnUse" x1="845" y1="172" x2="873" y2="172">
            <stop offset="0" stopColor="#8a93ff" /><stop offset="1" stopColor="#7c83ff" />
          </linearGradient>
          <radialGradient id="aovG-fuse" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#aab2ff" /><stop offset="1" stopColor="#7c83ff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* SEGMENT 1: Operator → Image Parser (x292 → 348, spine y=172) */}
        <path className="aov-wire-track" d="M292 172 H348" />
        <path className="aov-wire-flow" stroke="url(#aovG-entry)" d="M292 172 H348" style={{ animationDelay: '0s' }} />
        <path className="aov-wire-arrow" stroke="#4d9bff" d="M341 167 l6 5 -6 5" />

        {/* CENTRAL SPINE track: Image Parser → MERGE POINT (the MAIN thread).
            FIX #3: the spine pulse departs FROM the card right edge x=544. */}
        <path className="aov-wire-pass-track" d="M544 172 H845" />

        {/* FORK (tap-off): branches diverge from the spine up to INV (616,85) and
            down to Triage (616,258). */}
        <path className="aov-wire-track" d="M544 172 C600 172, 600 85, 616 85" />
        <path className="aov-wire-track" d="M544 172 C600 172, 600 258, 616 258" />
        {/* IN-SYNC fork pulses (identical delay = simultaneity). FIX #3: both
            start at x=544, the Image Parser card edge — not at a fork point. */}
        <path className="aov-wire-flow" stroke="url(#aovG-fork-teal)" d="M544 172 C600 172, 600 85, 616 85" style={{ animationDelay: '0.34s' }} />
        <path className="aov-wire-flow" stroke="url(#aovG-fork-violet)" d="M544 172 C600 172, 600 258, 616 258" style={{ animationDelay: '0.34s' }} />
        <path className="aov-wire-arrow" stroke="#2dd4bf" d="M609 80 l6 5 -6 5" />
        <path className="aov-wire-arrow" stroke="#b07cff" d="M609 253 l6 5 -6 5" />

        {/* 3→1 JOIN: INV (above) + Triage (below) + spine (center) converge at
            the merge point (845,172) just left of the Assistant. */}
        <path className="aov-wire-track" d="M808 86 C842 86, 821 172, 845 172" />
        <path className="aov-wire-track" d="M808 259 C842 259, 821 172, 845 172" />
        {/* in-sync merge pulses (the GATING pair) */}
        <path className="aov-wire-flow" stroke="url(#aovG-merge-teal)" d="M808 86 C842 86, 821 172, 845 172" style={{ animationDelay: '0.62s' }} />
        <path className="aov-wire-flow" stroke="url(#aovG-merge-violet)" d="M808 259 C842 259, 821 172, 845 172" style={{ animationDelay: '0.62s' }} />

        {/* FUSE point: glow flash + anchor dot where the three streams combine */}
        <circle className="aov-merge-glow" cx="845" cy="172" r="14" />
        <circle className="aov-merge-dot" cx="845" cy="172" r="4.5" />

        {/* COMBINED single edge track: merge point (845,172) → Assistant (873,172) */}
        <path className="aov-wire-combined-track" d="M845 172 H873" />
        <path className="aov-wire-arrow" stroke="#8a9bff" strokeWidth="2.4" d="M866 166 l7 6 -7 6" />

        {/* spine label, BELOW the spine in the lower clear lane so it never sits
            on the pulse's runway. Short connector tick links it to the spine. */}
        <line x1="698" y1="179" x2="698" y2="184" stroke="rgba(124,131,255,0.35)" strokeWidth="1" />
        <rect className="aov-pass-label-bg" x="640" y="185" width="116" height="15" rx="4" />
        <text className="aov-pass-label" x="698" y="193" textAnchor="middle" dominantBaseline="middle">
          parser context (direct)
        </text>

        {/* TOP LAYER: flowing pulses drawn LAST so nothing covers them.
            FIX #4 + #7: the SPINE pulse uses the IDENTICAL plain .aov-wire-flow
            mechanism as the branches (same dasharray, same keyframes, NO filter,
            NO separate head element). FIX #3: it departs from x=544. */}
        <path className="aov-wire-flow" stroke="url(#aovG-pass)" d="M544 172 H845" style={{ animationDelay: '0.18s' }} />
        {/* COMBINED entry flow: stream continues from merge point INTO the node */}
        <path className="aov-wire-combined-flow" d="M845 172 H873" />
      </svg>

      {/* ===== NODE GRID ===== */}
      <div className="aov-flow-grid">
        {/* 1. ENTRY: Operator Screenshot (input, not an agent) */}
        <div className="aov-flow-col" data-order="1">
          <div className="aov-flow-cap aov-flow-cap-top">&nbsp;</div>
          <div className="aov-flow-node entry">
            <span className="aov-flow-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="14" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
            </span>
            <span className="aov-flow-name">Operator Screenshot</span>
            <span className="aov-flow-role">Raw input</span>
          </div>
          <div className="aov-flow-cap">Entry point</div>
        </div>

        <div className="aov-flow-spacer" />

        {/* 2. Image Parser (hero blue role color; ★ pin when current) */}
        <div className="aov-flow-col" data-order="2">
          <div className="aov-flow-cap aov-flow-cap-top">{pin(parserId)}</div>
          <div className={nodeClass(parserId, 'hero')}>
            <span className="aov-flow-halo" aria-hidden="true" />
            <span className="aov-flow-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 8.5h18" /><path d="M8 13.5l2.2 2.2L15 11" /></svg>
            </span>
            <span className="aov-flow-name">{label(parserId)}</span>
            <span className="aov-flow-role">Reads the form, field by field</span>
          </div>
          <div className="aov-flow-cap">&nbsp;</div>
        </div>

        <div className="aov-flow-spacer" />

        {/* 3. PARALLEL: INV Search Agent (teal) + Triage Agent (violet) */}
        <div className="aov-flow-col" data-order="3">
          <div className="aov-flow-cap aov-flow-cap-top">
            <span className="aov-flow-parallel"><span className="aov-flow-sync" />Run in parallel</span>
          </div>
          <div className="aov-flow-branch">
            <div className={nodeClass(invId, 'teal')}>
              {pin(invId)}
              <span className="aov-flow-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              </span>
              <span className="aov-flow-name">{label(invId)}</span>
            </div>
            <div className={nodeClass(triageId, 'violet')}>
              {pin(triageId)}
              <span className="aov-flow-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M7 12h10" /><path d="M10 18h4" /></svg>
              </span>
              <span className="aov-flow-name">{label(triageId)}</span>
            </div>
          </div>
          <div className="aov-flow-cap">&nbsp;</div>
        </div>

        <div className="aov-flow-spacer" />

        {/* 4. FINAL: QBO Assistant (indigo, GATED on all three inputs) */}
        <div className="aov-flow-col" data-order="4">
          <div className="aov-flow-cap aov-flow-cap-top">
            {isCurrent(finalId) ? (
              pin(finalId)
            ) : (
              <span className="aov-flow-gate">
                <span className="aov-flow-gdot" />
                <span className="aov-flow-gwait">Waiting &middot; 3 inputs</span>
                <span className="aov-flow-glive">Active</span>
              </span>
            )}
          </div>
          <div className={nodeClass(finalId, 'indigo')}>
            <span className="aov-flow-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 1 3 3v1a4 4 0 0 1 4 4v2a4 4 0 0 1-1 2.6V18a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-.4A4 4 0 0 1 5 15v-2a4 4 0 0 1 4-4V5a3 3 0 0 1 3-3z" /><path d="M9 13h.01M15 13h.01" /></svg>
            </span>
            <span className="aov-flow-name">{label(finalId)}</span>
            <span className="aov-flow-role">Composes the reply</span>
          </div>
          <div className="aov-flow-cap">Final response</div>
        </div>
        </div>
      </div>
    </div>
  );
}

// ProviderModelLogo — the small inline provider mark shown next to the Model
// value on the Overview. Source of truth is the SAME canonical catalog mapping
// the app's provider picker uses (shared/ai-provider-catalog.json →
// getProviderMeta → iconPath/iconLightPath); we do not invent a new mapping.
//
// HONESTY: we only render a real asset. When a provider's catalog entry has an
// iconPath we render that file (preferring the dark-surface variant on this
// surface, matching AppHeader's ProviderLogo). When the entry has NO icon
// (e.g. the LLM Gateway uses a runtime-model-family strategy with no static
// asset) we fall back to a tasteful neutral monogram built from the provider's
// real short label — never a fabricated logo. `decoding`/`loading` keep it
// cheap; a load error hides the broken image so we degrade to text-only.
function ProviderModelLogo({ providerMeta, providerLabel }) {
  const [errored, setErrored] = useState(false);
  const iconSrc = getProviderIconPath(providerMeta);
  const altLabel = providerMeta?.shortLabel || providerMeta?.label || providerLabel || 'Provider';

  if (iconSrc && !errored) {
    return (
      <span className="aov-provider-logo" title={altLabel}>
        <img
          src={iconSrc}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
        />
      </span>
    );
  }

  // Neutral monogram fallback — real initial from the provider's short label.
  const initial = (altLabel || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="aov-provider-logo is-fallback" title={altLabel} aria-hidden="true">
      {initial}
    </span>
  );
}

// Build the "Attention" line from real signals only. We deliberately read the
// raw harness and review RECORDS here, NOT operation.reviewStatus — that field
// falls back to the hardcoded AGENT_OPERATION_META literal ("Deterministic",
// "Review overdue", ...) when an agent has no real review, and trusting it
// would let fabricated text claim a real concern. We only flag a concern when
// an actual record says so. If we checked the real records and found nothing
// wrong, "Nothing needs attention." is an honest statement.
function buildIdentityAttention(agent) {
  const lastRun = latestAgentHarnessRun(agent);
  if (lastRun && (lastRun.status === 'fail' || lastRun.status === 'failed')) {
    return { text: `Last test failed — ${lastRun.summary || 'review the harness results'}.`, tone: 'down' };
  }
  const lastReview = latestAgentReview(agent);
  if (lastReview && lastReview.status === 'rejected') {
    return { text: 'Latest review was rejected — changes are blocked.', tone: 'down' };
  }
  if (!agent?.promptId && !agent?.agentId?.includes('parser')) {
    return { text: 'No prompt registered yet — not ready for live work.', tone: 'warn' };
  }
  if (lastReview && lastReview.status === 'approved') {
    return { text: `Reviewed and approved · ${formatDate(lastReview.createdAt)}`, tone: 'good' };
  }
  return { text: 'Nothing needs attention.', tone: 'neutral' };
}

function WorkflowFootprint({ agent, operation }) {
  const inbound = operation?.workflowInputs || [];
  const outbound = operation?.workflowOutputs || [];

  return (
    <Panel title="Workflow Footprint" actions={<span className="panel-status-text">Connected in {operation?.workflowCount || 0}</span>}>
      <div className="workflow-footprint">
        <div className="workflow-column">
          {inbound.map((workflow) => (
            <span className="workflow-node" key={workflow}>
              <i />
              {workflow}
            </span>
          ))}
        </div>
        <div className="workflow-agent-node">
          <AgentAvatar agent={agent} size="small" />
          <strong>{agent.profile?.roleTitle || labelAgent(agent.agentId)}</strong>
        </div>
        <div className="workflow-column">
          {outbound.map((workflow) => (
            <span className="workflow-node" key={workflow}>
              <i />
              {workflow}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function HarnessSummaryPanel({ operation }) {
  return (
    <Panel title="Harness & Execution" actions={<span className="panel-status-text">{operation?.testCoverage}% tested</span>}>
      <div className="overview-definition-grid compact">
        <Definition label="Harness Type">{operation?.harnessType}</Definition>
        <Definition label="Input Channels">{operation?.channels?.join(', ')}</Definition>
        <Definition label="Output Format">{operation?.outputFormat}</Definition>
        <Definition label="Latency Target">{operation?.latencyTarget}</Definition>
        <Definition label="Fallback Model">{operation?.fallbackModel}</Definition>
        <Definition label="Observability">{operation?.observability}</Definition>
      </div>
      <div className="coverage-bar" aria-label={`Test coverage ${operation?.testCoverage}%`}>
        <span style={{ width: `${operation?.testCoverage || 0}%` }} />
      </div>
    </Panel>
  );
}

function ConnectedWorkflows({ operation }) {
  return (
    <Panel title="Connected Workflows">
      <div className="workflow-table">
        {(operation?.workflows || []).map((workflow, index) => (
          <div key={workflow}>
            <span>{workflow}</span>
            <strong>{index % 5 === 0 && operation.status === 'review' ? 'Review' : 'Active'}</strong>
            <small>{formatRunAge(index)}</small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PromptContractPanel({ agent, operation }) {
  const rows = operation?.promptContract || [];
  return (
    <Panel title="Prompt Contract" actions={<span className="panel-status-text">{agent.promptId || 'runtime-only'}</span>}>
      <div className="contract-grid">
        {rows.map((row) => (
          <div className="contract-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ToolPermissionMatrix({ operation }) {
  const permissions = operation?.toolPermissions || [];
  return (
    <Panel title="Tool Permissions" actions={<span className="panel-status-text">{permissions.length} tools</span>}>
      {permissions.length ? (
        <div className="permission-matrix">
          <div className="permission-row permission-header">
            <span>Tool</span>
            <span>Scope</span>
            <span>Confirmation</span>
            <span>Recent Use</span>
          </div>
          {permissions.map((permission) => (
            <div className="permission-row" key={permission.tool}>
              <strong>{permission.tool}</strong>
              <span>{permission.scope}</span>
              <span className={`permission-pill ${permission.confirmationRequired ? 'warn' : 'pass'}`}>
                {permission.confirmationRequired ? 'Required' : 'Not required'}
              </span>
              <span>{permission.recentUse}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No tool permissions" copy="This agent currently has no declared tool access." />
      )}
    </Panel>
  );
}

function normalizeMemoryNote(note) {
  if (typeof note === 'string') {
    return note;
  }
  if (!note || typeof note !== 'object') {
    return 'Memory note recorded.';
  }
  return String(
    note.content
      || note.summary
      || note.text
      || note.value
      || note.key
      || 'Memory note recorded.'
  );
}

function ReviewWorkflowPanel({ agent, operation, saving = false, onMarkReviewed }) {
  const items = operation?.reviewItems || [];
  return (
    <Panel title="Change Review Workflow" actions={<span className="panel-status-text">{operation?.reviewStatus}</span>}>
      <div className="review-workflow-list">
        {items.map((item) => (
          <div className="review-workflow-item" key={item.label}>
            <span className={`check-state ${item.status}`} />
            <div>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="review-action-row">
        <button
          type="button"
          className="secondary-action"
          disabled={saving || !onMarkReviewed}
          onClick={() => onMarkReviewed?.({
            surface: 'profile',
            status: 'approved',
            summary: `Approved ${agent.profile?.roleTitle || agent.agentId} profile review.`,
          })}
        >
          {saving ? 'Saving...' : 'Mark Reviewed'}
        </button>
      </div>
    </Panel>
  );
}

function HarnessResultsPanel({ agent, operation, saving = false, onRecordHarnessRun, onRunAgentTest }) {
  const supportsAgentTest = isAgentTestSupported(agent?.agentId);
  const actionLabel = supportsAgentTest ? 'Run Test' : 'Record Run';
  const actionHandler = supportsAgentTest ? () => onRunAgentTest?.(agent) : onRecordHarnessRun;
  const actionDisabled = saving || !actionHandler;

  return (
    <Panel
      title="Harness Results"
      actions={
        <button
          type="button"
          className="text-action"
          disabled={actionDisabled}
          onClick={actionHandler}
        >
          {saving ? 'Saving...' : actionLabel}
        </button>
      }
    >
      <div className="harness-results-table">
        {(operation?.harnessCases || []).map((testCase) => (
          <div key={testCase.id} className="harness-result-row">
            <span className={`check-state ${testCase.status}`} />
            <strong>{testCase.name}</strong>
            <small>{testCase.expected}</small>
            <span>{testCase.lastRun}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AgentConfigurationTab({
  agent,
  operation,
  profileDraft,
  profileSummary,
  profileSaving,
  runtimeDefinition,
  runtimeState,
  runtimeSaveStatus,
  runtimeRecheckResult,
  reviewSaving,
  onProfileChange,
  onProfileSummaryChange,
  onProfileSave,
  onRuntimeSave,
  onMarkReviewed,
}) {
  return (
    <section className="agent-tab-content configuration-layout">
      <Panel title="Profile Studio" actions={<span className="panel-status-text">{operation?.reviewStatus}</span>}>
        <div className="profile-form-grid">
          {PROFILE_FIELDS.map((field) => (
            <FormField
              key={field.key}
              label={field.label}
              type={field.type}
              value={profileDraft[field.key] || ''}
              onChange={(value) => onProfileChange(field.key, value)}
            />
          ))}
        </div>
        <FormField
          label="Change summary"
          type="textarea"
          value={profileSummary}
          placeholder="What changed and why?"
          onChange={onProfileSummaryChange}
        />
        <div className="form-action-row">
          <button type="button" className="primary-action" onClick={onProfileSave} disabled={profileSaving}>
            {profileSaving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </Panel>

      <Panel title="Runtime Defaults">
        <RuntimeSettingsPanel
          agent={agent}
          definition={runtimeDefinition}
          runtimeState={runtimeState}
          saveStatus={runtimeSaveStatus}
          recheckResult={runtimeRecheckResult}
          onSave={onRuntimeSave}
        />
      </Panel>

      <ToolPermissionMatrix operation={operation} />

      <Panel title="Operating Policy">
        <div className="overview-definition-grid compact">
          <Definition label="Owner">{operation?.owner}</Definition>
          <Definition label="Team">{operation?.team}</Definition>
          <Definition label="Permissions">{operation?.permissions}</Definition>
          <Definition label="Risk">{operation?.risk}</Definition>
          <Definition label="Escalation Policy">{operation?.escalationPolicy}</Definition>
          <Definition label="Review Status">{operation?.reviewStatus}</Definition>
        </div>
      </Panel>

      <ReviewWorkflowPanel
        agent={agent}
        operation={operation}
        saving={reviewSaving}
        onMarkReviewed={onMarkReviewed}
      />
    </section>
  );
}

function AgentPromptTab({
  agent,
  operation,
  promptState,
  promptDraft,
  promptSummary,
  promptLoading,
  promptSaving,
  promptError,
  previewVersion,
  onPromptDraftChange,
  onPromptSummaryChange,
  onPromptSave,
  onPreviewVersion,
  onRestorePreview,
  onLoadPrompt,
}) {
  const [editingPrompt, setEditingPrompt] = useState(false);

  useEffect(() => {
    setEditingPrompt(false);
  }, [agent?.promptId, promptState?.updatedAt]);

  const promptMeta = (
    <div className="prompt-editor-meta prompt-editor-meta-header">
      <Badge>Prompt: {agent.promptId}</Badge>
      <Badge>{promptState?.versions?.length || 0} snapshots</Badge>
      <Badge>{formatDate(promptState?.updatedAt)}</Badge>
    </div>
  );
  const promptHeader = (
    <div className="prompt-editor-toolbar">
      {agent.promptId ? promptMeta : <span />}
      <div className="prompt-editor-actions">
        <button
          type="button"
          className={`prompt-icon-button${promptLoading ? ' is-loading' : ''}`}
          onClick={onLoadPrompt}
          disabled={promptLoading}
          aria-label="Reload prompt"
          title="Reload"
        >
          <svg aria-hidden="true" focusable="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 1-15.1 6.6" />
            <path d="M3 12A9 9 0 0 1 18.1 5.4" />
            <path d="M18 2v4h-4" />
            <path d="M6 22v-4h4" />
          </svg>
        </button>
        <button
          type="button"
          className={`prompt-icon-button${editingPrompt ? ' is-active' : ''}`}
          onClick={() => setEditingPrompt((value) => !value)}
          disabled={!agent.promptId || promptLoading}
          aria-pressed={editingPrompt}
          aria-label={editingPrompt ? 'Disable prompt editing' : 'Enable prompt editing'}
          title={editingPrompt ? 'Editing' : 'Edit'}
        >
          <svg aria-hidden="true" focusable="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </div>
    </div>
  );

  const currentPromptVersion = getPromptVersionFromContent(promptState?.content);
  const currentPromptSha = formatShortSha(promptState?.promptSha256);
  const versionRows = [
    ...(promptState?.content ? [{
      versionId: 'current',
      versionLabel: currentPromptVersion
        ? `${currentPromptVersion} current production${currentPromptSha ? ` · ${currentPromptSha}` : ''}`
        : 'Current production',
      createdAt: promptState?.updatedAt,
      summary: 'Active prompt file',
      content: promptState.content,
      isCurrent: true,
    }] : []),
    ...(promptState?.versions || []),
  ];

  return (
    <section className="agent-tab-content prompt-layout">
      <Panel
        headerContent={promptHeader}
      >
        {!agent.promptId ? (
          <EmptyState title="No editable prompt" copy="This identity does not use an editable prompt file." />
        ) : promptLoading ? (
          <InlineLoading label="Loading prompt..." />
        ) : (
          <>
            {promptError && <div className="agent-alert">{promptError}</div>}
            <textarea
              className={`prompt-editor${editingPrompt ? ' is-editing' : ' is-readonly'}`}
              value={promptDraft}
              onChange={(event) => onPromptDraftChange(event.target.value)}
              readOnly={!editingPrompt}
              spellCheck={false}
            />
            {editingPrompt && (
              <>
                <FormField
                  label="Change summary"
                  type="textarea"
                  value={promptSummary}
                  placeholder="Summarize the prompt update."
                  onChange={onPromptSummaryChange}
                />
                <div className="form-action-row">
                  <button type="button" className="primary-action" onClick={onPromptSave} disabled={promptSaving}>
                    {promptSaving ? 'Saving...' : 'Save Prompt'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </Panel>

      <PromptContractPanel agent={agent} operation={operation} />

      <Panel title="Prompt Versions">
        {versionRows.length ? (
          <div className="version-rows">
            {versionRows.map((version) => (
              <button
                type="button"
                className={`version-row-button${version.isCurrent ? ' is-current' : ''}`}
                key={version.versionId || version.createdAt || version.summary}
                onClick={() => onPreviewVersion(version)}
              >
                <strong>{version.versionLabel || version.versionId || 'Version'}</strong>
                <span>{version.summary || 'Prompt version'}</span>
                <small>{formatDate(version.createdAt)}</small>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="No prompt versions loaded" copy="Reload the prompt to inspect previous versions." />
        )}
      </Panel>

      <Panel title="Version Preview">
        {previewVersion ? (
          <>
            <CompactItem
              title={previewVersion.versionLabel || previewVersion.versionId || 'Selected version'}
              meta={formatDate(previewVersion.createdAt)}
              detail={previewVersion.summary || 'Previous prompt content.'}
            />
            <pre className="prompt-preview">{previewVersion.content || 'No content recorded.'}</pre>
            <div className="form-action-row">
              <button type="button" className="secondary-action" onClick={onRestorePreview}>
                Restore into editor
              </button>
            </div>
          </>
        ) : (
          <EmptyState title="No version selected" copy="Select a prompt version to preview its content." />
        )}
      </Panel>
    </section>
  );
}

function AgentHarnessTab({
  agent,
  operation,
  runtimeDefinition,
  runtimeState,
  runtimeSaveStatus,
  runtimeRecheckResult,
  harnessSaving,
  onRuntimeSave,
  onRecordHarnessRun,
  onRunAgentTest,
}) {
  return (
    <section className="agent-tab-content harness-layout">
      <HarnessSummaryPanel operation={operation} />
      <HarnessResultsPanel
        agent={agent}
        operation={operation}
        saving={harnessSaving}
        onRecordHarnessRun={onRecordHarnessRun}
        onRunAgentTest={onRunAgentTest}
      />
      <Panel title="Runtime Provider Matrix">
        <RuntimeSettingsPanel
          agent={agent}
          definition={runtimeDefinition}
          runtimeState={runtimeState}
          saveStatus={runtimeSaveStatus}
          recheckResult={runtimeRecheckResult}
          onSave={onRuntimeSave}
        />
      </Panel>
      <Panel title="Harness Checks">
        <div className="harness-check-grid">
          {operation?.harnessChecks?.map((check) => (
            <div className="harness-check" key={check.label}>
              <span className={`check-state ${check.status}`} />
              <strong>{check.label}</strong>
              <small>{check.detail}</small>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

// Status chip definitions for the Recent Runs filter bar. Single-select.
// `match` is the predicate ANDed with the provider + model dropdowns.
const RUN_FILTER_STATUSES = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'recorded', label: 'Recorded', match: (status) => status === 'pass' || status === 'fail' },
  { value: 'pending-review', label: 'Pending review', match: (status) => status === 'pending-review' },
  { value: 'pass', label: 'Passed', match: (status) => status === 'pass' },
  { value: 'fail', label: 'Failed', match: (status) => status === 'fail' },
];

// Client-side filtering for a loaded Recent Runs array. No refetching — the data
// (limit 80) is already in page state. Holds the three filter selections, derives
// distinct sorted provider/model options, and returns the filtered array.
function useRunFilters(results) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');

  const providerOptions = useMemo(() => {
    const seen = new Set();
    for (const run of results) {
      if (run?.provider) seen.add(run.provider);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [results]);

  const modelOptions = useMemo(() => {
    const seen = new Set();
    for (const run of results) {
      if (run?.model) seen.add(run.model);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [results]);

  const filtered = useMemo(() => {
    const statusDef = RUN_FILTER_STATUSES.find((entry) => entry.value === statusFilter)
      || RUN_FILTER_STATUSES[0];
    return results.filter((run) => {
      const status = run?.status || 'pending-review';
      if (!statusDef.match(status)) return false;
      if (providerFilter !== 'all' && run?.provider !== providerFilter) return false;
      if (modelFilter !== 'all' && run?.model !== modelFilter) return false;
      return true;
    });
  }, [results, statusFilter, providerFilter, modelFilter]);

  // Per-status counts for the toolbar chips. Each chip shows how many runs match
  // its status predicate across the full (unfiltered) result set, so the numbers
  // stay stable while provider/model dropdowns narrow the visible list.
  const statusCounts = useMemo(() => {
    const counts = {};
    for (const entry of RUN_FILTER_STATUSES) {
      counts[entry.value] = 0;
    }
    for (const run of results) {
      const status = run?.status || 'pending-review';
      for (const entry of RUN_FILTER_STATUSES) {
        if (entry.match(status)) counts[entry.value] += 1;
      }
    }
    return counts;
  }, [results]);

  const isActive = statusFilter !== 'all' || providerFilter !== 'all' || modelFilter !== 'all';

  const reset = useCallback(() => {
    setStatusFilter('all');
    setProviderFilter('all');
    setModelFilter('all');
  }, []);

  return {
    statusFilter,
    setStatusFilter,
    providerFilter,
    setProviderFilter,
    modelFilter,
    setModelFilter,
    providerOptions,
    modelOptions,
    statusCounts,
    filtered,
    isActive,
    reset,
  };
}

// Presentational filter bar for the Recent Runs lists. Controlled — all state
// lives in the parent's useRunFilters() call and is passed in as props.
function RunFilterBar({ filters, totalCount }) {
  const {
    statusFilter,
    setStatusFilter,
    providerFilter,
    setProviderFilter,
    modelFilter,
    setModelFilter,
    providerOptions,
    modelOptions,
    statusCounts,
    filtered,
    isActive,
    reset,
  } = filters;

  return (
    <div className="tr-toolbar">
      <div className="tr-chips" role="group" aria-label="Filter runs by status">
        {RUN_FILTER_STATUSES.map((entry) => {
          const active = statusFilter === entry.value;
          const count = statusCounts?.[entry.value] ?? 0;
          return (
            <button
              key={entry.value}
              type="button"
              className={`tr-chip${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => setStatusFilter(entry.value)}
            >
              {entry.label}
              <span className="tr-chip-n">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="tr-filters">
        <select
          className="tr-select"
          aria-label="Filter runs by provider"
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
        >
          <option value="all">All providers</option>
          {providerOptions.map((provider) => (
            <option key={provider} value={provider}>{provider}</option>
          ))}
        </select>
        <select
          className="tr-select"
          aria-label="Filter runs by model"
          value={modelFilter}
          onChange={(event) => setModelFilter(event.target.value)}
        >
          <option value="all">All models</option>
          {modelOptions.map((model) => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
        <span className="tr-showing">{filtered.length} of {totalCount}</span>
        {isActive && (
          <button type="button" className="tr-clear" onClick={reset}>Clear</button>
        )}
      </div>
    </div>
  );
}

function AgentTestAssetsTab({
  agent,
  testAssets,
  testAssetsLoading,
  testAssetsError,
  testAssetUploadState,
  onLoadTestAssets,
  onRequestTestAssetUpload,
  onTestAssetFileSelected,
  testAssetFileInputRef,
  onRunTriageCase,
  onRunRandomTriageCase,
  onRunAllTriageCases,
  onCancelTriageBatch,
  triageBatchProgress,
}) {
  const agentId = agent?.agentId || '';
  const isParser = agentId === 'escalation-template-parser';
  const isTriage = agentId === 'triage-agent';
  const assets = Array.isArray(testAssets?.assets) ? testAssets.assets : [];
  const stats = testAssets?.stats || {};
  const batch = triageBatchProgress || null;
  const batchRunning = Boolean(batch?.running);
  const [selectedAssetKey, setSelectedAssetKey] = useState('');
  const assetEntries = useMemo(
    () => assets.map((asset, index) => ({
      asset,
      key: testAssetKey(asset, index),
    })),
    [assets],
  );
  const selectedEntry = assetEntries.find((entry) => entry.key === selectedAssetKey) || assetEntries[0] || null;
  const selectedAsset = selectedEntry?.asset || null;
  const title = isParser
    ? 'Parser Test Assets'
    : isTriage
      ? 'Triage Test Assets'
      : 'Test Assets';

  useEffect(() => {
    if (!assetEntries.length) {
      if (selectedAssetKey) setSelectedAssetKey('');
      return;
    }
    if (!assetEntries.some((entry) => entry.key === selectedAssetKey)) {
      setSelectedAssetKey(assetEntries[0].key);
    }
  }, [assetEntries, selectedAssetKey]);

  const headerActions = (
    <div className="test-assets-actions">
      <button type="button" className="secondary-action" onClick={onLoadTestAssets}>
        Refresh
      </button>
      {isParser && (
        <>
          <button
            type="button"
            className="primary-action"
            disabled={testAssetUploadState?.saving}
            onClick={onRequestTestAssetUpload}
          >
            {testAssetUploadState?.saving ? 'Adding...' : 'Add Image'}
          </button>
          <input
            ref={testAssetFileInputRef}
            className="test-assets-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onTestAssetFileSelected}
          />
        </>
      )}
      {isTriage && (
        <>
          <button
            type="button"
            className="secondary-action"
            disabled={batchRunning || !assets.length}
            onClick={onRunRandomTriageCase}
          >
            Run Random
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={batchRunning || !assets.length}
            onClick={onRunAllTriageCases}
          >
            {batchRunning ? 'Running…' : `Run All${assets.length ? ` (${assets.length})` : ''}`}
          </button>
        </>
      )}
    </div>
  );

  return (
    <section className="agent-tab-content test-assets-layout" aria-label={title}>
      <header className="test-assets-topbar">
        <div className="test-assets-heading">
          <span>{isParser ? 'Image fixture library' : isTriage ? 'Approved parser outputs' : 'Asset library'}</span>
          <strong>{title}</strong>
        </div>
        {!testAssetsLoading && !testAssetsError && (
          <TestAssetsStats isParser={isParser} isTriage={isTriage} stats={stats} assetCount={assets.length} />
        )}
        {headerActions}
      </header>

      {testAssetUploadState?.message && (
        <div className="test-assets-status is-success">{testAssetUploadState.message}</div>
      )}
      {testAssetUploadState?.error && (
        <div className="test-assets-status is-error">{testAssetUploadState.error}</div>
      )}

      {isTriage && batch && (batch.running || batch.done) && (
        <TriageBatchProgress batch={batch} onCancel={onCancelTriageBatch} />
      )}

      <section className="test-assets-main" aria-label="Agent test assets">
        {testAssetsLoading ? (
          <InlineLoading label="Loading test assets..." />
        ) : testAssetsError ? (
          <EmptyState title="Test assets unavailable" copy={testAssetsError} />
        ) : assets.length ? (
          <div className={`test-assets-workbench${isTriage ? ' is-triage' : ''}`}>
            <aside className="test-assets-rail" aria-label="Test asset thumbnails">
              <div className="test-assets-rail-head">
                <span>{isParser ? 'Screenshots' : 'Templates'}</span>
                <strong>{assets.length}</strong>
              </div>
              <div className="test-assets-rail-list">
                {assetEntries.map((entry, index) => (
                  <TestAssetRailItem
                    asset={entry.asset}
                    index={index}
                    isParser={isParser}
                    isTriage={isTriage}
                    selected={entry.key === selectedEntry?.key}
                    onSelect={() => setSelectedAssetKey(entry.key)}
                    onRunCase={isTriage ? onRunTriageCase : undefined}
                    runDisabled={batchRunning}
                    runningCaseId={batch?.current?.id || ''}
                    key={entry.key}
                  />
                ))}
              </div>
            </aside>
            {isParser ? (
              <ParserAssetDetail asset={selectedAsset} />
            ) : isTriage ? (
              <TriageAssetDetail
                asset={selectedAsset}
                onRunCase={onRunTriageCase}
                runDisabled={batchRunning}
              />
            ) : (
              <EmptyAssetDetail />
            )}
          </div>
        ) : isParser ? (
          <EmptyState title="No parser images found" copy="Add image assets to make them available to the random Image Parser test." />
        ) : isTriage ? (
          <EmptyState title="No approved parser templates yet" copy="Approved Image Parser outputs will appear here automatically for triage testing." />
        ) : (
          <EmptyState title="No test assets configured" copy="This agent does not have dedicated test assets yet." />
        )}
      </section>
    </section>
  );
}

function TestAssetsStats({ isParser, isTriage, stats, assetCount }) {
  const items = isParser
    ? [
        ['Images', stats.imageCount || assetCount],
        ['Approved', stats.approvedImageCount || 0],
        ['Templates', stats.approvedTemplateCount || 0],
      ]
    : isTriage
      ? [
          ['Templates', stats.templateCount || assetCount],
          ['Images', stats.sourceImageCount || 0],
        ]
      : [
          ['Assets', stats.assetCount || assetCount],
        ];

  return (
    <div className="test-assets-stats" aria-label="Test asset summary">
      {items.map(([label, value]) => (
        <span key={label}>
          <strong>{value}</strong>
          {label}
        </span>
      ))}
    </div>
  );
}

function TestAssetRailItem({
  asset,
  index,
  isParser,
  isTriage,
  selected,
  onSelect,
  onRunCase,
  runDisabled = false,
  runningCaseId = '',
}) {
  const templates = Array.isArray(asset.approvedTemplates) ? asset.approvedTemplates : [];
  const templateCount = isParser ? templates.length : 1;
  const imageUrl = asset.thumbnailUrl || asset.url || asset.imageUrl || asset.sourceImageUrl || '';
  const label = isTriage
    ? `${asset.sourceFixtureName || asset.name || 'Template'} · template ${(asset.outputIndex ?? 0) + 1}`
    : asset.name || `Asset ${index + 1}`;
  const caseId = isTriage ? (asset.id || '') : '';
  const isThisRunning = Boolean(caseId && runningCaseId && caseId === runningCaseId);

  const inner = (
    <>
      <span className="test-assets-thumb">
        {imageUrl ? (
          <img src={imageUrl} alt="" />
        ) : (
          <span>No image</span>
        )}
      </span>
      <span className="test-assets-rail-copy">
        <strong>{label}</strong>
        <small>
          {isParser
            ? `${templateCount} approved template${templateCount === 1 ? '' : 's'}`
            : `Parser template ${(asset.outputIndex ?? 0) + 1}`}
        </small>
      </span>
    </>
  );

  // Triage rail items get an inline per-case Run control. A button cannot nest
  // inside a button, so the selectable area and the Run action are sibling
  // buttons inside a div wrapper (vs. the parser path's single button).
  if (isTriage && onRunCase) {
    return (
      <div className={`test-assets-rail-item is-runnable${selected ? ' is-selected' : ''}${isThisRunning ? ' is-running' : ''}`}>
        <button
          type="button"
          className="test-assets-rail-select"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`Select ${label}`}
        >
          {inner}
        </button>
        <button
          type="button"
          className="test-assets-rail-run"
          onClick={() => onRunCase(caseId)}
          disabled={runDisabled || !caseId}
          title={`Run triage on ${label}`}
          aria-label={`Run triage on ${label}`}
        >
          {isThisRunning ? (
            <span className="test-assets-rail-run-spinner" aria-hidden="true" />
          ) : (
            <svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          <span>Run</span>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`test-assets-rail-item${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      {inner}
      <span className={`test-assets-state${templateCount ? ' is-ready' : ' is-missing'}`}>
        {templateCount ? 'Ready' : 'Needs template'}
      </span>
    </button>
  );
}

// Live progress for the "Run all" batch on the triage test surface. Shows a thin
// determinate bar plus a running count and the current case label. GPU-friendly
// (only transform/opacity animate via CSS). Stays mounted briefly after the
// batch finishes to show the final tally.
function TriageBatchProgress({ batch, onCancel }) {
  if (!batch) return null;
  const total = Math.max(0, Number(batch.total) || 0);
  const completed = Math.max(0, Number(batch.completed) || 0);
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const running = Boolean(batch.running);
  const cancelled = Boolean(batch.cancelled);
  const tone = batch.error
    ? 'is-error'
    : !running && batch.done
      ? (cancelled ? 'is-warn' : 'is-done')
      : 'is-running';

  const headline = running
    ? `Running approved cases ${completed} / ${total}`
    : batch.error
      ? batch.error
      : cancelled
        ? `Stopped — ${completed} of ${total} run`
        : `Finished — ${completed} of ${total} cases run`;

  return (
    <div className={`triage-batch-progress ${tone}`} role="status" aria-live="polite">
      <div className="triage-batch-progress-row">
        <div className="triage-batch-progress-copy">
          <strong>{headline}</strong>
          {running && batch.current?.label ? (
            <small>Now: {batch.current.label}</small>
          ) : !running && (batch.passed || batch.failed) ? (
            <small>{batch.passed} produced a card · {batch.failed} errored</small>
          ) : null}
        </div>
        {running && onCancel && (
          <button type="button" className="triage-batch-cancel" onClick={onCancel}>
            Stop
          </button>
        )}
      </div>
      <div className="triage-batch-progress-track" aria-hidden="true">
        <span className="triage-batch-progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
    </div>
  );
}

function ParserAssetDetail({ asset }) {
  const templates = Array.isArray(asset?.approvedTemplates) ? asset.approvedTemplates : [];
  return (
    <article className="test-assets-detail" aria-label="Selected parser asset">
      <section className="test-assets-preview-pane">
        <div className="test-assets-preview-frame">
          {asset?.url || asset?.thumbnailUrl ? (
            <img src={asset.url || asset.thumbnailUrl} alt={asset.name || 'Selected parser screenshot'} />
          ) : (
            <span>No image</span>
          )}
        </div>
        <div className="test-assets-preview-meta">
          <div>
            <span>Screenshot</span>
            <strong>{asset?.name || 'No asset selected'}</strong>
          </div>
          <div className="test-assets-meta-row">
            <span>{asset.mimeType || 'image'}</span>
            <span>{formatAssetBytes(asset.sizeBytes)}</span>
            <span>{formatDate(asset.updatedAt)}</span>
          </div>
        </div>
      </section>

      <section className="test-assets-template-pane">
        <div className="test-assets-pane-head">
          <span>Official approved text</span>
          <strong>{templates.length}</strong>
        </div>
        {templates.length ? (
          <div className="test-assets-template-stack">
          {templates.map((template, index) => (
            <OfficialTemplateBlock
              template={template}
              index={index}
              key={template.id || `${asset.name}-template-${index}`}
            />
          ))}
          </div>
        ) : (
          <div className="test-assets-template-empty">No official approved text template saved for programmatic checking.</div>
        )}
      </section>
    </article>
  );
}

function TriageAssetDetail({ asset, onRunCase, runDisabled = false }) {
  if (!asset) return <EmptyAssetDetail />;
  const template = asset.approvedTemplate || {};
  const caseId = asset.id || '';
  const canRun = Boolean(onRunCase && caseId);
  return (
    <article className="test-assets-detail is-template" aria-label="Selected triage template">
      <section className="test-assets-preview-pane">
        <div className="test-assets-preview-frame">
          {asset.thumbnailUrl || asset.imageUrl ? (
            <img src={asset.imageUrl || asset.thumbnailUrl} alt={asset.sourceFixtureName || 'Source parser image'} />
          ) : (
            <span>No image</span>
          )}
        </div>
        <div className="test-assets-preview-meta">
          <div>
            <span>Source screenshot</span>
            <strong>{asset.sourceFixtureName || asset.name || 'Parser-approved template'}</strong>
          </div>
          <div className="test-assets-meta-row">
            <span>Template {(asset.outputIndex ?? 0) + 1}</span>
            <span>{asset.source || template.source || 'approved'}</span>
            <span>{formatDate(asset.updatedAt || template.updatedAt)}</span>
          </div>
        </div>
      </section>
      <section className="test-assets-template-pane">
        <div className="test-assets-pane-head">
          <span>Triage input text</span>
          {canRun ? (
            <button
              type="button"
              className="test-assets-run-case"
              onClick={() => onRunCase(caseId)}
              disabled={runDisabled}
              title="Run the triage agent on this approved case"
            >
              <svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Run triage on this case</span>
            </button>
          ) : (
            <strong>1</strong>
          )}
        </div>
        <div className="test-assets-template-stack">
          <OfficialTemplateBlock template={{ ...template, expectedText: asset.expectedText || template.expectedText }} index={asset.outputIndex || 0} compact />
        </div>
      </section>
    </article>
  );
}

function EmptyAssetDetail() {
  return (
    <article className="test-assets-detail">
      <EmptyState title="No test assets configured" copy="This agent does not have dedicated test assets yet." />
    </article>
  );
}

function OfficialTemplateBlock({ template, index, compact = false }) {
  const sourceParts = [
    template.sourceProvider,
    template.sourceModel,
    template.promptVersion,
  ].filter(Boolean);
  return (
    <div className={`test-asset-template${compact ? ' is-compact' : ''}`}>
      <div className="test-asset-template-head">
        <span>Official template {index + 1}</span>
        <small>{sourceParts.join(' / ') || template.source || 'approved output'}</small>
      </div>
      <pre>{template.expectedText || 'No template text saved.'}</pre>
    </div>
  );
}

function testAssetKey(asset, index) {
  return [
    asset?.id,
    asset?.name,
    asset?.sourceFixtureName,
    asset?.outputIndex,
    index,
  ].filter((value) => value !== null && value !== undefined && value !== '').join('::');
}

function ImageParserTestResultsTab({
  parserTestResults,
  parserTestResultsLoading,
  parserTestResultsError,
  parserResultPreview,
  onLoadParserTestResults,
  onUpdateParserTestResult,
  onProgrammaticCheckParserTestResult,
  onRetestParserTestResult,
  onDeleteParserTestResult,
  onOpenParserTestResult,
  onRequestDeleteParserTestResult,
  onPreviewParserResult,
  onCloseParserResultPreview,
}) {
  const stats = parserTestResults?.stats || {};
  const results = parserTestResults?.results || [];
  const runFilters = useRunFilters(results);
  const providerReliabilityRows = (stats.byProvider || []).map((row) => ({
    ...row,
    reliability: getImageParserDeterminismProfile(row.provider || ''),
    metric: formatReliabilityRowMetric(row),
  }));

  const blocked = parserTestResultsLoading || parserTestResultsError
    || parserTestResults?.dbAvailable === false;

  return (
    <section className="agent-tab-content tr-results">
      <aside className="tr-summary">
        <div className="tr-summary-head">
          <div className="tr-summary-heading">Image Parser Test Results</div>
          <p>Live parser runs checked against the required QBO format.</p>
          <button type="button" className="tr-refresh" onClick={onLoadParserTestResults}>Refresh</button>
        </div>

        {parserTestResultsLoading ? (
          <InlineLoading label="Loading parser test results..." />
        ) : parserTestResultsError ? (
          <EmptyState title="Test results unavailable" copy={parserTestResultsError} />
        ) : parserTestResults?.dbAvailable === false ? (
          <EmptyState title="Database unavailable" copy="Parser test results are separate from escalation logs, and MongoDB is not currently connected." />
        ) : (
          <>
            <div className="tr-metrics">
              <ParserResultMetric label="Total" value={stats.total || 0} detail={`${stats.pending || 0} pending review`} />
              <ParserResultMetric label="Pass rate" value={formatRate(stats.passRate)} detail={`${stats.pass || 0} pass / ${stats.fail || 0} fail`} tone={passRateTone(stats.passRate)} />
              <ParserResultMetric label="Avg time" value={formatMs(stats.avgElapsedMs)} detail="elapsed per run" />
            </div>
            <ParserResultBreakdown label="By provider" headLabel="Provider" rows={stats.byProvider || []} labelFor={(row) => row.provider || 'Unknown'} />
            {providerReliabilityRows.length > 0 && (
              <div className="tr-determinism">
                <div className="tr-section-label">Reliability notes</div>
                {providerReliabilityRows.map((row) => (
                  <div className={`tr-determinism-row is-${row.reliability.tone}`} key={`reliability-${row.provider || 'unknown'}`}>
                    <strong>{row.provider || 'Unknown'}</strong>
                    <span>{row.reliability.label}</span>
                    <small>{row.metric}</small>
                  </div>
                ))}
              </div>
            )}
            <ParserResultBreakdown label="By model" headLabel="Model" mono rows={stats.byModel || []} labelFor={(row) => [row.provider, row.model].filter(Boolean).join(' / ') || 'Unknown'} />
            <ParserResultBreakdown
              label="By prompt version"
              headLabel="Prompt"
              mono
              rows={stats.byPromptVersion || []}
              labelFor={(row) => [
                row.promptVersion || 'Unknown version',
                formatShortSha(row.promptSha256),
              ].filter(Boolean).join(' · ')}
            />
            <ParserResultBreakdown label="By test image" headLabel="Image" rows={stats.byFixture || []} labelFor={(row) => row.fixtureName || 'Unknown fixture'} withThumbs />
          </>
        )}
      </aside>

      <section className="tr-runs">
        <div className="tr-eyebrow">
          <span className="tr-section-label">Recent runs</span>
        </div>
        {blocked ? (
          <div className="tr-runs-placeholder" aria-hidden="true" />
        ) : results.length ? (
          <>
            <RunFilterBar filters={runFilters} totalCount={results.length} />
            {runFilters.filtered.length ? (
              <div className="tr-list">
                {runFilters.filtered.map((result) => {
                  const status = result.status || 'pending-review';
                  return (
                    <article className={`tr-run is-${status}`} key={result.id}>
                      <div className="tr-run-body">
                        <div className="tr-run-head">
                          <button
                            type="button"
                            className="tr-run-thumb"
                            onClick={() => onPreviewParserResult(result)}
                            aria-label="Open test image"
                          >
                            {result.fixture?.url ? <img src={result.fixture.url} alt="" /> : <span>No image</span>}
                          </button>
                          <div className="tr-run-copy">
                            <div className="tr-run-top">
                              <span className="tr-run-name">{result.fixture?.name || 'Unknown fixture'}</span>
                              <span className="tr-run-time">{formatDate(result.createdAt)}</span>
                            </div>
                            <div className="tr-run-meta">
                              <span className="tr-tag is-mono">{[result.provider || 'provider?', result.model || 'model?'].join(' / ')}</span>
                              <span className="tr-tag">{result.reasoningEffort || 'default effort'}</span>
                              <span className="tr-tag is-mono">{formatMs(result.elapsedMs)}</span>
                              <span className={`tr-tag${result.canonicalPassed === true ? ' is-ok' : result.canonicalPassed === false ? ' is-fail' : ''}`}>
                                9-label {result.canonicalPassed === false ? 'failed' : result.canonicalPassed === true ? 'passed' : 'unknown'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <pre className="tr-run-out">{result.parsedText || 'No parser output saved.'}</pre>
                      </div>
                      <ParserResultActions
                        result={result}
                        resultId={result.id}
                        currentStatus={result.status}
                        onUpdate={onUpdateParserTestResult}
                        onProgrammaticCheck={onProgrammaticCheckParserTestResult}
                        onRetest={onRetestParserTestResult}
                        onDelete={onDeleteParserTestResult}
                        onOpen={() => onOpenParserTestResult(result)}
                        onRequestDelete={() => onRequestDeleteParserTestResult(result)}
                        onReview={() => onPreviewParserResult(result)}
                        openOnly
                      />
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="tr-empty">
                <span>No runs match these filters.</span>
                <button type="button" className="tr-clear" onClick={runFilters.reset}>Clear</button>
              </div>
            )}
          </>
        ) : (
          <EmptyState title="No parser tests saved yet" copy="Run the Image Parser test from Chat, then mark the result pass or fail." />
        )}
      </section>

      {parserResultPreview && (
        <ImageParserResultPreviewModal result={parserResultPreview} onClose={onCloseParserResultPreview} />
      )}
    </section>
  );
}

function TriageAgentTestResultsTab({
  triageTestResults,
  triageTestResultsLoading,
  triageTestResultsError,
  onLoadTriageTestResults,
  onUpdateTriageTestResult,
}) {
  const stats = triageTestResults?.stats || {};
  const results = triageTestResults?.results || [];
  const runFilters = useRunFilters(results);

  const blocked = triageTestResultsLoading || triageTestResultsError
    || triageTestResults?.dbAvailable === false;

  return (
    <section className="agent-tab-content tr-results">
      <aside className="tr-summary">
        <div className="tr-summary-head">
          <div className="tr-summary-heading">Triage Agent Test Results</div>
          <p>Live triage runs graded on severity, category, and confidence.</p>
          <button type="button" className="tr-refresh" onClick={onLoadTriageTestResults}>Refresh</button>
        </div>

        {triageTestResultsLoading ? (
          <InlineLoading label="Loading triage test results..." />
        ) : triageTestResultsError ? (
          <EmptyState title="Test results unavailable" copy={triageTestResultsError} />
        ) : triageTestResults?.dbAvailable === false ? (
          <EmptyState title="Database unavailable" copy="Triage test results are separate from escalation logs, and MongoDB is not currently connected." />
        ) : (
          <>
            <div className="tr-metrics">
              <ParserResultMetric label="Total" value={stats.total || 0} detail={`${stats.pending || 0} pending review`} />
              <ParserResultMetric label="Pass rate" value={formatRate(stats.passRate)} detail={`${stats.pass || 0} pass / ${stats.fail || 0} fail`} tone={passRateTone(stats.passRate)} />
              <ParserResultMetric label="Avg time" value={formatMs(stats.avgElapsedMs)} detail="elapsed per run" />
            </div>
            <ParserResultBreakdown label="By provider" headLabel="Provider" rows={stats.byProvider || []} labelFor={(row) => row.provider || 'Unknown'} />
            <ParserResultBreakdown label="By model" headLabel="Model" mono rows={stats.byModel || []} labelFor={(row) => [row.provider, row.model].filter(Boolean).join(' / ') || 'Unknown'} />
            <ParserResultBreakdown label="By fixture" headLabel="Fixture" rows={stats.byFixture || []} labelFor={(row) => row.fixtureName || 'Unknown fixture'} />
          </>
        )}
      </aside>

      <section className="tr-runs">
        <div className="tr-eyebrow">
          <span className="tr-section-label">Recent runs</span>
        </div>
        {blocked ? (
          <div className="tr-runs-placeholder" aria-hidden="true" />
        ) : results.length ? (
          <>
            <RunFilterBar filters={runFilters} totalCount={results.length} />
            {runFilters.filtered.length ? (
              <div className="tr-list">
                {runFilters.filtered.map((result) => {
                  const fixture = result.fixture || {};
                  const tags = Array.isArray(fixture.tags) ? fixture.tags.filter(Boolean) : [];
                  const missingInfo = Array.isArray(result.missingInfo) ? result.missingInfo.filter(Boolean) : [];
                  const status = result.status || 'pending-review';
                  return (
                    <article className={`tr-run tr-run--triage is-${status}`} key={result.id}>
                      <div className="tr-run-body">
                        <div className="tr-run-top">
                          <span className="tr-run-name">{fixture.name || 'Unknown fixture'}</span>
                          <span className="tr-run-time">{formatDate(result.createdAt)}</span>
                        </div>
                        {fixture.description && (
                          <p className="tr-run-desc">{fixture.description}</p>
                        )}
                        <div className="tr-run-meta">
                          <span className="tr-tag is-mono">{[result.provider || 'provider?', result.model || 'model?'].join(' / ')}</span>
                          <span className="tr-tag">{result.reasoningEffort || 'default effort'}</span>
                          <span className="tr-tag is-mono">{formatMs(result.elapsedMs)}</span>
                          <span className="tr-tag"><span className="tr-tag-k">severity</span> {result.severity || '—'}</span>
                          <span className="tr-tag"><span className="tr-tag-k">category</span> {result.category || '—'}</span>
                          <span className="tr-tag is-mono"><span className="tr-tag-k">conf</span> {result.confidence || '—'}</span>
                          {result.fallbackEligible && <span className="tr-tag is-warn" title={result.fallbackReason || 'Parser validation failed'}>fallback-eligible</span>}
                          {result.fallbackUsed && <span className="tr-tag is-warn">rule-fallback</span>}
                        </div>
                        {tags.length > 0 && (
                          <div className="tr-run-meta">
                            {tags.map((tag) => <span className="tr-tag is-faint" key={tag}>#{tag}</span>)}
                          </div>
                        )}
                        {result.read && (
                          <pre className="tr-run-out">{`Fast read: ${result.read}`}</pre>
                        )}
                        {result.action && (
                          <pre className="tr-run-out">{`Next step: ${result.action}`}</pre>
                        )}
                        {missingInfo.length > 0 && (
                          <pre className="tr-run-out">{`Missing info: ${missingInfo.join(', ')}`}</pre>
                        )}
                      </div>
                      <ParserResultActions
                        resultId={result.id}
                        currentStatus={result.status}
                        onUpdate={onUpdateTriageTestResult}
                      />
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="tr-empty">
                <span>No runs match these filters.</span>
                <button type="button" className="tr-clear" onClick={runFilters.reset}>Clear</button>
              </div>
            )}
          </>
        ) : (
          <EmptyState title="No triage tests saved yet" copy="Run the Triage Agent test from Chat, then mark the result pass or fail." />
        )}
      </section>
    </section>
  );
}

function ParserResultActions({
  result = null,
  resultId,
  currentStatus,
  onUpdate,
  onProgrammaticCheck,
  onRetest,
  onDelete,
  onOpen,
  onRequestDelete,
  onReview,
  openOnly = false,
}) {
  // Single-click Pass / Fail grading for a parser test result row.
  // Behavior mirrors the chat-area `ParserOutput` review buttons in ChatV5Container.jsx:
  // - One click PATCHes /api/pipeline-tests/parser-results/:id
  // - Both buttons disable while the save is in flight
  // - The active button keeps its is-pass / is-fail color after the save lands
  // - A status line below the buttons announces "Saving...", "Recorded: pass/fail", or "Pending review"
  const [pendingStatus, setPendingStatus] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const status = currentStatus || 'pending-review';
  const isSaving = Boolean(pendingStatus || pendingAction);
  const hasConfirmedOutput = result?.hasConfirmedOutput === true;
  const hasFixture = Boolean(result?.fixture?.name);
  const canAutoCheck = status === 'pending-review' && hasConfirmedOutput && Boolean(onProgrammaticCheck);
  const canReview = status === 'pending-review' && !hasConfirmedOutput && Boolean(onReview);
  const canRetest = status === 'fail' && hasFixture && Boolean(onRetest);
  const canDelete = Boolean((onRequestDelete || onDelete) && resultId);

  async function runRowAction(action, fn) {
    if (isSaving) return;
    setPendingAction(action);
    setActionMessage('');
    try {
      await fn();
    } catch (err) {
      setActionMessage(err?.message || 'Action failed.');
    } finally {
      setPendingAction('');
    }
  }

  async function handleClick(nextStatus) {
    if (isSaving) return;
    setPendingStatus(nextStatus);
    setActionMessage('');
    try {
      await onUpdate(resultId, nextStatus);
    } catch (_err) {
      // Parent surfaces the error via setParserTestResultsError; no extra handling needed here.
    } finally {
      setPendingStatus('');
    }
  }

  // verdictKind drives the prominent state pill. graded === a recorded human call.
  const verdictKind = status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : 'pending';
  const verdictLabel = isSaving
    ? pendingAction === 'check' ? 'Checking'
      : pendingAction === 'retest' ? 'Retesting'
        : pendingAction === 'delete' ? 'Deleting'
          : 'Saving'
    : status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Pending';
  const railLabel = status === 'pass' || status === 'fail' ? 'Regrade' : 'Grade';

  if (openOnly && typeof onOpen === 'function') {
    return (
      <div className="tr-run-rail tr-run-rail--open" aria-label="Open test result">
        <span className={`tr-verdict is-${verdictKind}`}>{verdictLabel}</span>
        <div className="tr-row-open-actions">
          <button
            type="button"
            className="tr-row-action is-open"
            disabled={isSaving}
            onClick={onOpen}
          >
            Open
          </button>
          {canDelete && (
            <button
              type="button"
              className="tr-trash-run"
              disabled={isSaving}
              aria-label={`Delete ${result?.fixture?.name || 'test run'}`}
              title="Delete saved test run"
              onClick={onRequestDelete || (() => runRowAction('delete', () => onDelete(resultId)))}
            >
              <TrashIcon size={14} />
            </button>
          )}
        </div>
        {actionMessage && <small className="tr-action-message">{actionMessage}</small>}
      </div>
    );
  }

  return (
    <div className="tr-run-rail" aria-label="Record test result">
      <span className={`tr-verdict is-${verdictKind}`}>{verdictLabel}</span>
      {(canAutoCheck || canReview || canRetest) && (
        <div className="tr-row-actions">
          {canAutoCheck && (
            <button
              type="button"
              className="tr-row-action is-check"
              disabled={isSaving}
              onClick={() => runRowAction('check', () => onProgrammaticCheck(resultId))}
            >
              Auto check
            </button>
          )}
          {canReview && (
            <button
              type="button"
              className="tr-row-action is-review"
              disabled={isSaving}
              onClick={onReview}
            >
              Review
            </button>
          )}
          {canRetest && (
            <button
              type="button"
              className="tr-row-action is-retest"
              disabled={isSaving}
              onClick={() => runRowAction('retest', () => onRetest(result))}
            >
              Retest
            </button>
          )}
        </div>
      )}
      <div className="tr-rail-label">{railLabel}</div>
      <div className="tr-grade">
        <button
          type="button"
          className={status === 'pass' ? 'is-on-pass' : ''}
          disabled={isSaving}
          aria-label="Mark this test result as a pass"
          onClick={() => handleClick('pass')}
        >
          Pass
        </button>
        <button
          type="button"
          className={status === 'fail' ? 'is-on-fail' : ''}
          disabled={isSaving}
          aria-label="Mark this test result as a fail"
          onClick={() => handleClick('fail')}
        >
          Fail
        </button>
      </div>
      {canDelete && (
        <button
          type="button"
          className="tr-delete-run"
          disabled={isSaving}
          onClick={onRequestDelete || (() => runRowAction('delete', () => onDelete(resultId)))}
        >
          Delete
        </button>
      )}
      {actionMessage && <small className="tr-action-message">{actionMessage}</small>}
    </div>
  );
}

function TrashIcon({ size = 14 }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function ParserResultMetric({ label, value, detail, tone }) {
  // tone is semantic: 'ok' | 'warn' | 'err' color the value; anything else is neutral.
  const toneClass = tone === 'ok' || tone === 'warn' || tone === 'err' ? ` is-${tone}` : '';
  return (
    <div className="tr-metric">
      <div className="tr-metric-label">{label}</div>
      <div className={`tr-metric-value${toneClass}`}>{value}</div>
      <div className="tr-metric-detail">{detail}</div>
    </div>
  );
}

// Breakdown rendered as a real data table with 4 unambiguous columns:
// NAME | RUNS | PASS RATE (mini bar + % + "N pass · M fail") | AVG.
// Pass + fail fold into one cell so 360-400px stays readable. `headLabel`
// names the first column; `mono` renders the name cell in monospace (model
// strings); `withThumbs` shows a fixture thumbnail before the name. All values
// are real stats fields — pass is derived as total - fail.
function ParserResultBreakdown({ label, headLabel, rows, labelFor, withThumbs = false, mono = false }) {
  return (
    <div className="tr-breakdown">
      <div className="tr-section-label">{label}</div>
      {rows.length ? (
        <table className="tr-table">
          <colgroup>
            <col className="c-name" />
            <col className="c-runs" />
            <col className="c-rate" />
            <col className="c-avg" />
          </colgroup>
          <thead>
            <tr>
              <th className="h-name">{headLabel}</th>
              <th>Runs</th>
              <th className="h-rate">Pass rate</th>
              <th>Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const total = row.total || 0;
              const fail = row.fail || 0;
              const pass = Math.max(0, total - fail);
              const ratePct = Math.round(clamp(Number(row.passRate) || 0, 0, 1) * 100);
              // Tone-grade the bar fill on the same thresholds as the pass-rate
              // metric so a bad rate never shows a green bar.
              const fillTone = passRateTone(row.passRate) || 'err';
              return (
                <tr key={`${label}-${labelFor(row)}`}>
                  <td className={`tr-row-name${mono ? ' tr-mono' : ''}`} title={labelFor(row)}>
                    {withThumbs && (
                      row.fixture?.url
                        ? <img className="tr-thumb" src={row.fixture.url} alt="" />
                        : <span className="tr-thumb" />
                    )}
                    {labelFor(row)}
                  </td>
                  <td>{total}</td>
                  <td className="tr-rate">
                    <div className="tr-rate-top">
                      <div className="tr-rate-bar">
                        <div className={`tr-rate-fill is-${fillTone}`} style={{ width: `${ratePct}%` }} />
                      </div>
                      <span className="tr-rate-pct">{formatRate(row.passRate)}</span>
                    </div>
                    <div className="tr-rate-sub">
                      {pass} pass · <span className={`tr-rate-fail${fail === 0 ? ' is-zero' : ''}`}>{fail} fail</span>
                    </div>
                  </td>
                  <td className="tr-mono">{formatMs(row.avgElapsedMs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="tr-breakdown-empty">No data yet.</div>
      )}
    </div>
  );
}

function ImageParserResultPreviewModal({ result, onClose }) {
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="parser-result-preview-modal" role="dialog" aria-modal="true" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="parser-result-preview-panel">
        <header>
          <strong>{result.fixture?.name || 'Parser test image'}</strong>
          <div>
            <button type="button" onClick={() => setZoom((value) => Math.max(50, value - 25))}>-</button>
            <span>{zoom}%</span>
            <button type="button" onClick={() => setZoom((value) => Math.min(225, value + 25))}>+</button>
            <button type="button" onClick={() => setZoom(100)}>1:1</button>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </header>
        <main>
          {result.fixture?.url && <img src={result.fixture.url} alt={result.fixture?.name || 'Parser test image'} style={{ width: `${zoom}%` }} />}
          <pre>{result.parsedText || ''}</pre>
        </main>
      </div>
    </div>
  );
}

function ImageParserEventStreamsTab({
  parserHistory,
  parserSavedEvents,
  parserHistoryLoading,
  parserHistoryError,
  parserEventStats,
  onLoadParserEventStreams,
}) {
  const results = parserHistory?.results || [];
  const events = parserSavedEvents || [];
  const parserStats = parserEventStats?.byStage?.parser || {};
  const totals = parserEventStats?.totals || {};
  const providerCaptures = results
    .filter((result) => result?.providerTrace)
    .map((result) => ({
      key: result._id || result.id || `${result.provider}-${result.createdAt}`,
      title: result.providerTrace?.providerPackageId || 'Provider package pending',
      meta: [
        result.provider || 'provider?',
        result.providerTrace?.providerHarness || 'provider harness',
        result.providerTrace?.outcome || result.status || 'run',
        formatDate(result.createdAt),
      ].filter(Boolean).join(' · '),
      detail: formatProviderTraceDetail(result.providerTrace),
    }))
    .slice(0, 20);

  return (
    <section className="agent-tab-content single-column-layout">
      <Panel
        title="Image Parser Event Streams"
        actions={
          <button type="button" className="text-action" onClick={onLoadParserEventStreams}>
            Refresh
          </button>
        }
      >
        {parserHistoryLoading ? (
          <InlineLoading label="Loading parser event streams..." />
        ) : parserHistoryError ? (
          <EmptyState title="Event streams unavailable" copy={parserHistoryError} />
        ) : events.length ? (
          <div className="compact-list">
            {events.map((event) => (
              <CompactItem
                key={event.key}
                title={event.kind || 'parser event'}
                meta={`${formatDate(event.ts)} · ${event.conversationTitle || 'Conversation'} · ${event.runStatus || 'parser run'}`}
                detail={event.detail || 'Saved parser event'}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No parser events yet" copy="Run the Image Parser from Chat to populate this stream." />
        )}
      </Panel>
      <Panel title="Stream Source">
        <div className="overview-definition-grid">
          <Definition label="Recent parser runs">{parserHistory?.total || results.length}</Definition>
          <Definition label="Saved parser events">{events.length}</Definition>
          <Definition label="Parser event average">{parserStats.avg ? `${parserStats.avg} per run` : 'No parser average yet'}</Definition>
          <Definition label="Pipeline events total">{totals.allTime || 0}</Definition>
        </div>
      </Panel>
      <Panel title="Provider Harness Captures">
        {providerCaptures.length ? (
          <div className="compact-list">
            {providerCaptures.map((capture) => (
              <CompactItem
                key={capture.key}
                title={capture.title}
                meta={capture.meta}
                detail={capture.detail}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No provider captures yet" copy="Run the Image Parser with a harnessed provider to populate provider package traces." />
        )}
      </Panel>
    </section>
  );
}

function ImageParserChatSessionsTab({
  parserSessions,
  parserSessionsLoading,
  parserSessionsError,
  onLoadParserChatSessions,
}) {
  const sessions = parserSessions || [];
  return (
    <section className="agent-tab-content single-column-layout">
      <Panel
        title="Image Parser Chat Sessions"
        actions={
          <button type="button" className="text-action" onClick={onLoadParserChatSessions}>
            Refresh
          </button>
        }
      >
        {parserSessionsLoading ? (
          <InlineLoading label="Loading chat session activity..." />
        ) : parserSessionsError ? (
          <EmptyState title="Chat sessions unavailable" copy={parserSessionsError} />
        ) : sessions.length ? (
          <div className="compact-list">
            {sessions.map((conversation) => (
              <a
                key={conversation._id}
                href={`#/chat/${conversation._id}`}
                className="compact-item compact-item-link"
              >
                <strong>{conversation.title || 'Untitled conversation'}</strong>
                <span>
                  {formatDate(conversation.updatedAt || conversation.createdAt)}
                  {' · '}
                  {conversation.totalEventCount || 0} pipeline events
                  {conversation.messageCount ? ` · ${conversation.messageCount} messages` : ''}
                </span>
                <small>{conversation.lastMessage?.preview || conversation.provider || 'Open chat session'}</small>
              </a>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No image parser chat sessions yet"
            copy="Chat sessions with saved pipeline events will appear here after the Image Parser runs."
          />
        )}
      </Panel>
    </section>
  );
}

function buildParserSavedEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event, index) => ({
      key: event.key || `${event.conversationId || 'conversation'}-${event.seq ?? index}-${event.kind || 'event'}`,
      kind: event.kind || 'parser event',
      ts: event.ts,
      runStatus: event.runStatus || '',
      conversationTitle: event.conversationTitle || 'Untitled conversation',
      detail: formatParserEventDetail(event),
    }))
    .sort((a, b) => timestampValue(b.ts) - timestampValue(a.ts))
    .slice(0, 80);
}

function timestampValue(value) {
  if (value === null || value === undefined) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatParserEventDetail(event) {
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  const parts = [];
  if (event?.category) parts.push(event.category);
  if (data.provider) parts.push(`provider=${data.provider}`);
  if (data.model) parts.push(`model=${data.model}`);
  if (data.elapsedMs != null) parts.push(`elapsed=${formatMs(data.elapsedMs)}`);
  if (data.durationMs != null) parts.push(`duration=${formatMs(data.durationMs)}`);
  if (data.providerHarness) parts.push(`harness=${data.providerHarness}`);
  if (data.providerPackageId) parts.push(`package=${data.providerPackageId}`);
  if (data.outcome) parts.push(`outcome=${data.outcome}`);
  if (data.captureEnabled != null) parts.push(`capture=${data.captureEnabled ? 'on' : 'off'}`);
  if (data.packageCaptureQueued != null) parts.push(`queued=${data.packageCaptureQueued ? 'yes' : 'no'}`);
  if (data.textChars != null) parts.push(`chars=${data.textChars}`);
  if (data.error) parts.push(`error=${data.error}`);
  if (data.status) parts.push(`status=${data.status}`);
  return parts.join(' · ') || 'Saved event from conversation case intake.';
}

function formatProviderTraceDetail(trace) {
  if (!trace || typeof trace !== 'object') {
    return 'No provider trace metadata saved.';
  }

  const parts = [];
  if (trace.callSite) parts.push(`call=${trace.callSite}`);
  if (trace.statusCode != null) parts.push(`http=${trace.statusCode}`);
  if (trace.durationMs != null) parts.push(`duration=${formatMs(trace.durationMs)}`);
  if (trace.captureEnabled != null) parts.push(`capture=${trace.captureEnabled ? 'on' : 'off'}`);
  if (trace.packageCaptureQueued != null) parts.push(`queued=${trace.packageCaptureQueued ? 'yes' : 'no'}`);
  if (trace.gatewayRequestId) parts.push(`gateway=${trace.gatewayRequestId}`);
  if (trace.textLength != null) parts.push(`chars=${trace.textLength}`);
  return parts.join(' · ') || 'Provider harness trace saved.';
}

function AgentWorkflowsTab({ agent, operation }) {
  return (
    <section className="agent-tab-content workflows-layout">
      <WorkflowFootprint agent={agent} operation={operation} />
      <ConnectedWorkflows operation={operation} />
      <Panel title="Workflow Impact">
        <div className="workflow-impact-grid">
          {(operation?.workflows || []).map((workflow, index) => (
            <div className="workflow-impact-card" key={workflow}>
              <span className="rank-pill">{index + 1}</span>
              <strong>{workflow}</strong>
              <small>{operation?.workflowDescriptions?.[index] || 'Connected workflow stage'}</small>
              <FitBars score={Math.max(0.45, operation.workflowFit - index * 0.04)} />
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function AgentMemoryTab({ agent }) {
  const notes = agent?.memory?.notes || [];
  const relationships = agent?.relationships?.notes || [];
  return (
    <section className="agent-tab-content single-column-layout">
      <Panel title="Agent Memory" actions={<span className="panel-status-text">{notes.length} notes</span>}>
        {notes.length ? (
          <div className="compact-list">
            {notes.map((note) => (
              <CompactItem
                key={note.key || `${note.kind}-${note.updatedAt}`}
                title={note.kind || 'Memory'}
                meta={formatDate(note.updatedAt)}
                detail={note.content}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No memory notes yet" copy="Agent-specific learned notes will appear here." />
        )}
      </Panel>
      <Panel title="Agent Relationships" actions={<span className="panel-status-text">{relationships.length} notes</span>}>
        {relationships.length ? (
          <div className="compact-list">
            {relationships.map((note) => (
              <CompactItem
                key={`${note.otherAgentId}-${note.updatedAt}-${note.summary}`}
                title={note.otherAgentId || 'Related agent'}
                meta={`${note.strength || 'relationship'} · confidence ${note.confidence ?? 'unknown'}`}
                detail={note.summary}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No relationship notes yet" copy="Agent-to-agent memory and coordination notes will appear here." />
        )}
      </Panel>
    </section>
  );
}

function AgentMonitoringTab({ agent, operation, runtimeState }) {
  const latestHarness = latestEntryByDate(agent?.harness?.runs || [], ['completedAt', 'createdAt']);
  const latestActivity = latestEntryByDate(agent?.activity?.entries || [], ['createdAt']);
  // getAgentRuntimeSummary expects (definition, state) — pass the resolved
  // runtime DEFINITION as the first arg (matching the correct call sites at
  // buildOperationalProfile and the overview properties strip). Passing the
  // STATE object here made every Monitoring tab read "No runtime mapping".
  const runtimeDefinition = getAgentRuntimeDefinition(agent?.agentId);
  const runtimeSummary = getAgentRuntimeSummary(
    runtimeDefinition,
    runtimeState || agent?.runtime || {},
  );
  return (
    <section className="agent-tab-content single-column-layout">
      <Panel title="Monitoring Snapshot" actions={<span className="panel-status-text">{agent?.enabled === false ? 'Disabled' : 'Enabled'}</span>}>
        <div className="overview-definition-grid">
          <Definition label="Lifecycle">{agent?.enabled === false ? 'Disabled' : 'Enabled'}</Definition>
          <Definition label="Runtime">{runtimeSummary || operation?.modelLabel}</Definition>
          <Definition label="Prompt">{agent?.promptId || 'No prompt registered'}</Definition>
          <Definition label="Latest harness">{latestHarness ? formatDate(latestHarness.completedAt || latestHarness.createdAt) : 'No harness runs'}</Definition>
          <Definition label="Latest activity">{latestActivity ? formatDate(latestActivity.createdAt) : 'No activity recorded'}</Definition>
          <Definition label="Open gaps">Issues/tasks ledger, live log stream, and alert history are not first-class profile sections yet.</Definition>
        </div>
      </Panel>
    </section>
  );
}

function AgentActivityTab({ history, historyLoading, historyError, onLoadHistory, agent }) {
  const entries = history?.activity || agent.activity?.entries || [];
  return (
    <section className="agent-tab-content single-column-layout">
      <Panel
        title="Activity Timeline"
        actions={
          <button type="button" className="text-action" onClick={onLoadHistory}>
            Refresh
          </button>
        }
      >
        {historyLoading ? (
          <InlineLoading label="Loading activity..." />
        ) : historyError ? (
          <EmptyState title="Activity unavailable" copy={historyError} />
        ) : (
          <TimelineList entries={entries} fallback="No activity recorded for this agent yet." />
        )}
      </Panel>
    </section>
  );
}

function AgentVersionsTab({ history, historyLoading, historyError, onLoadHistory }) {
  const versions = history?.versions || [];
  return (
    <section className="agent-tab-content single-column-layout">
      <Panel
        title="Version History"
        actions={
          <button type="button" className="text-action" onClick={onLoadHistory}>
            Refresh
          </button>
        }
      >
        {historyLoading ? (
          <InlineLoading label="Loading versions..." />
        ) : historyError ? (
          <EmptyState title="Versions unavailable" copy={historyError} />
        ) : versions.length ? (
          <div className="version-timeline">
            {versions.map((version) => (
              <CompactItem
                key={version.versionId || version.createdAt || version.summary}
                title={version.versionLabel || version.versionId || 'Version'}
                meta={formatDate(version.createdAt)}
                detail={version.summary || 'Identity version saved.'}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No versions yet" copy="Profile and prompt saves will appear here." />
        )}
      </Panel>
    </section>
  );
}

function RuntimeSettingsPanel({ agent, definition, runtimeState, saveStatus, recheckResult, onSave }) {
  const { providerStatus } = useProviderKeyStatus();
  const normalizedRuntimeState = normalizeAgentRuntimeState(definition, runtimeState || {});
  const [provider, setProvider] = useState(normalizedRuntimeState?.provider || '');
  const [fallbackProvider, setFallbackProvider] = useState(normalizedRuntimeState?.fallbackProvider || '');
  const [model, setModel] = useState(normalizedRuntimeState?.model || '');
  const [fallbackModel, setFallbackModel] = useState(normalizedRuntimeState?.fallbackModel || '');
  const [reasoningEffort, setReasoningEffort] = useState(
    normalizedRuntimeState?.reasoningEffort || ''
  );
  const [serviceTier, setServiceTier] = useState(normalizedRuntimeState?.serviceTier || 'fast');

  useEffect(() => {
    const normalized = normalizeAgentRuntimeState(definition, runtimeState || {});
    setProvider(normalized?.provider || '');
    setFallbackProvider(normalized?.fallbackProvider || '');
    setModel(normalized?.model || '');
    setFallbackModel(normalized?.fallbackModel || '');
    setReasoningEffort(normalized?.reasoningEffort || '');
    setServiceTier(normalized?.serviceTier || 'fast');
  }, [definition, runtimeState]);

  if (!definition) {
    return (
      <EmptyState
        title="No runtime registry entry"
        copy="This identity does not currently map to an editable model provider configuration."
      />
    );
  }

  const providerOptions = PROVIDER_OPTIONS;
  const isMissingKey = (providerId) => isProviderMissingApiKey(providerId, providerStatus);
  // Failover is now ALWAYS on for EVERY agent — including the Image Parser and
  // Triage (Wave 2). Every agent shows a Primary + Fallback pair so the operator
  // can pick the backup the engine fails over to. There is no use-case/capability
  // restriction on which provider may back up which.
  const supportsFallback = true;
  const currentRuntime = {
    provider,
    fallbackProvider,
    model,
    fallbackModel,
    reasoningEffort,
    serviceTier,
  };
  const modelSuggestions = getAgentRuntimeModelSuggestions(definition, currentRuntime);
  const fallbackModelSuggestions = getAgentRuntimeModelSuggestions(definition, currentRuntime, {
    fallback: true,
  });
  const modelListId = `${definition.id}-model-suggestions`;
  const fallbackModelListId = `${definition.id}-fallback-model-suggestions`;
  const reasoningOptions = provider ? getReasoningEffortOptions(provider) : [];
  const supportsServiceTier = providerSupportsCodexServiceTier(provider)
    || (supportsFallback && providerSupportsCodexServiceTier(fallbackProvider));
  const determinismProfile = definition.kind === 'image-parser' && (provider || model)
    ? getImageParserDeterminismProfile(provider, model)
    : null;

  function handleProviderChange(nextProvider) {
    setProvider(nextProvider);
    setModel('');
    if (definition.kind === 'image-parser') setReasoningEffort('');
    // Only clear the Codex service tier when neither the new primary nor the
    // (always-present) fallback provider needs it — the fallback can still be a
    // Codex provider that requires the tier.
    const fallbackNeedsTier = supportsFallback && providerSupportsCodexServiceTier(fallbackProvider);
    if (!providerSupportsCodexServiceTier(nextProvider) && !fallbackNeedsTier) {
      setServiceTier('');
    }
    if (providerSupportsCodexServiceTier(nextProvider) && !serviceTier) setServiceTier('fast');
  }

  function handleFallbackProviderChange(nextProvider) {
    setFallbackProvider(nextProvider);
    setFallbackModel('');
    if (!providerSupportsCodexServiceTier(provider) && !providerSupportsCodexServiceTier(nextProvider)) {
      setServiceTier('');
    }
    if (providerSupportsCodexServiceTier(nextProvider) && !serviceTier) setServiceTier('fast');
  }

  return (
    <div className="runtime-settings-panel">
      <div className="runtime-form-grid">
        <label>
          <span>{supportsFallback ? 'Primary provider' : 'Provider'}</span>
          <select value={provider} onChange={(event) => handleProviderChange(event.target.value)}>
            {providerOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled || isMissingKey(option.value)}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{supportsFallback ? 'Primary model' : 'Model'}</span>
          <select
            id={modelListId}
            value={model}
            title={getAgentRuntimeModelPlaceholder(definition, currentRuntime)}
            onChange={(event) => setModel(event.target.value)}
            disabled={isMissingKey(provider)}
          >
            <option value="" disabled={!isProviderModelEnabled(provider, '')}>Provider default</option>
            {model && !modelSuggestions.some((option) => option.value === model) && (
              <option value={model} disabled>{model} (not approved)</option>
            )}
            {modelSuggestions.map((option) => (
              <option key={`${option.provider || provider}:${option.value}`} value={option.value} disabled={option.disabled}>
                {option.label || option.value}{option.disabled ? ' (disabled)' : ''}
              </option>
            ))}
          </select>
        </label>

        {supportsFallback && (
          <label>
            <span>Fallback provider</span>
            <select
              value={fallbackProvider}
              onChange={(event) => handleFallbackProviderChange(event.target.value)}
            >
              {providerOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled || isMissingKey(option.value)}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {supportsFallback && (
          <label>
            <span>Fallback model</span>
            <select
              id={fallbackModelListId}
              value={fallbackModel}
              title={getAgentRuntimeModelPlaceholder(definition, currentRuntime, { fallback: true })}
              onChange={(event) => setFallbackModel(event.target.value)}
              disabled={isMissingKey(fallbackProvider)}
            >
              <option value="" disabled={!isProviderModelEnabled(fallbackProvider, '')}>Provider default</option>
              {fallbackModel && !fallbackModelSuggestions.some((option) => option.value === fallbackModel) && (
                <option value={fallbackModel} disabled>{fallbackModel} (not approved)</option>
              )}
              {fallbackModelSuggestions.map((option) => (
                <option
                  key={`${option.provider || fallbackProvider}:${option.value}`}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label || option.value}{option.disabled ? ' (disabled)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {definition.supportsReasoning && reasoningOptions.length > 0 && (
          <label>
            <span>Reasoning effort</span>
            <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)}>
              <option value="">Default</option>
              {reasoningOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {supportsServiceTier && (
          <label>
            <span>Codex service tier</span>
            <select value={serviceTier || 'fast'} onChange={(event) => setServiceTier(event.target.value)}>
              {CODEX_SERVICE_TIER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="runtime-summary-box">
        <strong>{agent.profile?.roleTitle || labelAgent(agent.agentId)}</strong>
        <span>{getAgentRuntimeSummary(definition, currentRuntime)}</span>
      </div>

      {determinismProfile && (
        <div className={`runtime-determinism-note is-${determinismProfile.tone}`}>
          <strong>{determinismProfile.label}</strong>
          <span>{determinismProfile.summary}</span>
        </div>
      )}

      <div className="form-action-row">
        <button
          type="button"
          className="primary-action"
          onClick={() =>
            // `mode` is no longer chosen here (failover is always on); the
            // fallback provider/model are always sent so the server can persist
            // a Primary + Fallback pair for every agent.
            onSave({
              provider,
              fallbackProvider,
              model,
              fallbackModel,
              reasoningEffort: reasoningEffort || null,
              serviceTier: supportsServiceTier ? (serviceTier || 'fast') : null,
            })
          }
        >
          Save Runtime
        </button>
        {saveStatus && <span className="save-status">{saveStatus}</span>}
        {recheckResult && recheckResult.agentId === agent.agentId && (
          <span
            className="save-status"
            title={recheckResult.message}
            aria-live="polite"
          >
            <span
              className={`status-dot ${runtimeRecheckDotClass(recheckResult.status)}`}
              aria-hidden="true"
            />
            {recheckResult.message}
          </span>
        )}
      </div>
    </div>
  );
}

// Map the inline recheck result's status onto the existing .status-dot-*
// CSS classes declared in AgentsView.css. Green (active) for online, orange
// (degraded) for offline / recheck-failed, gray (idle) for everything else
// including the in-flight "checking" state and the intentionally-off
// "disabled" state. No new CSS is introduced.
function runtimeRecheckDotClass(status) {
  switch (status) {
    case 'online':
      return 'status-dot-active';
    case 'offline':
    case 'failed':
      return 'status-dot-degraded';
    case 'disabled':
      return 'status-dot-disabled';
    case 'checking':
    case 'unknown':
    default:
      return 'status-dot-idle';
  }
}

function Panel({ title, children, actions = null, headerContent = null }) {
  return (
    <section className="agent-panel">
      {headerContent ? (
        <header>{headerContent}</header>
      ) : (
        <header>
          <h3>{title}</h3>
          {actions}
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}

function Definition({ label, children }) {
  return (
    <div className="definition-row">
      <span>{label}</span>
      <strong>{children || 'Not set'}</strong>
    </div>
  );
}

function CompactItem({ title, meta, detail }) {
  return (
    <article className="compact-item">
      <div>
        <strong>{title}</strong>
        {meta && <span>{meta}</span>}
      </div>
      {detail && <p>{detail}</p>}
    </article>
  );
}

function LifecycleStatusPill({ status, label }) {
  const normalized = normalizeLifecycleStatus(status);
  return (
    <span className={`lifecycle-status-pill status-${normalized}`}>
      <span aria-hidden="true" />
      {label || formatLifecycleStatus(normalized)}
    </span>
  );
}

function LifecycleStepList({ steps = [], onStepSelect = null }) {
  if (!steps.length) {
    return <EmptyState title="No lifecycle steps yet" copy="The operation stream will appear here as soon as the server responds." />;
  }

  return (
    <div className="lifecycle-step-list">
      {steps.map((step, index) => {
        const status = normalizeLifecycleStatus(step.status);
        const selectable = typeof onStepSelect === 'function';
        const handleKeyDown = (event) => {
          if (!selectable) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onStepSelect(step);
          }
        };
        return (
          <article
            className={`lifecycle-step-row status-${status}${selectable ? ' is-clickable' : ''}`}
            key={step.stepId || `${step.name}-${index}`}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            aria-label={selectable ? `View stored shape for ${step.name || step.functionName || 'lifecycle step'}` : undefined}
            onClick={selectable ? () => onStepSelect(step) : undefined}
            onKeyDown={handleKeyDown}
          >
            <div className="lifecycle-step-main">
              <LifecycleStatusPill status={status} label={formatLifecycleStatus(status)} />
              <div>
                <strong>{step.name || step.functionName || 'Lifecycle step'}</strong>
                <span className="lifecycle-step-function">{step.functionName || 'Function not recorded'}</span>
              </div>
            </div>
            <div className="lifecycle-step-meta">
              <span>{step.durationMs != null ? formatMs(step.durationMs) : ''}</span>
              {step.completedAt && <span>{formatDate(step.completedAt)}</span>}
            </div>
            {step.check && <p><strong>Check:</strong> {step.check}</p>}
            {(step.summary || step.detail) && <p>{step.summary || step.detail}</p>}
          </article>
        );
      })}
    </div>
  );
}

function LifecycleStepDetail({ step }) {
  const json = JSON.stringify(step, null, 2);

  return (
    <div className="lifecycle-step-detail">
      <LifecycleJsonEditor value={json} />
    </div>
  );
}

function LifecycleJsonEditor({ value }) {
  const lines = value.split('\n');
  const viewportRef = useRef(null);
  const codeRef = useRef(null);
  const [visibleLineCount, setVisibleLineCount] = useState(lines.length);
  const displayLineCount = Math.max(lines.length, visibleLineCount);

  useEffect(() => {
    const viewport = viewportRef.current;
    const code = codeRef.current;
    if (!viewport || !code) return undefined;

    const updateVisibleLineCount = () => {
      const viewportStyle = window.getComputedStyle(viewport);
      const codeStyle = window.getComputedStyle(code);
      const lineHeight = parseFloat(viewportStyle.lineHeight) || 18;
      const verticalPadding =
        (parseFloat(codeStyle.paddingTop) || 0) + (parseFloat(codeStyle.paddingBottom) || 0);
      const availableHeight = Math.max(0, viewport.clientHeight - verticalPadding);
      const nextLineCount = Math.max(lines.length, Math.ceil(availableHeight / lineHeight));
      setVisibleLineCount((current) => (current === nextLineCount ? current : nextLineCount));
    };

    updateVisibleLineCount();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateVisibleLineCount);
      return () => window.removeEventListener('resize', updateVisibleLineCount);
    }

    const resizeObserver = new ResizeObserver(updateVisibleLineCount);
    resizeObserver.observe(viewport);
    window.addEventListener('resize', updateVisibleLineCount);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateVisibleLineCount);
    };
  }, [lines.length]);

  return (
    <section className="lifecycle-code-editor" aria-label="Stored lifecycle JSON">
      <div className="lifecycle-editor-toolbar">
        <div className="lifecycle-window-controls" aria-hidden="true">
          <span className="lifecycle-window-dot dot-red" />
          <span className="lifecycle-window-dot dot-amber" />
          <span className="lifecycle-window-dot dot-green" />
        </div>
        <span className="lifecycle-editor-title">lifecycle-step.json</span>
        <span className="lifecycle-editor-badge">JSON</span>
      </div>
      <pre className="lifecycle-step-json" ref={viewportRef}>
        <code ref={codeRef}>
          {Array.from({ length: displayLineCount }, (_, index) => {
            const line = lines[index] ?? '';
            const isFillerLine = index >= lines.length;

            return (
              <span
                className={`lifecycle-code-line${isFillerLine ? ' is-filler' : ''}`}
                key={`${index}-${isFillerLine ? 'filler' : line}`}
              >
                <span className="lifecycle-code-gutter">{index + 1}</span>
                <span className="lifecycle-code-text">{isFillerLine ? ' ' : renderJsonLine(line)}</span>
              </span>
            );
          })}
        </code>
      </pre>
      <div className="lifecycle-editor-statusbar">
        <span>{lines.length} lines</span>
        <span>read-only</span>
      </div>
    </section>
  );
}

function renderJsonLine(line) {
  const tokenPattern = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g;
  const parts = [];
  let cursor = 0;

  for (const match of line.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    const token = match[0];

    if (index > cursor) {
      parts.push(line.slice(cursor, index));
    }

    parts.push(
      <span className={`json-token ${getJsonTokenClass(line, index, token)}`} key={`${index}-${token}`}>
        {token}
      </span>
    );
    cursor = index + token.length;
  }

  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }

  return parts.length ? parts : ' ';
}

function getJsonTokenClass(line, index, token) {
  if (/^[{}\[\],:]$/.test(token)) return 'token-punctuation';
  if (/^-?\d/.test(token)) return 'token-number';
  if (token === 'true' || token === 'false') return 'token-boolean';
  if (token === 'null') return 'token-null';

  const rest = line.slice(index + token.length);
  if (token.startsWith('"') && /^\s*:/.test(rest)) return 'token-key';
  if (token.startsWith('"')) return 'token-string';
  return 'token-plain';
}

function FormField({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {type === 'textarea' ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function TimelineList({ entries, fallback }) {
  if (!entries?.length) {
    return <EmptyState title="Nothing recorded" copy={fallback} />;
  }

  return (
    <div className="timeline-list">
      {entries.map((entry) => {
        const lifecycleRun = getLifecycleRunFromEntry(entry);
        if (lifecycleRun) {
          return <LifecycleActivityItem key={timelineEntryKey(entry)} entry={entry} run={lifecycleRun} />;
        }
        return (
          <CompactItem
            key={timelineEntryKey(entry)}
            title={entry.event || entry.type || 'Activity'}
            meta={formatDate(entry.createdAt || entry.timestamp)}
            detail={entry.summary || entry.detail || entry.actor || 'Agent activity recorded.'}
          />
        );
      })}
    </div>
  );
}

function LifecycleActivityItem({ entry, run }) {
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  const directionLabel = run?.direction === 'startup' ? 'Startup' : 'Shutdown';
  return (
    <details className="compact-item lifecycle-activity-item">
      <summary>
        <div>
          <strong>{entry.summary || `${directionLabel} lifecycle run`}</strong>
          <span>{formatDate(entry.createdAt || run.completedAt || run.startedAt)}</span>
        </div>
        <p>{entry.detail || `${steps.length} lifecycle function calls and checks recorded.`}</p>
        <div className="lifecycle-activity-meta">
          <LifecycleStatusPill status={run.status || entry.status} label={formatLifecycleStatus(run.status || entry.status)} />
          <span>{steps.length} steps</span>
          {run.durationMs != null && <span>{formatMs(run.durationMs)}</span>}
        </div>
      </summary>
      <LifecycleStepList steps={steps} />
    </details>
  );
}

function TagList({ items }) {
  if (!items?.length) {
    return <span className="muted-text">None recorded</span>;
  }
  return (
    <div className="tag-list">
      {items.map((item) => (
        <Badge key={item}>{item}</Badge>
      ))}
    </div>
  );
}

function Badge({ children }) {
  if (!children) {
    return null;
  }
  return <span className="agent-badge">{children}</span>;
}

function EmptyState({ title, copy }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{copy}</span>
    </div>
  );
}

function InlineLoading({ label }) {
  return (
    <div className="inline-loading">
      <span />
      {label}
    </div>
  );
}

function AgentAvatar({ agent, size = 'medium' }) {
  const label = agent?.profile?.avatarEmoji || agent?.profile?.roleTitle || agent?.agentId || 'A';
  const text = label.length <= 3 ? label : label.slice(0, 1).toUpperCase();
  return <span className={`agent-avatar avatar-${size}`}>{text}</span>;
}

function MiniSparkline({ points, tone }) {
  return (
    <div className={`mini-sparkline tone-${tone}`} aria-hidden="true">
      {points.map((point, index) => (
        <i key={`${point}-${index}`} style={{ height: `${point}%` }} />
      ))}
    </div>
  );
}

function FitBars({ score }) {
  const active = Math.round(clamp(score, 0, 1) * 8);
  return (
    <span className="fit-bars" aria-label={`Workflow fit ${Math.round(score * 100)} percent`}>
      {Array.from({ length: 8 }).map((_, index) => (
        <i key={index} className={index < active ? 'active' : ''} />
      ))}
    </span>
  );
}

function buildIdentityHistoryState(payload) {
  const historyEntries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.history)
      ? payload.history
      : [];
  const activity = Array.isArray(payload?.activity)
    ? payload.activity
    : historyEntries;
  const versions = historyEntries
    .filter((entry) => /profile|prompt|version|restore/i.test(`${entry.type || ''} ${entry.summary || ''}`))
    .map((entry, index) => ({
      versionId: entry.id || entry.versionId || `${entry.createdAt || index}`,
      versionLabel: entry.type || 'Change',
      createdAt: entry.createdAt || entry.timestamp,
      summary: entry.summary || entry.event || 'Identity change recorded.',
    }));

  return { activity, versions };
}

function getLifecycleRunFromEntry(entry) {
  return entry?.metadata?.lifecycleRun || null;
}

function buildLifecycleRunActivityEntry(run) {
  if (!run?.runId) return null;
  const directionLabel = run.direction === 'startup' ? 'Started' : 'Shut down';
  const counts = countLifecycleStepStatuses(run.steps || []);
  const issueSummary = counts.error
    ? `${counts.error} errors`
    : counts.warning
      ? `${counts.warning} warnings`
      : 'all checks completed';
  return {
    type: 'agent-lifecycle-run',
    phase: run.direction || 'lifecycle',
    surface: run.source || 'agent-profiles',
    summary: `${directionLabel} agent lifecycle: ${(run.steps || []).length} steps, ${issueSummary}.`,
    detail: 'Expand to view the full lifecycle function and check stream.',
    status: run.status || 'success',
    createdAt: run.completedAt || run.startedAt || new Date().toISOString(),
    metadata: {
      lifecycleRunId: run.runId,
      lifecycleRun: run,
      enabled: run.targetEnabled !== false,
    },
  };
}

function mergeLifecycleRunIntoHistory(previous, run) {
  const entry = buildLifecycleRunActivityEntry(run);
  if (!entry) return previous;
  const previousActivity = Array.isArray(previous?.activity) ? previous.activity : [];
  const nextActivity = [
    entry,
    ...previousActivity.filter((item) => item?.metadata?.lifecycleRunId !== run.runId),
  ];
  return {
    activity: nextActivity,
    versions: Array.isArray(previous?.versions) ? previous.versions : [],
  };
}

function mergeLifecycleStreamEvent(previous, event, agentName) {
  if (!event?.lifecycleRun) return previous;
  const requestState = event.type === 'complete'
    ? 'complete'
    : event.type === 'error'
      ? 'error'
      : 'running';
  return {
    run: event.lifecycleRun,
    agentName: previous?.agentName || agentName,
    requestState,
  };
}

function countLifecycleStepStatuses(steps = []) {
  return steps.reduce((acc, step) => {
    const status = normalizeLifecycleStatus(step?.status);
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { success: 0, warning: 0, error: 0, info: 0 });
}

function completeClientLifecycleRun(previous, message) {
  if (!previous?.run) return previous;
  const completedAt = new Date().toISOString();
  const startedAtMs = Date.parse(previous.run.startedAt || completedAt);
  const steps = [
    ...(previous.run.steps || []),
    {
      stepId: `client-step-error-${Date.now()}`,
      sequence: (previous.run.steps || []).length + 1,
      name: 'Surface lifecycle request failure',
      functionName: 'handleToggleAgentEnabled',
      check: 'Failed API response is shown in the lifecycle modal',
      status: 'error',
      summary: message || 'Failed to update agent status.',
      detail: '',
      startedAt: completedAt,
      completedAt,
      durationMs: 0,
      metadata: {},
    },
  ];
  const counts = countLifecycleStepStatuses(steps);
  return {
    ...previous,
    requestState: 'error',
    run: {
      ...previous.run,
      status: 'error',
      completedAt,
      durationMs: Number.isNaN(startedAtMs) ? 0 : Math.max(0, Date.parse(completedAt) - startedAtMs),
      counts,
      steps,
    },
  };
}

function buildPromptState(payload, versions) {
  const prompt = payload?.prompt || null;
  return {
    ...prompt,
    prompt,
    content: payload?.content || '',
    updatedAt: prompt?.updatedAt || prompt?.lastModified || prompt?.modified || null,
    versions: normalizePromptVersions(versions),
  };
}

function normalizePromptVersions(versions) {
  if (!Array.isArray(versions)) {
    return [];
  }
  return versions.map((version) => {
    const promptVersion = String(version.promptVersion || '').trim();
    const label = String(version.label || '').trim();
    const source = String(version.source || '').trim();
    const sha = formatShortSha(version.sha256);
    return {
      ...version,
      promptVersion,
      versionId: String(version.ts || version.versionId || ''),
      versionLabel: [
        promptVersion || (version.ts ? `Snapshot ${version.ts}` : 'Prompt snapshot'),
        sha,
      ].filter(Boolean).join(' · '),
      createdAt: version.ts ? new Date(Number(version.ts)).toISOString() : version.createdAt,
      summary: formatPromptVersionSummary({ label, source, size: version.size }),
    };
  });
}

function formatShortSha(value) {
  const clean = String(value || '').trim();
  return clean ? clean.slice(0, 8) : '';
}

function formatPromptVersionSummary({ label, source, size }) {
  const cleanLabel = String(label || '').trim();
  const cleanSource = String(source || '').trim();
  if (cleanSource.endsWith(':after')) {
    return cleanLabel ? `Saved change: ${cleanLabel}` : 'Saved prompt change';
  }
  if (cleanSource.endsWith(':before')) {
    return cleanLabel ? cleanLabel : 'Before prompt change';
  }
  if (cleanSource === 'api-list-current') {
    return 'Observed active prompt file';
  }
  if (cleanSource === 'runtime-read') {
    return 'Observed during runtime prompt use';
  }
  if (cleanSource === 'read') {
    return 'Observed during prompt read';
  }
  if (cleanLabel) {
    return cleanLabel;
  }
  return `${size || 0} bytes`;
}

function getPromptVersionFromContent(content) {
  const match = String(content || '').match(/^\s*PROMPT_VERSION:\s*([^\r\n]+)/im);
  return match ? match[1].trim() : '';
}

// liveStatus comes from the AgentRegistry (see AgentsView's useAgentRegistry
// call). It's the legacy-token form of the agent's real reachability and
// replaces the static `meta.status` lookup. Passing it through the existing
// signature (rather than reading the registry inside this helper) keeps this
// function a pure transform that's easy to call from useMemo without hook
// rules getting in the way.
function buildOperationalProfile(agent, runtimeState, liveStatus) {
  const meta = getAgentMeta(agent?.agentId);
  const runtimeDefinition = getAgentRuntimeDefinition(agent?.agentId);
  const modelLabel = runtimeDefinition
    ? getAgentRuntimeSummary(runtimeDefinition, runtimeState || agent?.runtime || {})
    : 'Runtime not mapped';
  const toolCount = agent?.tools?.available?.length || 0;
  const activityCount = agent?.activity?.entries?.length || 0;
  const relationshipCount = Object.keys(agent?.relationships?.map || {}).length;
  const memoryCount = agent?.memory?.notes?.length || 0;
  const promptReady = Boolean(agent?.promptId);
  const status = resolveOperationalStatus(meta, agent, liveStatus);
  const latestReview = latestAgentReview(agent);
  const latestHarnessRun = latestAgentHarnessRun(agent);
  const reviewStatus = resolveReviewStatus(meta, latestReview);
  const hasTrustScore = Number.isFinite(Number(meta.trust));
  const trust = hasTrustScore
    ? clamp(
        Number(meta.trust)
          + Math.min(0.15, toolCount * 0.015)
          + Math.min(0.08, activityCount * 0.01)
          + (latestReview?.status === 'approved' ? 0.06 : 0)
          + (latestHarnessRun?.status === 'pass' ? 0.06 : 0)
          - (status === 'review' ? 0.25 : 0),
        3.4,
        4.9
      )
    : 0;
  const workflowFit = hasTrustScore
    ? clamp(trust / 5 + Math.min(0.12, toolCount * 0.02), 0.45, 0.98)
    : 0;
  const workflows = meta.workflows.length ? meta.workflows : ['Profile Review', 'Runtime Verification', 'Human Handoff'];
  const midpoint = Math.ceil(workflows.length / 2);
  const testCoverage = hasTrustScore
    ? clamp(Math.round(72 + trust * 4 + Math.min(8, toolCount)), 72, 96)
    : 0;
  const qualitySeed = hasTrustScore ? Math.round(trust * 18) : 0;
  const lastUpdatedAt = latestAgentTimestamp(agent);
  const toolPermissions = buildToolPermissions(agent, meta);
  const promptContract = buildPromptContract(agent, meta, modelLabel);
  const reviewItems = buildReviewItems(agent, status, promptReady, toolCount, relationshipCount, memoryCount, latestReview, latestHarnessRun);

  return {
    agentId: agent?.agentId,
    department: meta.department,
    owner: meta.owner,
    team: meta.team,
    status,
    statusLabel: STATUS_LABELS[status] || 'Idle',
    risk: meta.risk,
    reviewStatus,
    permissions: meta.permissions,
    escalationPolicy: meta.escalationPolicy,
    workflows,
    workflowInputs: workflows.slice(0, midpoint),
    workflowOutputs: workflows.slice(midpoint),
    workflowCount: workflows.length,
    workflowFit,
    workflowDescriptions: workflows.map((workflow) => describeWorkflow(workflow, agent)),
    modelLabel,
    toolSummary: toolCount ? `${toolCount} tools available` : 'No tools configured',
    channels: meta.channels,
    harnessType: meta.harnessType,
    latencyTarget: meta.latencyTarget,
    outputFormat: agent?.agentId?.includes('parser') ? 'Structured JSON' : 'Guided response',
    fallbackModel: runtimeDefinition?.providers?.[1]?.models?.[0]?.label || 'Configured provider default',
    observability: 'Activity log, runtime defaults, prompt versions',
    trust,
    trustLabel: hasTrustScore ? `${trust.toFixed(1)} / 5` : 'Not scored',
    qualityMetrics: hasTrustScore ? [
      {
        label: 'Resolution Accuracy',
        value: `${clamp(qualitySeed + 7, 78, 96)}%`,
        delta: '+4.3%',
        deltaTone: 'positive',
        tone: 'green',
      },
      {
        label: 'First Response Accuracy',
        value: `${clamp(qualitySeed + 3, 75, 94)}%`,
        delta: '+3.1%',
        deltaTone: 'positive',
        tone: 'blue',
      },
      {
        label: 'Escalation Precision',
        value: `${clamp(qualitySeed - 2, 72, 91)}%`,
        delta: status === 'review' ? '-1.8%' : '+2.7%',
        deltaTone: status === 'review' ? 'negative' : 'positive',
        tone: 'violet',
      },
      {
        label: 'Avg. Handling Time',
        value: `${Math.max(2, 9 - Math.round(trust))}m ${12 + toolCount * 3}s`,
        delta: status === 'review' ? '+8.2%' : '-5.4%',
        deltaTone: status === 'review' ? 'negative' : 'positive',
        tone: 'orange',
      },
      {
        label: 'Operator CSAT',
        value: trust.toFixed(1),
        delta: '+0.2',
        deltaTone: 'positive',
        tone: 'teal',
      },
    ] : [],
    promptSummary: {
      goals: agent?.profile?.headline || 'Understand escalation context and recommend the next best action.',
      guardrails: agent?.profile?.boundaries || 'Prefer evidence-backed guidance and defer uncertain cases to review.',
      tone: agent?.profile?.tone || 'Clear, concise, and operational.',
      escalationRules: meta.escalationPolicy,
    },
    testCoverage,
    lastUpdatedAt,
    promptReady,
    memoryCount,
    relationshipCount,
    activityCount,
    toolPermissions,
    promptContract,
    reviewItems,
    harnessCases: buildHarnessCases(agent, status, promptReady, toolCount, latestHarnessRun),
    harnessChecks: buildHarnessChecks(agent, status, promptReady, toolCount, relationshipCount, memoryCount),
  };
}

function buildToolPermissions(agent, meta) {
  return (agent?.tools?.available || []).map((tool, index) => {
    const label = normalizeToolLabel(tool, index);
    const writeLike = /(write|send|create|update|delete|action|gmail|calendar|auto|shipment)/i.test(label);
    const sensitive = writeLike || meta.risk === 'High';
    return {
      tool: label,
      scope: writeLike ? 'Read/write' : 'Read',
      confirmationRequired: sensitive,
      recentUse: index < 3 ? formatRunAge(index) : 'No recent use',
    };
  });
}

function normalizeToolLabel(tool, index) {
  if (typeof tool === 'string') {
    return tool;
  }
  if (!tool || typeof tool !== 'object') {
    return `Tool ${index + 1}`;
  }
  return String(
    tool.label
      || tool.name
      || tool.id
      || tool.key
      || tool.kind
      || `Tool ${index + 1}`
  );
}

function buildPromptContract(agent, meta, modelLabel) {
  return [
    {
      label: 'Mission',
      value: agent?.profile?.headline || 'Support the escalation workflow with evidence-backed next steps.',
    },
    {
      label: 'Inputs',
      value: `${meta.channels.join(', ')} plus current escalation context.`,
    },
    {
      label: 'Output Format',
      value: agent?.agentId?.includes('parser') ? 'Strict structured JSON' : 'Concise operator-facing guidance',
    },
    {
      label: 'Guardrails',
      value: agent?.profile?.boundaries || meta.escalationPolicy,
    },
    {
      label: 'Escalation Trigger',
      value: meta.escalationPolicy,
    },
    {
      label: 'Runtime',
      value: modelLabel,
    },
  ];
}

function buildReviewItems(agent, status, promptReady, toolCount, relationshipCount, memoryCount, latestReview, latestHarnessRun) {
  const reviewApproved = latestReview?.status === 'approved';
  const harnessPersisted = Boolean(latestHarnessRun?.runId);
  return [
    {
      code: 'prompt-contract',
      title: promptReady ? 'Prompt contract linked' : 'Prompt contract missing',
      label: 'Prompt contract',
      detail: promptReady ? `Linked to ${agent.promptId}.` : 'No editable prompt is linked for review.',
      status: promptReady || agent.agentId?.includes('parser') ? 'pass' : 'warn',
      severity: promptReady ? 'low' : 'medium',
    },
    {
      code: 'runtime-review',
      title: reviewApproved ? 'Runtime defaults reviewed' : 'Runtime defaults need periodic review',
      label: 'Runtime defaults',
      detail: reviewApproved
        ? `Approved ${formatDate(latestReview.createdAt)}.`
        : 'Provider and model defaults should be reviewed after model migrations.',
      status: reviewApproved ? 'pass' : 'warn',
      severity: reviewApproved ? 'low' : 'medium',
    },
    {
      code: 'tool-permissions',
      title: toolCount ? 'Tool permissions declared' : 'No tools declared',
      label: 'Tool permissions',
      detail: toolCount ? `${toolCount} tools are visible for audit.` : 'Agent has no declared tool surface.',
      status: toolCount ? 'pass' : 'warn',
      severity: toolCount ? 'low' : 'medium',
    },
    {
      code: 'harness-run',
      title: harnessPersisted ? 'Harness run persisted' : 'Harness run is simulated',
      label: 'Harness evidence',
      detail: harnessPersisted
        ? `${latestHarnessRun.summary || 'Harness run recorded.'} (${formatDate(latestHarnessRun.completedAt || latestHarnessRun.createdAt)})`
        : 'This UI shows derived checks until persisted harness run data is added.',
      status: harnessPersisted ? latestHarnessRun.status : 'warn',
      severity: harnessPersisted && latestHarnessRun.status === 'pass' ? 'low' : 'medium',
    },
    {
      code: 'relationship-map',
      title: relationshipCount ? 'Relationships mapped' : 'Relationship map missing',
      label: 'Relationship map',
      detail: relationshipCount ? `${relationshipCount} peers linked.` : 'No handoff relationships are mapped.',
      status: relationshipCount || memoryCount ? 'pass' : 'warn',
      severity: 'low',
    },
    {
      code: 'operational-status',
      title: status === 'active' ? 'Agent is active' : 'Agent needs status review',
      label: 'Operational status',
      detail: STATUS_LABELS[status] || 'Unknown status',
      status: status === 'active' ? 'pass' : 'fail',
      severity: status === 'active' ? 'low' : 'high',
    },
  ];
}

function buildHarnessCases(agent, status, promptReady, toolCount, latestHarnessRun) {
  if (latestHarnessRun?.cases?.length) {
    return latestHarnessRun.cases.map((testCase, index) => ({
      id: testCase.caseId || testCase.id || `case-${index + 1}`,
      name: testCase.name || `Harness case ${index + 1}`,
      expected: testCase.expected || testCase.detail || 'Persisted harness case.',
      actual: testCase.actual || '',
      status: testCase.status || latestHarnessRun.status || 'pass',
      lastRun: formatDate(latestHarnessRun.completedAt || latestHarnessRun.createdAt),
    }));
  }
  const base = agent?.profile?.roleTitle || labelAgent(agent?.agentId);
  return [
    {
      id: 'contract-shape',
      name: `${base} contract shape`,
      expected: promptReady ? 'Prompt loads and exposes reviewable sections.' : 'Runtime-only contract remains explicit.',
      actual: 'No persisted harness case has run yet.',
      status: 'warn',
      lastRun: 'Not run',
    },
    {
      id: 'tool-safety',
      name: 'Tool safety gate',
      expected: toolCount ? 'Tool use is auditable with confirmation guidance.' : 'No tool calls are attempted.',
      actual: 'No persisted harness case has run yet.',
      status: 'warn',
      lastRun: 'Not run',
    },
    {
      id: 'status-regression',
      name: 'Operational status regression',
      expected: status === 'active' ? 'Agent is available for workflow assignment.' : 'Agent is flagged before workflow use.',
      actual: 'No persisted harness case has run yet.',
      status: 'warn',
      lastRun: 'Not run',
    },
  ];
}

function buildAttentionItems(operations) {
  return operations
    .filter((operation) => (
      operation.status === 'review'
      || operation.status === 'degraded'
      || /review overdue|needs attention|degraded|incomplete/i.test(operation.reviewStatus || '')
    ))
    .map((operation) => ({
      agentId: operation.agentId,
      name: operation.name || operation.role || operation.agentId,
      status: operation.status || 'review',
      reason: operation.status === 'degraded'
        ? 'Degraded setup or runtime state'
        : operation.reviewStatus || 'Review required',
    }));
}

function buildHarnessChecks(agent, status, promptReady, toolCount, relationshipCount, memoryCount) {
  return [
    {
      label: 'Prompt contract',
      detail: promptReady ? 'Editable prompt surface is linked.' : 'No editable prompt surface exposed.',
      status: promptReady ? 'pass' : 'warn',
    },
    {
      label: 'Tool readiness',
      detail: toolCount ? `${toolCount} tool permissions are declared.` : 'No tools are configured.',
      status: toolCount ? 'pass' : 'warn',
    },
    {
      label: 'Relationship context',
      detail: relationshipCount ? `${relationshipCount} peer relationships mapped.` : 'No peer relationships mapped.',
      status: relationshipCount ? 'pass' : 'warn',
    },
    {
      label: 'Memory surface',
      detail: memoryCount ? `${memoryCount} memory notes available.` : 'No memory notes available.',
      status: memoryCount ? 'pass' : 'warn',
    },
    {
      label: 'Operational status',
      detail: STATUS_LABELS[status] || 'Idle',
      status: status === 'active' ? 'pass' : 'warn',
    },
  ];
}

function latestAgentReview(agent) {
  const entries = Array.isArray(agent?.reviews?.entries) ? agent.reviews.entries : [];
  return entries
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null;
}

function latestAgentHarnessRun(agent) {
  const runs = Array.isArray(agent?.harness?.runs) ? agent.harness.runs : [];
  return runs
    .slice()
    .sort((a, b) => new Date(b.completedAt || b.createdAt || 0).getTime() - new Date(a.completedAt || a.createdAt || 0).getTime())[0] || null;
}

function latestEntryByDate(entries, fields) {
  return (Array.isArray(entries) ? entries : [])
    .slice()
    .sort((a, b) => {
      const aTime = fields
        .map((field) => new Date(a?.[field] || 0).getTime())
        .find((time) => Number.isFinite(time) && time > 0) || 0;
      const bTime = fields
        .map((field) => new Date(b?.[field] || 0).getTime())
        .find((time) => Number.isFinite(time) && time > 0) || 0;
      return bTime - aTime;
    })[0] || null;
}

function resolveReviewStatus(meta, latestReview) {
  if (!latestReview) {
    return meta.reviewStatus;
  }
  if (latestReview.status === 'approved') {
    return 'Human-reviewed';
  }
  if (latestReview.status === 'rejected') {
    return 'Review blocked';
  }
  return 'Review overdue';
}

function getAgentMeta(agentId) {
  if (agentId === 'triage-agent') {
    return {
      department: 'Standalone Triage Harness',
      owner: 'Unassigned',
      team: 'Escalation Support',
      status: 'idle',
      risk: 'Not scored',
      trust: null,
      reviewStatus: 'Runtime configured',
      permissions: 'Read: parsed escalation template text',
      escalationPolicy: 'Operator-facing card only; the triage card does not feed the analyst answer.',
      workflows: ['Parser result intake', 'Direct provider handoff', 'Provider package readback', 'Soft validation', 'Operator card display'],
      channels: ['Chat v5', '/api/triage'],
      harnessType: 'Direct-provider API harness',
      latencyTarget: 'Configured request timeout',
    };
  }
  return (
    AGENT_OPERATION_META[agentId] || {
      department: 'Agent Operations',
      owner: 'Platform Ops',
      team: 'Escalation Support',
      status: 'idle',
      risk: 'Medium',
      trust: 4.1,
      reviewStatus: 'Human-reviewed',
      permissions: 'Read: workspace context',
      escalationPolicy: 'Defer ambiguous cases to human review.',
      workflows: ['Agent Review', 'Workflow Assignment', 'Human Handoff'],
      channels: ['Workspace', 'API'],
      harnessType: 'Profile review',
      latencyTarget: '< 15s',
    }
  );
}

// liveStatus is the legacy operational token derived from the registry's
// health.status for this agent (see healthStatusToOperationalToken). It is the
// single source of truth for the dot color. The `meta` argument is still
// passed because callers already hold it for labels/descriptions, but its
// `.status` field is intentionally NOT read here — we no longer let the static
// table claim an agent is "active" when the underlying provider is offline.
function resolveOperationalStatus(meta, agent, liveStatus) {
  if (agent?.enabled === false) {
    return 'disabled';
  }
  // Defensive: a caller may pass undefined/null if an agent is missing from
  // the live-status map (e.g. registry hasn't observed it yet). Default to
  // 'idle' so downstream CSS resolves to a real `status-dot-idle` class
  // rather than the missing `status-dot-undefined`. See cto-review finding H2.
  const safeLive = liveStatus || 'idle';
  // An agent with no prompt configured (and that isn't a parser) is not yet
  // wired up for real work, so downgrade a live "active" to "idle" to keep the
  // UI honest. Non-active live tokens (degraded, disabled, idle) pass through
  // unchanged.
  if (!agent?.promptId && !agent?.agentId?.includes('parser')) {
    return safeLive === 'active' ? 'idle' : safeLive;
  }
  return safeLive;
}

function describeWorkflow(workflow, agent) {
  if (/intake/i.test(workflow)) {
    return 'Captures incoming context and prepares it for the agent.';
  }
  if (/review|human/i.test(workflow)) {
    return 'Surfaces uncertainty and evidence for operator review.';
  }
  if (/search|knowledge|issue/i.test(workflow)) {
    return 'Finds matching references and supporting evidence.';
  }
  if (/routing|handoff|assist/i.test(workflow)) {
    return 'Routes work to the right lane with next-step context.';
  }
  return `${agent?.profile?.roleTitle || 'Agent'} participates in this workflow stage.`;
}

function latestAgentTimestamp(agent) {
  const candidates = [
    agent?.updatedAt,
    agent?.profile?.updatedAt,
    agent?.memory?.lastLearnedAt,
    agent?.relationships?.lastUpdatedAt,
    agent?.reviews?.lastApprovedAt,
    agent?.harness?.lastRunAt,
    ...(agent?.activity?.entries || []).map((entry) => entry.createdAt || entry.timestamp),
    ...(agent?.reviews?.entries || []).map((entry) => entry.createdAt),
    ...(agent?.harness?.runs || []).map((run) => run.completedAt || run.createdAt),
  ].filter(Boolean);

  if (!candidates.length) {
    return null;
  }
  return candidates
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0]
    ?.toISOString();
}

function formatRunAge(index) {
  const minutes = [2, 5, 7, 12, 18, 24, 31, 44];
  return `${minutes[index % minutes.length]}m ago`;
}

function agentSearchText(agent, operation) {
  return [
    agent.agentId,
    agent.promptId,
    agent.profile?.roleTitle,
    agent.profile?.headline,
    agent.profile?.tone,
    operation?.department,
    operation?.modelLabel,
    operation?.workflows?.join(' '),
    (agent.tools?.available || []).map(normalizeToolLabel).join(' '),
    (agent.memory?.notes || []).map(normalizeMemoryNote).join(' '),
    (agent.reviews?.entries || []).map((entry) => entry.summary).join(' '),
    (agent.harness?.runs || []).map((run) => run.summary).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function timelineEntryKey(entry) {
  return [
    entry.id,
    entry.versionId,
    entry.metadata?.lifecycleRunId,
    entry.createdAt,
    entry.timestamp,
    entry.event,
    entry.summary,
  ]
    .filter(Boolean)
    .join(':');
}

function formatAgentProfileTitle(agent) {
  const agentName = getAgentDisplayName(agent);
  if (!agentName) {
    return 'Agent Profile';
  }

  return `${agentName}'s Profile`;
}

function getAgentDisplayName(agent) {
  return agent?.profile?.displayName
    || agent?.profile?.roleTitle
    || labelAgent(agent?.agentId);
}

function getAgentRoleLabel(agent) {
  const role = String(agent?.profile?.roleTitle || '').trim();
  const name = String(getAgentDisplayName(agent) || '').trim();
  return role && role.toLocaleLowerCase() !== name.toLocaleLowerCase() ? role : '';
}

function labelAgent(agentId = '') {
  return agentId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatAssetBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'size unknown';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDate(value) {
  if (!value) {
    return 'Not recorded';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function normalizeLifecycleStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'warn') return 'warning';
  if (normalized === 'fail' || normalized === 'failed') return 'error';
  if (['success', 'error', 'warning', 'info'].includes(normalized)) return normalized;
  if (normalized === 'enabled' || normalized === 'disabled' || normalized === 'configured') return 'success';
  return 'info';
}

function formatLifecycleStatus(value) {
  const status = normalizeLifecycleStatus(value);
  if (status === 'success') return 'Success';
  if (status === 'error') return 'Error';
  if (status === 'warning') return 'Warning';
  return 'Info';
}

function formatMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0.0s';
  return `${(numeric / 1000).toFixed(1)}s`;
}

function formatRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0%';
  return `${Math.round(numeric * 100)}%`;
}

function normalizeReliabilityKey(value) {
  return String(value || '').trim().toLowerCase();
}

function formatReliabilityRowMetric(row) {
  if (!row || Number(row.total || 0) <= 0) {
    return 'No recent tests yet';
  }
  const pass = Number(row.pass || 0);
  const fail = Number(row.fail || 0);
  const pending = Number(row.pending || 0);
  const pendingText = pending > 0 ? `, ${pending} pending` : '';
  return `${formatRate(row.passRate)} pass (${pass} pass, ${fail} fail${pendingText})`;
}

function findParserReliabilityRow(stats, provider, model) {
  if (!stats || Number(stats.total || 0) <= 0) {
    return null;
  }

  const providerKey = normalizeReliabilityKey(provider);
  const modelKey = normalizeReliabilityKey(model);
  const modelRows = Array.isArray(stats.byModel) ? stats.byModel : [];
  const providerRows = Array.isArray(stats.byProvider) ? stats.byProvider : [];

  const modelRow = modelRows.find((row) => {
    const rowModel = normalizeReliabilityKey(row?.model);
    const rowProvider = normalizeReliabilityKey(row?.provider);
    return modelKey && rowModel === modelKey && (!providerKey || rowProvider === providerKey);
  });
  if (modelRow) {
    return { kind: 'model', row: modelRow };
  }

  const providerRow = providerRows.find((row) => (
    providerKey && normalizeReliabilityKey(row?.provider) === providerKey
  ));
  if (providerRow) {
    return { kind: 'provider', row: providerRow };
  }

  return { kind: 'recent', row: stats };
}

function formatParserReliabilityMetric(stats, provider, model, loading = false) {
  const match = findParserReliabilityRow(stats, provider, model);
  if (!match) {
    return loading ? 'Loading recent test results...' : 'No recent tests found';
  }

  const prefix = match.kind === 'model'
    ? 'This model'
    : match.kind === 'provider'
      ? 'This provider'
      : 'Recent tests';
  return `${prefix}: ${formatReliabilityRowMetric(match.row)}`;
}

function formatParserReliabilitySummary(stats, provider, model, fallback, loading = false) {
  const match = findParserReliabilityRow(stats, provider, model);
  if (!match) {
    return loading ? 'Loading recent test results...' : fallback;
  }

  const total = Number(match.row.total || 0);
  const noun = total === 1 ? 'test' : 'tests';
  const subject = match.kind === 'model'
    ? 'This model'
    : match.kind === 'provider'
      ? 'This provider'
      : 'Recent parser runs';
  return `${subject} has ${total} recent ${noun}: ${formatReliabilityRowMetric(match.row)}.`;
}

// Semantic tone for a 0-1 pass rate: green only when genuinely good, amber for
// borderline, red for poor. Keeps the metric honest — a low rate is never green.
function passRateTone(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (numeric >= 0.9) return 'ok';
  if (numeric >= 0.7) return 'warn';
  return 'err';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default AgentsView;
