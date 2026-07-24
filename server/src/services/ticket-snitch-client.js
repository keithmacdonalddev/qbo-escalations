const crypto = require('crypto');

const SDK_VERSION = 'qbo-escalations/1.0.0';

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function sanitizePageUrl(value) {
  const raw = cleanText(value, 2048);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().slice(0, 2048);
  } catch {
    return '';
  }
}

function safePublicUrl(value) {
  const raw = cleanText(value, 2048);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function configuration(env = process.env) {
  const baseUrl = String(env.TICKET_SNITCH_API_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(env.TICKET_SNITCH_API_KEY || '').trim();
  const evidenceApiKey = String(env.TICKET_SNITCH_EVIDENCE_API_KEY || '').trim();
  const agentApiKey = String(env.TICKET_SNITCH_AGENT_API_KEY || '').trim();
  const projectId = String(env.TICKET_SNITCH_PROJECT_ID || '').trim();
  const configuredDataUseUrl = safePublicUrl(env.TICKET_SNITCH_DATA_USE_URL);
  const dataUseUrl = configuredDataUseUrl || (safePublicUrl(baseUrl) ? `${baseUrl}/data-use` : '');
  const parsedTimeout = Number.parseInt(env.TICKET_SNITCH_TIMEOUT_MS || '8000', 10);
  return {
    baseUrl,
    apiKey,
    evidenceApiKey,
    agentApiKey,
    projectId,
    dataUseUrl,
    timeoutMs: Number.isFinite(parsedTimeout) ? Math.min(30_000, Math.max(1_000, parsedTimeout)) : 8_000,
    configured: Boolean(baseUrl && apiKey && projectId),
    evidenceConfigured: Boolean(baseUrl && evidenceApiKey && projectId),
    agentConfigured: Boolean(baseUrl && agentApiKey && projectId),
  };
}

class TicketSnitchConnectorError extends Error {
  constructor(message, { code = 'TICKET_SNITCH_REQUEST_FAILED', status = 502, requestId = '' } = {}) {
    super(message);
    this.name = 'TicketSnitchConnectorError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

function getConnectorConfig() {
  return configuration();
}

function credentialFor(config, authority) {
  if (authority === 'evidence') return config.evidenceApiKey;
  if (authority === 'agent') return config.agentApiKey;
  return config.apiKey;
}

async function callTicketSnitch(path, { method = 'GET', body, requestId, idempotencyKey, authority = 'report', issueCustomerReceipt = false } = {}) {
  const config = configuration();
  const apiKey = credentialFor(config, authority);
  if (!config.baseUrl || !config.projectId || !apiKey) {
    const code = authority === 'evidence'
      ? 'TICKET_SNITCH_EVIDENCE_NOT_CONFIGURED'
      : authority === 'agent'
        ? 'TICKET_SNITCH_AGENT_NOT_CONFIGURED'
        : 'TICKET_SNITCH_NOT_CONFIGURED';
    throw new TicketSnitchConnectorError('Ticket Snitch is not configured for this server operation.', { code, status: 503 });
  }
  const correlationId = requestId || crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Request-ID': correlationId,
        'X-Ticket-Snitch-Project': config.projectId,
        'X-Ticket-Snitch-SDK': SDK_VERSION,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...(issueCustomerReceipt ? { 'X-Ticket-Snitch-Issue-Receipt': 'true' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new TicketSnitchConnectorError(payload?.error?.message || `Ticket Snitch returned HTTP ${response.status}.`, {
        code: payload?.error?.code || 'TICKET_SNITCH_REQUEST_FAILED', status: response.status, requestId: payload?.requestId || response.headers.get('x-request-id') || correlationId,
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof TicketSnitchConnectorError) throw error;
    if (error.name === 'AbortError') throw new TicketSnitchConnectorError('Ticket Snitch did not respond before the connector timeout.', { code: 'TICKET_SNITCH_TIMEOUT', status: 504, requestId: correlationId });
    throw new TicketSnitchConnectorError('QBO Escalations could not reach Ticket Snitch.', { code: 'TICKET_SNITCH_UNAVAILABLE', status: 502, requestId: correlationId });
  } finally { clearTimeout(timer); }
}

async function callCustomerReceipt(path, { method = 'GET', body, requestId, idempotencyKey, receiptToken } = {}) {
  const config = configuration();
  if (!config.baseUrl || !/^tsr_[0-9a-f-]{36}\.[A-Za-z0-9_-]{40,64}$/.test(String(receiptToken || ''))) {
    throw new TicketSnitchConnectorError('This private report receipt is unavailable or invalid.', {
      code: 'TICKET_SNITCH_CUSTOMER_RECEIPT_INVALID',
      status: 401,
      requestId,
    });
  }
  const correlationId = requestId || crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/customer/receipt${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'X-Ticket-Snitch-Receipt': receiptToken,
        'Content-Type': 'application/json',
        'X-Request-ID': correlationId,
        'X-Ticket-Snitch-SDK': SDK_VERSION,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new TicketSnitchConnectorError(payload?.error?.message || `Ticket Snitch returned HTTP ${response.status}.`, {
        code: payload?.error?.code || 'TICKET_SNITCH_CUSTOMER_RECEIPT_FAILED',
        status: response.status,
        requestId: payload?.requestId || response.headers.get('x-request-id') || correlationId,
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof TicketSnitchConnectorError) throw error;
    if (error.name === 'AbortError') {
      throw new TicketSnitchConnectorError('Ticket Snitch did not respond before the receipt timeout.', {
        code: 'TICKET_SNITCH_TIMEOUT', status: 504, requestId: correlationId,
      });
    }
    throw new TicketSnitchConnectorError('QBO Escalations could not reach Ticket Snitch.', {
      code: 'TICKET_SNITCH_UNAVAILABLE', status: 502, requestId: correlationId,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildReport(input, context = {}, trustedReporter = {}) {
  const config = configuration();
  const diagnosticsRequired = context.diagnosticsRequired === true;
  const pageUrl = sanitizePageUrl(context.pageUrl);
  const capturedAt = cleanText(context.observedAt, 100);
  const reporterActorId = cleanText(trustedReporter.actorId, 128);
  const hasTrustedReporter = Boolean(reporterActorId);
  const safeContext = {
    capturedAt: capturedAt || new Date().toISOString(),
    pageUrl,
    routeName: cleanText(context.routeName, 200),
    sourceRequestId: cleanText(context.sourceRequestId, 128),
    captureEnvironment: cleanText(process.env.NODE_ENV || 'development', 40),
    timezone: cleanText(context.timezone, 120),
    diagnosticsRequired,
    consent: {
      diagnostics: false,
      screenshot: context.screenshotApproved === true,
      reply: hasTrustedReporter,
    },
    environment: {
      appVersion: cleanText(context.appVersion || process.env.npm_package_version, 120),
      requestId: cleanText(context.sourceRequestId, 128),
      browser: cleanText(context.browser, 500),
      viewport: cleanText(context.viewport, 80),
      locale: cleanText(context.locale, 80),
      errorCode: cleanText(context.errorCode, 200),
      ipAddress: cleanText(context.ipAddress, 80),
    },
  };
  return {
    projectId: config.projectId,
    type: input.type,
    title: input.title,
    originalReport: input.originalReport,
    description: input.description || '',
    productArea: input.productArea || '',
    priority: input.priority || 'none',
    severity: input.severity || 'none',
    ownerId: input.ownerId || '',
    nextAction: input.nextAction || '',
    tags: Array.isArray(input.tags) ? input.tags : [],
    source: { kind: 'project_api', url: pageUrl, externalId: safeContext.sourceRequestId },
    reporter: {
      actorId: reporterActorId,
      displayName: cleanText(trustedReporter.displayName, 200),
      email: cleanText(trustedReporter.email, 320),
      wantsReply: hasTrustedReporter,
    },
    details: safeContext,
  };
}

async function reportWork(input, context = {}, requestId = '', trustedReporter = {}) {
  const config = configuration();
  const sourceIdentity = String(context.submissionId || context.sourceRequestId || requestId || crypto.randomUUID()).slice(0, 128);
  const idempotencyKey = crypto.createHash('sha256').update(`qbo:${config.projectId}:${sourceIdentity}`).digest('hex');
  return callTicketSnitch('/work-items', {
    method: 'POST',
    body: buildReport(input, context, trustedReporter),
    requestId,
    idempotencyKey,
    issueCustomerReceipt: Boolean(cleanText(trustedReporter.actorId, 128)),
  });
}

const getWork = (identifier, requestId) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}`, { requestId, authority: 'agent' });
const updateWork = (identifier, changes, requestId) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}`, { method: 'PATCH', body: changes, requestId, authority: 'agent' });
const commentOnWork = (identifier, comment, requestId) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}/comments`, { method: 'POST', body: comment, requestId, authority: 'agent' });
const transitionWork = (identifier, transition, requestId) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}/transitions`, { method: 'POST', body: transition, requestId, authority: 'agent' });
const attachEvidence = (identifier, evidence, requestId, { idempotencyKey, authority = 'report' } = {}) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}/evidence/base64`, {
  method: 'POST',
  body: evidence,
  requestId,
  idempotencyKey,
  authority,
});
const checkConnection = (requestId, { authority = 'report' } = {}) => {
  const config = configuration();
  return callTicketSnitch(`/projects/${encodeURIComponent(config.projectId)}`, { requestId, authority });
};

function screenshotEvidenceIdempotencyKey(submissionId) {
  const config = configuration();
  return crypto
    .createHash('sha256')
    .update(`qbo-screenshot:${config.projectId}:${String(submissionId || '').slice(0, 128)}`)
    .digest('hex');
}

const getCustomerReceipt = (receiptToken, requestId) => callCustomerReceipt('', {
  receiptToken,
  requestId,
});

const replyToCustomerReceipt = (receiptToken, body, actionId, requestId) => callCustomerReceipt('/replies', {
  method: 'POST',
  body: { body },
  receiptToken,
  idempotencyKey: actionId,
  requestId,
});

const validateCustomerReceipt = (receiptToken, input, actionId, requestId) => callCustomerReceipt('/validation', {
  method: 'POST',
  body: input,
  receiptToken,
  idempotencyKey: actionId,
  requestId,
});

module.exports = {
  TicketSnitchConnectorError,
  attachEvidence,
  buildReport,
  callCustomerReceipt,
  callTicketSnitch,
  checkConnection,
  commentOnWork,
  getConnectorConfig,
  getCustomerReceipt,
  getWork,
  replyToCustomerReceipt,
  reportWork,
  screenshotEvidenceIdempotencyKey,
  transitionWork,
  updateWork,
  validateCustomerReceipt,
};
