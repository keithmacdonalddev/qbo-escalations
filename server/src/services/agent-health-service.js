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

function emitTrace(trace, step = {}) {
  if (typeof trace !== 'function') return;
  try {
    trace(step);
  } catch {
    // Lifecycle trace failures should never change the health result.
  }
}

async function traceHealthCall(trace, step, call) {
  const startedAt = new Date();
  try {
    const result = typeof call === 'function' ? await call() : undefined;
    emitTrace(trace, {
      ...step,
      status: step.status || 'success',
      startedAt,
      completedAt: new Date(),
    });
    return result;
  } catch (err) {
    emitTrace(trace, {
      ...step,
      status: 'error',
      summary: err.message || step.summary || `${step.functionName || step.name} failed`,
      detail: err.stack || err.message || '',
      startedAt,
      completedAt: new Date(),
    });
    throw err;
  }
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

async function checkRuntimeProvider(runtime, availabilityByProvider, trace = null) {
  const provider = normalizeProvider(runtime?.provider || getDefaultProvider());
  const transport = getProviderTransport(provider);
  const model = safeText(runtime?.model) || getProviderModelId(provider) || provider;
  emitTrace(trace, {
    name: 'Resolve runtime provider transport',
    functionName: 'checkRuntimeProvider',
    check: 'normalizeProvider and getProviderTransport returned a provider transport',
    status: 'info',
    summary: `${provider} uses ${transport || 'unknown'} transport.`,
    metadata: { provider, transport, model },
  });

  if (transport === 'codex') {
    const cli = await traceHealthCall(trace, {
      name: 'Check Codex CLI availability',
      functionName: 'checkCli',
      check: 'codex --version completes before timeout',
      summary: 'Codex CLI availability check completed.',
      metadata: { provider, command: 'codex --version' },
    }, () => checkCli('codex'));
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
    const cli = await traceHealthCall(trace, {
      name: 'Check Claude CLI availability',
      functionName: 'checkCli',
      check: 'claude --version completes before timeout',
      summary: 'Claude CLI availability check completed.',
      metadata: { provider, command: 'claude --version' },
    }, () => checkCli('claude'));
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
  emitTrace(trace, {
    name: 'Read shared provider availability',
    functionName: 'checkRuntimeProvider',
    check: 'Shared provider availability map includes the selected provider',
    status: status ? (status.available ? 'success' : 'warning') : 'warning',
    summary: status
      ? `${getProviderLabel(provider)} shared availability is ${status.available ? 'available' : 'unavailable'}.`
      : `${getProviderLabel(provider)} did not have a shared availability result.`,
    metadata: { provider, code: status?.code || '', available: Boolean(status?.available) },
  });
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

async function buildAgentHealth(agentId, runtimeDefaults, availabilityByProvider, runtimeOverrides = {}, trace = null) {
  const identity = await traceHealthCall(trace, {
    name: 'Load agent identity for health',
    functionName: 'getAgentIdentity',
    check: 'Health refresh can read the current merged agent identity',
    summary: `Loaded identity for health refresh: ${agentId}.`,
    metadata: { agentId },
  }, () => getAgentIdentity(agentId));
  const profile = identity?.profile || DEFAULT_PROFILES[agentId] || {};
  const enabled = identity?.enabled !== false;
  const runtime = getRuntimeForAgent(agentId, runtimeDefaults, runtimeOverrides);
  const checkedAt = new Date().toISOString();
  emitTrace(trace, {
    name: 'Evaluate lifecycle enabled flag',
    functionName: 'buildAgentHealth',
    check: 'identity.enabled !== false',
    status: 'success',
    summary: `${agentId} is ${enabled ? 'enabled' : 'disabled'} after lifecycle update.`,
    metadata: { agentId, enabled },
  });
  emitTrace(trace, {
    name: 'Resolve runtime settings for health',
    functionName: 'getRuntimeForAgent',
    check: 'Saved runtime, override runtime, or default runtime can be normalized',
    status: runtime?.configured === false && IMAGE_AGENT_IDS.has(agentId) ? 'warning' : 'success',
    summary: runtime?.provider
      ? `${agentId} runtime provider resolved to ${runtime.provider}.`
      : `${agentId} does not have a runtime provider configured.`,
    metadata: { agentId, provider: runtime?.provider || '', configured: runtime?.configured !== false },
  });

  if (!enabled) {
    emitTrace(trace, {
      name: 'Build disabled health entry',
      functionName: 'buildAgentHealth',
      check: 'Disabled agents are marked inactive without provider probes',
      status: 'success',
      summary: `${agentId} health is disabled and inactive.`,
      metadata: { agentId, status: 'disabled' },
    });
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
    emitTrace(trace, {
      name: 'Check image parser runtime provider',
      functionName: 'buildAgentHealth',
      check: 'Image-capable agents require a configured runtime provider when enabled',
      status: 'warning',
      summary: `${agentId} is enabled but has no image parser provider configured.`,
      metadata: { agentId },
    });
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

  const providerStatus = await checkRuntimeProvider(runtime, availabilityByProvider, trace);
  const online = Boolean(providerStatus.available);
  emitTrace(trace, {
    name: 'Build active provider health entry',
    functionName: 'buildAgentHealth',
    check: 'Provider status determines active/offline health result',
    status: online ? 'success' : 'warning',
    summary: online
      ? `${agentId} provider health is online.`
      : `${agentId} provider health is offline.`,
    metadata: {
      agentId,
      provider: providerStatus.provider,
      code: providerStatus.code || '',
      available: online,
    },
  });
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
  const trace = typeof options.trace === 'function' ? options.trace : null;
  if (inFlightRefresh) {
    emitTrace(trace, {
      name: 'Reuse in-flight health refresh',
      functionName: 'refreshAgentHealth',
      check: 'Only one health refresh runs at a time',
      status: 'info',
      summary: 'A health refresh was already running, so this request reused it.',
    });
    return inFlightRefresh;
  }

  inFlightRefresh = (async () => {
    const agentIds = resolveAgentIds(options.agentIds);
    emitTrace(trace, {
      name: 'Resolve health refresh agent ids',
      functionName: 'resolveAgentIds',
      check: 'Requested health ids are normalized',
      status: 'success',
      summary: `Health refresh will check ${agentIds.length} agent${agentIds.length === 1 ? '' : 's'}.`,
      metadata: { agentIds },
    });
    const forceRefresh = options.forceRefresh === true;
    const runtimeDefaults = await traceHealthCall(trace, {
      name: 'Load runtime defaults for health',
      functionName: 'listAgentRuntimeDefaults',
      check: 'MongoDB runtime defaults are readable',
      summary: 'Loaded runtime defaults for health refresh.',
      metadata: { agentIds },
    }, () => listAgentRuntimeDefaults(agentIds));
    const runtimeOverrides = options.runtimeOverrides && typeof options.runtimeOverrides === 'object'
      ? options.runtimeOverrides
      : {};
    emitTrace(trace, {
      name: 'Normalize runtime overrides',
      functionName: 'refreshAgentHealth',
      check: 'Runtime overrides are optional and must be an object',
      status: 'info',
      summary: Object.keys(runtimeOverrides).length
        ? 'Runtime overrides were included in the health refresh.'
        : 'No runtime overrides were included in the health refresh.',
      metadata: { overrideCount: Object.keys(runtimeOverrides).length },
    });
    const requiresSharedAvailability = needsSharedProviderAvailability(agentIds, runtimeDefaults, runtimeOverrides);
    emitTrace(trace, {
      name: 'Check shared provider availability requirement',
      functionName: 'needsSharedProviderAvailability',
      check: 'Non-CLI providers need shared availability probes',
      status: 'success',
      summary: requiresSharedAvailability
        ? 'Shared provider availability probes are required.'
        : 'Shared provider availability probes are not required for this refresh.',
      metadata: { requiresSharedAvailability },
    });
    const availabilityByProvider = requiresSharedAvailability
      ? await traceHealthCall(trace, {
        name: 'Check shared provider availability',
        functionName: 'checkProviderAvailability',
        check: 'Configured non-CLI providers respond or report a known unavailable state',
        summary: 'Shared provider availability check completed.',
        metadata: { forceRefresh },
      }, () => checkProviderAvailability({ forceRefresh, trace }))
      : {};
    const entries = await Promise.all(
      agentIds.map((agentId) => buildAgentHealth(agentId, runtimeDefaults, availabilityByProvider, runtimeOverrides, trace))
    );

    const checkedAt = new Date().toISOString();
    for (const entry of entries) {
      healthByAgentId.set(entry.agentId, entry);
    }
    lastCheckedAt = checkedAt;
    emitTrace(trace, {
      name: 'Update in-memory health cache',
      functionName: 'refreshAgentHealth',
      check: 'Health snapshot cache is updated with latest entries',
      status: 'success',
      summary: `Cached ${entries.length} health entr${entries.length === 1 ? 'y' : 'ies'}.`,
      metadata: { checkedAt, agentIds: entries.map((entry) => entry.agentId) },
    });
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
