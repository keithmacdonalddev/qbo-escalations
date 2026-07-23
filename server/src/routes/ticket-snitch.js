const crypto = require('crypto');
const express = require('express');
const {
  attachEvidence,
  checkConnection,
  commentOnWork,
  getConnectorConfig,
  getWork,
  reportWork,
  screenshotEvidenceIdempotencyKey,
  transitionWork,
  updateWork,
} = require('../services/ticket-snitch-client');
const {
  ScreenshotValidationError,
  prepareScreenshotEvidence,
} = require('../services/ticket-snitch-screenshot');
const { createRateLimiter } = require('../middleware/rate-limit');
const { requireReportingUser } = require('../middleware/app-auth');

const router = express.Router();
const TYPES = new Set(['problem_report', 'feature_request', 'improvement', 'task', 'maintenance', 'incident', 'idea', 'decision', 'question', 'agent_discovered_problem']);
const PRIORITIES = new Set(['none', 'low', 'medium', 'high', 'urgent']);
const SEVERITIES = new Set(['none', 'minor', 'moderate', 'major', 'critical']);
const USER_REPORT_TYPES = new Map([
  ['problem', 'problem_report'],
  ['feature', 'feature_request'],
  ['feedback', 'improvement'],
]);
const REPORT_TOKEN_TTL_MS = 15 * 60 * 1000;
const reportTokenSecret = crypto.randomBytes(32);

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function allowedReportOrigins(env = process.env) {
  return new Set(
    String(env.TICKET_SNITCH_REPORT_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
}

function requestOrigin(req) {
  const direct = cleanText(req.headers.origin, 2048);
  if (direct) return direct.replace(/\/+$/, '');
  const referer = cleanText(req.headers.referer, 2048);
  if (referer) {
    try { return new URL(referer).origin; } catch { return ''; }
  }
  return '';
}

function sameServerOrigin(req, origin) {
  if (!origin) return false;
  const protocol = req.protocol || 'http';
  const host = cleanText(req.headers.host, 300);
  return origin === `${protocol}://${host}`.replace(/\/+$/, '');
}

function safeReportedPageUrl(value, origin) {
  try {
    const parsed = new URL(cleanText(value, 2048));
    if (parsed.origin !== origin) return '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().slice(0, 2048);
  } catch {
    return '';
  }
}

function requireReportOrigin(req, res, next) {
  const origin = requestOrigin(req);
  const allowed = allowedReportOrigins();
  if (!origin || (!allowed.has(origin) && !sameServerOrigin(req, origin))) {
    return res.status(403).json({
      ok: false,
      code: 'TICKET_SNITCH_REPORT_ORIGIN_DENIED',
      error: 'This application origin is not allowed to submit reports.',
      requestId: req.requestId,
    });
  }
  req.reportOrigin = origin;
  return next();
}

function issueReportToken(origin, sessionKey, now = Date.now()) {
  const expiresAt = now + REPORT_TOKEN_TTL_MS;
  const nonce = crypto.randomBytes(18).toString('base64url');
  const payload = `${expiresAt}.${nonce}.${origin}.${sessionKey}`;
  const signature = crypto.createHmac('sha256', reportTokenSecret).update(payload).digest('base64url');
  return `${expiresAt}.${nonce}.${signature}`;
}

function isValidReportToken(token, origin, sessionKey, now = Date.now()) {
  const [expiresText, nonce, signature, ...rest] = String(token || '').split('.');
  if (rest.length || !/^\d{13}$/.test(expiresText || '') || !/^[A-Za-z0-9_-]{20,40}$/.test(nonce || '') || !signature) return false;
  const expiresAt = Number(expiresText);
  if (expiresAt < now || expiresAt > now + REPORT_TOKEN_TTL_MS + 5_000) return false;
  const expected = crypto.createHmac('sha256', reportTokenSecret)
    .update(`${expiresAt}.${nonce}.${origin}.${sessionKey}`)
    .digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireReportToken(req, res, next) {
  if (!isValidReportToken(req.headers['x-qbo-report-token'], req.reportOrigin, req.authenticatedUser?.sessionKey || '')) {
    return res.status(403).json({
      ok: false,
      code: 'TICKET_SNITCH_REPORT_TOKEN_INVALID',
      error: 'The reporting form expired or could not be verified. Reopen it and try again.',
      requestId: req.requestId,
    });
  }
  return next();
}

function requireReportProxySecret(req, res, next) {
  const expected = String(process.env.TICKET_SNITCH_REPORT_PROXY_SECRET || '');
  if (expected.length < 32) return res.status(503).json({ ok: false, code: 'TICKET_SNITCH_REPORT_PROXY_DISABLED', error: 'The Ticket Snitch report proxy is disabled.' });
  const provided = String(req.headers['x-ticket-snitch-proxy-secret'] || '');
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.status(401).json({ ok: false, code: 'TICKET_SNITCH_REPORT_PROXY_UNAUTHORIZED', error: 'This report source is not authorized.' });
  }
  return next();
}

function connectorError(res, error, requestId) {
  return res.status(error.status || 502).json({
    ok: false,
    code: error.code || 'TICKET_SNITCH_REQUEST_FAILED',
    error: error.message,
    requestId: error.requestId || requestId,
  });
}

const userReportRateLimit = createRateLimiter({ name: 'ticket-snitch-user-report', limit: 12, includeRequestId: true });

router.get('/reporting/bootstrap', requireReportOrigin, requireReportingUser, (req, res) => {
  const connector = getConnectorConfig();
  const available = connector.configured;
  return res.json({
    ok: true,
    available,
    unavailableReason: available
      ? ''
      : 'TICKET_SNITCH_NOT_CONFIGURED',
    reportToken: available ? issueReportToken(req.reportOrigin, req.authenticatedUser.sessionKey) : '',
    screenshotAvailable: available && connector.evidenceConfigured,
    expiresInSeconds: available ? Math.floor(REPORT_TOKEN_TTL_MS / 1000) : 0,
    requestId: req.requestId,
  });
});

router.post('/reporting/reports', requireReportOrigin, requireReportingUser, userReportRateLimit, requireReportToken, async (req, res) => {
  const connector = getConnectorConfig();
  if (!connector.configured) {
    return res.status(503).json({
      ok: false,
      code: 'TICKET_SNITCH_NOT_CONFIGURED',
      error: 'Reporting is not connected on this QBO Escalations server.',
      requestId: req.requestId,
    });
  }

  const input = req.body || {};
  const type = USER_REPORT_TYPES.get(cleanText(input.kind, 40));
  const title = cleanText(input.title, 241);
  const originalReport = cleanText(input.explanation, 40_001);
  const submissionId = cleanText(input.submissionId, 128);
  const observedAt = cleanText(input.observedAt, 100);
  if (!type) return res.status(400).json({ ok: false, code: 'INVALID_REPORT_TYPE', error: 'Choose problem, feature request, or feedback.', requestId: req.requestId });
  if (title.length < 3 || title.length > 240) return res.status(400).json({ ok: false, code: 'INVALID_REPORT_TITLE', error: 'Enter a title between 3 and 240 characters.', requestId: req.requestId });
  if (originalReport.length < 10 || originalReport.length > 40_000) return res.status(400).json({ ok: false, code: 'INVALID_REPORT_EXPLANATION', error: 'Enter an explanation between 10 and 40,000 characters.', requestId: req.requestId });
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(submissionId)) return res.status(400).json({ ok: false, code: 'INVALID_SUBMISSION_ID', error: 'This report draft could not be identified. Reopen the form and try again.', requestId: req.requestId });
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) return res.status(400).json({ ok: false, code: 'INVALID_OBSERVED_AT', error: 'This report draft has an invalid timestamp. Reopen the form and try again.', requestId: req.requestId });

  let screenshot = null;
  if (input.screenshot !== undefined && input.screenshot !== null) {
    try {
      screenshot = await prepareScreenshotEvidence(input.screenshot);
    } catch (error) {
      if (error instanceof ScreenshotValidationError) {
        return res.status(error.status).json({
          ok: false,
          code: error.code,
          error: error.message,
          requestId: req.requestId,
        });
      }
      throw error;
    }
  }

  const suppliedContext = input.context && typeof input.context === 'object' ? input.context : {};
  const diagnosticsApproved = input.includeDiagnostics === true;
  const reporter = {
    actorId: req.authenticatedUser.id,
    displayName: req.authenticatedUser.displayName,
    email: req.authenticatedUser.email || '',
  };
  const context = {
    pageUrl: safeReportedPageUrl(suppliedContext.pageUrl, req.reportOrigin),
    routeName: cleanText(suppliedContext.routeName, 200).split('?')[0],
    appVersion: cleanText(process.env.npm_package_version || '1.0.0', 120),
    observedAt: new Date(observedAt).toISOString(),
    sourceRequestId: submissionId,
    diagnosticsApproved,
    ...(diagnosticsApproved ? {
      browser: cleanText(suppliedContext.browser, 500),
      viewport: cleanText(suppliedContext.viewport, 80),
      locale: cleanText(suppliedContext.locale, 80),
      errorCode: cleanText(suppliedContext.errorCode, 200),
    } : {}),
  };

  try {
    const result = await reportWork(
      { type, title, originalReport, priority: 'none', severity: 'none' },
      { ...context, submissionId, screenshotApproved: Boolean(screenshot) },
      req.requestId,
      reporter
    );
    let evidence = { requested: false, status: 'not_requested' };
    if (screenshot) {
      try {
        const attached = await attachEvidence(
          result.data.id,
          {
            filename: screenshot.filename,
            contentType: screenshot.contentType,
            base64: screenshot.base64,
            description: screenshot.description,
            kind: screenshot.kind,
          },
          req.requestId,
          {
            authority: 'evidence',
            idempotencyKey: screenshotEvidenceIdempotencyKey(submissionId),
          },
        );
        evidence = {
          requested: true,
          status: 'attached',
          id: attached.data.id,
          idempotentReplay: Boolean(attached.idempotentReplay),
        };
      } catch (error) {
        evidence = {
          requested: true,
          status: 'failed',
          code: error.code || 'TICKET_SNITCH_EVIDENCE_FAILED',
          message: error.message || 'The screenshot could not be attached.',
          requestId: error.requestId || req.requestId,
          retryable: error.status !== 400 && error.status !== 401 && error.status !== 403 && error.status !== 413 && error.status !== 415,
        };
      }
    }
    return res.status(result.idempotentReplay ? 200 : 201).json({
      ok: true,
      ticket: { id: result.data.id, key: result.data.key },
      evidence,
      idempotentReplay: Boolean(result.idempotentReplay),
      requestId: req.requestId,
    });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.use(requireReportProxySecret);

router.get('/status', async (req, res) => {
  const config = getConnectorConfig();
  if (!config.configured) return res.json({ ok: true, configured: false, connected: false });
  try {
    const result = await checkConnection(req.requestId);
    return res.json({ ok: true, configured: true, connected: true, project: { id: result.data.id, key: result.data.key, name: result.data.name }, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

const mutationRateLimit = createRateLimiter({ name: 'ticket-snitch-mutation', limit: 60 });

router.post('/report', mutationRateLimit, async (req, res) => {
  const input = req.body || {};
  const type = String(input.type || 'problem_report');
  const title = String(input.title || '').trim();
  const originalReport = String(input.originalReport || '').trim();
  if (!TYPES.has(type)) return res.status(400).json({ ok: false, code: 'INVALID_REPORT_TYPE', error: 'Choose a supported report type.' });
  if (title.length < 3 || title.length > 240) return res.status(400).json({ ok: false, code: 'INVALID_REPORT_TITLE', error: 'Report title must contain 3 to 240 characters.' });
  if (!originalReport || originalReport.length > 40_000) return res.status(400).json({ ok: false, code: 'INVALID_ORIGINAL_REPORT', error: 'Original report is required and may contain at most 40,000 characters.' });
  const priority = PRIORITIES.has(input.priority) ? input.priority : 'none';
  const severity = SEVERITIES.has(input.severity) ? input.severity : 'none';
  try {
    const result = await reportWork({ ...input, type, title, originalReport, priority, severity }, input.context || {}, req.requestId);
    return res.status(result.idempotentReplay ? 200 : 201).json({ ok: true, ticket: { id: result.data.id, key: result.data.key }, idempotentReplay: Boolean(result.idempotentReplay), requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.get('/work/:identifier', async (req, res) => {
  try {
    const result = await getWork(req.params.identifier, req.requestId);
    return res.json({ ok: true, data: result.data, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.patch('/work/:identifier', mutationRateLimit, async (req, res) => {
  try {
    const result = await updateWork(req.params.identifier, req.body || {}, req.requestId);
    return res.json({ ok: true, data: result.data, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.post('/work/:identifier/comments', mutationRateLimit, async (req, res) => {
  try {
    const result = await commentOnWork(req.params.identifier, req.body || {}, req.requestId);
    return res.status(201).json({ ok: true, data: result.data, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.post('/work/:identifier/transitions', mutationRateLimit, async (req, res) => {
  try {
    const result = await transitionWork(req.params.identifier, req.body || {}, req.requestId);
    return res.json({ ok: true, data: result.data, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.post('/work/:identifier/evidence', mutationRateLimit, async (req, res) => {
  try {
    const result = await attachEvidence(
      req.params.identifier,
      req.body || {},
      req.requestId,
      {
        authority: 'agent',
        idempotencyKey: cleanText(req.headers['idempotency-key'], 200) || undefined,
      },
    );
    return res.status(result.idempotentReplay ? 200 : 201).json({ ok: true, data: result.data, idempotentReplay: Boolean(result.idempotentReplay), requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

module.exports = router;
module.exports.allowedReportOrigins = allowedReportOrigins;
module.exports.isValidReportToken = isValidReportToken;
module.exports.requireReportProxySecret = requireReportProxySecret;
module.exports.requireReportOrigin = requireReportOrigin;
