'use strict';

const express = require('express');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  COOKIE_NAME,
  FLOW_COOKIE_NAME,
  configuration,
  cookieOptions,
  consumeTicketSnitchSignInFlow,
  createTicketSnitchSignInFlow,
  createSession,
  destroySession,
  flowCookieOptions,
  publicUser,
  verifyPassword,
} = require('../services/app-auth');
const { exchangeProjectSignIn } = require('../services/ticket-snitch-client');

const router = express.Router();
const loginRateLimit = createRateLimiter({
  name: 'qbo-auth-login',
  limit: 5,
  windowMs: 15 * 60 * 1000,
  includeRequestId: true,
});

function cleanOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function allowedOrigins(env = process.env) {
  return new Set(String(env.QBO_AUTH_ALLOWED_ORIGINS || '')
    .split(',')
    .map(cleanOrigin)
    .filter(Boolean));
}

function requestOrigin(req) {
  const origin = cleanOrigin(req.headers.origin);
  if (origin) return origin;
  try { return new URL(String(req.headers.referer || '')).origin; } catch { return ''; }
}

function sameServerOrigin(req, origin) {
  return Boolean(origin && req.headers.host && origin === `${req.protocol || 'http'}://${req.headers.host}`);
}

function requireAuthOrigin(req, res, next) {
  const origin = requestOrigin(req);
  if (!origin || (!sameServerOrigin(req, origin) && !allowedOrigins().has(origin))) {
    return res.status(403).json({
      ok: false,
      code: 'QBO_AUTH_ORIGIN_DENIED',
      error: 'This application origin is not allowed to sign in or sign out.',
      requestId: req.requestId,
    });
  }
  return next();
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

function safeReturnTo(value) {
  const raw = String(value || '/').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 1024) return '/';
  try {
    const parsed = new URL(raw, 'http://qbo.local');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function redirectWithAuthResult(res, flow, result, details = {}) {
  const target = new URL(flow.returnTo || '/', flow.clientOrigin);
  target.searchParams.set('qboAuth', result);
  if (details.code) target.searchParams.set('qboAuthCode', String(details.code).slice(0, 120));
  if (details.requestId) target.searchParams.set('qboAuthRequestId', String(details.requestId).slice(0, 128));
  return res.redirect(302, target.href);
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/session', (req, res) => {
  const config = req.appAuth?.config || configuration();
  const user = req.authenticatedUser ? publicUser(req.authenticatedUser) : null;
  return res.json({
    ok: true,
    enabled: config.enabled,
    configured: config.configured,
    mode: config.mode,
    authenticated: Boolean(user),
    user,
    identityProvider: req.appAuth?.session?.identityProvider || null,
    expiresAt: req.appAuth?.session?.expiresAt || null,
    requestId: req.requestId,
  });
});

router.post('/login', requireAuthOrigin, loginRateLimit, async (req, res) => {
  const config = req.appAuth?.config || configuration();
  if (!config.enabled) {
    return res.status(409).json({ ok: false, code: 'QBO_AUTH_DISABLED', error: 'QBO sign-in is not enabled on this server.', requestId: req.requestId });
  }
  if (!config.configured) {
    return res.status(503).json({ ok: false, code: 'QBO_AUTH_NOT_CONFIGURED', error: 'QBO sign-in is not configured correctly on this server.', requestId: req.requestId });
  }
  if (config.mode !== 'password') {
    return res.status(409).json({
      ok: false,
      code: 'QBO_AUTH_TICKET_SNITCH_REQUIRED',
      error: 'Continue to Ticket Snitch to sign in.',
      requestId: req.requestId,
    });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const valid = await verifyPassword(password, config.passwordHash);
  if (!valid) {
    return res.status(401).json({ ok: false, code: 'QBO_AUTH_INVALID_CREDENTIALS', error: 'The password is incorrect.', requestId: req.requestId });
  }
  destroySession(req);
  const session = createSession(config.user, { ttlMs: config.sessionTtlMs });
  res.cookie(COOKIE_NAME, session.token, cookieOptions(config, session.expiresAt));
  return res.json({
    ok: true,
    enabled: true,
    configured: true,
    authenticated: true,
    user: publicUser(session.user),
    expiresAt: session.expiresAt,
    requestId: req.requestId,
  });
});

router.get('/ticket-snitch/start', requireAuthOrigin, loginRateLimit, (req, res) => {
  const config = req.appAuth?.config || configuration();
  if (!config.enabled) {
    return res.status(409).json({ ok: false, code: 'QBO_AUTH_DISABLED', error: 'QBO sign-in is not enabled on this server.', requestId: req.requestId });
  }
  if (!config.configured || config.mode !== 'ticket-snitch') {
    return res.status(503).json({ ok: false, code: 'QBO_AUTH_NOT_CONFIGURED', error: 'Ticket Snitch sign-in is not configured correctly on this server.', requestId: req.requestId });
  }
  const clientOrigin = requestOrigin(req);
  if (!allowedOrigins().has(clientOrigin)) {
    return res.status(403).json({
      ok: false,
      code: 'QBO_AUTH_ORIGIN_DENIED',
      error: 'This application origin is not allowed to start Ticket Snitch sign-in.',
      requestId: req.requestId,
    });
  }
  const flow = createTicketSnitchSignInFlow({
    clientOrigin,
    returnTo: safeReturnTo(req.query.returnTo),
  });
  res.cookie(FLOW_COOKIE_NAME, flow.state, flowCookieOptions(config));
  const authorize = new URL('/api/v1/auth/project-sign-in/authorize', config.ticketSnitchWebOrigin);
  authorize.searchParams.set('projectId', config.ticketSnitchProjectId);
  authorize.searchParams.set('redirectUri', config.ticketSnitchCallbackUrl);
  authorize.searchParams.set('state', flow.state);
  authorize.searchParams.set('codeChallenge', flow.codeChallenge);
  return res.redirect(302, authorize.href);
});

router.get('/ticket-snitch/callback', async (req, res) => {
  const config = req.appAuth?.config || configuration();
  const state = String(req.query.state || '');
  const code = String(req.query.code || '');
  const flow = consumeTicketSnitchSignInFlow(state, cookieValue(req, FLOW_COOKIE_NAME));
  res.clearCookie(FLOW_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookie,
    path: '/api/auth/ticket-snitch/callback',
  });
  if (!flow || !code || !config.configured || config.mode !== 'ticket-snitch') {
    return res.status(400).json({
      ok: false,
      code: 'QBO_AUTH_FLOW_INVALID',
      error: 'This Ticket Snitch sign-in attempt is invalid or expired. Return to QBO Escalations and try again.',
      requestId: req.requestId,
    });
  }
  try {
    const result = await exchangeProjectSignIn({
      code,
      codeVerifier: flow.codeVerifier,
      redirectUri: config.ticketSnitchCallbackUrl,
    }, req.requestId);
    destroySession(req);
    const session = createSession({
      id: result.data.identity.subject,
      displayName: result.data.identity.displayName,
      email: result.data.identity.email || '',
    }, {
      ttlMs: config.sessionTtlMs,
      identityProvider: 'ticket-snitch',
      projectId: result.data.project.id,
    });
    res.cookie(COOKIE_NAME, session.token, cookieOptions(config, session.expiresAt));
    return redirectWithAuthResult(res, flow, 'success');
  } catch (error) {
    return redirectWithAuthResult(res, flow, 'error', {
      code: error.code || 'TICKET_SNITCH_SIGN_IN_FAILED',
      requestId: error.requestId || req.requestId,
    });
  }
});

router.post('/logout', requireAuthOrigin, (req, res) => {
  const config = req.appAuth?.config || configuration();
  destroySession(req);
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookie,
    path: '/',
  });
  return res.json({ ok: true, authenticated: false, requestId: req.requestId });
});

module.exports = router;
module.exports.allowedOrigins = allowedOrigins;
module.exports.requireAuthOrigin = requireAuthOrigin;
