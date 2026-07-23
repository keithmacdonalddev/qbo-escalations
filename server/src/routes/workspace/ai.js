'use strict';

const express = require('express');
const { normalizeModelOverride, resolvePolicy } = require('../../services/chat-orchestrator');
const { getDefaultProvider, getAlternateProvider, isValidProvider, normalizeProvider } = require('../../services/providers/registry');
const { resolveAgentBackup } = require('../../services/agent-failover');
const { reportServerError } = require('../../lib/server-error-pipeline');
const { getRenderedAgentPrompt } = require('../../lib/agent-prompt-store');
const {
  createWorkspaceSession,
  updateWorkspaceSession,
  recordWorkspaceChunk,
  recordWorkspaceActions,
  completeWorkspacePass,
  attachWorkspaceSessionController,
  deleteWorkspaceSession,
  getWorkspaceRuntimeHealth,
  acquireChatLock,
  releaseChatLock,
  isChatAgentActive,
} = require('../../services/workspace-runtime');
const { WORKSPACE_AVAILABLE_TOOL_LINES } = require('../../services/workspace-tools/metadata');
const { buildWorkspacePrompt } = require('../../services/workspace-prompt-builder');
const { getWorkspaceAuthority } = require('../../services/workspace-action-policy');
const {
  createWorkspaceConversationSaver,
  loadWorkspaceConversationMessages,
} = require('../../services/workspace-conversation-service');
const {
  autoExtractFromEmails,
} = require('../../services/workspace-memory-extraction');
const {
  buildCommunityProfilesContext,
  buildIdentityMemoryContext,
  buildRelationshipCoordinationContext,
  getAgentIdentity,
  listAgentIdentities,
} = require('../../services/agent-identity-service');
const { buildAgentIdentityOverlay } = require('../../services/room-agents/agent-profiles');
const {
  clearWorkspaceFailureFingerprints,
  normalizeWorkspaceReasoningEffort,
} = require('../../services/workspace-request-helpers');
const { runWorkspaceRequest } = require('../../services/workspace-request-service');

const router = express.Router();
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const WORKSPACE_CHAT_TIMEOUT_MS = Math.min(
  parsePositiveInt(process.env.WORKSPACE_CHAT_TIMEOUT_MS, 600_000),
  1_800_000
);
const WORKSPACE_PRIMARY_PROVIDER = getDefaultProvider();

// ---------------------------------------------------------------------------
// Context-building timeout — prevents Gmail/Calendar hangs from stalling the
// entire workspace request.  Individual sub-sections use shorter timeouts;
// this outer guard is the last resort.
// ---------------------------------------------------------------------------
const CONTEXT_SECTION_TIMEOUT_MS = 12_000; // 12 s — auto-context (Gmail/Calendar/actions)
const CONTEXT_MINOR_TIMEOUT_MS = 5_000;    // 5 s  — alerts, memory, conversation history

/**
 * Race a promise against a timeout.  Returns `fallback` if the promise
 * doesn't settle within `ms`.  Never rejects — callers get the fallback
 * value on timeout or error.
 */
function withTimeout(promise, ms, fallback = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).then(
    (v) => { clearTimeout(timer); return v; },
    () => { clearTimeout(timer); return fallback; }
  );
}

// ---------------------------------------------------------------------------
// Memory cleanup — debounced to once per hour
// ---------------------------------------------------------------------------

let _lastMemoryCleanup = 0;

/**
 * Delete expired memories and run confidence decay.
 * Called at the top of /ai handler, debounced to once per hour.
 */
async function cleanupExpiredMemories() {
  const workspaceMemory = require('../../services/workspace-memory');
  const result = await workspaceMemory.cleanupExpired();
  // Also trigger confidence decay (already debounced internally, but call for completeness)
  await workspaceMemory.decayPatternConfidence();
  if (result.deletedCount > 0) {
    console.log(`[workspace] cleaned up ${result.deletedCount} expired memories`);
  }
}

// The reviewed Workspace Agent role lives in prompts/agents/workspace-action.md.
// Its live tool catalog is appended here so prompt wording cannot drift from code.

function getWorkspaceRolePrompt() {
  return [
    getRenderedAgentPrompt('workspace-action'),
    WORKSPACE_AVAILABLE_TOOL_LINES.join('\n'),
  ].filter(Boolean).join('\n\n');
}


router.post('/ai', async (req, res) => {
  if (Date.now() - _lastMemoryCleanup > 3600000) {
    _lastMemoryCleanup = Date.now();
    cleanupExpiredMemories().catch(() => {});
  }

  const {
    prompt,
    context,
    conversationHistory,
    conversationSessionId,
    provider,
    primaryProvider,
    primaryModel,
    fallbackProvider,
    fallbackModel,
    mode,
    reasoningEffort,
  } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ ok: false, code: 'MISSING_PROMPT', error: 'prompt is required' });
  }

  const workspaceAuthority = await getWorkspaceAuthority();
  if (!workspaceAuthority.enabled) {
    return res.status(409).json({
      ok: false,
      code: 'WORKSPACE_AGENT_DISABLED',
      error: 'The Workspace Agent is disabled. Enable it from the Agents profile before starting a request.',
    });
  }

  // Reject if another workspace request is already running
  if (isChatAgentActive()) {
    return res.status(409).json({
      ok: false,
      code: 'WORKSPACE_BUSY',
      error: 'Workspace agent is currently handling another request',
    });
  }
  if (provider !== undefined && !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported provider' });
  }
  if (primaryProvider !== undefined && !isValidProvider(primaryProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported primary provider' });
  }
  if (fallbackProvider !== undefined && !isValidProvider(fallbackProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported fallback provider' });
  }
  if (primaryModel !== undefined && typeof primaryModel !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_MODEL', error: 'primaryModel must be a string' });
  }
  if (fallbackModel !== undefined && typeof fallbackModel !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_MODEL', error: 'fallbackModel must be a string' });
  }
  if (mode !== undefined && mode !== 'single' && mode !== 'fallback') {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_MODE',
      error: 'Workspace only supports single or fallback mode',
    });
  }

  const useActionFlow = true;
  const workspaceBackupIdentity = await getAgentIdentity('workspace').catch(() => null);
  const profileRuntime = workspaceBackupIdentity?.runtime?.configured
    ? workspaceBackupIdentity.runtime
    : null;
  const requestedPrimaryProvider = normalizeProvider(
    primaryProvider || provider || profileRuntime?.provider || WORKSPACE_PRIMARY_PROVIDER
  );
  const effectiveReasoningEffort = normalizeWorkspaceReasoningEffort(
    reasoningEffort || profileRuntime?.reasoningEffort
  );
  // Backup precedence: an explicit request-body fallbackProvider wins; otherwise
  // the Workspace agent profile (AgentIdentity 'workspace') runtime is the
  // source of truth; otherwise the neutral global alternate. Failover is always
  // on in the orchestrator, so a distinct backup here means the engine fails
  // over on primary failure. (Shared, use-case-agnostic backup rule.)
  const workspaceBackup = resolveAgentBackup(requestedPrimaryProvider, workspaceBackupIdentity?.runtime || null);
  const effectiveFallbackProvider = fallbackProvider
    || (workspaceBackup.fromProfile ? workspaceBackup.provider : '')
    || getAlternateProvider(requestedPrimaryProvider);
  const effectiveFallbackModel = fallbackProvider
    ? fallbackModel
    : (workspaceBackup.fromProfile ? workspaceBackup.model : fallbackModel);
  const policy = resolvePolicy({
    mode: mode || profileRuntime?.mode || 'fallback',
    primaryProvider: requestedPrimaryProvider,
    primaryModel: normalizeModelOverride(primaryModel || profileRuntime?.model),
    fallbackProvider: effectiveFallbackProvider,
    fallbackModel: normalizeModelOverride(effectiveFallbackModel),
  });

  const persistentSessionId = conversationSessionId
    || `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  clearWorkspaceFailureFingerprints();
  const connectedAccountsPromise = require('../../models/GmailAuth').getAll().catch(() => []);

  const session = createWorkspaceSession({ prompt, context, conversationHistory });
  const sessionId = session.id;
  updateWorkspaceSession(sessionId, { phase: useActionFlow ? 'pass1' : 'direct' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write('event: start\ndata: ' + JSON.stringify({
    ok: true,
    provider: policy.primaryProvider,
    primaryProvider: policy.primaryProvider,
    primaryModel: policy.primaryModel || null,
    fallbackProvider: policy.fallbackProvider || null,
    fallbackModel: policy.fallbackModel || null,
    mode: policy.mode,
    reasoningEffort: effectiveReasoningEffort,
    sessionId,
    conversationSessionId: persistentSessionId,
  }) + '\n\n');
  res.write('event: status\ndata: ' + JSON.stringify({
    message: 'Preparing context...',
    phase: useActionFlow ? 'pass1' : 'direct',
    elapsedMs: 0,
    sessionId,
  }) + '\n\n');

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  let clientDisconnected = false;
  let pass1Request = null;
  let pass2Cleanup = null;
  let receivedFirstChunk = false;
  let spawnGuard = null;

  const statusTicker = setInterval(() => {
    if (clientDisconnected) return;
    const runtime = getWorkspaceRuntimeHealth().sessions.find((item) => item.id === sessionId);
    if (!runtime) return;
    try {
      res.write('event: status\ndata: ' + JSON.stringify({
        message: runtime.phase === 'actions'
          ? 'Executing actions...'
          : 'Working...',
        phase: runtime.phase,
        elapsedMs: runtime.ageMs,
        sessionId,
      }) + '\n\n');
    } catch { /* client disconnected */ }
  }, 5000);

  function markAiSubprocessOutputReceived() {
    if (receivedFirstChunk) return;
    receivedFirstChunk = true;
    if (spawnGuard) {
      clearTimeout(spawnGuard);
      spawnGuard = null;
    }
  }

  function clearWorkspaceTimers() {
    clearInterval(heartbeat);
    clearInterval(statusTicker);
  }

  const workspaceRequestState = {
    isClientDisconnected: () => clientDisconnected,
    clearSpawnGuard: () => {
      if (spawnGuard) {
        clearTimeout(spawnGuard);
        spawnGuard = null;
      }
    },
    setPass1Request: (value) => {
      pass1Request = value;
    },
    setPass2Cleanup: (value) => {
      pass2Cleanup = value;
    },
  };

  const SPAWN_GUARD_MS = 30000;
  spawnGuard = setTimeout(() => {
    if (receivedFirstChunk || clientDisconnected || res.writableEnded) return;
    console.error('[workspace] spawn guard triggered — no stream output after 30 s');
    clearWorkspaceTimers();
    updateWorkspaceSession(sessionId, {
      phase: 'error',
      lastError: 'AI subprocess produced no output within 30 seconds',
    });
    reportServerError({
      message: 'Workspace spawn guard: no output after 30 s',
      detail: 'The Claude subprocess may have failed to start or died silently.',
      stack: '',
      source: 'routes/workspace/ai.js',
      category: 'runtime-error',
      severity: 'error',
    });
    try { pass1Request?.abort('Spawn guard timeout — no output'); } catch { /* ignore */ }
    try { pass2Cleanup?.(); } catch { /* ignore */ }
    if (!res.writableEnded) {
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          ok: false,
          code: 'SPAWN_TIMEOUT',
          error: 'AI subprocess produced no output within 30 seconds — it may have failed to start',
        }) + '\n\n');
        res.end();
      } catch { /* client already gone */ }
    }
    deleteWorkspaceSession(sessionId);
  }, SPAWN_GUARD_MS);

  attachWorkspaceSessionController(sessionId, {
    abort: (reason = 'Workspace session aborted by supervisor') => {
      if (clientDisconnected) return;
      updateWorkspaceSession(sessionId, {
        phase: 'aborting',
        lastError: reason,
      });
      clearWorkspaceTimers();
      if (pass1Request) {
        pass1Request.abort(reason);
        return;
      }
      if (pass2Cleanup) {
        try { pass2Cleanup(); } catch { /* ignore */ }
        pass2Cleanup = null;
        try {
          res.write('event: error\ndata: ' + JSON.stringify({
            ok: false,
            code: 'AUTO_ABORT',
            error: reason,
          }) + '\n\n');
          res.end();
        } catch { /* client disconnected */ }
        deleteWorkspaceSession(sessionId);
      }
    },
  });

  res.on('close', () => {
    clientDisconnected = true;
    clearWorkspaceTimers();
    if (spawnGuard) {
      clearTimeout(spawnGuard);
      spawnGuard = null;
    }
    updateWorkspaceSession(sessionId, { clientConnected: false });
    try { pass1Request?.abort('Workspace client disconnected during pass 1'); } catch { /* ignore */ }
    try { pass2Cleanup?.(); } catch { /* ignore */ }
  });

  const fullPrompt = await buildWorkspacePrompt({
    prompt,
    context,
    withTimeout,
    contextSectionTimeoutMs: CONTEXT_SECTION_TIMEOUT_MS,
    contextMinorTimeoutMs: CONTEXT_MINOR_TIMEOUT_MS,
    autoExtractFromEmails,
  });

  const messages = await loadWorkspaceConversationMessages({
    conversationSessionId,
    conversationHistory,
    fullPrompt,
  });

  const saveConversationTurn = createWorkspaceConversationSaver({
    persistentSessionId,
    prompt,
  });

  const workspaceIdentity = await getAgentIdentity('workspace').catch(() => null);
  const allAgentIdentities = await listAgentIdentities().catch(() => []);
  const enrichedWorkspaceRole = [
    getWorkspaceRolePrompt(),
    buildAgentIdentityOverlay(workspaceIdentity?.profile || 'workspace'),
    buildIdentityMemoryContext(workspaceIdentity),
    buildRelationshipCoordinationContext(workspaceIdentity, allAgentIdentities.map((item) => item.agentId).filter((id) => id !== 'workspace')),
    buildCommunityProfilesContext('workspace', allAgentIdentities),
  ].filter(Boolean).join('\n\n');

  await runWorkspaceRequest({
    res,
    useActionFlow,
    prompt,
    messages,
    sessionId,
    requestedPrimaryProvider,
    effectiveReasoningEffort,
    timeoutMs: WORKSPACE_CHAT_TIMEOUT_MS,
    policy,
    requestState: workspaceRequestState,
    saveConversationTurn,
    connectedAccountsPromise,
    workspaceRole: enrichedWorkspaceRole,
    workspaceChatOnlyRole: enrichedWorkspaceRole,
    runtime: {
      updateWorkspaceSession,
      recordWorkspaceChunk,
      recordWorkspaceActions,
      completeWorkspacePass,
      deleteWorkspaceSession,
      acquireChatLock,
      releaseChatLock,
    },
    ui: {
      clearTimers: clearWorkspaceTimers,
      markAiSubprocessOutputReceived,
    },
  });
  return;
});

module.exports = router;
