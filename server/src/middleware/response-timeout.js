/**
 * Response timeout for non-streaming routes.
 *
 * If the server hasn't started sending a response within `ms`, returns a 504.
 * SSE/streaming routes call res.writeHead() early, so `res.headersSent` is
 * already true and the timeout is a no-op for them.
 */
function responseTimeout(ms = 30000) {
  return function responseTimeoutMiddleware(req, res, next) {
    const effectiveMs = Number.isFinite(req.responseTimeoutMs) && req.responseTimeoutMs > 0
      ? req.responseTimeoutMs
      : ms;

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          ok: false,
          code: 'RESPONSE_TIMEOUT',
          error: `Request timed out after ${effectiveMs}ms`,
        });
      }
    }, effectiveMs);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

module.exports = responseTimeout;
