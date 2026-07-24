'use strict';

const express = require('express');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  COOKIE_NAME,
  configuration,
  cookieOptions,
  createSession,
  destroySession,
  publicUser,
  verifyPassword,
} = require('../services/app-auth');

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
