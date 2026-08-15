'use strict';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
// The server test runner starts each test file with NODE_ENV=test. Capture that
// once so a permission test that temporarily exercises production behavior
// does not also turn Supertest's random local port into a Host-policy failure.
const PROCESS_STARTED_IN_TEST = process.env.NODE_ENV === 'test';

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function getAllowedLocalPorts(env = process.env) {
  const values = [env.PORT || '4000', env.VITE_DEV_PORT || '5174'];
  if (env.LOCAL_ALLOWED_HOST_PORTS) values.push(...env.LOCAL_ALLOWED_HOST_PORTS.split(','));
  return new Set(values.map((value) => parsePort(String(value).trim())).filter(Boolean));
}

function parseHostHeader(hostHeader) {
  if (typeof hostHeader !== 'string') return null;
  const value = hostHeader.trim();
  if (!value || /[\s,/@]/.test(value) || value.includes('://')) return null;

  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return {
      hostname: parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''),
      port: parsed.port ? parsePort(parsed.port) : 80,
    };
  } catch {
    return null;
  }
}

function isAllowedLocalRequestHost(hostHeader, options = {}) {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed || !LOOPBACK_HOSTNAMES.has(parsed.hostname)) return false;
  if (options.allowAnyLoopbackPort === true) return true;

  const env = options.env || process.env;
  if ((PROCESS_STARTED_IN_TEST || env.NODE_ENV === 'test') && options.allowAnyLoopbackPort !== false) return true;
  return (options.allowedPorts || getAllowedLocalPorts(env)).has(parsed.port);
}

function requireLocalRequestHost(options = {}) {
  return function localHostPolicy(req, res, next) {
    if (isAllowedLocalRequestHost(req.headers.host, options)) return next();
    return res.status(403).json({
      ok: false,
      code: 'LOCAL_HOST_REQUIRED',
      error: 'This local application only accepts requests addressed to this computer.',
    });
  };
}

module.exports = {
  getAllowedLocalPorts,
  isAllowedLocalRequestHost,
  parseHostHeader,
  requireLocalRequestHost,
};
