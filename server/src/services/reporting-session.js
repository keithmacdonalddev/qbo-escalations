'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = 'qbo_reporting_visitor';
const COOKIE_VERSION = 'v1';
const DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MIN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000;

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function configuration(env = process.env) {
  const secret = cleanText(env.QBO_REPORTING_SECRET, 4096);
  const parsedTtl = Number.parseInt(env.QBO_REPORTING_VISITOR_TTL_MS || '', 10);
  const ttlMs = Number.isFinite(parsedTtl)
    ? Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, parsedTtl))
    : DEFAULT_TTL_MS;
  return {
    secret,
    configured: secret.length >= 32,
    ttlMs,
    secureCookie: env.QBO_REPORTING_COOKIE_SECURE === '1'
      || (env.QBO_REPORTING_COOKIE_SECURE !== '0' && env.NODE_ENV === 'production'),
  };
}

function parseCookieHeader(header) {
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() === COOKIE_NAME) {
      return part.slice(separator + 1).trim();
    }
  }
  return '';
}

function signature(visitorId, issuedAt, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`qbo-reporting-visitor-v1:${visitorId}:${issuedAt}`)
    .digest('base64url');
}

function secureMatch(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function visitorFromToken(token, config = configuration(), now = Date.now()) {
  if (!config.configured) return null;
  const match = /^v1\.([0-9a-f-]{36})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!match) return null;
  const issuedAt = Number(match[2]);
  if (issuedAt > now + 5 * 60 * 1000 || issuedAt + config.ttlMs <= now) return null;
  if (!secureMatch(match[3], signature(match[1], issuedAt, config.secret))) return null;
  return visitorIdentity(match[1], config.secret);
}

function visitorIdentity(visitorId, secret) {
  const scope = crypto
    .createHmac('sha256', secret)
    .update(`qbo-reporting-storage-scope-v1:${visitorId}`)
    .digest('base64url')
    .slice(0, 32);
  return {
    id: `qbo-visitor:${visitorId}`,
    scope: `qrv_${scope}`,
  };
}

function createVisitor(config = configuration(), now = Date.now()) {
  if (!config.configured) return null;
  const visitorId = crypto.randomUUID();
  return {
    ...visitorIdentity(visitorId, config.secret),
    token: `${COOKIE_VERSION}.${visitorId}.${now}.${signature(visitorId, now, config.secret)}`,
  };
}

function cookieOptions(config = configuration()) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookie,
    path: '/api/ticket-snitch/reporting',
    maxAge: config.ttlMs,
  };
}

function ensureReportingVisitor(req, res, next) {
  const config = configuration();
  if (!config.configured) {
    return res.status(503).json({
      ok: false,
      code: 'QBO_REPORTING_SECRET_NOT_CONFIGURED',
      error: 'Anonymous reporting continuity is not configured on this server.',
      requestId: req.requestId,
    });
  }
  let visitor = visitorFromToken(parseCookieHeader(req.headers.cookie), config);
  if (!visitor) {
    visitor = createVisitor(config);
    res.cookie(COOKIE_NAME, visitor.token, cookieOptions(config));
  }
  req.reportingVisitor = { id: visitor.id, scope: visitor.scope };
  return next();
}

function deriveReportingKey(purpose, env = process.env) {
  const config = configuration(env);
  if (!config.configured) return null;
  return crypto
    .createHmac('sha256', config.secret)
    .update(`qbo-reporting-key-v1:${cleanText(purpose, 120)}:${cleanText(env.TICKET_SNITCH_PROJECT_ID, 128)}`)
    .digest();
}

module.exports = {
  COOKIE_NAME,
  configuration,
  cookieOptions,
  createVisitor,
  deriveReportingKey,
  ensureReportingVisitor,
  visitorFromToken,
};
