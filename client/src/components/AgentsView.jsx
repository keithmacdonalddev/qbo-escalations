import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../hooks/useToast.jsx';
import {
  getAgentIdentity,
  getAgentIdentityHistory,
  listAgentIdentities,
  updateAgentIdentity,
} from '../api/agentIdentitiesApi.js';
import {
  getAgentPrompt,
  getAgentPromptVersion,
  listAgentPromptVersions,
  restoreAgentPromptVersion,
  updateAgentPrompt,
} from '../api/agentPromptsApi.js';
import {
  dispatchAgentRuntimeDefaultsApplied,
  getAgentRuntimeDefinition,
  getAgentRuntimeModelPlaceholder,
  getAgentRuntimeModelSuggestions,
  getAgentRuntimeProviderLabel,
  getAgentRuntimeSummary,
  normalizeAgentRuntimeState,
  readAgentRuntimeState,
  readAllAgentRuntimeStatesByAgentId,
  readAllAgentRuntimeStatesBySurfaceId,
  writeAgentRuntimeState,
} from '../lib/agentRuntimeSettings.js';
import {
  loadAiAssistantDefaultsFromServer,
  syncAiAssistantDefaultsToServer,
} from '../lib/aiAssistantPreferences.js';
import { SURFACE_DEFAULTS_APPLIED_EVENT } from '../lib/surfacePreferences.js';
import {
  DEFAULT_REASONING_EFFORT,
  PROVIDER_FAMILY,
  PROVIDER_OPTIONS,
  getAlternateProvider,
  getReasoningEffortOptions,
  normalizeProvider,
} from '../lib/providerCatalog.js';
import { IMAGE_PARSER_PROVIDER_OPTIONS } from '../lib/imageParserCatalog.js';

const PROFILE_FIELDS = [
  ['displayName', 'Display Name'],
  ['roleTitle', 'Role'],
  ['headline', 'Headline'],
  ['tone', 'Tone'],
  ['conversationalStyle', 'Conversation Style'],
  ['boundaries', 'Boundaries'],
  ['initiativeLevel', 'Initiative'],
  ['socialStyle', 'Social Style'],
  ['communityStyle', 'Community Style'],
  ['selfImprovementStyle', 'Self-Improvement'],
  ['soul', 'Off-Clock Personality'],
  ['routingBias', 'Routing Bias'],
];

function emptyProfile() {
  return {
    displayName: '',
    roleTitle: '',
    headline: '',
    tone: '',
    quirks: [],
    conversationalStyle: '',
    boundaries: '',
    initiativeLevel: '',
    socialStyle: '',
    communityStyle: '',
    selfImprovementStyle: '',
    soul: '',
    routingBias: '',
    avatarUrl: '',
    avatarEmoji: '',
    avatarPrompt: '',
    avatarSource: '',
  };
}

export default function AgentsView({ agentIdFromRoute = null }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  const initialAgentIdRef = useRef(agentIdFromRoute);
  const selectedAgentIdRef = useRef(agentIdFromRoute);
  const selectedAgentRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const promptRequestRef = useRef(0);
  const [agents, setAgents] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState(agentIdFromRoute);
  const [currentAgent, setCurrentAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [agentLoading, setAgentLoading] = useState(false);
  const [profileDraft, setProfileDraft] = useState(emptyProfile());
  const [profileSummary, setProfileSummary] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoadedFor, setHistoryLoadedFor] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [promptContent, setPromptContent] = useState('');
  const [promptDraft, setPromptDraft] = useState('');
  const [promptLabel, setPromptLabel] = useState('');
  const [promptVersions, setPromptVersions] = useState([]);
  const [promptLoadedFor, setPromptLoadedFor] = useState(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [runtimeSelections, setRuntimeSelections] = useState(() => readAllAgentRuntimeStatesByAgentId());
  const [runtimeDraft, setRuntimeDraft] = useState(null);
  const [runtimeSaved, setRuntimeSaved] = useState(null);
  const [runtimeSaving, setRuntimeSaving] = useState(false);

  const selectedRuntimeDefinition = useMemo(
    () => getAgentRuntimeDefinition(selectedAgentId),
    [selectedAgentId]
  );

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    if (!selectedRuntimeDefinition) {
      setRuntimeDraft(null);
      setRuntimeSaved(null);
      return;
    }

    const next = readAgentRuntimeState(selectedRuntimeDefinition);
    setRuntimeDraft(next);
    setRuntimeSaved(next);
    setRuntimeSelections((current) => ({
      ...current,
      [selectedRuntimeDefinition.agentId]: next,
    }));
  }, [selectedRuntimeDefinition]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleDefaultsApplied = () => {
      const nextSelections = readAllAgentRuntimeStatesByAgentId();
      setRuntimeSelections(nextSelections);
      if (selectedRuntimeDefinition) {
        const next = nextSelections[selectedRuntimeDefinition.agentId] || readAgentRuntimeState(selectedRuntimeDefinition);
        setRuntimeDraft(next);
        setRuntimeSaved(next);
      }
    };

    window.addEventListener(SURFACE_DEFAULTS_APPLIED_EVENT, handleDefaultsApplied);
    return () => window.removeEventListener(SURFACE_DEFAULTS_APPLIED_EVENT, handleDefaultsApplied);
  }, [selectedRuntimeDefinition]);

  const selectedAgent = useMemo(() => {
    if (currentAgent?.agentId === selectedAgentId) return currentAgent;
    return agents.find((agent) => agent.agentId === selectedAgentId) || null;
  }, [agents, currentAgent, selectedAgentId]);

  const filteredAgents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter((agent) => agentSearchText(agent).includes(needle));
  }, [agents, query]);

  const loadSelectedAgent = useCallback(async (agentId) => {
    if (!agentId) return;
    const requestId = selectedAgentRequestRef.current + 1;
    selectedAgentRequestRef.current = requestId;
    setAgentLoading(true);
    setProfileDraft(emptyProfile());
    setPreviewContent('');
    setHistory([]);
    setHistoryLoadedFor(null);
    setPromptContent('');
    setPromptDraft('');
    setPromptLabel('');
    setPromptVersions([]);
    setPromptLoadedFor(null);
    try {
      const agent = await getAgentIdentity(agentId);
      if (selectedAgentRequestRef.current !== requestId) return null;
      setCurrentAgent(agent);
      setProfileDraft({ ...emptyProfile(), ...(agent.profile || {}) });
      return agent;
    } finally {
      if (selectedAgentRequestRef.current === requestId) setAgentLoading(false);
    }
  }, []);

  const loadHistoryForAgent = useCallback(async (agentId = selectedAgentId, { force = false } = {}) => {
    if (!agentId) return;
    if (!force && historyLoadedFor === agentId) return;
    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    setHistoryLoading(true);
    try {
      const nextHistory = await getAgentIdentityHistory(agentId);
      if (historyRequestRef.current !== requestId || selectedAgentIdRef.current !== agentId) return;
      setHistory(nextHistory || []);
      setHistoryLoadedFor(agentId);
    } finally {
      if (historyRequestRef.current === requestId) setHistoryLoading(false);
    }
  }, [historyLoadedFor, selectedAgentId]);

  const loadPromptForAgent = useCallback(async (agent = selectedAgent, { force = false } = {}) => {
    if (!agent?.agentId) return;
    if (!agent.promptId) {
      setPromptLoadedFor(agent.agentId);
      return;
    }
    if (!force && promptLoadedFor === agent.agentId) return;
    const requestId = promptRequestRef.current + 1;
    promptRequestRef.current = requestId;
    setPromptLoading(true);
    setPreviewContent('');
    try {
      const [prompt, versions] = await Promise.all([
        getAgentPrompt(agent.promptId),
        listAgentPromptVersions(agent.promptId).catch(() => []),
      ]);
      if (promptRequestRef.current !== requestId || selectedAgentIdRef.current !== agent.agentId) return;
      setPromptContent(prompt.content || '');
      setPromptDraft(prompt.content || '');
      setPromptVersions(versions || []);
      setPromptLoadedFor(agent.agentId);
    } finally {
      if (promptRequestRef.current === requestId) setPromptLoading(false);
    }
  }, [promptLoadedFor, selectedAgent]);

  const loadHistoryForSelectedAgent = useCallback(() => {
    return loadHistoryForAgent(selectedAgentId);
  }, [loadHistoryForAgent, selectedAgentId]);

  const loadPromptForSelectedAgent = useCallback(() => {
    return loadPromptForAgent(selectedAgent);
  }, [loadPromptForAgent, selectedAgent]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const list = await listAgentIdentities();
        if (!active) return;
        setAgents(list || []);
        const nextSelected = initialAgentIdRef.current || list?.[0]?.agentId || null;
        setSelectedAgentId(nextSelected);
        if (nextSelected) await loadSelectedAgent(nextSelected);
      } catch (err) {
        if (active) toastRef.current.error(err?.message || 'Failed to load agents');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadSelectedAgent]);

  useEffect(() => {
    if (!agentIdFromRoute || agentIdFromRoute === selectedAgentId) return;
    setSelectedAgentId(agentIdFromRoute);
    loadSelectedAgent(agentIdFromRoute).catch((err) => {
      toastRef.current.error(err?.message || 'Failed to load agent');
    });
  }, [agentIdFromRoute, loadSelectedAgent, selectedAgentId]);

  const profile = selectedAgent?.profile || emptyProfile();
  const hasProfileChanges = JSON.stringify(profileDraft) !== JSON.stringify({ ...emptyProfile(), ...profile });
  const hasPromptChanges = promptDraft !== promptContent;
  const latestActivity = selectedAgent?.activity?.entries?.[0] || null;
  const selectedRuntimeState = selectedRuntimeDefinition
    ? (runtimeSelections[selectedRuntimeDefinition.agentId] || runtimeSaved)
    : null;
  const hasRuntimeChanges = Boolean(
    selectedRuntimeDefinition
    && runtimeDraft
    && runtimeSaved
    && JSON.stringify(runtimeDraft) !== JSON.stringify(runtimeSaved)
  );

  function handleSelectAgent(agentId) {
    if (!agentId || agentId === selectedAgentId) return;
    window.location.hash = `#/agents/${agentId}`;
  }

  async function handleSaveProfile() {
    if (!selectedAgentId || !hasProfileChanges) return;
    setProfileSaving(true);
    try {
      const agent = await updateAgentIdentity(selectedAgentId, profileDraft, profileSummary);
      setCurrentAgent(agent);
      setAgents((current) => current.map((item) => (item.agentId === selectedAgentId ? agent : item)));
      if (historyLoadedFor === selectedAgentId) {
        setHistory(await getAgentIdentityHistory(selectedAgentId));
        setHistoryLoadedFor(selectedAgentId);
      }
      setProfileSummary('');
      toast.success('Agent profile saved');
    } catch (err) {
      toast.error(err?.message || 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleSaveRuntime() {
    if (!selectedRuntimeDefinition || !runtimeDraft || !hasRuntimeChanges) return;
    setRuntimeSaving(true);
    try {
      const normalized = writeAgentRuntimeState(selectedRuntimeDefinition, runtimeDraft);
      const existingDefaults = await loadAiAssistantDefaultsFromServer().catch(() => null);
      const syncedDefaults = await syncAiAssistantDefaultsToServer({
        settings: existingDefaults?.settings,
        agents: readAllAgentRuntimeStatesBySurfaceId(),
      });
      const syncedRuntime = syncedDefaults?.agents?.[selectedRuntimeDefinition.id] || normalized;
      dispatchAgentRuntimeDefaultsApplied(syncedDefaults?.agents || { [selectedRuntimeDefinition.id]: syncedRuntime });
      setRuntimeSaved(syncedRuntime);
      setRuntimeDraft(syncedRuntime);
      setRuntimeSelections((current) => ({
        ...current,
        [selectedRuntimeDefinition.agentId]: syncedRuntime,
      }));
      toast.success('Agent model saved');
    } catch (err) {
      toast.error(err?.message || 'Failed to save agent model');
    } finally {
      setRuntimeSaving(false);
    }
  }

  function handleDiscardRuntime() {
    if (!selectedRuntimeDefinition || !runtimeSaved) return;
    setRuntimeDraft({ ...runtimeSaved });
  }

  async function handleSavePrompt() {
    if (!selectedAgent?.promptId || !hasPromptChanges) return;
    setPromptSaving(true);
    try {
      await updateAgentPrompt(selectedAgent.promptId, promptDraft, promptLabel);
      setPromptContent(promptDraft);
      setPromptLabel('');
      setPromptVersions(await listAgentPromptVersions(selectedAgent.promptId));
      setPromptLoadedFor(selectedAgentId);
      if (historyLoadedFor === selectedAgentId) {
        setHistory(await getAgentIdentityHistory(selectedAgentId));
        setHistoryLoadedFor(selectedAgentId);
      }
      toast.success('Prompt saved');
    } catch (err) {
      toast.error(err?.message || 'Failed to save prompt');
    } finally {
      setPromptSaving(false);
    }
  }

  async function handlePreviewVersion(ts) {
    if (!selectedAgent?.promptId) return;
    try {
      setPreviewContent(await getAgentPromptVersion(selectedAgent.promptId, ts));
    } catch (err) {
      toast.error(err?.message || 'Failed to load prompt version');
    }
  }

  async function handleRestoreVersion(ts) {
    if (!selectedAgent?.promptId) return;
    try {
      await restoreAgentPromptVersion(selectedAgent.promptId, ts);
      await loadPromptForAgent(selectedAgent, { force: true });
      if (historyLoadedFor === selectedAgentId) {
        setHistory(await getAgentIdentityHistory(selectedAgentId));
        setHistoryLoadedFor(selectedAgentId);
      }
      toast.success('Prompt version restored');
    } catch (err) {
      toast.error(err?.message || 'Failed to restore prompt version');
    }
  }

  if (loading) {
    return (
      <div className="app-content-constrained">
        <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
          <span className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="app-content-constrained agent-profiles-page">
      <header className="page-header agent-profiles-titlebar">
        <div>
          <h1 className="page-title">Agent Profiles</h1>
          <p className="text-secondary">
            Search, select, and expand only the sections you need.
          </p>
        </div>
      </header>

      <section className="agent-profiles-shell">
        <AgentDirectory
          agents={filteredAgents}
          totalAgents={agents.length}
          query={query}
          setQuery={setQuery}
          selectedAgentId={selectedAgentId}
          onSelect={handleSelectAgent}
        />

        {selectedAgent ? (
          <main className="agent-profile-pane">
            <AgentHeader
              agent={selectedAgent}
              latestActivity={latestActivity}
              loading={agentLoading}
              runtimeDefinition={selectedRuntimeDefinition}
              runtimeState={selectedRuntimeState}
            />
            <OverviewGrid
              agent={selectedAgent}
              latestActivity={latestActivity}
              runtimeDefinition={selectedRuntimeDefinition}
              runtimeState={selectedRuntimeState}
            />
            <ProgressiveSections
              agent={selectedAgent}
              agents={agents}
              history={history}
              historyLoading={historyLoading}
              profileDraft={profileDraft}
              setProfileDraft={setProfileDraft}
              profileSummary={profileSummary}
              setProfileSummary={setProfileSummary}
              profileSaving={profileSaving}
              hasProfileChanges={hasProfileChanges}
              onSaveProfile={handleSaveProfile}
              runtimeDefinition={selectedRuntimeDefinition}
              runtimeDraft={runtimeDraft}
              setRuntimeDraft={setRuntimeDraft}
              runtimeSaving={runtimeSaving}
              hasRuntimeChanges={hasRuntimeChanges}
              onSaveRuntime={handleSaveRuntime}
              onDiscardRuntime={handleDiscardRuntime}
              promptContent={promptContent}
              promptDraft={promptDraft}
              setPromptDraft={setPromptDraft}
              promptLabel={promptLabel}
              setPromptLabel={setPromptLabel}
              promptVersions={promptVersions}
              promptLoading={promptLoading}
              promptSaving={promptSaving}
              hasPromptChanges={hasPromptChanges}
              previewContent={previewContent}
              onLoadHistory={loadHistoryForSelectedAgent}
              onLoadPrompt={loadPromptForSelectedAgent}
              onSavePrompt={handleSavePrompt}
              onPreviewVersion={handlePreviewVersion}
              onRestoreVersion={handleRestoreVersion}
            />
          </main>
        ) : (
          <EmptyState>No agent selected.</EmptyState>
        )}
      </section>
    </div>
  );
}

function AgentDirectory({ agents, totalAgents, query, setQuery, selectedAgentId, onSelect }) {
  return (
    <aside
      className="card agent-directory"
    >
      <div className="agent-directory-search">
        <div className="agent-directory-header">
          <h2>Directory</h2>
          <span className="text-secondary">
            {agents.length}/{totalAgents}
          </span>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search agents..."
        />
      </div>

      <div className="agent-directory-list">
        {agents.length ? agents.map((agent) => (
          <AgentListRow
            key={agent.agentId}
            agent={agent}
            selected={agent.agentId === selectedAgentId}
            onSelect={onSelect}
          />
        )) : (
          <EmptyState>No matching agents.</EmptyState>
        )}
      </div>
    </aside>
  );
}

function AgentListRow({ agent, selected, onSelect }) {
  const profile = agent.profile || {};
  return (
    <button
      type="button"
      className={`agent-list-row${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(agent.agentId)}
    >
      <AgentAvatar profile={profile} fallbackLabel={agent.agentId} size={30} />
      <div className="agent-list-row-copy">
        <strong>
          {profile.displayName || agent.agentId}
        </strong>
        <span className="text-secondary">
          {profile.roleTitle || 'Agent'}
        </span>
      </div>
    </button>
  );
}

function AgentHeader({ agent, latestActivity, loading, runtimeDefinition, runtimeState }) {
  const profile = agent.profile || {};
  const runtimeSummary = runtimeDefinition
    ? getAgentRuntimeSummary(runtimeDefinition, runtimeState || {})
    : '';
  return (
    <section className="card agent-profile-header">
      <AgentAvatar profile={profile} fallbackLabel={agent.agentId} size={44} />
      <div className="agent-profile-header-main">
        <div className="agent-profile-name-row">
            <h2>
              {profile.displayName || agent.agentId}
            </h2>
            {loading ? <span className="spinner" /> : null}
        </div>
        <p className="text-secondary agent-profile-headline">
            {profile.roleTitle || 'Agent'} - {profile.headline || 'No headline set.'}
        </p>
      </div>

      <div className="agent-profile-badges">
        {runtimeDefinition ? (
          <Badge className="agent-runtime-badge" title={runtimeSummary}>Model: {runtimeSummary}</Badge>
        ) : null}
        <Badge>Prompt: {agent.promptId || 'none'}</Badge>
        <Badge>{agent.tools?.available?.length || 0} tools</Badge>
        <Badge>{agent.memory?.notes?.length || 0} memory notes</Badge>
        <Badge>{latestActivity?.status || 'no recent status'}</Badge>
      </div>
    </section>
  );
}

function OverviewGrid({ agent, latestActivity, runtimeDefinition, runtimeState }) {
  const profile = agent.profile || {};
  const runtimeSummary = runtimeDefinition
    ? getAgentRuntimeSummary(runtimeDefinition, runtimeState || {})
    : 'No model mapping.';
  return (
    <section className="agent-overview-grid">
      <SimpleCard title="Purpose">
        <p>{profile.headline || profile.roleTitle || 'No purpose has been defined.'}</p>
      </SimpleCard>
      <SimpleCard title="Model">
        <p title={runtimeSummary}>{runtimeSummary}</p>
      </SimpleCard>
      <SimpleCard title="Behavior">
        <p>{profile.tone || profile.conversationalStyle || 'No behavior profile has been defined.'}</p>
      </SimpleCard>
      <SimpleCard title="Recent Activity">
        <p>{latestActivity?.summary || latestActivity?.status || 'No recent activity yet.'}</p>
      </SimpleCard>
    </section>
  );
}

function ProgressiveSections(props) {
  return (
    <section className="agent-section-stack">
      <DetailsSection title="Profile Details" summary="Tone, boundaries, quirks, and collaboration style.">
        <ProfileDetails agent={props.agent} />
      </DetailsSection>

      <DetailsSection title="Model Defaults" summary="Default model, with advanced routing options when needed.">
        <RuntimeSettingsPanel
          definition={props.runtimeDefinition}
          draft={props.runtimeDraft}
          setDraft={props.setRuntimeDraft}
          saving={props.runtimeSaving}
          hasChanges={props.hasRuntimeChanges}
          onSave={props.onSaveRuntime}
          onDiscard={props.onDiscardRuntime}
        />
      </DetailsSection>

      <DetailsSection title="Tools and Activity" summary="Capabilities and recent runtime behavior." onOpen={props.onLoadHistory}>
        <ToolsAndActivity agent={props.agent} history={props.history} historyLoading={props.historyLoading} />
      </DetailsSection>

      <DetailsSection title="Memory and Relationships" summary="Continuity notes and how this agent coordinates with the others." onOpen={props.onLoadHistory}>
        <MemoryAndRelationships agent={props.agent} agents={props.agents} history={props.history} historyLoading={props.historyLoading} />
      </DetailsSection>

      <DetailsSection title="Admin" summary="Edit the profile, prompt, and prompt versions." onOpen={props.onLoadPrompt}>
        <AdminTools {...props} />
      </DetailsSection>
    </section>
  );
}

function DetailsSection({ title, summary, children, defaultOpen = false, onOpen }) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (open) onOpen?.();
  }, [onOpen, open]);

  function handleToggle(event) {
    setOpen(event.currentTarget.open);
  }

  return (
    <details className="card agent-details-section" open={open} onToggle={handleToggle}>
      <summary>
        <div className="agent-details-summary">
          <div>
            <h3>{title}</h3>
            <p className="text-secondary">{summary}</p>
          </div>
          <span className="text-secondary">{open ? 'Close' : 'Open'}</span>
        </div>
      </summary>
      <div className="agent-details-body">
        {children}
      </div>
    </details>
  );
}

function ProfileDetails({ agent }) {
  const profile = agent.profile || {};
  return (
    <div className="agent-profile-details">
      <section className="agent-definition-grid">
        <Definition label="Tone" value={profile.tone} />
        <Definition label="Conversation Style" value={profile.conversationalStyle} />
        <Definition label="Boundaries" value={profile.boundaries} />
        <Definition label="Initiative" value={profile.initiativeLevel} />
        <Definition label="Social Style" value={profile.socialStyle} />
        <Definition label="Community Style" value={profile.communityStyle} />
        <Definition label="Self-Improvement" value={profile.selfImprovementStyle} />
        <Definition label="Routing Bias" value={profile.routingBias} />
      </section>
      <Definition label="Off-Clock Personality" value={profile.soul} />
      <div className="agent-tag-block">
        <span className="eyebrow">Quirks</span>
        <TagList items={profile.quirks || []} />
      </div>
    </div>
  );
}

function ToolsAndActivity({ agent, history, historyLoading }) {
  const tools = agent.tools?.available || [];
  const recentUsage = agent.tools?.recentUsage || [];
  const activity = agent.activity?.entries || [];
  return (
    <div className="agent-expanded-grid">
      <section className="agent-count-grid">
        <CountCard label="Tools" value={tools.length} />
        <CountCard label="Tool Uses" value={recentUsage.length} />
        <CountCard label="Activity" value={activity.length} />
      </section>

      <section className="agent-two-column">
        <Panel title="Top Tools">
          {tools.length ? tools.slice(0, 10).map((tool, index) => (
            <CompactItem key={`${tool.name || 'tool'}-${index}`} title={tool.name} meta={tool.kind} body={tool.description} />
          )) : <EmptyState>No tools registered.</EmptyState>}
        </Panel>
        <Panel title="Recent Activity">
          <TimelineList entries={[...activity.slice(0, 6), ...recentUsage.slice(0, 4)]} empty="No recent activity." />
        </Panel>
      </section>

      <Panel title="History">
        {historyLoading ? <InlineLoading label="Loading history..." /> : <TimelineList entries={(history || []).slice(0, 8)} empty="No history yet." />}
      </Panel>
    </div>
  );
}

function MemoryAndRelationships({ agent, agents, history, historyLoading }) {
  const notes = agent.memory?.notes || [];
  const relationships = agent.relationships?.notes || [];
  const relationshipMap = agent.relationships?.map?.all || [];
  return (
    <div className="agent-expanded-grid">
      <section className="agent-count-grid">
        <CountCard label="Memory" value={notes.length} />
        <CountCard label="Relationships" value={relationships.length} />
        <CountCard label="Mapped Peers" value={relationshipMap.length} />
      </section>

      <section className="agent-two-column">
        <Panel title="Continuity">
          <TimelineList entries={notes.slice(0, 8).map((note) => ({
            type: note.kind,
            summary: note.content,
            createdAt: note.updatedAt,
          }))} empty="No continuity notes yet." />
        </Panel>
        <Panel title="Relationships">
          {relationships.length ? relationships.slice(0, 8).map((note, index) => (
            <CompactItem
              key={`${note.otherAgentId}-${index}`}
              title={labelAgent(agent, agents, note.otherAgentId)}
              meta={`${note.kind || 'dynamic'} - confidence ${formatConfidence(note.confidence)}`}
              body={note.summary}
            />
          )) : <EmptyState>No relationship notes yet.</EmptyState>}
        </Panel>
      </section>

      <Panel title="Learning Timeline">
        {historyLoading ? <InlineLoading label="Loading learning timeline..." /> : (
          <TimelineList entries={(history || []).filter((entry) => /learned|relationship|correction|profile|prompt/.test(entry.type)).slice(0, 10)} empty="No learning timeline yet." />
        )}
      </Panel>
    </div>
  );
}

function RuntimeSettingsPanel({ definition, draft, setDraft, saving, hasChanges, onSave, onDiscard }) {
  if (!definition || !draft) {
    return <EmptyState>No model defaults are mapped to this agent.</EmptyState>;
  }

  const isImageParser = definition.kind === 'image-parser';
  const effortOptions = isImageParser
    ? []
    : getReasoningEffortOptions(PROVIDER_FAMILY[draft.provider] || 'claude');

  function updateDraft(patch) {
    setDraft((current) => normalizeAgentRuntimeState(definition, {
      ...(current || draft || {}),
      ...patch,
    }));
  }

  function handleProviderChange(value) {
    if (isImageParser) {
      updateDraft({ provider: value, model: '' });
      return;
    }

    const nextProvider = normalizeProvider(value);
    setDraft((current) => {
      const previous = current || draft || {};
      const nextFallbackProvider = previous.fallbackProvider === nextProvider
        ? getAlternateProvider(nextProvider)
        : previous.fallbackProvider;
      return normalizeAgentRuntimeState(definition, {
        ...previous,
        provider: nextProvider,
        fallbackProvider: nextFallbackProvider,
        model: '',
        fallbackModel: nextFallbackProvider === previous.fallbackProvider ? previous.fallbackModel : '',
        reasoningEffort: previous.reasoningEffort || DEFAULT_REASONING_EFFORT,
      });
    });
  }

  function handleFallbackProviderChange(value) {
    updateDraft({
      fallbackProvider: normalizeProvider(value),
      fallbackModel: '',
    });
  }

  const primarySuggestions = getAgentRuntimeModelSuggestions(definition, draft);
  const fallbackSuggestions = getAgentRuntimeModelSuggestions(definition, draft, { fallback: true });
  const primaryListId = `agent-runtime-${definition.id}-primary-models`;
  const fallbackListId = `agent-runtime-${definition.id}-fallback-models`;

  return (
    <div className="agent-runtime-editor">
      <div className="agent-runtime-primary-row">
        {isImageParser ? (
          <label className="agent-runtime-field">
            <span className="eyebrow">Current model</span>
            <select value={draft.provider || ''} onChange={(event) => handleProviderChange(event.target.value)}>
              <option value="">Disabled</option>
              {IMAGE_PARSER_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="agent-runtime-field">
            <span className="eyebrow">Current model</span>
            <select value={draft.provider} onChange={(event) => handleProviderChange(event.target.value)}>
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        )}

        {!isImageParser ? (
          <label className="agent-runtime-field">
            <span className="eyebrow">Reasoning</span>
            <select value={draft.reasoningEffort} onChange={(event) => updateDraft({ reasoningEffort: event.target.value })}>
              {effortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="agent-runtime-actions">
          <button type="button" className="btn btn-secondary" disabled={!hasChanges || saving} onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="btn btn-primary" disabled={!hasChanges || saving} onClick={onSave}>
            {saving ? 'Saving...' : 'Save Model'}
          </button>
        </div>
      </div>

      <details className="agent-runtime-advanced">
        <summary>Advanced runtime options</summary>
        <div className="agent-runtime-form-grid">
          <label className="agent-runtime-field">
            <span className="eyebrow">{isImageParser ? 'Model ID override' : 'Primary model ID override'}</span>
            <input
              type="text"
              value={draft.model || ''}
              list={primaryListId}
              placeholder={getAgentRuntimeModelPlaceholder(definition, draft)}
              onChange={(event) => updateDraft({ model: event.target.value })}
            />
            <datalist id={primaryListId}>
              {primarySuggestions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </datalist>
          </label>

          {!isImageParser ? (
            <>
            <label className="agent-runtime-field">
              <span className="eyebrow">Mode</span>
              <select value={draft.mode} onChange={(event) => updateDraft({ mode: event.target.value })}>
                {definition.supportedModes.map((mode) => (
                  <option key={mode} value={mode}>{mode === 'single' ? 'Single' : 'Fallback'}</option>
                ))}
              </select>
            </label>

            {draft.mode === 'fallback' ? (
              <>
                <label className="agent-runtime-field">
                  <span className="eyebrow">Fallback Provider</span>
                  <select value={draft.fallbackProvider} onChange={(event) => handleFallbackProviderChange(event.target.value)}>
                    {PROVIDER_OPTIONS.filter((option) => option.value !== draft.provider).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="agent-runtime-field">
                  <span className="eyebrow">Fallback Model</span>
                  <input
                    type="text"
                    value={draft.fallbackModel || ''}
                    list={fallbackListId}
                    placeholder={getAgentRuntimeModelPlaceholder(definition, draft, { fallback: true })}
                    onChange={(event) => updateDraft({ fallbackModel: event.target.value })}
                  />
                  <datalist id={fallbackListId}>
                    {fallbackSuggestions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </datalist>
                </label>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function AdminTools(props) {
  const {
    agent,
    profileDraft,
    setProfileDraft,
    profileSummary,
    setProfileSummary,
    profileSaving,
    hasProfileChanges,
    onSaveProfile,
    promptContent,
    promptDraft,
    setPromptDraft,
    promptLabel,
    setPromptLabel,
    promptVersions,
    promptLoading,
    promptSaving,
    hasPromptChanges,
    previewContent,
    onSavePrompt,
    onPreviewVersion,
    onRestoreVersion,
  } = props;

  return (
    <div className="agent-expanded-grid">
      <Panel title="Edit Profile">
        <div className="agent-admin-form-grid">
          {PROFILE_FIELDS.map(([field, label]) => (
            <FormField
              key={field}
              label={label}
              value={profileDraft[field]}
              textarea
              rows={field === 'soul' ? 4 : 2}
              onChange={(value) => setProfileDraft((current) => ({ ...current, [field]: value }))}
            />
          ))}
          <FormField
            label="Quirks"
            value={(profileDraft.quirks || []).join('\n')}
            textarea
            rows={4}
            wide
            onChange={(value) => setProfileDraft((current) => ({
              ...current,
              quirks: value.split('\n').map((item) => item.trim()).filter(Boolean),
            }))}
          />
          <FormField label="Avatar URL" value={profileDraft.avatarUrl} onChange={(value) => setProfileDraft((current) => ({ ...current, avatarUrl: value }))} />
          <FormField label="Emoji" value={profileDraft.avatarEmoji} onChange={(value) => setProfileDraft((current) => ({ ...current, avatarEmoji: value }))} />
          <FormField label="Avatar Prompt" value={profileDraft.avatarPrompt} textarea wide onChange={(value) => setProfileDraft((current) => ({ ...current, avatarPrompt: value }))} />
          <FormField label="Change Summary" value={profileSummary} wide onChange={setProfileSummary} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
          <button type="button" className="btn btn-primary" disabled={!hasProfileChanges || profileSaving} onClick={onSaveProfile}>
            {profileSaving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </Panel>

      <Panel title="Prompt">
        {agent.promptId ? (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', alignItems: 'center' }}>
              <Badge>{agent.promptId}</Badge>
              <button type="button" className="btn btn-primary" disabled={!hasPromptChanges || promptSaving || promptLoading} onClick={onSavePrompt}>
                {promptSaving ? 'Saving...' : 'Save Prompt'}
              </button>
            </div>
            {promptLoading ? (
              <InlineLoading label="Loading prompt..." />
            ) : (
              <>
                <FormField label="Revision Note" value={promptLabel} onChange={setPromptLabel} />
                <textarea
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  rows={16}
                  style={{ minHeight: 320, fontFamily: 'var(--font-mono, monospace)' }}
                />
                <div className="text-secondary" style={{ fontSize: 'var(--text-xs)' }}>
                  {promptDraft.length} chars {hasPromptChanges ? '- unsaved changes' : '- saved'}
                </div>
              </>
            )}
          </div>
        ) : (
          <EmptyState>No prompt file is mapped to this agent.</EmptyState>
        )}
      </Panel>

      <section className="agent-prompt-version-grid">
        <Panel title="Versions">
          {promptLoading ? <InlineLoading label="Loading versions..." /> : promptVersions.length ? promptVersions.map((version, index) => (
            <CompactItem
              key={`${version.ts || 'version'}-${index}`}
              title={formatDate(version.ts)}
              meta={version.label || 'No note'}
              action={(
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPreviewVersion(version.ts)}>Preview</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRestoreVersion(version.ts)}>Restore</button>
                </div>
              )}
            />
          )) : <EmptyState>No prompt versions yet.</EmptyState>}
        </Panel>
        <Panel title="Preview">
          {promptLoading ? (
            <InlineLoading label="Loading preview..." />
          ) : (
            <textarea value={previewContent || promptContent} readOnly rows={16} style={{ minHeight: 320, fontFamily: 'var(--font-mono, monospace)' }} />
          )}
        </Panel>
      </section>
    </div>
  );
}

function SimpleCard({ title, children }) {
  return (
    <section className="card agent-summary-card">
      <h3>{title}</h3>
      <div>
        {children}
      </div>
    </section>
  );
}

function Panel({ title, children }) {
  return (
    <section className="card card-compact agent-panel">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Definition({ label, value }) {
  return (
    <div className="agent-definition">
      <span className="eyebrow">{label}</span>
      <span>{value || 'Not defined yet.'}</span>
    </div>
  );
}

function CountCard({ label, value }) {
  return (
    <div className="card card-compact agent-count-card">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompactItem({ title, meta, body, action = null }) {
  return (
    <div className="card card-compact agent-compact-item">
      <div className="agent-compact-item-head">
        <strong>{title}</strong>
        {action}
      </div>
      {meta ? <span className="text-secondary">{meta}</span> : null}
      {body ? <span className="agent-compact-item-body">{body}</span> : null}
    </div>
  );
}

function FormField({ label, value, onChange, textarea = false, rows = 2, wide = false }) {
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <label style={{ display: 'grid', gap: 6, gridColumn: wide ? '1 / -1' : undefined }}>
      <span className="eyebrow">{label}</span>
      <Tag
        type={textarea ? undefined : 'text'}
        value={value || ''}
        rows={textarea ? rows : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TimelineList({ entries, empty }) {
  if (!entries?.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="agent-timeline-list">
      {entries.map((entry, index) => (
        <CompactItem
          key={timelineEntryKey(entry, index)}
          title={entry.type || entry.tool || 'event'}
          meta={formatDate(entry.createdAt)}
          body={entry.summary || entry.status || 'No summary.'}
        />
      ))}
    </div>
  );
}

function TagList({ items }) {
  if (!items?.length) return <EmptyState>None recorded.</EmptyState>;
  return (
    <div className="agent-tag-list">
      {items.map((item, index) => <Badge key={`${item}-${index}`}>{item}</Badge>)}
    </div>
  );
}

function Badge({ children, className = '', title = undefined }) {
  return <span className={`badge${className ? ` ${className}` : ''}`} title={title}>{children}</span>;
}

function EmptyState({ children }) {
  return <div className="text-secondary agent-empty-state">{children}</div>;
}

function InlineLoading({ label }) {
  return (
    <div className="text-secondary agent-inline-loading">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

function AgentAvatar({ profile, fallbackLabel, size = 56 }) {
  const avatarUrl = profile?.avatarUrl || '';
  const avatarEmoji = profile?.avatarEmoji || '';
  const label = profile?.displayName || fallbackLabel || 'AI';
  const initials = String(label)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'AI';

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(145deg, rgba(27, 130, 191, 0.32), rgba(32, 38, 55, 0.92))',
        border: '1px solid rgba(255,255,255,0.14)',
        color: 'var(--ink)',
        fontSize: Math.max(16, Math.round(size * 0.34)),
        fontWeight: 800,
        flex: '0 0 auto',
      }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : avatarEmoji ? (
        <span style={{ lineHeight: 1 }}>{avatarEmoji}</span>
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

function agentSearchText(agent) {
  const profile = agent.profile || {};
  return [
    agent.agentId,
    agent.promptId,
    profile.displayName,
    profile.roleTitle,
    profile.headline,
    profile.tone,
    profile.routingBias,
    ...(profile.quirks || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function timelineEntryKey(entry, index) {
  return [
    index,
    entry?.type || entry?.tool || 'entry',
    entry?.phase || '',
    entry?.surface || '',
    entry?.roomId || '',
    entry?.conversationId || '',
    entry?.createdAt || '',
  ].join('|');
}

function labelAgent(selectedAgent, agents, agentId) {
  if (!agentId) return 'Unknown';
  if (selectedAgent?.agentId === agentId) return selectedAgent.profile?.displayName || agentId;
  const match = (agents || []).find((agent) => agent.agentId === agentId);
  return match?.profile?.displayName || agentId;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function formatConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
}
