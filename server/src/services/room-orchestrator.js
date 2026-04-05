'use strict';

const { randomUUID } = require('crypto');
const { getAgent, getAllAgents, getAgentsForMessage } = require('./room-agents/registry');
const { shouldProfileJoinConversation } = require('./room-agents/agent-profiles');
const { buildAgentContext } = require('./room-context-builder');
const { getAgentIdentity, recordAgentNudge } = require('./agent-identity-service');
const { runAgentToolLoop } = require('./agent-tool-loop');
const { getRoom } = require('./chat-room-service');
const { startChatOrchestration } = require('./chat-orchestrator');
const { logUsage } = require('../lib/usage-writer');
const { DEFAULT_CHAT_RUNTIME_SETTINGS } = require('../lib/chat-settings');

/**
 * Parse @mentions from a message string.
 * Supports hyphenated agent IDs (e.g., @image-analyst).
 *
 * @param {string} text
 * @returns {string[]} Array of lowercased agent IDs
 */
function parseMentions(text) {
  if (!text || typeof text !== 'string') return [];
  // Create regex inside function to avoid lastIndex persistence with /g flag
  const re = /@([a-z0-9-]+)\b/gi;
  const mentions = [];
  const seen = new Set();
  let match;
  while ((match = re.exec(text)) !== null) {
    const id = match[1].toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      mentions.push(id);
    }
  }
  return mentions;
}

/**
 * Group agents by priority into execution stages.
 * Agents with the same priority run in parallel; different priorities run sequentially.
 *
 * @param {Object[]} agents - Sorted array of agent definitions
 * @returns {Object[][]} Array of stages, each stage is an array of agents
 */
function groupIntoStages(agents) {
  if (!agents || agents.length === 0) return [];
  const stages = [];
  let currentPriority = null;
  let currentStage = [];

  for (const agent of agents) {
    const priority = agent.priority ?? 100;
    if (priority !== currentPriority) {
      if (currentStage.length > 0) stages.push(currentStage);
      currentStage = [agent];
      currentPriority = priority;
    } else {
      currentStage.push(agent);
    }
  }
  if (currentStage.length > 0) stages.push(currentStage);
  return stages;
}

function getRelationshipItem(identity, otherAgentId) {
  const all = Array.isArray(identity?.relationships?.map?.all) ? identity.relationships.map.all : [];
  return all.find((item) => item.otherAgentId === otherAgentId) || null;
}

function computeRelationshipCoordinationScore(agentId, peerIds, identityById) {
  const identity = identityById.get(agentId);
  if (!identity || !Array.isArray(peerIds) || peerIds.length === 0) return 0;
  let score = 0;
  for (const peerId of peerIds) {
    if (!peerId || peerId === agentId) continue;
    const item = getRelationshipItem(identity, peerId);
    if (!item) continue;
    score += Number(item.activeConfidence || item.confidence || 0);
    if (item.reciprocity === 'mutual') score += 0.18;
    if (item.trend === 'warming') score += 0.12;
    if (item.needsRepair) score -= 0.2;
  }
  return score;
}

function shouldRelationshipJoinConversation(agentId, selectedIds, identityById) {
  const identity = identityById.get(agentId);
  if (!identity || !selectedIds || selectedIds.size === 0) return false;
  let strongestTie = null;
  for (const selectedId of selectedIds) {
    const item = getRelationshipItem(identity, selectedId);
    if (!item) continue;
    if (!strongestTie || (Number(item.activeConfidence || item.confidence || 0) > Number(strongestTie.activeConfidence || strongestTie.confidence || 0))) {
      strongestTie = item;
    }
  }
  if (!strongestTie) return false;
  if (strongestTie.needsRepair) return false;
  if (strongestTie.reciprocity === 'mutual' && (strongestTie.activeStrength === 'established' || strongestTie.trend === 'warming')) {
    return true;
  }
  return strongestTie.activeStrength === 'established' && Number(strongestTie.activeConfidence || 0) >= 0.72;
}

function normalizeMessageText(value) {
  return String(value || '').trim().toLowerCase();
}

function wantsMoreParticipation(userMessage, recentMessages) {
  const directText = normalizeMessageText(userMessage);
  const recentUserText = Array.isArray(recentMessages)
    ? recentMessages
        .filter((msg) => msg?.role === 'user')
        .slice(-3)
        .map((msg) => normalizeMessageText(msg.content))
        .join(' \n ')
    : '';
  const haystack = `${directText}\n${recentUserText}`;

  if (!haystack.trim()) return false;

  return [
    /jump in/,
    /chime in/,
    /keep talking/,
    /don't stay quiet/,
    /dont stay quiet/,
    /don't be quiet/,
    /dont be quiet/,
    /participat/,
    /conversation died/,
    /keeping it alive/,
    /everyone here/,
    /hear from/,
    /wake up/,
    /sleep/,
    /nudge/,
  ].some((pattern) => pattern.test(haystack));
}

function buildParticipationCounts(messages) {
  const counts = new Map();
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (msg?.role !== 'assistant' || !msg.agentId) continue;
    counts.set(msg.agentId, (counts.get(msg.agentId) || 0) + 1);
  }
  return counts;
}

function normalizeContentFingerprint(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 24)
    .join(' ');
}

function buildRoomQualityState(messages = []) {
  const recentAssistantMessages = (Array.isArray(messages) ? messages : [])
    .filter((msg) => msg?.role === 'assistant' && msg?.agentId && msg?.content)
    .slice(-8);
  const counts = buildParticipationCounts(recentAssistantMessages);
  const overtalkingAgentIds = new Set();
  const fingerprints = recentAssistantMessages.map((msg) => ({
    agentId: msg.agentId,
    fingerprint: normalizeContentFingerprint(msg.content),
  })).filter((entry) => entry.fingerprint);

  for (const [agentId, count] of counts.entries()) {
    if (count >= 3 && recentAssistantMessages.length >= 4) {
      overtalkingAgentIds.add(agentId);
    }
  }

  let repeatedPairs = 0;
  for (let i = 1; i < fingerprints.length; i += 1) {
    if (fingerprints[i].fingerprint && fingerprints[i].fingerprint === fingerprints[i - 1].fingerprint) {
      repeatedPairs += 1;
    }
  }

  const uniqueAssistantVoices = new Set(recentAssistantMessages.map((msg) => msg.agentId));
  const roomIsLooping = repeatedPairs >= 1 || (uniqueAssistantVoices.size <= 2 && recentAssistantMessages.length >= 5);

  return {
    assistantMessages: recentAssistantMessages,
    participationCounts: counts,
    overtalkingAgentIds,
    uniqueAssistantVoices,
    repeatedPairs,
    roomIsLooping,
  };
}

function shouldSuppressForQuality(agentId, qualityState, { mentions = [], candidates = [] } = {}) {
  if (!agentId || !qualityState) return false;
  if (Array.isArray(mentions) && mentions.includes(agentId)) return false;
  if ((candidates || []).length <= 1) return false;
  if (!qualityState.overtalkingAgentIds.has(agentId)) return false;
  return qualityState.roomIsLooping || qualityState.uniqueAssistantVoices.size <= 2;
}

function chooseNudgePlans({ selectedAgents, activeAgentIds, recentMessages, identityById }) {
  const selectedIds = new Set(selectedAgents.map((agent) => agent.id));
  const quietAgentIds = activeAgentIds.filter((id) => !selectedIds.has(id));
  if (quietAgentIds.length === 0 || selectedAgents.length === 0) return [];

  const participationCounts = buildParticipationCounts(recentMessages);
  const sortedSenders = [...selectedAgents].sort((a, b) => {
    const aCount = participationCounts.get(a.id) || 0;
    const bCount = participationCounts.get(b.id) || 0;
    if (aCount !== bCount) return bCount - aCount;
    const aCoordination = computeRelationshipCoordinationScore(a.id, quietAgentIds, identityById);
    const bCoordination = computeRelationshipCoordinationScore(b.id, quietAgentIds, identityById);
    return bCoordination - aCoordination;
  });

  return quietAgentIds.map((quietAgentId, index) => {
    const sender = sortedSenders[index % sortedSenders.length];
    const senderName = sender?.name || sender?.id || 'Another agent';
    const quietName = getAgent(quietAgentId)?.name || quietAgentId;
    return {
      fromAgentId: sender.id,
      toAgentId: quietAgentId,
      note: `${senderName} wants ${quietName} to join in if they have something real to add.`,
    };
  });
}

/**
 * Run the Router Agent to classify which agents should respond.
 *
 * @param {string} userMessage
 * @param {Object[]} availableAgents
 * @param {Object} opts
 * @param {Map} opts.activeCleanups - Shared cleanup map for cancellation
 * @param {Function} opts.isCancelled - Returns true if parent orchestration was cancelled
 * @returns {Promise<string[]>} Array of agent IDs the router selected
 */
async function runRouterAgent(userMessage, availableAgents, room, { activeCleanups, isCancelled }) {
  const fallback = availableAgents.map(a => a.id);

  // Check cancellation before doing any work
  if (isCancelled()) return fallback;

  const routerDef = getAgent('__router');
  if (!routerDef) return fallback;

  const prompt = routerDef.buildPrompt(userMessage, availableAgents, room);

  return new Promise((resolve, reject) => {
    let fullResponse = '';
    let settled = false;

    function settle(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      activeCleanups.delete('__router');
      fn(value);
    }

    const timeout = setTimeout(() => {
      // Router timed out — fall back to all agents
      settle(resolve, fallback);
    }, 15000);

    const providerCancel = startChatOrchestration({
      mode: 'single',
      primaryProvider: routerDef.preferredProvider,
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: 'You are a routing classifier. Return only valid JSON.',
      onChunk: ({ text }) => { fullResponse += text; },
      onDone: (data) => {
        // If cancelled during execution, reject early
        if (isCancelled()) {
          settle(reject, new Error('Router cancelled'));
          return;
        }

        const responseText = data.fullResponse || fullResponse;
        try {
          // Strip markdown fences if present
          const cleaned = responseText.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed.agents) && parsed.agents.length > 0) {
            // Validate returned IDs against available agents
            const validIds = new Set(availableAgents.map(a => a.id));
            const selected = parsed.agents.filter(id => validIds.has(id));
            settle(resolve, selected.length > 0 ? selected : fallback);
            return;
          }
        } catch {
          // Parse failed — fall back to all agents
        }
        settle(resolve, fallback);
      },
      onError: () => {
        // If cancelled during execution, reject early
        if (isCancelled()) {
          settle(reject, new Error('Router cancelled'));
          return;
        }

        settle(resolve, fallback);
      },
    });

    // Register a cancellation wrapper that: kills the provider subprocess,
    // clears the timeout, and rejects the Promise so it fully settles.
    activeCleanups.set('__router', () => {
      try { providerCancel(); } catch { /* ignore */ }
      settle(reject, new Error('Router cancelled'));
    });
  });
}

/**
 * Start room orchestration: route a user message to one or more agents,
 * stream their responses via callbacks, and aggregate telemetry.
 *
 * Pattern follows chat-orchestrator.js but adds multi-agent coordination
 * with priority-based staging.
 *
 * @param {Object} params
 * @returns {Function} cancel() — idempotent cancellation function
 */
function startRoomOrchestration({
  room,
  userMessage,
  mentions,
  parsedImageContext,  // Parsed image data for image-analyst agent
  onRoomStart,
  onAgentStart,
  onChunk,
  onThinkingChunk,
  onAgentDone,
  onAgentError,
  onRoomDone,
  onError,
  onActions,  // workspace agent action results
  onStatus,   // workspace agent status updates
}) {
  const roomRequestId = randomUUID();
  let cancelled = false;
  const activeCleanups = new Map();
  const agentUsages = [];
  const startedAt = Date.now();

  function cancel() {
    if (cancelled) return;
    cancelled = true;
    for (const [, cleanupFn] of activeCleanups) {
      try { cleanupFn(); } catch { /* ignore */ }
    }
    activeCleanups.clear();
  }

  (async () => {
    try {
      // --- 1. Resolve which agents should respond ---
      const mode = room.settings?.orchestrationMode || 'auto';
      const activeAgentIds = room.activeAgents || [];
      let selectedAgents = [];
      const identityById = new Map();

      for (const id of activeAgentIds) {
        try {
          const identity = await getAgentIdentity(id);
          if (identity) identityById.set(id, identity);
        } catch {
          // Best-effort only. Static defaults still exist.
        }
      }

      if (Array.isArray(mentions) && mentions.length > 0) {
        // Explicit @mentions — use only those agents
        for (const id of mentions) {
          const agent = getAgent(id);
          if (agent && !agent.internal && activeAgentIds.includes(id)) {
            selectedAgents.push(agent);
          }
        }
      }

      if (selectedAgents.length === 0 && Array.isArray(mentions) && mentions.length > 0) {
        // Explicit @mentions were provided but none resolved to valid active agents
        onError?.({
          code: 'INVALID_MENTIONS',
          message: `No matching active agents found for mentions: ${mentions.join(', ')}`,
        });
        return;
      }

      if (selectedAgents.length === 0) {
        if (mode === 'mentioned-only') {
          onError?.({ code: 'NO_AGENTS', message: 'No agents mentioned. Use @agent-name to mention an agent in mentioned-only mode.' });
          return;
        }

        // Get candidate agents from the registry
        const candidates = getAgentsForMessage(userMessage, [], room);

        if (candidates.length === 0) {
          onError?.({ code: 'NO_AGENTS', message: 'No active agents configured for this room.' });
          return;
        }

        if (mode === 'auto' && candidates.length > 1) {
          // Use the Router Agent to pick the best agents
          const routerResult = await runRouterAgent(userMessage, candidates, room, {
            activeCleanups,
            isCancelled: () => cancelled,
          });
          if (cancelled) return;
          selectedAgents = routerResult
            .map(id => getAgent(id))
            .filter(a => a && !a.internal);
          // Ensure at least one agent
          if (selectedAgents.length === 0) selectedAgents = candidates;
        } else {
          selectedAgents = candidates;
        }
      }

      if (cancelled) return;

      // --- Personality-driven participation layer ---
      // Profiles can encourage an agent to join when the room is in a more
      // social or relational mode, without forcing every agent to answer.
      const recentMessages = Array.isArray(room.messages) ? room.messages.slice(-8) : [];
      const roomState = { parsedImageContext, roomMemory: room.memory || null };
      const qualityState = buildRoomQualityState(room.messages || []);
      const nudgedAgentIds = new Set();
      const selectedIds = new Set(selectedAgents.map(a => a.id));
      for (const agent of getAllAgents()) {
        if (selectedIds.has(agent.id)) continue;
        if (!activeAgentIds.includes(agent.id)) continue;
        if (
          shouldProfileJoinConversation(agent.id, {
            userMessage,
            recentMessages,
            roomMemory: room.memory || null,
            profile: identityById.get(agent.id)?.profile || agent.profile || null,
          })
          || shouldRelationshipJoinConversation(agent.id, selectedIds, identityById)
        ) {
          selectedAgents.push(agent);
          selectedIds.add(agent.id);
        }
      }

      if (qualityState.roomIsLooping) {
        onStatus?.({
          type: 'quality_guard',
          phase: 'coordination',
          message: qualityState.overtalkingAgentIds.size > 0
            ? 'Room quality guard is reducing repetition and making space for fresher voices.'
            : 'Room quality guard detected a loop and is pushing for a fresher angle.',
          repeatedPairs: qualityState.repeatedPairs,
          overtalkingAgentIds: [...qualityState.overtalkingAgentIds],
        });
      }

      const shouldAutoEncourage = wantsMoreParticipation(userMessage, recentMessages)
        && activeAgentIds.length > selectedAgents.length;

      if (shouldAutoEncourage) {
        const nudgePlans = chooseNudgePlans({
          selectedAgents,
          activeAgentIds,
          recentMessages,
          identityById,
        });

        for (const plan of nudgePlans) {
          nudgedAgentIds.add(plan.toAgentId);
          try {
            await recordAgentNudge(plan.fromAgentId, plan.toAgentId, plan.note, {
              surface: 'rooms',
              roomId: room._id ? room._id.toString() : null,
            });
          } catch {
            // Best effort only. Room flow should continue even if nudge persistence fails.
          }

          onStatus?.({
            agentId: plan.fromAgentId,
            type: 'social_nudge',
            phase: 'coordination',
            message: `${getAgent(plan.fromAgentId)?.name || plan.fromAgentId} nudged ${getAgent(plan.toAgentId)?.name || plan.toAgentId} to join the room if they have something real to add.`,
            fromAgentId: plan.fromAgentId,
            toAgentId: plan.toAgentId,
          });
        }
      }

      const selectedIdList = selectedAgents.map((agent) => agent.id);
      selectedAgents.sort((a, b) => {
        const priorityDiff = (a.priority || 100) - (b.priority || 100);
        if (priorityDiff !== 0) return priorityDiff;
        const aScore = computeRelationshipCoordinationScore(a.id, selectedIdList, identityById);
        const bScore = computeRelationshipCoordinationScore(b.id, selectedIdList, identityById);
        return bScore - aScore;
      });

      if (selectedAgents.length > 1) {
        const unsuppressed = selectedAgents.filter((agent) => !shouldSuppressForQuality(agent.id, qualityState, {
          mentions,
          candidates: selectedAgents,
        }));
        if (unsuppressed.length > 0) {
          selectedAgents = unsuppressed;
          selectedIds.clear();
          for (const agent of selectedAgents) {
            selectedIds.add(agent.id);
          }
        }
      }

      // --- Auto-trigger agents via shouldRespond ---
      // Agents like image-analyst auto-activate when their shouldRespond
      // returns true (e.g., when parsedImageContext is present), even if
      // they weren't otherwise selected by the router or mention system.
      for (const agent of getAllAgents()) {
        if (selectedIds.has(agent.id)) continue;
        if (typeof agent.shouldRespond === 'function' && agent.shouldRespond(userMessage, roomState)) {
          selectedAgents.push(agent);
          selectedIds.add(agent.id);
        }
      }

      // Sort by priority and group into stages
      selectedAgents.sort((a, b) => (a.priority || 100) - (b.priority || 100));
      const stages = groupIntoStages(selectedAgents);

      // --- 2. Emit room_start ---
      onRoomStart?.({
        roomId: room._id ? room._id.toString() : null,
        requestId: roomRequestId,
        agents: selectedAgents.map(a => ({
          id: a.id,
          name: a.name,
          shortName: a.shortName,
          icon: a.icon || null,
          color: a.color || null,
        })),
      });

      // --- 3. Execute stages sequentially, agents within a stage in parallel ---
      for (let i = 0; i < stages.length; i++) {
        if (cancelled) return;

        // Re-fetch room between stages so later agents see earlier responses
        if (i > 0 && room._id) {
          const freshRoom = await getRoom(room._id);
          if (freshRoom) room = freshRoom;
        }

        await Promise.all(stages[i].map(agent => {
          if (cancelled) return Promise.resolve();
          return runAgent(agent);
        }));
      }

      if (cancelled) return;

      // --- 3b. Reaction rounds ---
      // Agents that did NOT fire in round 0 may react if their shouldRespond()
      // returns true after seeing round 0 output. Hard cap at 3 total rounds.
      const maxRounds = Math.min(
        Math.max(room.settings?.maxRoundsPerTurn ?? 1, nudgedAgentIds.size > 0 ? 2 : 1),
        3
      );

      if (maxRounds > 1) {
        // Track which agents ran in round 0
        const respondedInRound0 = new Set(selectedAgents.map((a) => a.id));
        const allPublicAgents = getAllAgents();

        for (let roundIdx = 1; roundIdx < maxRounds; roundIdx++) {
          if (cancelled) break;

          // Re-fetch room so reaction agents see round 0 messages
          let freshRoom = null;
          if (room._id) {
            freshRoom = await getRoom(room._id);
            if (freshRoom) room = freshRoom;
          }

          const latestMessages = (freshRoom || room).messages || [];
          const roomState = { parsedImageContext, roomMemory: room.memory || null };
          const roundQualityState = buildRoomQualityState(latestMessages);

          if (roundQualityState.roomIsLooping) {
            onStatus?.({
              type: 'quality_guard',
              phase: 'reaction',
              message: roundQualityState.overtalkingAgentIds.size > 0
                ? 'Reaction round is steering away from repeated voices so the room does not stall.'
                : 'Reaction round detected a loop and is favoring fresher angles.',
              repeatedPairs: roundQualityState.repeatedPairs,
              overtalkingAgentIds: [...roundQualityState.overtalkingAgentIds],
              round: roundIdx + 1,
            });
          }

          // Agents eligible for reaction: active, not in round 0, shouldRespond() true
          const reactionCandidates = allPublicAgents.filter((agent) => {
            if (respondedInRound0.has(agent.id)) return false;
            if (!activeAgentIds.includes(agent.id)) return false;
            const relationshipBoost = shouldRelationshipJoinConversation(agent.id, respondedInRound0, identityById);
            const wasNudged = nudgedAgentIds.has(agent.id);
            if (shouldSuppressForQuality(agent.id, roundQualityState, { mentions, candidates: allPublicAgents })) {
              return false;
            }
            if (typeof agent.shouldRespond !== 'function') {
              return relationshipBoost || wasNudged;
            }
            if (!agent.shouldRespond(latestMessages, roomState) && !relationshipBoost && !wasNudged) return false;
            const strongestScore = computeRelationshipCoordinationScore(agent.id, [...respondedInRound0], identityById);
            return strongestScore > -0.15 || wasNudged;
          });

          if (reactionCandidates.length === 0) break;

          await Promise.all(reactionCandidates.map((agent) => {
            if (cancelled) return Promise.resolve();
            return runAgent(agent);
          }));
        }
      }

      if (cancelled) return;

      // --- 4. Emit room_done ---
      const totalUsage = aggregateUsage(agentUsages);
      onRoomDone?.({
        roomId: room._id ? room._id.toString() : null,
        requestId: roomRequestId,
        agents: agentUsages.map(u => ({
          agentId: u.agentId,
          agentName: u.agentName,
          status: u.status,
          latencyMs: u.latencyMs,
          usage: u.usage,
        })),
        totalUsage,
        elapsedMs: Date.now() - startedAt,
      });

    } catch (err) {
      if (cancelled) return;
      onError?.({
        code: err.code || 'ORCHESTRATION_FAILED',
        message: err.message || 'Room orchestration failed',
      });
    }
  })();

  /**
   * Run a single agent: build context, call startChatOrchestration, pipe callbacks.
   */
  async function runAgent(agent) {
    const agentStartedAt = Date.now();

    onAgentStart?.({
      agentId: agent.id,
      agentName: agent.name,
      provider: agent.preferredProvider,
    });

    // --- Tool-executing agents (workspace) ---
    if (agent.useActionFlow && typeof agent.executeWithActions === 'function') {
      try {
        const contextResult = await buildAgentContext(agent, room, { parsedImageContext });
        if (cancelled) return;

        return new Promise((resolve) => {
          let settled = false;
          let pass1Request = null;
          let pass2Cleanup = null;

          function settleAgent() {
            if (settled) return;
            settled = true;
            activeCleanups.delete(agent.id);
            resolve();
          }

          const cancelWorkspaceAgent = () => {
            try { pass1Request?.abort?.(`Room request ${roomRequestId} cancelled`); } catch { /* ignore */ }
            pass1Request = null;
            try { pass2Cleanup?.(); } catch { /* ignore */ }
            pass2Cleanup = null;
            settleAgent();
          };

          activeCleanups.set(agent.id, cancelWorkspaceAgent);

          agent.executeWithActions(
            { systemPrompt: contextResult.systemPrompt, messagesForModel: contextResult.messagesForModel },
            {
              onChunk: ({ text }) => {
                if (cancelled || settled) return;
                onChunk?.({ agentId: agent.id, provider: agent.preferredProvider, text });
              },
              onThinking: ({ thinking, provider, phase }) => {
                if (cancelled || settled) return;
                onThinkingChunk?.({ agentId: agent.id, provider: provider || agent.preferredProvider, thinking });
              },
              onActions: (data) => {
                if (cancelled || settled) return;
                onActions?.({ agentId: agent.id, ...data });
              },
              onStatus: (data) => {
                if (cancelled || settled) return;
                onStatus?.({ agentId: agent.id, ...data });
              },
              onProviderError: (data) => {
                if (cancelled || settled) return;
                onStatus?.({ agentId: agent.id, type: 'provider_error', ...data });
              },
              onFallback: (data) => {
                if (cancelled || settled) return;
                onStatus?.({ agentId: agent.id, type: 'fallback', ...data });
              },
              onDone: (data) => {
                if (cancelled || settled) return;
                const latencyMs = Date.now() - agentStartedAt;
                const agentUsage = data.usage ? {
                  inputTokens: data.usage.inputTokens || 0,
                  outputTokens: data.usage.outputTokens || 0,
                  totalTokens: data.usage.totalTokens || 0,
                  model: data.modelUsed || agent.preferredProvider,
                  totalCostMicros: data.usage.totalCostMicros || 0,
                  usageAvailable: true,
                } : { usageAvailable: false };

                agentUsages.push({
                  agentId: agent.id,
                  agentName: agent.name,
                  status: 'ok',
                  latencyMs,
                  usage: agentUsage.usageAvailable ? agentUsage : null,
                  provider: data.providerUsed || agent.preferredProvider,
                  model: agentUsage.model || '',
                });

                // Log usage for workspace agent
                if (agentUsage.usageAvailable) {
                  logUsage({
                    requestId: roomRequestId + ':' + agent.id,
                    service: 'chat',
                    category: 'room',
                    provider: data.providerUsed || agent.preferredProvider,
                    model: agentUsage.model || '',
                    inputTokens: agentUsage.inputTokens || 0,
                    outputTokens: agentUsage.outputTokens || 0,
                    usageAvailable: true,
                    usageComplete: true,
                    mode: 'single',
                    status: 'ok',
                    latencyMs,
                  });
                }

                onAgentDone?.({
                  agentId: agent.id,
                  agentName: agent.name,
                  fullResponse: data.fullResponse,
                  thinking: '',  // thinking streamed via onThinking
                  usage: agentUsage.usageAvailable ? agentUsage : null,
                  provider: data.providerUsed || agent.preferredProvider,
                  latencyMs,
                  citations: contextResult.citations || [],
                  actions: data.actions || [],
                  iterations: data.iterations || 0,
                });

                settleAgent();
              },
              onError: (err) => {
                const latencyMs = Date.now() - agentStartedAt;
                agentUsages.push({
                  agentId: agent.id,
                  agentName: agent.name,
                  status: 'error',
                  latencyMs,
                  usage: null,
                  error: err.error || err.message || 'Workspace execution failed',
                });

                logUsage({
                  requestId: roomRequestId + ':' + agent.id,
                  service: 'chat',
                  category: 'room',
                  provider: agent.preferredProvider,
                  model: '',
                  inputTokens: 0,
                  outputTokens: 0,
                  usageAvailable: false,
                  mode: 'single',
                  status: 'error',
                  errorCode: 'WORKSPACE_ERROR',
                  latencyMs,
                });

                onAgentError?.({
                  agentId: agent.id,
                  agentName: agent.name,
                  error: err.error || err.message || 'Workspace execution failed',
                  code: err.code || 'WORKSPACE_ERROR',
                });

                settleAgent();
              },
            },
            {
              isAborted: () => cancelled,
              setPass1Request: (value) => {
                pass1Request = value;
              },
              setPass2Cleanup: (value) => {
                pass2Cleanup = value;
              },
            },
          );
        });
      } catch (err) {
        const latencyMs = Date.now() - agentStartedAt;
        agentUsages.push({
          agentId: agent.id,
          agentName: agent.name,
          status: 'error',
          latencyMs,
          usage: null,
          error: err.message || 'Context build failed',
        });

        logUsage({
          requestId: roomRequestId + ':' + agent.id,
          service: 'chat',
          category: 'room',
          provider: agent.preferredProvider,
          model: '',
          inputTokens: 0,
          outputTokens: 0,
          usageAvailable: false,
          mode: 'single',
          status: 'error',
          errorCode: 'CONTEXT_BUILD_FAILED',
          latencyMs,
        });

        onAgentError?.({
          agentId: agent.id,
          agentName: agent.name,
          error: err.message || 'Failed to build agent context',
          code: 'CONTEXT_BUILD_FAILED',
        });
        return;
      }
    }

    // --- Standard chat agents (existing flow) ---
    try {
      const contextResult = await buildAgentContext(agent, room, { parsedImageContext });
      if (cancelled) return;

      if (agent.supportsAgentTools) {
        onStatus?.({
          agentId: agent.id,
          type: 'tool_ready',
          message: 'Agent can inspect profiles, internal data, and web results when needed.',
        });

        const toolLoopResult = await runAgentToolLoop({
          agent,
          systemPrompt: contextResult.systemPrompt,
          messagesForModel: contextResult.messagesForModel,
          onActions: (data) => {
            if (cancelled) return;
            onActions?.({ agentId: agent.id, ...data });
          },
          onStatus: (data) => {
            if (cancelled) return;
            onStatus?.({ agentId: agent.id, ...data });
          },
          isCancelled: () => cancelled,
        });
        if (cancelled) return;

        const latencyMs = Date.now() - agentStartedAt;
        agentUsages.push({
          agentId: agent.id,
          agentName: agent.name,
          status: 'ok',
          latencyMs,
          usage: toolLoopResult.usage || null,
          provider: toolLoopResult.providerUsed || agent.preferredProvider,
          model: toolLoopResult.modelUsed || '',
        });

        onAgentDone?.({
          agentId: agent.id,
          agentName: agent.name,
          fullResponse: toolLoopResult.fullResponse || '',
          thinking: '',
          usage: toolLoopResult.usage || null,
          provider: toolLoopResult.providerUsed || agent.preferredProvider,
          latencyMs,
          citations: contextResult.citations || [],
          actions: toolLoopResult.actions || [],
          iterations: toolLoopResult.iterations || 0,
        });
        return;
      }

      return new Promise((resolve) => {
        let fullResponse = '';
        let thinking = '';
        let agentUsage = null;
        let settled = false;

        function settleAgent() {
          if (settled) return;
          settled = true;
          activeCleanups.delete(agent.id);
          resolve();
        }

        const cleanup = startChatOrchestration({
          mode: 'single',
          primaryProvider: agent.preferredProvider,
          messages: contextResult.messagesForModel,
          systemPrompt: contextResult.systemPrompt,
          images: [],
          reasoningEffort: DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy.reasoningEffort,
          onChunk: ({ provider, text }) => {
            if (cancelled || settled) return;
            fullResponse += text;
            onChunk?.({ agentId: agent.id, provider, text });
          },
          onThinkingChunk: ({ provider, thinking: thinkingText }) => {
            if (cancelled || settled) return;
            thinking += thinkingText;
            onThinkingChunk?.({ agentId: agent.id, provider, thinking: thinkingText });
          },
          onDone: (data) => {
            const latencyMs = Date.now() - agentStartedAt;
            agentUsage = data.usage || null;
            const usageRecord = {
              agentId: agent.id,
              agentName: agent.name,
              status: 'ok',
              latencyMs,
              usage: agentUsage,
              provider: data.providerUsed || agent.preferredProvider,
              model: agentUsage?.model || '',
            };
            agentUsages.push(usageRecord);

            // Log usage for this agent
            if (agentUsage) {
              logUsage({
                requestId: roomRequestId + ':' + agent.id,
                service: 'chat',
                category: 'room',
                provider: data.providerUsed || agent.preferredProvider,
                model: agentUsage.model || '',
                inputTokens: agentUsage.inputTokens || 0,
                outputTokens: agentUsage.outputTokens || 0,
                usageAvailable: true,
                usageComplete: true,
                mode: 'single',
                status: 'ok',
                latencyMs,
              });
            }

            // Fire-and-forget: callback handles its own DB writes + error logging
            onAgentDone?.({
              agentId: agent.id,
              agentName: agent.name,
              fullResponse: data.fullResponse || fullResponse,
              thinking: data.thinking || thinking,
              usage: agentUsage,
              provider: data.providerUsed || agent.preferredProvider,
              latencyMs,
              citations: contextResult.citations || [],
            });

            settleAgent();
          },
          onError: (err) => {
            const latencyMs = Date.now() - agentStartedAt;
            agentUsages.push({
              agentId: agent.id,
              agentName: agent.name,
              status: 'error',
              latencyMs,
              usage: err.usage || null,
              error: err.message || 'Agent failed',
            });

            // Log failed usage — preserve partial data from err.usage if available
            logUsage({
              requestId: roomRequestId + ':' + agent.id,
              service: 'chat',
              category: 'room',
              provider: agent.preferredProvider,
              model: err.usage?.model || agent.preferredProvider,
              inputTokens: err.usage?.inputTokens || 0,
              outputTokens: err.usage?.outputTokens || 0,
              usageAvailable: !!err.usage,
              mode: 'single',
              status: 'error',
              latencyMs,
            });

            // Fire-and-forget: callback handles its own DB writes + error logging
            onAgentError?.({
              agentId: agent.id,
              agentName: agent.name,
              error: err.message || 'Agent failed',
              code: err.code || 'AGENT_FAILED',
            });

            settleAgent();
          },
          onAbort: () => {
            const latencyMs = Date.now() - agentStartedAt;
            agentUsages.push({
              agentId: agent.id,
              agentName: agent.name,
              status: 'abort',
              latencyMs,
              usage: null,
            });

            // Log aborted agent to usage
            logUsage({
              requestId: roomRequestId + ':' + agent.id,
              service: 'chat',
              category: 'room',
              provider: agent.preferredProvider,
              model: '',
              inputTokens: 0,
              outputTokens: 0,
              usageAvailable: false,
              mode: 'single',
              status: 'abort',
              latencyMs,
            });

            settleAgent();
          },
        });

        activeCleanups.set(agent.id, cleanup);
      });
    } catch (err) {
      const latencyMs = Date.now() - agentStartedAt;
      agentUsages.push({
        agentId: agent.id,
        agentName: agent.name,
        status: 'error',
        latencyMs,
        usage: null,
        error: err.message || 'Context build failed',
      });

      // Log context-build failures to usage
      logUsage({
        requestId: roomRequestId + ':' + agent.id,
        service: 'chat',
        category: 'room',
        provider: agent.preferredProvider,
        model: '',
        inputTokens: 0,
        outputTokens: 0,
        usageAvailable: false,
        mode: 'single',
        status: 'error',
        errorCode: 'CONTEXT_BUILD_FAILED',
        latencyMs,
      });

      onAgentError?.({
        agentId: agent.id,
        agentName: agent.name,
        error: err.message || 'Failed to build agent context',
        code: 'CONTEXT_BUILD_FAILED',
      });
    }
  }

  return cancel;
}

/**
 * Aggregate usage across all agents in a room turn.
 */
function aggregateUsage(usages) {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCostMicros = 0;

  for (const u of usages) {
    if (!u.usage) continue;
    inputTokens += u.usage.inputTokens || 0;
    outputTokens += u.usage.outputTokens || 0;
    totalCostMicros += u.usage.totalCostMicros || 0;
  }

  return { inputTokens, outputTokens, totalCostMicros };
}

module.exports = {
  parseMentions,
  startRoomOrchestration,
};
