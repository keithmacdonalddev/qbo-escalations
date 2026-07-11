const crypto = require('crypto');

const SDK_VERSION = 'qbo-escalations/1.0.0';

function configuration(env = process.env) {
  const baseUrl = String(env.TICKET_SNITCH_API_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(env.TICKET_SNITCH_API_KEY || '').trim();
  const projectId = String(env.TICKET_SNITCH_PROJECT_ID || '').trim();
  const parsedTimeout = Number.parseInt(env.TICKET_SNITCH_TIMEOUT_MS || '8000', 10);
  return {
    baseUrl,
    apiKey,
    projectId,
    timeoutMs: Number.isFinite(parsedTimeout) ? Math.min(30_000, Math.max(1_000, parsedTimeout)) : 8_000,
    configured: Boolean(baseUrl && apiKey && projectId),
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

async function callTicketSnitch(path, { method = 'GET', body, requestId, idempotencyKey } = {}) {
  const config = configuration();
  if (!config.configured) throw new TicketSnitchConnectorError('Ticket Snitch is not configured for this server.', { code: 'TICKET_SNITCH_NOT_CONFIGURED', status: 503 });
  const correlationId = requestId || crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-Request-ID': correlationId,
        'X-Ticket-Snitch-Project': config.projectId,
        'X-Ticket-Snitch-SDK': SDK_VERSION,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
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

function buildReport(input, context = {}, trustedReporter = {}) {
  const config = configuration();
  const safeContext = {
    pageUrl: String(context.pageUrl || '').slice(0, 2048),
    routeName: String(context.routeName || '').slice(0, 200),
    browser: String(context.browser || '').slice(0, 500),
    appVersion: String(context.appVersion || process.env.npm_package_version || '').slice(0, 120),
    errorCode: String(context.errorCode || '').slice(0, 200),
    observedAt: String(context.observedAt || new Date().toISOString()).slice(0, 100),
    sourceRequestId: String(context.sourceRequestId || '').slice(0, 128),
    captureEnvironment: String(process.env.NODE_ENV || 'development').slice(0, 40),
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
    source: { kind: 'project_api', url: safeContext.pageUrl, externalId: safeContext.sourceRequestId },
    reporter: {
      actorId: String(trustedReporter.actorId || '').slice(0, 200),
      displayName: String(trustedReporter.displayName || '').slice(0, 200),
      email: '',
      wantsReply: Boolean(input.wantsReply),
    },
    details: safeContext,
  };
}

async function reportWork(input, context = {}, requestId = '', trustedReporter = {}) {
  const config = configuration();
  const sourceIdentity = String(context.sourceRequestId || requestId || crypto.randomUUID()).slice(0, 128);
  const idempotencyKey = crypto.createHash('sha256').update(`qbo:${config.projectId}:${sourceIdentity}`).digest('hex');
  return callTicketSnitch('/work-items', { method: 'POST', body: buildReport(input, context, trustedReporter), requestId, idempotencyKey });
}

const getWork = (identifier, requestId) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}`, { requestId });
const updateWork = (identifier, changes, requestId) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}`, { method: 'PATCH', body: changes, requestId });
const commentOnWork = (identifier, comment, requestId) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}/comments`, { method: 'POST', body: comment, requestId });
const transitionWork = (identifier, transition, requestId) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}/transitions`, { method: 'POST', body: transition, requestId });
const attachEvidence = (identifier, evidence, requestId) => callTicketSnitch(`/work-items/${encodeURIComponent(identifier)}/evidence/base64`, { method: 'POST', body: evidence, requestId });
const checkConnection = (requestId) => { const config = configuration(); return callTicketSnitch(`/projects/${encodeURIComponent(config.projectId)}`, { requestId }); };

module.exports = { TicketSnitchConnectorError, attachEvidence, buildReport, callTicketSnitch, checkConnection, commentOnWork, getConnectorConfig, getWork, reportWork, transitionWork, updateWork };
