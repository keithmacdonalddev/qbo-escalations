'use strict';

const activeOperations = new Map();
const operationControllers = new Map();
const AI_KINDS = Object.freeze(['chat', 'copilot', 'gmail', 'parse']);

const PRUNE_STALE_MS = 10 * 60 * 1000; // 10 minutes
const PRUNE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
let _pruneInterval = null;

function pruneStaleOperations() {
  const cutoff = Date.now() - PRUNE_STALE_MS;
  for (const [id, op] of activeOperations.entries()) {
    if (op.updatedAt < cutoff) {
      activeOperations.delete(id);
      operationControllers.delete(id);
    }
  }
}

function startPruning() {
  if (_pruneInterval) return;
  _pruneInterval = setInterval(() => {
    pruneStaleOperations();
  }, PRUNE_INTERVAL_MS);
  if (_pruneInterval.unref) _pruneInterval.unref();
}

function stopPruning() {
  if (_pruneInterval) {
    clearInterval(_pruneInterval);
    _pruneInterval = null;
  }
}

// Auto-start
if (process.env.DISABLE_RUNTIME_PRUNING !== '1') {
  startPruning();
}
const KIND_PREFIXES = Object.freeze({
  chat: 'ch',
  copilot: 'cp',
  gmail: 'gm',
  parse: 'ps',
});

function createOperationId(kind) {
  const prefix = KIND_PREFIXES[kind] || KIND_PREFIXES.chat;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeKind(kind) {
  return AI_KINDS.includes(kind) ? kind : 'chat';
}

function normalizePromptPreview(prompt) {
  return String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function cloneOperation(operation) {
  const now = Date.now();
  return {
    id: operation.id,
    kind: operation.kind,
    route: operation.route,
    action: operation.action,
    phase: operation.phase,
    provider: operation.provider,
    mode: operation.mode,
    conversationId: operation.conversationId,
    promptPreview: operation.promptPreview,
    hasImages: operation.hasImages,
    messageCount: operation.messageCount,
    providers: [...operation.providers],
    clientConnected: operation.clientConnected,
    startedAt: new Date(operation.startedAt).toISOString(),
    updatedAt: new Date(operation.updatedAt).toISOString(),
    ageMs: now - operation.startedAt,
    idleMs: now - operation.updatedAt,
    stats: { ...operation.stats },
    lastError: operation.lastError || null,
  };
}

function createAiOperation({
  kind,
  route,
  action,
  provider,
  mode = 'single',
  conversationId = null,
  promptPreview = '',
  hasImages = false,
  messageCount = 0,
  providers = [],
}) {
  const now = Date.now();
  const normalizedKind = normalizeKind(kind);
  const operation = {
    id: createOperationId(normalizedKind),
    kind: normalizedKind,
    route: route || null,
    action: action || null,
    phase: 'starting',
    provider: provider || null,
    mode: mode || 'single',
    conversationId: conversationId || null,
    promptPreview: normalizePromptPreview(promptPreview),
    hasImages: Boolean(hasImages),
    messageCount: Number.isFinite(messageCount) ? messageCount : 0,
    providers: Array.isArray(providers) ? providers.filter(Boolean) : [],
    clientConnected: true,
    startedAt: now,
    updatedAt: now,
    stats: {
      chunks: 0,
      chunkChars: 0,
      thinkingChunks: 0,
      providerErrors: 0,
      fallbacks: 0,
    },
    lastError: null,
  };
  activeOperations.set(operation.id, operation);
  return cloneOperation(operation);
}

function updateAiOperation(id, patch = {}) {
  const operation = activeOperations.get(id);
  if (!operation) return null;

  if (patch.phase) operation.phase = patch.phase;
  if (patch.provider !== undefined) operation.provider = patch.provider;
  if (patch.mode !== undefined) operation.mode = patch.mode;
  if (patch.conversationId !== undefined) operation.conversationId = patch.conversationId;
  if (patch.promptPreview !== undefined) operation.promptPreview = normalizePromptPreview(patch.promptPreview);
  if (patch.clientConnected !== undefined) operation.clientConnected = Boolean(patch.clientConnected);
  if (patch.lastError !== undefined) operation.lastError = patch.lastError;
  if (Array.isArray(patch.providers)) operation.providers = patch.providers.filter(Boolean);

  if (patch.stats && typeof patch.stats === 'object') {
    operation.stats = { ...operation.stats, ...patch.stats };
  }

  operation.updatedAt = Date.now();
  return cloneOperation(operation);
}

function recordAiChunk(id, text, options = {}) {
  const operation = activeOperations.get(id);
  if (!operation) return null;

  const nextText = typeof text === 'string' ? text : '';
  const isThinking = Boolean(options.thinking);

  operation.phase = isThinking ? 'thinking' : 'streaming';
  if (options.provider) operation.provider = options.provider;
  if (isThinking) {
    operation.stats.thinkingChunks += 1;
  } else {
    operation.stats.chunks += 1;
    operation.stats.chunkChars += nextText.length;
  }
  operation.updatedAt = Date.now();
  return cloneOperation(operation);
}

function recordAiEvent(id, type, detail = {}) {
  const operation = activeOperations.get(id);
  if (!operation) return null;

  if (detail.provider) operation.provider = detail.provider;

  if (type === 'provider_error') {
    operation.phase = 'provider_error';
    operation.stats.providerErrors += 1;
  } else if (type === 'fallback') {
    operation.phase = 'fallback';
    operation.stats.fallbacks += 1;
    if (detail.to) operation.provider = detail.to;
  } else if (type === 'saving') {
    operation.phase = 'saving';
  } else if (type === 'aborting') {
    operation.phase = 'aborting';
  } else if (type === 'completed') {
    operation.phase = 'completed';
  } else if (type === 'error') {
    operation.phase = 'error';
  }

  if (detail.lastError !== undefined) {
    operation.lastError = detail.lastError;
  }

  operation.updatedAt = Date.now();
  return cloneOperation(operation);
}

function deleteAiOperation(id) {
  operationControllers.delete(id);
  activeOperations.delete(id);
}

function attachAiOperationController(id, controller) {
  if (!activeOperations.has(id) || !controller || typeof controller.abort !== 'function') return false;
  operationControllers.set(id, controller);
  return true;
}

function abortAiOperation(id, reason = 'AI operation aborted by supervisor') {
  const controller = operationControllers.get(id);
  if (!controller || typeof controller.abort !== 'function') {
    return { ok: false, code: 'NO_CONTROLLER', error: 'No abort controller registered for AI operation' };
  }
  try {
    controller.abort(reason);
    return { ok: true, id, reason };
  } catch (err) {
    return { ok: false, code: 'ABORT_FAILED', error: err.message || 'Failed to abort AI operation' };
  }
}

function listAiOperations(kind) {
  const normalizedKind = kind ? normalizeKind(kind) : null;
  return [...activeOperations.values()]
    .filter((operation) => !normalizedKind || operation.kind === normalizedKind)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(cloneOperation)
    .filter(Boolean);
}

function buildKindHealth(kind) {
  const sessions = listAiOperations(kind).filter(Boolean);
  const longestActiveMs = sessions.reduce((max, session) => Math.max(max, session.ageMs || 0), 0);
  const stalestIdleMs = sessions.reduce((max, session) => Math.max(max, session.idleMs || 0), 0);
  const staleSessions = sessions.filter((session) => session.idleMs >= 30_000);

  return {
    activeSessions: sessions.length,
    longestActiveMs,
    stalestIdleMs,
    staleCount: staleSessions.length,
    sessions,
  };
}

function getAiRuntimeHealth() {
  const byKind = {};
  for (const kind of AI_KINDS) {
    byKind[kind] = buildKindHealth(kind);
  }

  return {
    totalActiveOperations: AI_KINDS.reduce((sum, kind) => sum + (byKind[kind].activeSessions || 0), 0),
    chat: byKind.chat,
    copilot: byKind.copilot,
    gmail: byKind.gmail,
    parse: byKind.parse,
    byKind,
  };
}

module.exports = {
  AI_KINDS,
  createAiOperation,
  updateAiOperation,
  recordAiChunk,
  recordAiEvent,
  attachAiOperationController,
  abortAiOperation,
  deleteAiOperation,
  listAiOperations,
  getAiRuntimeHealth,
  stopPruning,
};
