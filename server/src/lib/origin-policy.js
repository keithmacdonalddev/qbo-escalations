'use strict';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function normalizeOrigin(origin) {
  return typeof origin === 'string' ? origin.trim() : '';
}

function getAllowedCorsOrigins() {
  const raw = (process.env.CORS_ALLOWED_ORIGINS || '').trim();
  if (!raw) return null;
  return new Set(
    raw.split(',')
      .map((value) => normalizeOrigin(value))
      .filter(Boolean)
  );
}

function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isHttpOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function doesOriginMatchHost(origin, hostHeader) {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedHost = typeof hostHeader === 'string' ? hostHeader.trim() : '';
  if (!normalizedOrigin || !normalizedHost) return false;

  try {
    const parsed = new URL(normalizedOrigin);
    return parsed.protocol.startsWith('http') && parsed.host.toLowerCase() === normalizedHost.toLowerCase();
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin, allowedOrigins = getAllowedCorsOrigins(), options = {}) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return true;
  if (!isHttpOrigin(normalizedOrigin)) return false;
  if (allowedOrigins && allowedOrigins.size > 0) return allowedOrigins.has(normalizedOrigin);
  if (doesOriginMatchHost(normalizedOrigin, options.host)) return true;
  return isLoopbackOrigin(normalizedOrigin);
}

function buildCorsOptions() {
  const allowedOrigins = getAllowedCorsOrigins();
  return {
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin, allowedOrigins));
    },
  };
}

module.exports = {
  buildCorsOptions,
  doesOriginMatchHost,
  getAllowedCorsOrigins,
  isAllowedOrigin,
};
