'use strict';

const { spawn } = require('child_process');
const { DEFAULT_PROFILES } = require('./room-agents/agent-profiles');
const {
  getAgentIdentity,
  listAgentRuntimeDefaults,
  normalizeAgentRuntimeState,
} = require('./agent-identity-service');
const { checkProviderAvailability } = require('./image-parser');
const {
  getDefaultProvider,
  getProvider,
  getProviderLabel,
  getProviderModelId,
  getProviderTransport,
  isAllowedEffort,
  normalizeProvider,
} = require('./providers/registry');
const { startChatOrchestration } = require('./chat-orchestrator');
const {
  DEFAULT_CHAT_RUNTIME_SETTINGS,
  normalizeChatRuntimeSettings,
} = require('../lib/chat-settings');

const DEFAULT_AGENT_HEALTH_INTERVAL_MS = 60_000;
const DEFAULT_AGENT_HEALTH_TTL_MS = 30_000;
const DEFAULT_READINESS_TIMEOUT_MS = 20_000;
const PROVIDER_HEALTH_LEVELS = new Set(['heartbeat', 'readiness', 'canary']);
const IMAGE_AGENT_IDS = new Set([
  'escalation-template-parser',
  'follow-up-chat-parser',
  'image-analyst',
]);
const AGENT_HEALTH_IDS = Object.freeze(Object.keys(DEFAULT_PROFILES));

let healthByAgentId = new Map();
let lastCheckedAt = null;
let inFlightRefresh = null;
let healthTimer = null;

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeText(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return fallback;
  try {
    return String(value).trim();
  } catch {
    return fallback;
  }
}

function normalizeHealthLevel(value) {
  const normalized = safeText(value || '').toLowerCase();
  return PROVIDER_HEALTH_LEVELS.has(normalized) ? normalized : 'heartbeat';
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function resolveAgentIds(agentIds = []) {
  const requested = (Array.isArray(agentIds) ? agentIds : [])
    .map((agentId) => safeText(agentId))
    .filter(Boolean);
  if (requested.length > 0) return requested;
  return AGENT_HEALTH_IDS;
}

function getRuntimeForAgent(agentId, runtimeDefaults = {}, runtimeOverrides = {}) {
  const overrideRuntime = runtimeOverrides?.[agentId] || null;
  const savedRuntime = runtimeDefaults?.[agentId]?.runtime || null;
  const normalized = normalizeAgentRuntimeState(agentId, overrideRuntime || savedRuntime || {
    provider: IMAGE_AGENT_IDS.has(agentId) ? '' : getDefaultProvider(),
    model: '',
  });
  return normalized;
}

function providerNeedsSharedAvailability(provider) {
  const normalized = normalizeProvider(provider || getDefaultProvider());
  const transport = getProviderTransport(normalized);
  return transport !== 'codex' && transport !== 'claude';
}

function needsSharedProviderAvailability(agentIds, runtimeDefaults, runtimeOverrides = {}) {
  return agentIds.some((agentId) => {
    const runtime = getRuntimeForAgent(agentId, runtimeDefaults, runtimeOverrides);
    if (IMAGE_AGENT_IDS.has(agentId) && !runtime.provider) return false;
    return providerNeedsSharedAvailability(runtime?.provider);
  });
}

function resolveProviderRuntime(provider, model = '') {
  const normalizedProvider = normalizeProvider(provider || getDefaultProvider());
  return {
    provider: normalizedProvider,
    model: safeText(model) || getProviderModelId(normalizedProvider) || normalizedProvider,
  };
}

function normalizeReasoningEffortForProvider(provider, value) {
  const normalized = safeText(value || '').toLowerCase();
  if (normalized && isAllowedEffort(provider, normalized)) return normalized;
  if (isAllowedEffort(provider, 'low')) return 'low';
  if (isAllowedEffort(provider, 'medium')) return 'medium';
  if (isAllowedEffort(provider, 'none')) return 'none';
  return 'low';
}

function formatProviderSummary(providerStatus) {
  const label = providerStatus?.providerLabel || getProviderLabel(providerStatus?.provider);
  const model = safeText(providerStatus?.model);
  return model ? `${label} / ${model}` : label;
}

function formatAvailabilityMessage(providerStatus, roleLabel = 'Provider') {
  const summary = formatProviderSummary(providerStatus);
  if (providerStatus?.available) return `${roleLabel} is available: ${summary}.`;
  return `${roleLabel} is unavailable: ${summary}.`;
}

function checkCli(command, args = ['--version'], timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let errorOutput = '';

    function finish(payload) {
      if (settled) return;
      settled = true;
      resolve(payload);
    }

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, CLAUDECODE: undefined },
    });

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      finish({
        available: false,
        code: 'TIMEOUT',
        reason: `${command} availability check timed out`,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (output.length < 1000) output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (errorOutput.length < 1000) errorOutput += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: err.message || `${command} unavailable`,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        finish({
          available: true,
          code: 'OK',
          reason: output.trim().split(/\r?\n/)[0] || `${command} ready`,
        });
        return;
      }
      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: (errorOutput || output || `${command} exited with code ${code}`).trim().slice(0, 240),
      });
    });
  });
}

async function checkRuntimeProvider(runtime, availabilityByProvider) {
  const provider = normalizeProvider(runtime?.provider || getDefaultProvider());
  const transport = getProviderTransport(provider);
  const model = safeText(runtime?.model) || getProviderModelId(provider) || provider;

  if (transport === 'codex') {
    const cli = await checkCli('codex');
    return {
      provider,
      providerLabel: getProviderLabel(provider),
      model,
      available: cli.available,
      code: cli.code,
      reason: cli.reason,
    };
  }

  if (transport === 'claude') {
    const cli = await checkCli('claude');
    return {
      provider,
      providerLabel: getProviderLabel(provider),
      model,
      available: cli.available,
      code: cli.code,
      reason: cli.reason,
    };
  }

  const status = availabilityByProvider?.[provider] || null;
  return {
    provider,
    providerLabel: getProviderLabel(provider),
    model: safeText(status?.model) || model,
    available: Boolean(status?.available),
    code: safeText(status?.code) || (status?.available ? 'OK' : 'UNAVAILABLE'),
    reason: safeText(status?.reason) || (status?.available ? 'Provider available.' : 'Provider unavailable.'),
  };
}

function buildProviderHealthEntry(role, providerStatus, checkedAt) {
  const available = Boolean(providerStatus?.available);
  const roleLabel = role === 'fallback' ? 'Fallback provider' : 'Default provider';
  return {
    role,
    provider: providerStatus.provider,
    providerLabel: providerStatus.providerLabel,
    model: providerStatus.model,
    active: available,
    available,
    status: available ? 'online' : 'offline',
    tone: available ? 'active' : 'offline',
    code: providerStatus.code,
    message: formatAvailabilityMessage(providerStatus, roleLabel),
    diagnostic: providerStatus.reason || '',
    checkedAt,
  };
}

function runProviderReadinessProbe({ provider, model, reasoningEffort, timeoutMs }) {
  const providerId = normalizeProvider(provider);
  const providerAdapter = getProvider(providerId);
  const startedAt = Date.now();
  const effort = normalizeReasoningEffortForProvider(providerId, reasoningEffort);

  return new Promise((resolve) => {
    let settled = false;
    let cleanup = null;
    let responseText = '';
    let timeoutHandle = null;

    function finish(payload) {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = null;
      resolve({
        role: payload.role || 'readiness',
        provider: providerId,
        providerLabel: getProviderLabel(providerId),
        model: payload.model || model || getProviderModelId(providerId) || '',
        reasoningEffort: effort,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        ...payload,
      });
    }

    try {
      cleanup = providerAdapter.chat({
        messages: [
          {
            role: 'user',
            content: 'Reply with exactly: READY_OK',
          },
        ],
        systemPrompt: 'You are running a provider readiness check. Reply with exactly READY_OK and nothing else.',
        images: [],
        model: model || undefined,
        reasoningEffort: effort,
        timeoutMs,
        onChunk: (text) => {
          if (typeof text === 'string' && responseText.length < 600) responseText += text;
        },
        onThinkingChunk: () => {},
        onDone: (fullResponse, usage) => {
          const output = safeText(fullResponse || responseText);
          const ok = /READY_OK/i.test(output);
          finish({
            ok,
            active: ok,
            available: ok,
            status: ok ? 'online' : 'offline',
            tone: ok ? 'active' : 'offline',
            code: ok ? 'OK' : 'UNEXPECTED_OUTPUT',
            message: ok
              ? `Readiness check passed: ${getProviderLabel(providerId)} / ${usage?.model || model || getProviderModelId(providerId) || providerId}.`
              : `Readiness check returned an unexpected response from ${getProviderLabel(providerId)}.`,
            diagnostic: output.slice(0, 240),
            model: usage?.model || model || getProviderModelId(providerId) || '',
            usage: usage || null,
          });
        },
        onError: (err) => {
          finish({
            ok: false,
            active: false,
            available: false,
            status: 'offline',
            tone: 'offline',
            code: err?.code || 'READINESS_FAILED',
            message: err?.message || `${getProviderLabel(providerId)} readiness check failed.`,
            diagnostic: err?.stack || err?.message || '',
            usage: err?.usage || null,
          });
        },
      });
    } catch (err) {
      finish({
        ok: false,
        active: false,
        available: false,
        status: 'offline',
        tone: 'offline',
        code: err?.code || 'READINESS_FAILED',
        message: err?.message || `${getProviderLabel(providerId)} readiness check failed.`,
        diagnostic: err?.stack || err?.message || '',
        usage: err?.usage || null,
      });
      return;
    }

    timeoutHandle = setTimeout(() => {
      let usage = null;
      try {
        const abortData = typeof cleanup === 'function' ? cleanup() : null;
        usage = abortData?.usage || null;
      } catch { /* ignore */ }
      finish({
        ok: false,
        active: false,
        available: false,
        status: 'offline',
        tone: 'offline',
        code: 'TIMEOUT',
        message: `${getProviderLabel(providerId)} readiness check timed out after ${timeoutMs}ms.`,
        diagnostic: '',
        usage,
      });
    }, timeoutMs + 250);
    timeoutHandle.unref?.();
  });
}

function runStrategyCanaryProbe({
  mode,
  primaryProvider,
  primaryModel,
  fallbackProvider,
  fallbackModel,
  reasoningEffort,
  timeoutMs,
}) {
  const startedAt = Date.now();
  const effort = normalizeReasoningEffortForProvider(primaryProvider, reasoningEffort);

  return new Promise((resolve) => {
    let settled = false;
    let cleanup = null;
    let timeoutHandle = null;
    let responseText = '';

    function finish(payload) {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = null;
      resolve({
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        ...payload,
      });
    }

    cleanup = startChatOrchestration({
      mode,
      primaryProvider,
      primaryModel,
      fallbackProvider,
      fallbackModel,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: CANARY_OK',
        },
      ],
      systemPrompt: 'You are running an application provider canary. Reply with exactly CANARY_OK and nothing else.',
      images: [],
      reasoningEffort: effort,
      timeoutMs,
      onChunk: (chunk) => {
        if (chunk?.text && responseText.length < 600) responseText += chunk.text;
      },
      onThinkingChunk: () => {},
      onDone: (result) => {
        const output = safeText(result?.fullResponse || responseText);
        const ok = result?.mode === 'parallel' || /CANARY_OK/i.test(output);
        finish({
          ok,
          active: ok,
          available: ok,
          status: ok ? 'online' : 'offline',
          tone: ok ? 'active' : 'offline',
          code: ok ? 'OK' : 'UNEXPECTED_OUTPUT',
          message: ok
            ? `Application canary passed on ${getProviderLabel(result?.providerUsed || primaryProvider)}.`
            : 'Application canary returned an unexpected response.',
          providerUsed: result?.providerUsed || primaryProvider,
          modelUsed: result?.modelUsed || getProviderModelId(result?.providerUsed || primaryProvider) || '',
          fallbackUsed: Boolean(result?.fallbackUsed),
          attempts: Array.isArray(result?.attempts) ? result.attempts : [],
          usage: result?.usage || null,
          diagnostic: output.slice(0, 240),
        });
      },
      onError: (err) => {
        finish({
          ok: false,
          active: false,
          available: false,
          status: 'offline',
          tone: 'offline',
          code: err?.code || 'CANARY_FAILED',
          message: err?.message || 'Application canary failed.',
          providerUsed: '',
          modelUsed: err?.modelUsed || '',
          fallbackUsed: false,
          attempts: Array.isArray(err?.attempts) ? err.attempts : [],
          usage: err?.usage || null,
          diagnostic: err?.detail || err?.message || '',
        });
      },
    });

    timeoutHandle = setTimeout(() => {
      let abortData = null;
      try {
        abortData = typeof cleanup === 'function' ? cleanup() : null;
      } catch { /* ignore */ }
      finish({
        ok: false,
        active: false,
        available: false,
        status: 'offline',
        tone: 'offline',
        code: 'TIMEOUT',
        message: `Application canary timed out after ${timeoutMs}ms.`,
        providerUsed: '',
        modelUsed: '',
        fallbackUsed: false,
        attempts: Array.isArray(abortData?.attempts) ? abortData.attempts : [],
        usage: abortData?.usage || null,
        diagnostic: '',
      });
    }, timeoutMs + 500);
    timeoutHandle.unref?.();
  });
}

async function checkProviderStrategyHealth(rawStrategy = {}, options = {}) {
  const healthLevel = normalizeHealthLevel(options.healthLevel || options.level || rawStrategy?.healthLevel);
  const normalizedSettings = normalizeChatRuntimeSettings({
    providerStrategy: rawStrategy && typeof rawStrategy === 'object'
      ? rawStrategy
      : DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy,
  });
  const strategy = normalizedSettings.providerStrategy;
  const primaryRuntime = resolveProviderRuntime(
    strategy.defaultPrimaryProvider,
    rawStrategy?.primaryModel || rawStrategy?.defaultPrimaryModel || rawStrategy?.model
  );
  const fallbackRuntime = resolveProviderRuntime(
    strategy.defaultFallbackProvider,
    rawStrategy?.fallbackModel || rawStrategy?.defaultFallbackModel
  );
  const needsAvailability = providerNeedsSharedAvailability(primaryRuntime.provider)
    || providerNeedsSharedAvailability(fallbackRuntime.provider);
  const availabilityByProvider = needsAvailability
    ? await checkProviderAvailability({ forceRefresh: options.forceRefresh === true })
    : {};
  const checkedAt = new Date().toISOString();
  const [primaryStatus, fallbackStatus] = await Promise.all([
    checkRuntimeProvider(primaryRuntime, availabilityByProvider),
    checkRuntimeProvider(fallbackRuntime, availabilityByProvider),
  ]);
  const primary = buildProviderHealthEntry('primary', primaryStatus, checkedAt);
  const fallback = buildProviderHealthEntry('fallback', fallbackStatus, checkedAt);
  const readinessTimeoutMs = toInt(
    options.readinessTimeoutMs || rawStrategy?.readinessTimeoutMs || process.env.PROVIDER_READINESS_TIMEOUT_MS,
    DEFAULT_READINESS_TIMEOUT_MS
  );
  const shouldRunReadiness = healthLevel === 'readiness' || healthLevel === 'canary';
  let readiness = null;
  if (shouldRunReadiness) {
    const [primaryReadiness, fallbackReadiness] = await Promise.all([
      runProviderReadinessProbe({
        provider: primaryRuntime.provider,
        model: primaryRuntime.model,
        reasoningEffort: strategy.reasoningEffort,
        timeoutMs: readinessTimeoutMs,
      }),
      runProviderReadinessProbe({
        provider: fallbackRuntime.provider,
        model: fallbackRuntime.model,
        reasoningEffort: strategy.reasoningEffort,
        timeoutMs: readinessTimeoutMs,
      }),
    ]);
    readiness = {
      checkedAt: new Date().toISOString(),
      primary: primaryReadiness,
      fallback: fallbackReadiness,
    };
  }
  const canary = healthLevel === 'canary'
    ? await runStrategyCanaryProbe({
        mode: strategy.defaultMode,
        primaryProvider: primaryRuntime.provider,
        primaryModel: primaryRuntime.model,
        fallbackProvider: fallbackRuntime.provider,
        fallbackModel: fallbackRuntime.model,
        reasoningEffort: strategy.reasoningEffort,
        timeoutMs: readinessTimeoutMs,
      })
    : null;
  const readinessPrimaryOk = readiness ? readiness.primary?.ok === true : null;
  const readinessFallbackOk = readiness ? readiness.fallback?.ok === true : null;
  const canaryOk = canary ? canary.ok === true : null;
  const effectiveStatus = primary.available && fallback.available
    ? 'online'
    : primary.available || fallback.available
      ? 'degraded'
      : 'offline';
  const readinessStatus = readiness
    ? readinessPrimaryOk && readinessFallbackOk
      ? 'online'
      : readinessPrimaryOk || readinessFallbackOk
        ? 'degraded'
        : 'offline'
    : null;
  const finalStatus = canary
    ? canaryOk
      ? (readinessStatus === 'degraded' ? 'degraded' : 'online')
      : 'offline'
    : readinessStatus || effectiveStatus;
  const effectiveMessage = canary
    ? canary.message
    : readiness
      ? readinessStatus === 'online'
        ? 'Default and fallback providers passed real model readiness checks.'
        : readinessStatus === 'degraded'
          ? 'One provider passed readiness and one provider failed.'
          : 'Default and fallback providers failed readiness checks.'
      : effectiveStatus === 'online'
        ? 'Default and fallback providers are available.'
        : effectiveStatus === 'degraded'
          ? primary.available
            ? 'Default provider is available, but fallback is unavailable.'
            : 'Default provider is unavailable, but fallback is available.'
          : 'Default and fallback providers are unavailable.';

  return {
    checkedAt,
    healthLevel,
    defaultMode: strategy.defaultMode,
    reasoningEffort: strategy.reasoningEffort,
    timeoutMs: strategy.timeoutMs,
    primary,
    fallback,
    readiness,
    canary,
    effective: {
      status: finalStatus,
      heartbeatStatus: effectiveStatus,
      readinessStatus,
      canaryStatus: canary ? canary.status : null,
      confidence: canaryOk
        ? 'end-to-end'
        : readiness
          ? readinessStatus === 'online'
            ? 'model-readiness'
            : 'partial-readiness'
          : 'heartbeat',
      tone: finalStatus === 'online' ? 'active' : finalStatus,
      active: finalStatus !== 'offline',
      message: effectiveMessage,
    },
  };
}

async function buildAgentHealth(agentId, runtimeDefaults, availabilityByProvider, runtimeOverrides = {}) {
  const identity = await getAgentIdentity(agentId);
  const profile = identity?.profile || DEFAULT_PROFILES[agentId] || {};
  const enabled = identity?.enabled !== false;
  const runtime = getRuntimeForAgent(agentId, runtimeDefaults, runtimeOverrides);
  const checkedAt = new Date().toISOString();

  if (!enabled) {
    return {
      agentId,
      label: profile.displayName || profile.roleTitle || agentId,
      enabled: false,
      active: false,
      status: 'disabled',
      tone: 'disabled',
      provider: runtime.provider || '',
      providerLabel: runtime.provider ? getProviderLabel(runtime.provider) : '',
      model: safeText(runtime.model),
      message: 'Agent is turned off in its profile.',
      checkedAt,
    };
  }

  if (IMAGE_AGENT_IDS.has(agentId) && !runtime.provider) {
    return {
      agentId,
      label: profile.displayName || profile.roleTitle || agentId,
      enabled: true,
      active: false,
      status: 'offline',
      tone: 'offline',
      provider: '',
      providerLabel: '',
      model: '',
      message: 'Agent is enabled, but no image parser provider is configured.',
      checkedAt,
    };
  }

  const providerStatus = await checkRuntimeProvider(runtime, availabilityByProvider);
  const online = Boolean(providerStatus.available);
  return {
    agentId,
    label: profile.displayName || profile.roleTitle || agentId,
    enabled: true,
    active: online,
    status: online ? 'online' : 'offline',
    tone: online ? 'active' : 'offline',
    provider: providerStatus.provider,
    providerLabel: providerStatus.providerLabel,
    model: providerStatus.model,
    code: providerStatus.code,
    diagnostic: providerStatus.reason || '',
    message: online
      ? `${profile.displayName || agentId} is active on ${formatProviderSummary(providerStatus)}.`
      : formatAvailabilityMessage(providerStatus, 'Agent provider'),
    checkedAt,
  };
}

async function refreshAgentHealth(options = {}) {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    const agentIds = resolveAgentIds(options.agentIds);
    const forceRefresh = options.forceRefresh === true;
    const runtimeDefaults = await listAgentRuntimeDefaults(agentIds);
    const runtimeOverrides = options.runtimeOverrides && typeof options.runtimeOverrides === 'object'
      ? options.runtimeOverrides
      : {};
    const availabilityByProvider = needsSharedProviderAvailability(agentIds, runtimeDefaults, runtimeOverrides)
      ? await checkProviderAvailability({ forceRefresh })
      : {};
    const entries = await Promise.all(
      agentIds.map((agentId) => buildAgentHealth(agentId, runtimeDefaults, availabilityByProvider, runtimeOverrides))
    );

    const checkedAt = new Date().toISOString();
    for (const entry of entries) {
      healthByAgentId.set(entry.agentId, entry);
    }
    lastCheckedAt = checkedAt;
    return {
      checkedAt,
      agents: Object.fromEntries(entries.map((entry) => [entry.agentId, clone(entry)])),
    };
  })().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

async function getAgentHealthSnapshot(options = {}) {
  const agentIds = resolveAgentIds(options.agentIds);
  const ttlMs = toInt(options.ttlMs ?? process.env.AGENT_HEALTH_CACHE_TTL_MS, DEFAULT_AGENT_HEALTH_TTL_MS);
  const now = Date.now();
  const stale = !lastCheckedAt || (now - Date.parse(lastCheckedAt)) > ttlMs;
  const missing = agentIds.some((agentId) => !healthByAgentId.has(agentId));
  const hasRuntimeOverrides = options.runtimeOverrides
    && typeof options.runtimeOverrides === 'object'
    && Object.keys(options.runtimeOverrides).length > 0;

  if (options.forceRefresh || stale || missing || hasRuntimeOverrides) {
    return refreshAgentHealth({
      agentIds,
      runtimeOverrides: options.runtimeOverrides,
      forceRefresh: options.forceRefresh === true,
    });
  }

  return {
    checkedAt: lastCheckedAt,
    agents: Object.fromEntries(agentIds.map((agentId) => [agentId, clone(healthByAgentId.get(agentId))])),
  };
}

function startAgentHealthMonitor(options = {}) {
  stopAgentHealthMonitor();
  const intervalMs = toInt(
    options.intervalMs ?? process.env.AGENT_HEALTH_INTERVAL_MS,
    DEFAULT_AGENT_HEALTH_INTERVAL_MS
  );

  refreshAgentHealth({ forceRefresh: true }).catch((err) => {
    console.warn('[agent-health] Startup health check failed:', err.message);
  });

  healthTimer = setInterval(() => {
    refreshAgentHealth({ forceRefresh: true }).catch((err) => {
      console.warn('[agent-health] Scheduled health check failed:', err.message);
    });
  }, intervalMs);
  if (healthTimer.unref) healthTimer.unref();
}

function stopAgentHealthMonitor() {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
}

module.exports = {
  checkProviderStrategyHealth,
  getAgentHealthSnapshot,
  refreshAgentHealth,
  startAgentHealthMonitor,
  stopAgentHealthMonitor,
};
