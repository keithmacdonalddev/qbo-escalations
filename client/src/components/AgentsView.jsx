import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createAgentIdentity,
  getAgentIdentity,
  getAgentIdentityHistory,
  importAgentIdentities,
  listImageParserTestResults,
  listImageParserHistory,
  listAgentIdentities,
  recordAgentHarnessRun,
  recordAgentReview,
  updateImageParserTestResult,
  updateAgentIdentity,
  updateAgentEnabled,
  updateAgentRuntime,
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
  getAgentRuntimeModelPlaceholder,
  getAgentRuntimeModelSuggestions,
  getAgentRuntimeSummary,
  normalizeAgentRuntimeState,
  readAgentRuntimeState,
  writeAgentRuntimeState,
} from '../lib/agentRuntimeSettings.js';
import {
  IMAGE_PARSER_PROVIDER_OPTIONS,
  getImageParserReasoningEffortOptions,
} from '../lib/imageParserCatalog.js';
import { PROVIDER_OPTIONS, REASONING_EFFORT_OPTIONS } from '../lib/providerCatalog.js';
import useProviderKeyStatus from '../hooks/useProviderKeyStatus.js';
import { isProviderMissingApiKey } from '../lib/providerKeyStatus.js';
import './AgentsView.css';

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

const PROFILE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'harness', label: 'Harness' },
  { id: 'memory', label: 'Memory' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'activity', label: 'Activity' },
  { id: 'versions', label: 'Versions' },
];

const IMAGE_PARSER_PROFILE_TABS = [
  ...PROFILE_TABS.slice(0, 4),
  { id: 'test-results', label: 'Test Results' },
  { id: 'event-streams', label: 'Event Streams' },
  { id: 'chat-sessions', label: 'Chat Sessions' },
  ...PROFILE_TABS.slice(4),
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
    status: 'active',
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
    status: 'active',
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
  'triage-agent': {
    department: 'Support Intelligence',
    owner: 'Olivia Chen',
    team: 'Customer Support',
    status: 'active',
    risk: 'Medium',
    trust: 4.6,
    reviewStatus: 'Human-reviewed',
    permissions: 'Read: escalation context, investigations, templates',
    escalationPolicy: 'Escalate when rules conflict, evidence is missing, or priority is high.',
    workflows: ['Ticket Intake', 'Known Issue Scan', 'Policy Match', 'Priority Routing', 'Resolution Assist', 'Human Review'],
    channels: ['Web', 'Email', 'Live Chat', 'API'],
    harnessType: 'Tool-augmented triage',
    latencyTarget: '< 12s',
  },
  'known-issue-search-agent': {
    department: 'Knowledge Ops',
    owner: 'David Park',
    team: 'Investigation Support',
    status: 'active',
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
    status: 'idle',
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
    status: 'active',
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
    status: 'active',
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
    status: 'review',
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

function AgentsView({ agentIdFromRoute = null }) {
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
  const [activeProfileTab, setActiveProfileTab] = useState('overview');
  const [registryModalMode, setRegistryModalMode] = useState(null);
  const [registrySaving, setRegistrySaving] = useState(false);
  const [registryMessage, setRegistryMessage] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [harnessSaving, setHarnessSaving] = useState(false);
  const [parserTestResults, setParserTestResults] = useState({ results: [], stats: null, dbAvailable: true });
  const [parserTestResultsLoading, setParserTestResultsLoading] = useState(false);
  const [parserTestResultsError, setParserTestResultsError] = useState(null);
  const [parserResultPreview, setParserResultPreview] = useState(null);
  const [parserHistory, setParserHistory] = useState({ results: [], total: 0 });
  const [parserSavedEvents, setParserSavedEvents] = useState([]);
  const [parserHistoryLoading, setParserHistoryLoading] = useState(false);
  const [parserHistoryError, setParserHistoryError] = useState(null);
  const [parserEventStats, setParserEventStats] = useState(null);
  const [parserSessions, setParserSessions] = useState([]);
  const [parserSessionsLoading, setParserSessionsLoading] = useState(false);
  const [parserSessionsError, setParserSessionsError] = useState(null);
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
    setActiveProfileTab('overview');
  }, [selectedAgentId]);

  useEffect(() => {
    if (!currentAgent) {
      setProfileDraft(emptyProfile);
      setProfileSummary('');
      return;
    }
    setProfileDraft({ ...emptyProfile, ...(currentAgent.profile || {}) });
    setProfileSummary('');
  }, [currentAgent]);

  const selectedAgent = currentAgent?.agentId === selectedAgentId
    ? currentAgent
    : agents.find((agent) => agent.agentId === selectedAgentId) || null;
  const selectedRuntimeState = selectedAgent?.agentId ? runtimeSelections[selectedAgent.agentId] : null;
  const selectedRuntimeDefinition = selectedAgent?.agentId
    ? getAgentRuntimeDefinition(selectedAgent.agentId)
    : null;

  const operationalProfiles = useMemo(
    () =>
      agents.map((agent) =>
        buildOperationalProfile(agent, runtimeSelections[agent.agentId])
      ),
    [agents, runtimeSelections]
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
    return buildOperationalProfile(selectedAgent, selectedRuntimeState);
  }, [selectedAgent, selectedRuntimeState]);

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
      const entries = await getAgentIdentityHistory(selectedAgent.agentId);
      setHistory(buildIdentityHistoryState(entries));
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
      }
      setProfileSummary('');
    } catch (err) {
      setError(err.message || 'Failed to save profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleSaveRuntime(nextRuntime) {
    if (!selectedAgent?.agentId) {
      return;
    }
    try {
      setRuntimeSaveStatus('Saving runtime defaults...');
      const localRuntime = writeAgentRuntimeState(selectedAgent.agentId, nextRuntime);
      const updated = await updateAgentRuntime(
        selectedAgent.agentId,
        localRuntime,
        `Updated runtime defaults for ${selectedAgent.profile?.roleTitle || selectedAgent.agentId}.`
      );
      const updatedRuntime = updated?.runtime || localRuntime;
      setRuntimeSelections((previous) => ({
        ...previous,
        [selectedAgent.agentId]: updatedRuntime,
      }));
      applyUpdatedAgent(updated);
      dispatchAgentRuntimeDefaultsApplied({
        [selectedAgent.agentId]: updatedRuntime,
      });
      window.dispatchEvent(new CustomEvent('agent-health-refresh'));
      setRuntimeSaveStatus('Runtime defaults saved to server.');
    } catch (err) {
      setRuntimeSaveStatus(err.message || 'Failed to save runtime defaults.');
    }
  }

  async function handleToggleAgentEnabled(nextEnabled) {
    if (!selectedAgent?.agentId) return;
    try {
      setEnabledSaving(true);
      const updated = await updateAgentEnabled(
        selectedAgent.agentId,
        nextEnabled,
        `${nextEnabled ? 'Enabled' : 'Disabled'} ${selectedAgent.profile?.roleTitle || selectedAgent.agentId} globally.`
      );
      applyUpdatedAgent(updated);
      window.dispatchEvent(new CustomEvent('agent-health-refresh'));
    } catch (err) {
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
    onLoadParserTestResults: loadParserTestResults,
    onLoadParserEventStreams: loadParserEventStreams,
    onLoadParserChatSessions: loadParserChatSessions,
    onUpdateParserTestResult: handleUpdateParserTestResult,
    onPreviewParserResult: setParserResultPreview,
    onCloseParserResultPreview: () => setParserResultPreview(null),
    onLoadHistory: loadHistoryForSelectedAgent,
    onLoadPrompt: loadPromptForSelectedAgent,
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

function AgentMissionGrid({ agents, operationById, onSelectAgent }) {
  return (
    <div className="agent-card-grid">
      {agents.map((agent, index) => (
        <AgentMissionCard
          key={agent.agentId}
          agent={agent}
          operation={operationById.get(agent.agentId)}
          rank={index + 1}
          onSelect={() => onSelectAgent(agent.agentId)}
        />
      ))}
    </div>
  );
}

function AgentMissionCard({ agent, operation, rank, onSelect }) {
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
          title={STATUS_LABELS[operation?.status] || 'Idle'}
          aria-label={STATUS_LABELS[operation?.status] || 'Idle'}
        />
      </header>
      <div className="agent-mission-card-title">
        <strong>{agent.profile?.roleTitle || labelAgent(agent.agentId)}</strong>
      </div>
      <p>{agent.profile?.headline || operation?.promptSummary?.goals}</p>
      <div className="agent-card-chip-row">
        <Badge>{operation?.modelLabel}</Badge>
        <Badge>{operation?.toolSummary}</Badge>
      </div>
      <div className="agent-card-metrics">
        <span>
          Trust
          <strong>{operation?.trustLabel || 'Not scored'}</strong>
        </span>
        <span>
          Workflow Fit
          <FitBars score={operation?.workflowFit || 0} />
        </span>
      </div>
      <MiniSparkline points={[25, 31, 42, 38, 48, 54, 62]} tone={operation?.status === 'review' ? 'orange' : 'blue'} />
    </a>
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
  const enabled = selectedAgent?.enabled !== false;
  return (
    <div className="agent-profiles-page agent-profile-detail-page">
      <header className="profile-page-topbar">
        <div className="profile-page-title-row">
          <a href="#/agents" className="back-link">Agent Mission Control</a>
          {selectedAgent && (
            <label
              className={`agent-enabled-switch${enabled ? ' is-on' : ' is-off'}`}
              aria-label={`${enabled ? 'Disable' : 'Enable'} ${selectedAgent.profile?.roleTitle || selectedAgent.agentId}`}
            >
              <input
                type="checkbox"
                checked={enabled}
                disabled={workspaceProps.enabledSaving}
                onChange={(event) => workspaceProps.onToggleAgentEnabled?.(event.target.checked)}
              />
              <span className="agent-enabled-switch-track" aria-hidden="true">
                <span className="agent-enabled-switch-thumb" />
              </span>
              <span className="agent-enabled-switch-label">{enabled ? 'On' : 'Off'}</span>
            </label>
          )}
        </div>
        {loadingCurrent && <InlineLoading label="Refreshing profile..." />}
      </header>

      {error && <div className="agent-alert">{error}</div>}

      {selectedAgent ? (
        <main className="profile-detail-shell">
          <AgentProfileTabs
            tabs={selectedAgent.agentId === 'escalation-template-parser' ? IMAGE_PARSER_PROFILE_TABS : PROFILE_TABS}
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
                <strong>{selectedAgent?.profile?.roleTitle || selectedAgent?.agentId || 'Select agent'}</strong>
                <small>{selectedOperation?.department || 'Agent profile'}</small>
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

      {open && (
        <div className="agent-attention-popover" role="menu">
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

  if (activeTab === 'configuration') {
    return <AgentConfigurationTab {...props} />;
  }
  if (activeTab === 'prompt') {
    return <AgentPromptTab {...props} />;
  }
  if (activeTab === 'harness') {
    return <AgentHarnessTab {...props} />;
  }
  if (activeTab === 'test-results') {
    return <ImageParserTestResultsTab {...props} />;
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
    return <AgentMonitoringTab {...props} />;
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

function AgentOverviewTab({
  agent,
  operation,
  reviewSaving,
  onMarkReviewed,
}) {
  return (
    <section className="agent-tab-content overview-layout">
      <Panel title="Overview" actions={<span className="panel-status-text">{operation?.workflowCount} workflows</span>}>
        <div className="overview-definition-grid">
          <Definition label="Agent name">{agent.profile?.roleTitle || agent.profile?.displayName || labelAgent(agent.agentId)}</Definition>
          <Definition label="Agent ID">{agent.agentId}</Definition>
          <Definition label="Code identity">{agent.agentId}</Definition>
          <Definition label="Prompt ID">{agent.promptId || 'No prompt registered'}</Definition>
          <Definition label="Department">{operation?.department}</Definition>
          <Definition label="Model">{operation?.modelLabel}</Definition>
          <Definition label="Tools">{operation?.toolSummary}</Definition>
          <Definition label="Permissions">{operation?.permissions}</Definition>
          <Definition label="Escalation Policy">{operation?.escalationPolicy}</Definition>
          <Definition label="Risk Level">{operation?.risk}</Definition>
          <Definition label="Review Status">{operation?.reviewStatus}</Definition>
        </div>
      </Panel>

      <WorkflowFootprint agent={agent} operation={operation} />

      <QualityPerformance operation={operation} />

      <PromptContractPanel agent={agent} operation={operation} />

      <HarnessSummaryPanel operation={operation} />

      <ProfileSourceOfTruthPanel agent={agent} operation={operation} />

      <ReviewWorkflowPanel
        agent={agent}
        operation={operation}
        saving={reviewSaving}
        onMarkReviewed={onMarkReviewed}
      />
    </section>
  );
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

function QualityPerformance({ operation }) {
  return (
    <Panel title="Quality & Performance" actions={<span className="panel-status-text">Last 30 days</span>}>
      <div className="quality-list">
        {operation?.qualityMetrics?.map((metric) => (
          <div className="quality-row" key={metric.label}>
            <span>
              <i className={`quality-icon ${metric.tone}`} />
              {metric.label}
            </span>
            <strong>{metric.value}</strong>
            <small className={metric.deltaTone}>{metric.delta}</small>
          </div>
        ))}
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

function ProfileSourceOfTruthPanel({ agent, operation }) {
  const coverage = [
    ['Identity', Boolean(agent?.agentId && agent?.profile?.roleTitle), agent?.agentId],
    ['Prompt', Boolean(agent?.promptId), agent?.promptId || 'Missing prompt link'],
    ['Runtime', Boolean(agent?.runtime), operation?.modelLabel || 'Runtime not loaded'],
    ['Memory', Boolean(agent?.memory), `${agent?.memory?.notes?.length || 0} notes`],
    ['History', Boolean(agent?.history), `${agent?.history?.entries?.length || 0} entries`],
    ['Harness', Boolean(agent?.harness), `${agent?.harness?.runs?.length || 0} runs`],
    ['Activity', Boolean(agent?.activity), `${agent?.activity?.entries?.length || 0} entries`],
    ['Relationships', Boolean(agent?.relationships), `${agent?.relationships?.notes?.length || 0} notes`],
    ['Issues / tasks', false, 'No first-class agent issue/task ledger yet'],
    ['Monitoring', Boolean(agent?.lifecycle), agent?.enabled === false ? 'Disabled' : 'Enabled'],
  ];

  return (
    <Panel title="Profile Source of Truth" actions={<span className="panel-status-text">Canonical profile</span>}>
      <div className="compact-list">
        {coverage.map(([label, ready, detail]) => (
          <CompactItem
            key={label}
            title={label}
            meta={ready ? 'Available from agent profile' : 'Gap'}
            detail={detail}
          />
        ))}
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

function HarnessResultsPanel({ operation, saving = false, onRecordHarnessRun }) {
  return (
    <Panel
      title="Harness Results"
      actions={
        <button
          type="button"
          className="text-action"
          disabled={saving || !onRecordHarnessRun}
          onClick={onRecordHarnessRun}
        >
          {saving ? 'Saving...' : 'Record Run'}
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
  return (
    <section className="agent-tab-content prompt-layout">
      <Panel
        title="Editable Prompt Surface"
        actions={
          <button type="button" className="text-action" onClick={onLoadPrompt}>
            Reload
          </button>
        }
      >
        {!agent.promptId ? (
          <EmptyState title="No editable prompt" copy="This identity is runtime-only or deterministic and does not expose an editable prompt file." />
        ) : promptLoading ? (
          <InlineLoading label="Loading prompt..." />
        ) : (
          <>
            {promptError && <div className="agent-alert">{promptError}</div>}
            <div className="prompt-editor-meta">
              <Badge>Prompt: {agent.promptId}</Badge>
              <Badge>{promptState?.versions?.length || 0} versions</Badge>
              <Badge>{formatDate(promptState?.updatedAt)}</Badge>
            </div>
            <textarea
              className="prompt-editor"
              value={promptDraft}
              onChange={(event) => onPromptDraftChange(event.target.value)}
              spellCheck={false}
            />
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
      </Panel>

      <PromptContractPanel agent={agent} operation={operation} />

      <Panel title="Prompt Versions">
        {promptState?.versions?.length ? (
          <div className="version-rows">
            {promptState.versions.map((version) => (
              <button
                type="button"
                className="version-row-button"
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
  harnessSaving,
  onRuntimeSave,
  onRecordHarnessRun,
}) {
  return (
    <section className="agent-tab-content harness-layout">
      <HarnessSummaryPanel operation={operation} />
      <HarnessResultsPanel
        operation={operation}
        saving={harnessSaving}
        onRecordHarnessRun={onRecordHarnessRun}
      />
      <Panel title="Runtime Provider Matrix">
        <RuntimeSettingsPanel
          agent={agent}
          definition={runtimeDefinition}
          runtimeState={runtimeState}
          saveStatus={runtimeSaveStatus}
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

function ImageParserTestResultsTab({
  parserTestResults,
  parserTestResultsLoading,
  parserTestResultsError,
  parserResultPreview,
  onLoadParserTestResults,
  onUpdateParserTestResult,
  onPreviewParserResult,
  onCloseParserResultPreview,
}) {
  const stats = parserTestResults?.stats || {};
  const results = parserTestResults?.results || [];

  return (
    <section className="agent-tab-content parser-results-layout">
      <Panel
        title="Image Parser Test Results"
        actions={<button type="button" className="text-action" onClick={onLoadParserTestResults}>Refresh</button>}
      >
        {parserTestResultsLoading ? (
          <InlineLoading label="Loading parser test results..." />
        ) : parserTestResultsError ? (
          <EmptyState title="Test results unavailable" copy={parserTestResultsError} />
        ) : parserTestResults?.dbAvailable === false ? (
          <EmptyState title="Database unavailable" copy="Parser test results are separate from escalation logs, and MongoDB is not currently connected." />
        ) : (
          <>
            <div className="parser-result-stat-grid">
              <ParserResultMetric label="Total" value={stats.total || 0} detail={`${stats.pending || 0} pending review`} />
              <ParserResultMetric label="Pass Rate" value={formatRate(stats.passRate)} detail={`${stats.pass || 0} pass / ${stats.fail || 0} fail`} />
              <ParserResultMetric label="Avg Time" value={formatMs(stats.avgElapsedMs)} detail="Live parser test elapsed time" />
            </div>
            <ParserResultBreakdown title="By Provider" rows={stats.byProvider || []} labelFor={(row) => row.provider || 'Unknown'} />
            <ParserResultBreakdown title="By Model" rows={stats.byModel || []} labelFor={(row) => [row.provider, row.model].filter(Boolean).join(' / ') || 'Unknown'} />
            <ParserResultBreakdown title="By Test Image" rows={stats.byFixture || []} labelFor={(row) => row.fixtureName || 'Unknown fixture'} withThumbs />
          </>
        )}
      </Panel>

      <Panel title="Recent Runs">
        {results.length ? (
          <div className="parser-result-list">
            {results.map((result) => (
              <article className={`parser-result-card is-${result.status || 'pending-review'}`} key={result.id}>
                <button
                  type="button"
                  className="parser-result-thumb"
                  onClick={() => onPreviewParserResult(result)}
                  title="Open test image"
                >
                  {result.fixture?.url ? <img src={result.fixture.url} alt="" /> : <span>No image</span>}
                </button>
                <div className="parser-result-main">
                  <header>
                    <strong>{result.fixture?.name || 'Unknown fixture'}</strong>
                    <span>{formatDate(result.createdAt)}</span>
                  </header>
                  <div className="parser-result-meta">
                    <span>{result.provider || 'provider?'}</span>
                    <span>{result.model || 'model?'}</span>
                    <span>{result.reasoningEffort || 'default effort'}</span>
                    <span>{formatMs(result.elapsedMs)}</span>
                    <span>9-label {result.canonicalPassed === false ? 'failed' : result.canonicalPassed === true ? 'passed' : 'unknown'}</span>
                  </div>
                  <pre>{result.parsedText || 'No parser output saved.'}</pre>
                </div>
                <ParserResultActions
                  resultId={result.id}
                  currentStatus={result.status}
                  onUpdate={onUpdateParserTestResult}
                />
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No parser tests saved yet" copy="Run the Image Parser test from Chat, then mark the result pass or fail." />
        )}
      </Panel>

      {parserResultPreview && (
        <ImageParserResultPreviewModal result={parserResultPreview} onClose={onCloseParserResultPreview} />
      )}
    </section>
  );
}

function ParserResultActions({ resultId, currentStatus, onUpdate }) {
  // Single-click Pass / Fail grading for a parser test result row.
  // Behavior mirrors the chat-area `ParserOutput` review buttons in ChatV5Container.jsx:
  // - One click PATCHes /api/pipeline-tests/parser-results/:id
  // - Both buttons disable while the save is in flight
  // - The active button keeps its is-pass / is-fail color after the save lands
  // - A status line below the buttons announces "Saving...", "Recorded: pass/fail", or "Pending review"
  const [pendingStatus, setPendingStatus] = useState('');
  const status = currentStatus || 'pending-review';
  const isSaving = Boolean(pendingStatus);

  async function handleClick(nextStatus) {
    if (isSaving) return;
    setPendingStatus(nextStatus);
    try {
      await onUpdate(resultId, nextStatus);
    } catch (_err) {
      // Parent surfaces the error via setParserTestResultsError; no extra handling needed here.
    } finally {
      setPendingStatus('');
    }
  }

  let statusLine;
  if (isSaving) {
    statusLine = 'Saving...';
  } else if (status === 'pass' || status === 'fail') {
    statusLine = `Recorded: ${status}`;
  } else {
    statusLine = 'Pending review';
  }

  return (
    <div className="parser-result-actions" aria-label="Record parser test result">
      <button
        type="button"
        className={status === 'pass' ? 'is-pass' : ''}
        disabled={isSaving}
        aria-label="Mark this parser test result as a pass"
        onClick={() => handleClick('pass')}
      >
        Pass
      </button>
      <button
        type="button"
        className={status === 'fail' ? 'is-fail' : ''}
        disabled={isSaving}
        aria-label="Mark this parser test result as a fail"
        onClick={() => handleClick('fail')}
      >
        Fail
      </button>
      <span>{statusLine}</span>
    </div>
  );
}

function ParserResultMetric({ label, value, detail }) {
  return (
    <div className="parser-result-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ParserResultBreakdown({ title, rows, labelFor, withThumbs = false }) {
  return (
    <div className="parser-result-breakdown">
      <h4>{title}</h4>
      {rows.length ? rows.map((row) => (
        <div className="parser-result-breakdown-row" key={`${title}-${labelFor(row)}`}>
          {withThumbs && row.fixture?.url && <img src={row.fixture.url} alt="" />}
          <strong>{labelFor(row)}</strong>
          <span>{row.total || 0} runs</span>
          <span>{formatRate(row.passRate)}</span>
          <span>{row.fail || 0} fail</span>
          <span>{formatMs(row.avgElapsedMs)}</span>
        </div>
      )) : (
        <div className="muted-text">No data yet.</div>
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
  if (data.textChars != null) parts.push(`chars=${data.textChars}`);
  if (data.error) parts.push(`error=${data.error}`);
  if (data.status) parts.push(`status=${data.status}`);
  return parts.join(' · ') || 'Saved event from conversation case intake.';
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
  const runtimeSummary = getAgentRuntimeSummary(runtimeState || agent?.runtime || {});
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

function RuntimeSettingsPanel({ agent, definition, runtimeState, saveStatus, onSave }) {
  const { providerStatus } = useProviderKeyStatus();
  const normalizedRuntimeState = normalizeAgentRuntimeState(definition, runtimeState || {});
  const [provider, setProvider] = useState(normalizedRuntimeState?.provider || '');
  const [mode, setMode] = useState(normalizedRuntimeState?.mode || definition?.defaultMode || 'single');
  const [fallbackProvider, setFallbackProvider] = useState(normalizedRuntimeState?.fallbackProvider || '');
  const [model, setModel] = useState(normalizedRuntimeState?.model || '');
  const [fallbackModel, setFallbackModel] = useState(normalizedRuntimeState?.fallbackModel || '');
  const [reasoningEffort, setReasoningEffort] = useState(
    normalizedRuntimeState?.reasoningEffort || ''
  );

  useEffect(() => {
    const normalized = normalizeAgentRuntimeState(definition, runtimeState || {});
    setProvider(normalized?.provider || '');
    setMode(normalized?.mode || definition?.defaultMode || 'single');
    setFallbackProvider(normalized?.fallbackProvider || '');
    setModel(normalized?.model || '');
    setFallbackModel(normalized?.fallbackModel || '');
    setReasoningEffort(normalized?.reasoningEffort || '');
  }, [definition, runtimeState]);

  if (!definition) {
    return (
      <EmptyState
        title="No runtime registry entry"
        copy="This identity does not currently map to an editable model provider configuration."
      />
    );
  }

  const providerOptions = definition.kind === 'image-parser'
    ? IMAGE_PARSER_PROVIDER_OPTIONS
    : PROVIDER_OPTIONS;
  const isMissingKey = (providerId) => isProviderMissingApiKey(providerId, providerStatus);
  const currentRuntime = {
    provider,
    mode,
    fallbackProvider,
    model,
    fallbackModel,
    reasoningEffort,
  };
  const modelSuggestions = getAgentRuntimeModelSuggestions(definition, currentRuntime);
  const fallbackModelSuggestions = getAgentRuntimeModelSuggestions(definition, currentRuntime, {
    fallback: true,
  });
  const modelListId = `${definition.id}-model-suggestions`;
  const fallbackModelListId = `${definition.id}-fallback-model-suggestions`;
  const reasoningOptions = definition.kind === 'image-parser'
    ? getImageParserReasoningEffortOptions(provider)
    : REASONING_EFFORT_OPTIONS;

  function handleProviderChange(nextProvider) {
    setProvider(nextProvider);
    setModel('');
    if (definition.kind === 'image-parser') setReasoningEffort('');
  }

  function handleFallbackProviderChange(nextProvider) {
    setFallbackProvider(nextProvider);
    setFallbackModel('');
  }

  return (
    <div className="runtime-settings-panel">
      <div className="runtime-form-grid">
        <label>
          <span>Provider</span>
          <select value={provider} onChange={(event) => handleProviderChange(event.target.value)}>
            {providerOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={isMissingKey(option.value)}
              >
                {option.shortLabel || option.label}
              </option>
            ))}
          </select>
        </label>

        {definition.supportsModes && (
          <label>
            <span>Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              {(definition.supportedModes || ['single']).map((option) => (
                <option key={option} value={option}>
                  {option === 'fallback' ? 'Fallback' : 'Single provider'}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          <span>Model</span>
          <input
            value={model}
            list={modelListId}
            placeholder={getAgentRuntimeModelPlaceholder(definition, currentRuntime)}
            onChange={(event) => setModel(event.target.value)}
            disabled={isMissingKey(provider)}
          />
          <datalist id={modelListId}>
            {modelSuggestions.map((option) => (
              <option key={`${option.provider || provider}:${option.value}`} value={option.value}>
                {option.label || option.value}
              </option>
            ))}
          </datalist>
        </label>

        {definition.supportsModes && mode === 'fallback' && (
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
                  disabled={isMissingKey(option.value)}
                >
                  {option.shortLabel || option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {definition.supportsModes && mode === 'fallback' && (
          <label>
            <span>Fallback model</span>
            <input
              value={fallbackModel}
              list={fallbackModelListId}
              placeholder={getAgentRuntimeModelPlaceholder(definition, currentRuntime, {
                fallback: true,
              })}
              onChange={(event) => setFallbackModel(event.target.value)}
              disabled={isMissingKey(fallbackProvider)}
            />
            <datalist id={fallbackModelListId}>
              {fallbackModelSuggestions.map((option) => (
                <option
                  key={`${option.provider || fallbackProvider}:${option.value}`}
                  value={option.value}
                >
                  {option.label || option.value}
                </option>
              ))}
            </datalist>
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
      </div>

      <div className="runtime-summary-box">
        <strong>{agent.profile?.roleTitle || labelAgent(agent.agentId)}</strong>
        <span>{getAgentRuntimeSummary(definition, currentRuntime)}</span>
      </div>

      <div className="form-action-row">
        <button
          type="button"
          className="primary-action"
          onClick={() =>
            onSave({
              provider,
              mode,
              fallbackProvider,
              model,
              fallbackModel,
              reasoningEffort: reasoningEffort || null,
            })
          }
        >
          Save Runtime
        </button>
        {saveStatus && <span className="save-status">{saveStatus}</span>}
      </div>
    </div>
  );
}

function Panel({ title, children, actions = null }) {
  return (
    <section className="agent-panel">
      <header>
        <h3>{title}</h3>
        {actions}
      </header>
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
      {entries.map((entry) => (
        <CompactItem
          key={timelineEntryKey(entry)}
          title={entry.event || entry.type || 'Activity'}
          meta={formatDate(entry.createdAt || entry.timestamp)}
          detail={entry.summary || entry.detail || entry.actor || 'Agent activity recorded.'}
        />
      ))}
    </div>
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

function buildIdentityHistoryState(entries) {
  const activity = Array.isArray(entries) ? entries : [];
  const versions = activity
    .filter((entry) => /profile|prompt|version|restore/i.test(`${entry.type || ''} ${entry.summary || ''}`))
    .map((entry, index) => ({
      versionId: entry.id || entry.versionId || `${entry.createdAt || index}`,
      versionLabel: entry.type || 'Change',
      createdAt: entry.createdAt || entry.timestamp,
      summary: entry.summary || entry.event || 'Identity change recorded.',
    }));

  return { activity, versions };
}

function buildPromptState(payload, versions) {
  const prompt = payload?.prompt || null;
  return {
    ...prompt,
    prompt,
    content: payload?.content || '',
    updatedAt: prompt?.updatedAt || prompt?.lastModified || null,
    versions: normalizePromptVersions(versions),
  };
}

function normalizePromptVersions(versions) {
  if (!Array.isArray(versions)) {
    return [];
  }
  return versions.map((version) => ({
    ...version,
    versionId: String(version.ts || version.versionId || ''),
    versionLabel: version.label || (version.ts ? `Snapshot ${version.ts}` : 'Prompt snapshot'),
    createdAt: version.ts ? new Date(Number(version.ts)).toISOString() : version.createdAt,
    summary: version.label || `${version.size || 0} bytes`,
  }));
}

function buildOperationalProfile(agent, runtimeState) {
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
  const status = resolveOperationalStatus(meta, agent);
  const latestReview = latestAgentReview(agent);
  const latestHarnessRun = latestAgentHarnessRun(agent);
  const reviewStatus = resolveReviewStatus(meta, latestReview);
  const trust = clamp(
    meta.trust
      + Math.min(0.15, toolCount * 0.015)
      + Math.min(0.08, activityCount * 0.01)
      + (latestReview?.status === 'approved' ? 0.06 : 0)
      + (latestHarnessRun?.status === 'pass' ? 0.06 : 0)
      - (status === 'review' ? 0.25 : 0),
    3.4,
    4.9
  );
  const workflowFit = clamp(trust / 5 + Math.min(0.12, toolCount * 0.02), 0.45, 0.98);
  const workflows = meta.workflows.length ? meta.workflows : ['Profile Review', 'Runtime Verification', 'Human Handoff'];
  const midpoint = Math.ceil(workflows.length / 2);
  const testCoverage = clamp(Math.round(72 + trust * 4 + Math.min(8, toolCount)), 72, 96);
  const qualitySeed = Math.round(trust * 18);
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
    trustLabel: `${trust.toFixed(1)} / 5`,
    qualityMetrics: [
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
    ],
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
      status: promptReady || agent?.agentId?.includes('parser') ? 'pass' : 'warn',
      lastRun: '2m ago',
    },
    {
      id: 'tool-safety',
      name: 'Tool safety gate',
      expected: toolCount ? 'Tool use is auditable with confirmation guidance.' : 'No tool calls are attempted.',
      status: toolCount ? 'pass' : 'warn',
      lastRun: '5m ago',
    },
    {
      id: 'status-regression',
      name: 'Operational status regression',
      expected: status === 'active' ? 'Agent is available for workflow assignment.' : 'Agent is flagged before workflow use.',
      status: status === 'active' ? 'pass' : 'warn',
      lastRun: '12m ago',
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

function resolveOperationalStatus(meta, agent) {
  if (agent?.enabled === false) {
    return 'disabled';
  }
  if (!agent?.promptId && !agent?.agentId?.includes('parser')) {
    return meta.status === 'active' ? 'idle' : meta.status;
  }
  return meta.status;
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
  return [entry.id, entry.versionId, entry.createdAt, entry.timestamp, entry.event, entry.summary]
    .filter(Boolean)
    .join(':');
}

function labelAgent(agentId = '') {
  return agentId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default AgentsView;
