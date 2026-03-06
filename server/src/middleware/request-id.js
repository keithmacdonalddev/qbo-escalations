const { randomUUID } = require('node:crypto');

/**
 * Attaches a correlation ID to every request.
 * - Reuses client-sent X-Request-ID if present (end-to-end correlation)
 * - Otherwise generates a new UUID
 * - Sets X-Request-ID response header so the client can read it
 */
function requestId(req, res, next) {
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

module.exports = requestId;
