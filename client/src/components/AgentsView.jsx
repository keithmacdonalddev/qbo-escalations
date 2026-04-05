import { useCallback, useEffect, useMemo, useState } from 'react';
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

const PROFILE_FIELDS = [
  ['displayName', 'Display Name'],
  ['roleTitle', 'Job / Role'],
  ['headline', 'Headline'],
  ['tone', 'Tone'],
  ['conversationalStyle', 'Conversational Style'],
  ['boundaries', 'Boundaries'],
  ['initiativeLevel', 'Initiative Level'],
  ['socialStyle', 'Social Style'],
  ['communityStyle', 'Community Style'],
  ['selfImprovementStyle', 'Self-Improvement Style'],
  ['soul', 'Soul'],
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
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState(agentIdFromRoute);
  const [loading, setLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [currentAgent, setCurrentAgent] = useState(null);
  const [profileDraft, setProfileDraft] = useState(emptyProfile());
  const [promptContent, setPromptContent] = useState('');
  const [promptDraft, setPromptDraft] = useState('');
  const [promptLabel, setPromptLabel] = useState('');
  const [profileSummary, setProfileSummary] = useState('');
  const [timelineFilter, setTimelineFilter] = useState('all');
  const [selectedRelationshipAgentId, setSelectedRelationshipAgentId] = useState(null);
  const [history, setHistory] = useState([]);
  const [promptVersions, setPromptVersions] = useState([]);
  const [previewContent, setPreviewContent] = useState('');

  const loadAgentList = useCallback(async () => {
    const list = await listAgentIdentities();
    setAgents(list);
    const nextSelected = agentIdFromRoute || selectedAgentId || list[0]?.agentId || null;
    setSelectedAgentId(nextSelected);
    return { list, nextSelected };
  }, [agentIdFromRoute, selectedAgentId]);

  const loadSelectedAgent = useCallback(async (id) => {
    if (!id) return;
    const agent = await getAgentIdentity(id);
    setCurrentAgent(agent);
    setProfileDraft(agent.profile || emptyProfile());
    const hist = await getAgentIdentityHistory(id);
    setHistory(hist || []);

    if (agent.promptId) {
      const prompt = await getAgentPrompt(agent.promptId);
      setPromptContent(prompt.content || '');
      setPromptDraft(prompt.content || '');
      const versions = await listAgentPromptVersions(agent.promptId);
      setPromptVersions(versions || []);
    } else {
      setPromptContent('');
      setPromptDraft('');
      setPromptVersions([]);
    }
    setPreviewContent('');
    setSelectedRelationshipAgentId(null);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { nextSelected } = await loadAgentList();
        if (active && nextSelected) {
          await loadSelectedAgent(nextSelected);
        }
      } catch (err) {
        toast.error(err?.message || 'Failed to load agents');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadAgentList, loadSelectedAgent, toast]);

  useEffect(() => {
    if (!agentIdFromRoute || agentIdFromRoute === selectedAgentId) return;
    setSelectedAgentId(agentIdFromRoute);
    loadSelectedAgent(agentIdFromRoute).catch((err) => {
      toast.error(err?.message || 'Failed to load agent');
    });
  }, [agentIdFromRoute, selectedAgentId, loadSelectedAgent, toast]);

  const selectedAgent = useMemo(() => {
    if (currentAgent && currentAgent.agentId === selectedAgentId) return currentAgent;
    return agents.find((agent) => agent.agentId === selectedAgentId) || null;
  }, [agents, currentAgent, selectedAgentId]);

  const hasProfileChanges = useMemo(() => {
    return JSON.stringify(profileDraft) !== JSON.stringify(selectedAgent?.profile || emptyProfile());
  }, [profileDraft, selectedAgent]);

  const hasPromptChanges = promptDraft !== promptContent;
  const improvementTimeline = useMemo(() => {
    const base = (history || []).filter((entry) => (
      [
        'relationship-learned',
        'relationship-support',
        'relationship-deference',
        'continuity-learned',
        'correction-learned',
        'relationship-adjustment',
        'tool-usage',
        'prompt-edit',
        'prompt-restore',
        'profile-edit',
      ].includes(entry.type)
    ));
    if (timelineFilter === 'all') return base;
    if (timelineFilter === 'relationships') {
      return base.filter((entry) => entry.type.startsWith('relationship-'));
    }
    if (timelineFilter === 'learning') {
      return base.filter((entry) => ['continuity-learned', 'correction-learned'].includes(entry.type));
    }
    if (timelineFilter === 'tools') {
      return base.filter((entry) => entry.type === 'tool-usage');
    }
    if (timelineFilter === 'edits') {
      return base.filter((entry) => ['prompt-edit', 'prompt-restore', 'profile-edit', 'relationship-adjustment'].includes(entry.type));
    }
    return base;
  }, [history, timelineFilter]);
  const selectedRelationship = useMemo(() => {
    if (!selectedRelationshipAgentId || !selectedAgent) return null;
    const allRelationships = selectedAgent.relationships?.map?.all || [];
    return allRelationships.find((item) => item.otherAgentId === selectedRelationshipAgentId) || null;
  }, [selectedAgent, selectedRelationshipAgentId]);
  const relationshipTimeline = useMemo(() => {
    if (!selectedRelationshipAgentId) return [];
    const relationshipEntries = (history || []).filter((entry) => (
      entry?.metadata?.otherAgentId === selectedRelationshipAgentId
    ));
    const relationshipNotes = (selectedAgent?.relationships?.notes || [])
      .filter((note) => note.otherAgentId === selectedRelationshipAgentId)
      .map((note, index) => ({
        type: `note:${note.kind || 'dynamic'}`,
        summary: note.summary,
        createdAt: note.updatedAt,
        key: `note-${selectedRelationshipAgentId}-${index}`,
      }));
    return [...relationshipEntries, ...relationshipNotes]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 16);
  }, [history, selectedAgent, selectedRelationshipAgentId]);

  async function handleSelectAgent(nextId) {
    setSelectedAgentId(nextId);
    window.location.hash = `#/agents/${nextId}`;
    try {
      await loadSelectedAgent(nextId);
    } catch (err) {
      toast.error(err?.message || 'Failed to load agent');
    }
  }

  async function handleSaveProfile() {
    if (!selectedAgentId || !hasProfileChanges) return;
    setProfileSaving(true);
    try {
      const agent = await updateAgentIdentity(selectedAgentId, profileDraft, profileSummary);
      setCurrentAgent(agent);
      setAgents((current) => current.map((item) => item.agentId === selectedAgentId ? agent : item));
      setProfileSummary('');
      setHistory(await getAgentIdentityHistory(selectedAgentId));
      toast.success('Agent profile saved');
    } catch (err) {
      toast.error(err?.message || 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleSavePrompt() {
    if (!selectedAgent?.promptId || !hasPromptChanges) return;
    setPromptSaving(true);
    try {
      await updateAgentPrompt(selectedAgent.promptId, promptDraft, promptLabel);
      setPromptContent(promptDraft);
      setPromptLabel('');
      setPromptVersions(await listAgentPromptVersions(selectedAgent.promptId));
      const refreshedAgent = await getAgentIdentity(selectedAgentId);
      setCurrentAgent(refreshedAgent);
      setHistory(await getAgentIdentityHistory(selectedAgentId));
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
      const content = await getAgentPromptVersion(selectedAgent.promptId, ts);
      setPreviewContent(content || '');
    } catch (err) {
      toast.error(err?.message || 'Failed to load version preview');
    }
  }

  async function handleRestoreVersion(ts) {
    if (!selectedAgent?.promptId) return;
    try {
      await restoreAgentPromptVersion(selectedAgent.promptId, ts);
      await loadSelectedAgent(selectedAgentId);
      setHistory(await getAgentIdentityHistory(selectedAgentId));
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
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Agents</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          Persistent profiles, lived continuity, editable prompts, and revision history for the people behind each assistant.
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 'var(--sp-6)', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          {agents.map((agent) => (
            <button
              key={agent.agentId}
              type="button"
              className={`card card-compact card-clickable${selectedAgentId === agent.agentId ? ' is-selected' : ''}`}
              style={{
                textAlign: 'left',
                border: selectedAgentId === agent.agentId ? '1px solid var(--accent)' : undefined,
                background: selectedAgentId === agent.agentId ? 'var(--accent-subtle)' : undefined,
              }}
              onClick={() => handleSelectAgent(agent.agentId)}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr', gap: 'var(--sp-3)', alignItems: 'center' }}>
                <AgentIdentityAvatar profile={agent.profile} fallbackLabel={agent.agentId} size={44} />
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{agent.profile?.displayName || agent.agentId}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)', marginTop: '4px' }}>
                    {agent.profile?.roleTitle || 'Agent'}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: '8px' }}>
                    {agent.profile?.headline}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {selectedAgent && (
          <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
            <section className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', alignItems: 'center' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 'var(--sp-4)', alignItems: 'center' }}>
                  <AgentIdentityAvatar profile={profileDraft} fallbackLabel={selectedAgent.agentId} size={72} />
                  <div>
                    <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{selectedAgent.profile?.displayName}</h2>
                    <div className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginTop: '4px' }}>
                      {selectedAgent.profile?.roleTitle}
                    </div>
                  </div>
                </div>
                <button type="button" className="btn btn-primary" onClick={handleSaveProfile} disabled={!hasProfileChanges || profileSaving}>
                  {profileSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>

              <div className="card card-compact" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 'var(--text-md)' }}>Avatar</h3>
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginTop: '4px' }}>
                    They can keep an emoji, paste a direct image URL from the internet, or describe the vibe they want the avatar tools to generate.
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '96px repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)', alignItems: 'start' }}>
                  <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--sp-2)' }}>
                    <AgentIdentityAvatar profile={profileDraft} fallbackLabel={selectedAgent.agentId} size={96} />
                    <span className="text-secondary" style={{ fontSize: 'var(--text-xs)' }}>
                      {profileDraft.avatarSource || 'manual'}
                    </span>
                  </div>
                  <label style={{ display: 'grid', gap: '6px' }}>
                    <span className="eyebrow">Image URL</span>
                    <input
                      type="text"
                      value={profileDraft.avatarUrl || ''}
                      onChange={(e) => setProfileDraft((current) => ({ ...current, avatarUrl: e.target.value }))}
                      placeholder="https://..."
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '6px' }}>
                    <span className="eyebrow">Emoji Fallback</span>
                    <input
                      type="text"
                      value={profileDraft.avatarEmoji || ''}
                      onChange={(e) => setProfileDraft((current) => ({ ...current, avatarEmoji: e.target.value }))}
                      placeholder="⚡"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '6px', gridColumn: '2 / 4' }}>
                    <span className="eyebrow">Avatar Prompt</span>
                    <textarea
                      value={profileDraft.avatarPrompt || ''}
                      onChange={(e) => setProfileDraft((current) => ({ ...current, avatarPrompt: e.target.value }))}
                      rows={3}
                      placeholder="Describe the visual identity they want to generate or search for."
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '6px', gridColumn: '2 / 4' }}>
                    <span className="eyebrow">Avatar Source</span>
                    <input
                      type="text"
                      value={profileDraft.avatarSource || ''}
                      onChange={(e) => setProfileDraft((current) => ({ ...current, avatarSource: e.target.value }))}
                      placeholder="manual, generated, internet, custom..."
                    />
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
                {PROFILE_FIELDS.map(([field, label]) => (
                  <label key={field} style={{ display: 'grid', gap: '6px' }}>
                    <span className="eyebrow">{label}</span>
                    <textarea
                      value={profileDraft[field] || ''}
                      onChange={(e) => setProfileDraft((current) => ({ ...current, [field]: e.target.value }))}
                      rows={field === 'soul' || field === 'headline' ? 3 : 2}
                      style={{ minHeight: field === 'soul' ? 96 : 72 }}
                    />
                  </label>
                ))}
                <label style={{ display: 'grid', gap: '6px', gridColumn: '1 / -1' }}>
                  <span className="eyebrow">Quirks</span>
                  <textarea
                    value={(profileDraft.quirks || []).join('\n')}
                    onChange={(e) => setProfileDraft((current) => ({
                      ...current,
                      quirks: e.target.value.split('\n').map((item) => item.trim()).filter(Boolean),
                    }))}
                    rows={4}
                  />
                </label>
              </div>

              <label style={{ display: 'grid', gap: '6px' }}>
                <span className="eyebrow">Change Summary</span>
                <input
                  type="text"
                  value={profileSummary}
                  onChange={(e) => setProfileSummary(e.target.value)}
                  placeholder="What changed and why?"
                />
              </label>
            </section>

            <section className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Prompt</h2>
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginTop: '4px' }}>
                    Editable system prompt for this agent.
                  </div>
                </div>
                <button type="button" className="btn btn-primary" onClick={handleSavePrompt} disabled={!hasPromptChanges || promptSaving || !selectedAgent.promptId}>
                  {promptSaving ? 'Saving...' : 'Save Prompt'}
                </button>
              </div>

              {selectedAgent.promptId ? (
                <>
                  <label style={{ display: 'grid', gap: '6px' }}>
                    <span className="eyebrow">Prompt Revision Note</span>
                    <input
                      type="text"
                      value={promptLabel}
                      onChange={(e) => setPromptLabel(e.target.value)}
                      placeholder="What changed in this prompt revision?"
                    />
                  </label>
                  <textarea
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    rows={16}
                    style={{ minHeight: 320, fontFamily: 'var(--font-mono, monospace)' }}
                  />
                </>
              ) : (
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                  No dedicated prompt file is mapped to this agent yet.
                </div>
              )}
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-6)' }}>
              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Tools</h2>
                {!(selectedAgent.tools?.available || []).length ? (
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                    No tool manifest is available for this agent yet.
                  </div>
                ) : (
                  (selectedAgent.tools?.available || []).map((tool) => (
                    <div key={tool.name} className="card card-compact" style={{ display: 'grid', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', alignItems: 'center' }}>
                        <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{tool.name}</strong>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {tool.kind}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>{tool.description}</div>
                      <code style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>{tool.params}</code>
                    </div>
                  ))
                )}
              </div>

              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Recent Tool Use</h2>
                {!(selectedAgent.tools?.recentUsage || []).length ? (
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                    No recent tool usage has been recorded for this agent yet.
                  </div>
                ) : (
                  (selectedAgent.tools?.recentUsage || []).slice(0, 12).map((entry, index) => (
                    <div key={`${entry.tool}-${entry.createdAt || index}`} className="card card-compact" style={{ display: 'grid', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', alignItems: 'center' }}>
                        <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{entry.tool}</strong>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                          {formatDate(entry.createdAt)}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>{entry.summary || entry.status}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {entry.surface || 'unknown surface'}
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', color: entry.status === 'error' ? 'var(--danger)' : 'var(--ink-tertiary)' }}>
                          {entry.status || 'unknown'}
                        </span>
                      </div>
                      {entry.error ? (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>{entry.error}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-6)' }}>
              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Self-Improvement Timeline</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                  {[
                    ['all', 'All'],
                    ['relationships', 'Relationships'],
                    ['learning', 'Learning'],
                    ['tools', 'Tools'],
                    ['edits', 'Edits'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={timelineFilter === value ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm'}
                      onClick={() => setTimelineFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {improvementTimeline.length === 0 ? (
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                    No visible self-improvement events have been logged for this agent yet.
                  </div>
                ) : (
                  improvementTimeline.slice(0, 12).map((entry, index) => (
                    <div key={`${entry.type}-${entry.createdAt || index}-improve`} className="card card-compact" style={{ display: 'grid', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                        <strong style={{ fontSize: 'var(--text-sm)' }}>{entry.type}</strong>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                          {formatDate(entry.createdAt)}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{entry.summary}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Relationship Map</h2>
                <RelationshipBucket
                  title="Strongest Ties"
                  items={selectedAgent.relationships?.map?.strongestTies || []}
                  onSelect={setSelectedRelationshipAgentId}
                  selectedAgentId={selectedRelationshipAgentId}
                />
                <RelationshipBucket
                  title="Growing Ties"
                  items={selectedAgent.relationships?.map?.growingTies || []}
                  onSelect={setSelectedRelationshipAgentId}
                  selectedAgentId={selectedRelationshipAgentId}
                />
                <RelationshipBucket
                  title="Needs Repair"
                  items={selectedAgent.relationships?.map?.needsRepair || []}
                  onSelect={setSelectedRelationshipAgentId}
                  selectedAgentId={selectedRelationshipAgentId}
                />
                <RelationshipBucket
                  title="Cooling Off"
                  items={selectedAgent.relationships?.map?.coolingOff || []}
                  onSelect={setSelectedRelationshipAgentId}
                  selectedAgentId={selectedRelationshipAgentId}
                />
              </div>

              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Pair Timeline</h2>
                {!selectedRelationshipAgentId ? (
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                    Select someone from the relationship map to inspect how that connection changed over time.
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', alignItems: 'center' }}>
                      <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                        {selectedAgent.profile?.displayName} <span className="text-secondary">↔</span> {selectedRelationship?.otherDisplayName || labelAgent(selectedAgent, agents, selectedRelationshipAgentId)}
                      </strong>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedRelationshipAgentId(null)}
                      >
                        Clear
                      </button>
                    </div>
                    {selectedRelationship ? (
                      <div className="card card-compact" style={{ display: 'grid', gap: '6px' }}>
                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
                          {selectedRelationship.latestSummary}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                            live {formatConfidence(selectedRelationship.activeConfidence ?? selectedRelationship.confidence)}
                          </span>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                            trend {selectedRelationship.trend || 'stable'}
                          </span>
                        </div>
                      </div>
                    ) : null}
                    {relationshipTimeline.length === 0 ? (
                      <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                        No pair-specific events have been logged yet.
                      </div>
                    ) : (
                      relationshipTimeline.map((entry, index) => (
                        <div key={entry.key || `${entry.type}-${entry.createdAt || index}`} className="card card-compact" style={{ display: 'grid', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                            <strong style={{ fontSize: 'var(--text-sm)' }}>{entry.type}</strong>
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                              {formatDate(entry.createdAt)}
                            </span>
                          </div>
                          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{entry.summary}</div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>

              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Relationships</h2>
                {!(selectedAgent.relationships?.notes || []).length ? (
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                    No relationship memory has been recorded for this agent yet.
                  </div>
                ) : (
                  (selectedAgent.relationships?.notes || []).slice(0, 10).map((note, index) => (
                    <div key={`${note.otherAgentId}-${note.summary}-${index}`} className="card card-compact" style={{ display: 'grid', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', alignItems: 'center' }}>
                        <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{labelAgent(selectedAgent, agents, note.otherAgentId)}</strong>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {note.kind || 'dynamic'}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>{note.summary}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                          {note.strength || 'emerging'} relationship
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                          confidence {formatConfidence(note.confidence)}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                        {note.interactionCount || 1} signal{(note.interactionCount || 1) === 1 ? '' : 's'}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                        {formatDate(note.updatedAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Learning</h2>
                {(selectedAgent.memory?.notes || []).length === 0 ? (
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                    No learned continuity has been recorded for this agent yet.
                  </div>
                ) : (
                  (selectedAgent.memory?.notes || []).slice(0, 10).map((note) => (
                    <div key={note.key} className="card card-compact">
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {note.kind}
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{note.content}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>History</h2>
                {(history || []).slice(0, 12).map((entry, index) => (
                  <div key={`${entry.type}-${entry.createdAt || index}`} className="card card-compact">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                      <strong style={{ fontSize: 'var(--text-sm)' }}>{entry.type}</strong>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                        {formatDate(entry.createdAt)}
                      </span>
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{entry.summary}</div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Activity Log</h2>
                {!(selectedAgent.activity?.entries || []).length ? (
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                    No cross-site activity has been recorded for this agent yet.
                  </div>
                ) : (
                  (selectedAgent.activity?.entries || []).slice(0, 24).map((entry, index) => (
                    <div key={`${entry.type}-${entry.phase}-${entry.createdAt || index}-activity`} className="card card-compact" style={{ display: 'grid', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', alignItems: 'center' }}>
                        <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                          {entry.type}{entry.phase ? ` / ${entry.phase}` : ''}
                        </strong>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                          {formatDate(entry.createdAt)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {entry.surface || 'unknown surface'}
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', color: entry.status === 'error' ? 'var(--danger)' : 'var(--ink-tertiary)' }}>
                          {entry.status || 'unknown'}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{entry.summary}</div>
                      {entry.detail ? (
                        <pre style={{
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontSize: 'var(--text-xs)',
                          color: 'var(--ink-secondary)',
                          background: 'var(--surface-subtle)',
                          borderRadius: '12px',
                          padding: '10px 12px',
                        }}
                        >
                          {entry.detail}
                        </pre>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 'var(--sp-6)' }}>
              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Prompt Versions</h2>
                {promptVersions.length === 0 ? (
                  <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                    No saved prompt versions yet.
                  </div>
                ) : (
                  promptVersions.map((version) => (
                    <div key={version.ts} className="card card-compact" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{formatDate(version.ts)}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>{version.label || 'No revision note'}</div>
                      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => handlePreviewVersion(version.ts)}>Preview</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleRestoreVersion(version.ts)}>Restore</button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Version Preview</h2>
                <textarea value={previewContent} readOnly rows={18} style={{ minHeight: 360, fontFamily: 'var(--font-mono, monospace)' }} />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function labelAgent(selectedAgent, agents, agentId) {
  if (!agentId) return 'Unknown';
  if (selectedAgent?.agentId === agentId) {
    return selectedAgent.profile?.displayName || agentId;
  }
  const match = (agents || []).find((agent) => agent.agentId === agentId);
  return match?.profile?.displayName || agentId;
}

function formatConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.50';
  return numeric.toFixed(2);
}

function RelationshipBucket({ title, items, onSelect, selectedAgentId }) {
  return (
    <div style={{ display: 'grid', gap: '6px' }}>
      <div className="eyebrow">{title}</div>
      {!(items || []).length ? (
        <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          None yet.
        </div>
      ) : (
        (items || []).map((item) => (
          <button
            key={`${title}-${item.otherAgentId}`}
            type="button"
            className="card card-compact card-clickable"
            style={{
              display: 'grid',
              gap: '6px',
              textAlign: 'left',
              border: selectedAgentId === item.otherAgentId ? '1px solid var(--accent)' : undefined,
              background: selectedAgentId === item.otherAgentId ? 'var(--accent-subtle)' : undefined,
            }}
            onClick={() => onSelect?.(item.otherAgentId)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
              <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{item.otherDisplayName}</strong>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                {item.activeStrength || item.strongestStrength}
              </span>
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>{item.latestSummary}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                live {formatConfidence(item.activeConfidence ?? item.confidence)}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                {item.totalSignals || 0} signals
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                trend {item.trend || 'stable'}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                peak {formatConfidence(item.confidence)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                {item.reciprocity || 'unknown'}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                reverse {formatConfidence(item.reciprocalConfidence)}
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

function AgentIdentityAvatar({ profile, fallbackLabel, size = 56 }) {
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
        borderRadius: Math.round(size * 0.34),
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(145deg, rgba(103, 213, 255, 0.22), rgba(40, 48, 86, 0.92))',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 14px 34px rgba(0,0,0,0.24)',
        color: 'var(--ink)',
        fontSize: Math.max(18, Math.round(size * 0.34)),
        fontWeight: 800,
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : avatarEmoji ? (
        <span style={{ lineHeight: 1 }}>{avatarEmoji}</span>
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
