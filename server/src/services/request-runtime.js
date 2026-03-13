'use strict';

const activeRequests = new Map();

function cloneRequest(entry) {
  const now = Date.now();
  return {
    id: entry.id,
    requestId: entry.requestId,
    method: entry.method,
    path: entry.path,
    phase: entry.phase,
    statusCode: entry.statusCode,
    clientConnected: entry.clientConnected,
    startedAt: new Date(entry.startedAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
    ageMs: now - entry.startedAt,
    idleMs: now - entry.updatedAt,
  };
}

function listActiveRequests() {
  return [...activeRequests.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(cloneRequest)
    .filter(Boolean);
}

function getRequestRuntimeHealth() {
  const requests = listActiveRequests().filter(Boolean);
  const longestActiveMs = requests.reduce((max, request) => Math.max(max, request.ageMs || 0), 0);
  const stalestIdleMs = requests.reduce((max, request) => Math.max(max, request.idleMs || 0), 0);
  const staleRequests = requests.filter((request) => (request.ageMs || 0) >= 30_000);

  return {
    activeRequests: requests.length,
    longestActiveMs,
    stalestIdleMs,
    staleCount: staleRequests.length,
    requests,
  };
}

function registerRequestRuntime(req, res, next) {
  const now = Date.now();
  const id = req.requestId || `${req.method}-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id,
    requestId: req.requestId || null,
    method: req.method,
    path: req.originalUrl || req.url || '',
    phase: 'running',
    statusCode: null,
    clientConnected: true,
    startedAt: now,
    updatedAt: now,
  };

  activeRequests.set(id, entry);

  let settled = false;
  function finish(phase, statusCode, clientConnected) {
    if (settled) return;
    settled = true;
    entry.phase = phase;
    entry.statusCode = Number.isFinite(statusCode) ? statusCode : entry.statusCode;
    entry.clientConnected = clientConnected;
    entry.updatedAt = Date.now();
    activeRequests.delete(id);
  }

  // Detect SSE responses: once headers are written, check the content-type.
  // SSE connections are long-lived by design — remove them from active tracking
  // so they don't false-alarm as "stuck" requests.
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = function patchedWriteHead(...args) {
    const result = origWriteHead(...args);
    const ct = res.getHeader('content-type') || '';
    if (typeof ct === 'string' && ct.includes('text/event-stream')) {
      // SSE stream — mark phase and remove from active tracking.
      // The connection is healthy; it will close when the client disconnects.
      entry.phase = 'streaming';
      entry.statusCode = res.statusCode;
      entry.updatedAt = Date.now();
      activeRequests.delete(id);
      settled = true;
    }
    return result;
  };

  res.on('finish', () => {
    finish('finished', res.statusCode, entry.clientConnected);
  });

  res.on('close', () => {
    if (res.writableEnded) return;
    entry.clientConnected = false;
    finish('aborted', res.statusCode, false);
  });

  next();
}

module.exports = {
  registerRequestRuntime,
  listActiveRequests,
  getRequestRuntimeHealth,
};
