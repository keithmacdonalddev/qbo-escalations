'use strict';

const { configuration, getSession } = require('../services/app-auth');

function resolveAppAuthContext(req) {
  const config = configuration();
  const candidateSession = config.enabled && config.configured ? getSession(req) : null;
  const session = candidateSession
    && candidateSession.user.id === config.user.id
    && candidateSession.user.displayName === config.user.displayName
    && candidateSession.user.email === config.user.email
    ? candidateSession
    : null;
  return {
    appAuth: { config, session },
    authenticatedUser: session ? {
      ...session.user,
      sessionKey: session.sessionKey,
      sessionExpiresAt: session.expiresAt,
    } : null,
  };
}

function attachAppAuth(req, _res, next) {
  const context = resolveAppAuthContext(req);
  req.appAuth = context.appAuth;
  req.authenticatedUser = context.authenticatedUser;
  next();
}

function requireReportingUser(req, res, next) {
  const config = req.appAuth?.config || configuration();
  if (!config.enabled) {
    return res.status(503).json({
      ok: false,
      code: 'QBO_AUTH_DISABLED',
      error: 'Signed-in reporting is not enabled on this QBO Escalations server.',
      requestId: req.requestId,
    });
  }
  if (!config.configured) {
    return res.status(503).json({
      ok: false,
      code: 'QBO_AUTH_NOT_CONFIGURED',
      error: 'Signed-in reporting is not configured correctly on this QBO Escalations server.',
      requestId: req.requestId,
    });
  }
  if (!req.authenticatedUser) {
    return res.status(401).json({
      ok: false,
      code: 'QBO_AUTH_REQUIRED',
      error: 'Sign in to QBO Escalations before sending a report.',
      requestId: req.requestId,
    });
  }
  return next();
}

module.exports = { attachAppAuth, requireReportingUser, resolveAppAuthContext };
