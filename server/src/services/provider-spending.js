'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const UsageLog = require('../models/UsageLog');
const { resolveApiKey } = require('./image-parser');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'provider-spending.json');
const CREDENTIALS_FILE = path.join(__dirname, '..', '..', 'data', 'provider-spending-keys.json');
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

const PROVIDERS = Object.freeze({
  claude: {
    label: 'Claude CLI',
    reportingMode: 'local-subscription',
    summary: 'Claude CLI is subscription-backed. This app can show only the usage and estimated cost it observed.',
  },
  anthropic: {
    label: 'Anthropic API',
    reportingMode: 'organization-cost',
    environmentVariable: 'ANTHROPIC_ADMIN_KEY',
    setupUrl: 'https://platform.claude.com/docs/en/manage-claude/admin-api-keys',
    billingUrl: 'https://platform.claude.com/',
    summary: 'Provider-reported organization spend requires a separate Anthropic Admin API key.',
  },
  'llm-gateway': {
    label: 'LLM Gateway API',
    reportingMode: 'gateway-usage',
    usesModelKey: true,
    summary: 'The gateway can report billed usage, remaining limits, and prepaid credit for managed keys.',
  },
  codex: {
    label: 'Codex CLI',
    reportingMode: 'local-subscription',
    summary: 'Codex CLI is workspace or subscription-backed. This app can show only the usage and estimated cost it observed.',
  },
  openai: {
    label: 'OpenAI API',
    reportingMode: 'organization-cost',
    environmentVariable: 'OPENAI_ADMIN_KEY',
    setupUrl: 'https://platform.openai.com/settings/organization/admin-keys',
    billingUrl: 'https://platform.openai.com/usage',
    summary: 'Provider-reported organization spend requires a separate OpenAI Admin API key. OpenAI does not document an API for the prepaid cash balance.',
  },
  gemini: {
    label: 'Google Gemini API',
    reportingMode: 'billing-page-only',
    setupUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    billingUrl: 'https://aistudio.google.com/app/billing',
    summary: 'Google exposes the current Gemini prepaid balance in AI Studio, not through the Gemini model API. The app shows its own observed estimate.',
  },
  kimi: {
    label: 'Kimi API',
    reportingMode: 'account-balance',
    usesModelKey: true,
    setupUrl: 'https://platform.kimi.ai/docs/api/overview',
    billingUrl: 'https://platform.kimi.ai/',
    summary: 'Kimi exposes available, voucher, and cash balances through the normal Kimi API key.',
  },
  'lm-studio': {
    label: 'LM Studio (Local)',
    reportingMode: 'local-no-bill',
    summary: 'LM Studio runs locally and has no provider credit balance. Local hardware and electricity costs are not estimated here.',
  },
});

const LOCAL_USAGE_ALIASES = Object.freeze({
  claude: ['claude'],
  anthropic: ['anthropic'],
  'llm-gateway': ['llm-gateway'],
  codex: ['codex'],
  openai: ['openai'],
  gemini: ['gemini'],
  kimi: ['kimi'],
  'lm-studio': ['lm-studio'],
});

class ProviderSpendingError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'ProviderSpendingError';
    this.code = code;
    this.status = status;
  }
}

function assertProvider(providerId) {
  const normalized = String(providerId || '').trim();
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, normalized)) {
    throw new ProviderSpendingError('INVALID_PROVIDER', `Unknown provider: ${normalized || '(empty)'}`, 400);
  }
  return normalized;
}

function monthWindow(now = new Date()) {
  const current = new Date(now);
  const start = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const end = new Date(current);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix: Math.floor(end.getTime() / 1000),
  };
}

function finiteNumber(value) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isFinite(number) ? number : null;
}

function roundUsd(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number * 1_000_000) / 1_000_000;
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1, providers: {} };
    return {
      version: 1,
      providers: parsed.providers && typeof parsed.providers === 'object' && !Array.isArray(parsed.providers)
        ? parsed.providers
        : {},
    };
  } catch {
    return { version: 1, providers: {} };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function recordAttempt(providerId, patch) {
  const state = readState();
  const current = state.providers[providerId] && typeof state.providers[providerId] === 'object'
    ? state.providers[providerId]
    : {};
  state.providers[providerId] = { ...current, ...patch };
  writeState(state);
  return state.providers[providerId];
}

function readStoredReportingKeys() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredReportingKeys(keys) {
  fs.mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(keys, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(CREDENTIALS_FILE, 0o600); } catch { /* Windows permissions are inherited from the user profile. */ }
}

function assertReportingKeyProvider(providerId) {
  const normalized = assertProvider(providerId);
  if (!PROVIDERS[normalized].environmentVariable) {
    throw new ProviderSpendingError(
      'REPORTING_KEY_NOT_SUPPORTED',
      `${PROVIDERS[normalized].label} does not use a separate reporting key.`,
      400
    );
  }
  return normalized;
}

function resolveReportingCredential(providerId, { env = process.env, readKeysFn = readStoredReportingKeys } = {}) {
  const normalized = assertReportingKeyProvider(providerId);
  const stored = String(readKeysFn()[normalized] || '').trim();
  if (stored) return { key: stored, source: 'saved' };
  const environmentVariable = PROVIDERS[normalized].environmentVariable;
  const environmentKey = String(env[environmentVariable] || '').trim();
  return environmentKey
    ? { key: environmentKey, source: 'environment' }
    : { key: '', source: 'missing' };
}

function setStoredReportingKey(providerId, key, {
  readKeysFn = readStoredReportingKeys,
  writeKeysFn = writeStoredReportingKeys,
} = {}) {
  const normalized = assertReportingKeyProvider(providerId);
  const nextKey = String(key || '').trim();
  if (nextKey.length > 10_000) {
    throw new ProviderSpendingError('REPORTING_KEY_TOO_LONG', 'The reporting key is unexpectedly long.', 400);
  }
  const keys = readKeysFn();
  if (nextKey) keys[normalized] = nextKey;
  else delete keys[normalized];
  writeKeysFn(keys);
}

function safeProviderMessage(body, fallback) {
  const candidates = [
    body?.error?.message,
    body?.error,
    body?.message,
    body?.detail,
  ];
  const selected = candidates.find((value) => typeof value === 'string' && value.trim());
  return String(selected || fallback)
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-[a-z0-9_-]{8,}|AIza[a-z0-9_-]{20,}|[a-z0-9_-]{40,})\b/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function requestJson({ url, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const target = new URL(url);
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(target.hostname);
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && isLoopback)) {
    return Promise.reject(new ProviderSpendingError(
      'UNSAFE_REPORTING_URL',
      'Provider reporting requires HTTPS, except for a loopback-only local gateway.',
      500
    ));
  }
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(target, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new ProviderSpendingError('REPORT_TOO_LARGE', 'Provider reporting response was unexpectedly large.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          reject(new ProviderSpendingError('INVALID_PROVIDER_RESPONSE', 'Provider reporting returned invalid JSON.'));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const code = response.statusCode === 401 || response.statusCode === 403
            ? 'INVALID_REPORTING_CREDENTIAL'
            : response.statusCode === 429
              ? 'REPORTING_RATE_LIMITED'
              : 'PROVIDER_REPORT_FAILED';
          reject(new ProviderSpendingError(
            code,
            safeProviderMessage(body, `Provider reporting failed with HTTP ${response.statusCode}.`),
            response.statusCode === 401 || response.statusCode === 403 ? 401
              : response.statusCode === 429 ? 429 : 502
          ));
          return;
        }
        resolve(body);
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new ProviderSpendingError('REPORTING_TIMEOUT', 'Provider reporting timed out.', 504));
    });
    request.on('error', (error) => {
      reject(error instanceof ProviderSpendingError
        ? error
        : new ProviderSpendingError('PROVIDER_REPORT_FAILED', 'Provider reporting could not be reached.'));
    });
    request.end();
  });
}

function parseOpenAiReport(body, window) {
  const spendUsd = (Array.isArray(body?.data) ? body.data : []).reduce((bucketTotal, bucket) => (
    bucketTotal + (Array.isArray(bucket?.results) ? bucket.results : []).reduce((resultTotal, result) => {
      const amount = finiteNumber(result?.amount?.value);
      return resultTotal + (amount === null ? 0 : amount);
    }, 0)
  ), 0);
  return {
    source: 'provider',
    kind: 'organization-spend',
    periodStart: window.startIso,
    periodEnd: window.endIso,
    spendUsd: roundUsd(spendUsd),
    balanceUsd: null,
    currency: 'USD',
    note: 'Organization costs reported by OpenAI. The documented API does not return prepaid cash balance.',
  };
}

function parseAnthropicReport(body, window) {
  const spendCents = (Array.isArray(body?.data) ? body.data : []).reduce((bucketTotal, bucket) => (
    bucketTotal + (Array.isArray(bucket?.results) ? bucket.results : []).reduce((resultTotal, result) => {
      const amount = finiteNumber(result?.amount);
      return resultTotal + (amount === null ? 0 : amount);
    }, 0)
  ), 0);
  return {
    source: 'provider',
    kind: 'organization-spend',
    periodStart: window.startIso,
    periodEnd: window.endIso,
    spendUsd: roundUsd(spendCents / 100),
    balanceUsd: null,
    currency: 'USD',
    note: 'Organization costs reported by Anthropic in fractional cents. Credits and prepaid balance are not included.',
  };
}

function parseKimiReport(body, window) {
  if (body?.status !== true || !body?.data || finiteNumber(body.data.available_balance) === null) {
    throw new ProviderSpendingError('INVALID_PROVIDER_RESPONSE', 'Kimi returned an unexpected balance response.');
  }
  return {
    source: 'provider',
    kind: 'account-balance',
    periodStart: window.startIso,
    periodEnd: window.endIso,
    spendUsd: null,
    balanceUsd: roundUsd(body.data.available_balance),
    cashBalanceUsd: roundUsd(body.data.cash_balance),
    voucherBalanceUsd: roundUsd(body.data.voucher_balance),
    currency: 'USD',
    note: 'Available, cash, and voucher balances reported by Kimi for the configured API key.',
  };
}

function parseGatewayReport(body, window) {
  const currentUsage = body?.currentBillingPeriod?.usage || {};
  const credits = body?.credits || null;
  const status = body?.currentBillingPeriod?.status || null;
  return {
    source: 'provider',
    kind: 'gateway-usage',
    periodStart: body?.currentBillingPeriod?.start || window.startIso,
    periodEnd: body?.currentBillingPeriod?.end || window.endIso,
    spendUsd: roundUsd(currentUsage.totalCostUsd ?? body?.usage?.totalCostUsd),
    balanceUsd: credits ? roundUsd(credits.balanceUsd) : null,
    remainingBudgetUsd: status ? roundUsd(status.remainingCostUsd) : null,
    remainingRequests: finiteNumber(status?.remainingRequests),
    remainingTokens: finiteNumber(status?.remainingTokens),
    currency: 'USD',
    note: credits
      ? 'Billed usage and prepaid balance reported by the managed gateway key.'
      : 'Billed usage reported by the gateway. Static operator keys do not have a prepaid user balance.',
  };
}

async function getCredentialStatus(providerId, deps = {}) {
  const config = PROVIDERS[providerId];
  if (config.environmentVariable) {
    const resolveReportingCredentialFn = deps.resolveReportingCredentialFn || resolveReportingCredential;
    const resolved = resolveReportingCredentialFn(providerId, {
      env: deps.env || process.env,
      readKeysFn: deps.readReportingKeysFn,
    });
    return {
      required: true,
      configured: Boolean(resolved.key),
      source: resolved.source,
      environmentVariable: config.environmentVariable,
      label: providerId === 'anthropic' ? 'Admin API key' : 'Admin key',
      uiManaged: true,
    };
  }
  if (config.usesModelKey) {
    const resolveApiKeyFn = deps.resolveApiKeyFn || resolveApiKey;
    const key = await resolveApiKeyFn(providerId);
    return {
      required: true,
      configured: Boolean(key),
      source: key ? 'model-key' : 'missing',
      environmentVariable: null,
      label: 'Existing API key',
    };
  }
  return {
    required: false,
    configured: true,
    source: 'not-required',
    environmentVariable: null,
    label: 'No reporting key',
  };
}

async function getLocalObserved(providerId, { usageModel = UsageLog, now = new Date() } = {}) {
  const window = monthWindow(now);
  if (!usageModel?.db || usageModel.db.readyState !== 1) {
    return {
      available: false,
      reason: 'The usage database is not connected.',
      periodStart: window.startIso,
      periodEnd: window.endIso,
    };
  }
  const aliases = LOCAL_USAGE_ALIASES[providerId] || [providerId];
  let rows;
  try {
    rows = await usageModel.aggregate([
      { $match: { provider: { $in: aliases }, createdAt: { $gte: window.start, $lte: window.end } } },
      {
        $group: {
          _id: null,
          requests: { $sum: 1 },
          totalTokens: { $sum: '$totalTokens' },
          totalCostNanos: { $sum: '$totalCostNanos' },
          usageAvailableCount: { $sum: { $cond: ['$usageAvailable', 1, 0] } },
          fullyCostedCount: { $sum: { $cond: ['$usageComplete', 1, 0] } },
        },
      },
    ]);
  } catch {
    return {
      available: false,
      reason: 'App-observed usage could not be read.',
      periodStart: window.startIso,
      periodEnd: window.endIso,
    };
  }
  const row = rows[0] || {};
  const requests = Number(row.requests || 0);
  return {
    available: true,
    source: 'app-observed',
    periodStart: window.startIso,
    periodEnd: window.endIso,
    requests,
    totalTokens: Number(row.totalTokens || 0),
    spendUsd: roundUsd(Number(row.totalCostNanos || 0) / 1_000_000_000),
    usageCoveragePercent: requests > 0 ? Math.round((Number(row.usageAvailableCount || 0) / requests) * 1000) / 10 : 0,
    fullyCostedPercent: requests > 0 ? Math.round((Number(row.fullyCostedCount || 0) / requests) * 1000) / 10 : 0,
  };
}

function canRefresh(config) {
  return ['organization-cost', 'gateway-usage', 'account-balance'].includes(config.reportingMode);
}

async function getProviderSpendingSnapshot(providerId, deps = {}) {
  const normalized = assertProvider(providerId);
  const config = PROVIDERS[normalized];
  const [credential, localObserved] = await Promise.all([
    getCredentialStatus(normalized, deps),
    getLocalObserved(normalized, deps),
  ]);
  const readStateFn = deps.readStateFn || readState;
  const cached = readStateFn().providers[normalized] || {};
  const gatewayBaseUrl = String((deps.env || process.env).LLM_GATEWAY_API_URL || 'http://127.0.0.1:4100').replace(/\/+$/, '');
  return {
    providerId: normalized,
    label: config.label,
    reportingMode: config.reportingMode,
    canRefresh: canRefresh(config),
    summary: config.summary,
    setupUrl: config.setupUrl || null,
    billingUrl: normalized === 'llm-gateway' ? gatewayBaseUrl : config.billingUrl || null,
    credential,
    providerReport: cached.report || null,
    lastAttemptedAt: cached.lastAttemptedAt || null,
    lastSuccessfulAt: cached.lastSuccessfulAt || null,
    lastError: cached.lastError || null,
    localObserved,
  };
}

async function refreshProviderSpending(providerId, deps = {}) {
  const normalized = assertProvider(providerId);
  const config = PROVIDERS[normalized];
  if (!canRefresh(config)) {
    throw new ProviderSpendingError(
      'PROVIDER_REPORT_NOT_AVAILABLE',
      `${config.label} does not expose a provider reporting endpoint supported by this app.`,
      409
    );
  }
  const env = deps.env || process.env;
  const requestJsonFn = deps.requestJsonFn || requestJson;
  const resolveApiKeyFn = deps.resolveApiKeyFn || resolveApiKey;
  const resolveReportingCredentialFn = deps.resolveReportingCredentialFn || resolveReportingCredential;
  const recordAttemptFn = deps.recordAttemptFn || recordAttempt;
  const now = deps.now ? new Date(deps.now) : new Date();
  const window = monthWindow(now);
  const attemptedAt = now.toISOString();
  let report;
  try {
    if (normalized === 'openai') {
      const key = resolveReportingCredentialFn('openai', { env, readKeysFn: deps.readReportingKeysFn }).key;
      if (!key) throw new ProviderSpendingError('REPORTING_CREDENTIAL_REQUIRED', 'Add an OpenAI admin reporting key in AI Management first.', 400);
      const query = new URLSearchParams({
        start_time: String(window.startUnix),
        end_time: String(window.endUnix),
        bucket_width: '1d',
        limit: '31',
      });
      const body = await requestJsonFn({
        url: `https://api.openai.com/v1/organization/costs?${query}`,
        headers: { Authorization: `Bearer ${key}` },
      });
      report = parseOpenAiReport(body, window);
    } else if (normalized === 'anthropic') {
      const key = resolveReportingCredentialFn('anthropic', { env, readKeysFn: deps.readReportingKeysFn }).key;
      if (!key) throw new ProviderSpendingError('REPORTING_CREDENTIAL_REQUIRED', 'Add an Anthropic admin reporting key in AI Management first.', 400);
      const query = new URLSearchParams({
        starting_at: window.startIso,
        ending_at: window.endIso,
        bucket_width: '1d',
        limit: '31',
      });
      const body = await requestJsonFn({
        url: `https://api.anthropic.com/v1/organizations/cost_report?${query}`,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      report = parseAnthropicReport(body, window);
    } else if (normalized === 'kimi') {
      const key = await resolveApiKeyFn('kimi');
      if (!key) throw new ProviderSpendingError('REPORTING_CREDENTIAL_REQUIRED', 'Configure the Kimi API key before checking its balance.', 400);
      const body = await requestJsonFn({
        url: 'https://api.moonshot.ai/v1/users/me/balance',
        headers: { Authorization: `Bearer ${key}` },
      });
      report = parseKimiReport(body, window);
    } else if (normalized === 'llm-gateway') {
      const key = await resolveApiKeyFn('llm-gateway');
      if (!key) throw new ProviderSpendingError('REPORTING_CREDENTIAL_REQUIRED', 'Configure the gateway API key before checking spending.', 400);
      const baseUrl = String(env.LLM_GATEWAY_API_URL || 'http://127.0.0.1:4100').replace(/\/+$/, '');
      const days = Math.max(1, Math.min(90, Math.ceil((window.end.getTime() - window.start.getTime()) / 86_400_000) + 1));
      const body = await requestJsonFn({
        url: `${baseUrl}/v1/usage?days=${days}&limit=1`,
        headers: { Authorization: `Bearer ${key}` },
      });
      report = parseGatewayReport(body, window);
    }
    const checkedAt = new Date().toISOString();
    recordAttemptFn(normalized, {
      report: { ...report, checkedAt },
      lastAttemptedAt: attemptedAt,
      lastSuccessfulAt: checkedAt,
      lastError: null,
    });
  } catch (error) {
    const normalizedError = error instanceof ProviderSpendingError
      ? error
      : new ProviderSpendingError('PROVIDER_REPORT_FAILED', 'Provider reporting could not be refreshed.');
    recordAttemptFn(normalized, {
      lastAttemptedAt: attemptedAt,
      lastError: {
        code: normalizedError.code,
        message: normalizedError.message,
        checkedAt: new Date().toISOString(),
      },
    });
    throw normalizedError;
  }
  return getProviderSpendingSnapshot(normalized, deps);
}

module.exports = {
  ProviderSpendingError,
  getProviderSpendingSnapshot,
  refreshProviderSpending,
  setStoredReportingKey,
};

module.exports._internal = {
  LOCAL_USAGE_ALIASES,
  PROVIDERS,
  CREDENTIALS_FILE,
  STATE_FILE,
  getCredentialStatus,
  getLocalObserved,
  monthWindow,
  parseAnthropicReport,
  parseGatewayReport,
  parseKimiReport,
  parseOpenAiReport,
  requestJson,
  resolveReportingCredential,
  roundUsd,
  safeProviderMessage,
};
