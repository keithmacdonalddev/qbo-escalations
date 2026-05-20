'use strict';

const crypto = require('crypto');

const SECRET_HEADER_MARKERS = [
  'api-key',
  'token',
  'secret',
  'credential',
];

const SECRET_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
  'set-cookie',
]);

const SECRET_BODY_KEY_RE = /^(api[-_]?key|access[-_]?token|refresh[-_]?token|secret|credential|password)$/i;

function cloneValue(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = cloneValue(nested);
  }
  return output;
}

function normalizeHeaderName(name) {
  return String(name || '').trim().toLowerCase();
}

function shouldRedactHeader(name) {
  const normalized = normalizeHeaderName(name);
  if (!normalized) return false;
  if (SECRET_HEADER_NAMES.has(normalized)) return true;
  return SECRET_HEADER_MARKERS.some((marker) => normalized.includes(marker));
}

function redactHeaderValue(name, value) {
  const normalized = normalizeHeaderName(name);
  if (normalized === 'authorization' || normalized === 'proxy-authorization') {
    const text = Array.isArray(value) ? String(value[0] || '') : String(value || '');
    const scheme = text.match(/^\s*([A-Za-z][A-Za-z0-9._~-]*)\s+/)?.[1];
    return scheme ? `${scheme} [REDACTED]` : '[REDACTED]';
  }
  return '[REDACTED]';
}

function addUnique(list, value) {
  if (!value || list.includes(value)) return;
  list.push(value);
}

function redactHeaders(headers = {}) {
  const redactedHeaderNames = [];
  const output = {};

  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return { headers: output, redactedHeaderNames };
  }

  for (const [name, value] of Object.entries(headers)) {
    if (shouldRedactHeader(name)) {
      output[name] = redactHeaderValue(name, value);
      addUnique(redactedHeaderNames, normalizeHeaderName(name));
    } else {
      output[name] = cloneValue(value);
    }
  }

  return { headers: output, redactedHeaderNames };
}

function redactRawHeaders(rawHeaders = []) {
  const redactedHeaderNames = [];
  if (!Array.isArray(rawHeaders)) {
    return { rawHeaders: [], redactedHeaderNames };
  }

  const output = rawHeaders.map((value, index) => {
    if (index % 2 === 0) return value;
    const name = rawHeaders[index - 1];
    if (!shouldRedactHeader(name)) return value;
    addUnique(redactedHeaderNames, normalizeHeaderName(name));
    return redactHeaderValue(name, value);
  });

  return { rawHeaders: output, redactedHeaderNames };
}

function redactBodySecrets(value, path = '', redactedBodyPaths = []) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactBodySecrets(entry, `${path}[${index}]`, redactedBodyPaths));
  }

  if (!value || typeof value !== 'object' || value instanceof Date) {
    return cloneValue(value);
  }

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (SECRET_BODY_KEY_RE.test(key)) {
      output[key] = '[REDACTED]';
      addUnique(redactedBodyPaths, currentPath);
    } else {
      output[key] = redactBodySecrets(nested, currentPath, redactedBodyPaths);
    }
  }
  return output;
}

function mergeUnique(a = [], b = []) {
  const output = [];
  for (const value of [...a, ...b]) addUnique(output, value);
  return output;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function replaceJsonText(container, note, notes) {
  if (!container || typeof container !== 'object') return;
  const source = container.bodyJson !== undefined ? container.bodyJson : container.parsedJson;
  if (source === undefined || typeof container.bodyText !== 'string') return;
  const text = JSON.stringify(source);
  container.bodyText = text;
  container.bodyByteLength = Buffer.byteLength(text, 'utf8');
  container.bodySha256 = sha256(text);
  addUnique(notes, note);
}

function redactJsonTextField(container, fieldName, pathPrefix, redactedBodyPaths, notes, note) {
  if (!container || typeof container !== 'object' || typeof container[fieldName] !== 'string') return;

  let parsed;
  try {
    parsed = JSON.parse(container[fieldName]);
  } catch {
    return;
  }

  const beforeCount = redactedBodyPaths.length;
  const redactedJson = redactBodySecrets(parsed, pathPrefix, redactedBodyPaths);
  if (redactedBodyPaths.length === beforeCount) return;

  const text = JSON.stringify(redactedJson);
  container[fieldName] = text;
  if (fieldName === 'bodyText') {
    container.bodyByteLength = Buffer.byteLength(text, 'utf8');
    container.bodySha256 = sha256(text);
  }
  addUnique(notes, note);
}

function redactProviderCallPackage(envelope) {
  const redacted = cloneValue(envelope || {});
  const redactedHeaderNames = [];
  const redactedBodyPaths = [];
  const notes = Array.isArray(redacted.redaction?.notes) ? redacted.redaction.notes.slice() : [];

  if (redacted.request?.headers) {
    const result = redactHeaders(redacted.request.headers);
    redacted.request.headers = result.headers;
    redacted.request.redactedHeaderNames = result.redactedHeaderNames;
    redactedHeaderNames.push(...result.redactedHeaderNames);
  }

  if (redacted.response?.headers) {
    const result = redactHeaders(redacted.response.headers);
    redacted.response.headers = result.headers;
    redacted.response.redactedHeaderNames = result.redactedHeaderNames;
    redactedHeaderNames.push(...result.redactedHeaderNames);
  }

  if (redacted.response?.rawHeaders) {
    const result = redactRawHeaders(redacted.response.rawHeaders);
    redacted.response.rawHeaders = result.rawHeaders;
    redactedHeaderNames.push(...result.redactedHeaderNames);
  }

  if (redacted.request?.bodyJson) {
    const beforeCount = redactedBodyPaths.length;
    redacted.request.bodyJson = redactBodySecrets(redacted.request.bodyJson, 'request.bodyJson', redactedBodyPaths);
    if (redactedBodyPaths.length > beforeCount) {
      replaceJsonText(redacted.request, 'request.bodyText regenerated after body secret redaction', notes);
    }
  }
  if (!redacted.request?.bodyJson) {
    redactJsonTextField(
      redacted.request,
      'bodyText',
      'request.bodyText',
      redactedBodyPaths,
      notes,
      'request.bodyText JSON string redacted'
    );
  }

  if (redacted.response?.parsedJson) {
    const beforeCount = redactedBodyPaths.length;
    redacted.response.parsedJson = redactBodySecrets(redacted.response.parsedJson, 'response.parsedJson', redactedBodyPaths);
    if (redactedBodyPaths.length > beforeCount) {
      replaceJsonText(redacted.response, 'response.bodyText regenerated after body secret redaction', notes);
    }
  }

  if (redacted.error?.object) {
    redacted.error.object = redactBodySecrets(redacted.error.object, 'error.object', redactedBodyPaths);
  }
  redactJsonTextField(
    redacted.error,
    'rawBody',
    'error.rawBody',
    redactedBodyPaths,
    notes,
    'error.rawBody JSON string redacted'
  );

  redacted.redaction = {
    ...(redacted.redaction && typeof redacted.redaction === 'object' ? redacted.redaction : {}),
    applied: true,
    redactedHeaderNames: mergeUnique(redacted.redaction?.redactedHeaderNames, redactedHeaderNames),
    redactedBodyPaths: mergeUnique(redacted.redaction?.redactedBodyPaths, redactedBodyPaths),
    notes,
  };

  return redacted;
}

module.exports = {
  redactHeaders,
  redactRawHeaders,
  redactProviderCallPackage,
  _internal: {
    shouldRedactHeader,
    redactBodySecrets,
  },
};
