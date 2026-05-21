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
const SECRET_TEXT_PATTERNS = [
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /\b((?:OPENAI|ANTHROPIC|GOOGLE|GEMINI|KIMI|MOONSHOT|LLM_GATEWAY)[A-Z0-9_]*API_KEY\s*=\s*)[^\s"'`]+/gi,
  /\b((?:api[-_]?key|access[-_]?token|refresh[-_]?token|secret|credential|password)\s*[:=]\s*)[^\s"'`,}]+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
];

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

function redactPlainTextSecrets(value, path, redactedBodyPaths = [], notes = []) {
  if (typeof value !== 'string' || !value) return value;
  let redacted = value;
  for (const pattern of SECRET_TEXT_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix) => {
      addUnique(redactedBodyPaths, path);
      return typeof prefix === 'string' && prefix
        ? `${prefix}[REDACTED]`
        : '[REDACTED]';
    });
  }
  if (redacted !== value) {
    addUnique(notes, `${path} secret-like text redacted`);
  }
  return redacted;
}

function redactJsonLineSecrets(value, path, redactedBodyPaths = [], notes = []) {
  if (typeof value !== 'string' || !value) return value;
  const lines = value.split('\n');
  let changed = false;
  const redactedLines = lines.map((line, index) => {
    if (!line.trim()) return line;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return line;
    }
    const beforeCount = redactedBodyPaths.length;
    const redactedJson = redactBodySecrets(parsed, `${path}[${index}]`, redactedBodyPaths);
    if (redactedBodyPaths.length === beforeCount) return line;
    changed = true;
    return JSON.stringify(redactedJson);
  });
  if (changed) {
    addUnique(notes, `${path} JSONL secret fields redacted`);
  }
  return redactedLines.join('\n');
}

function redactCliText(value, path, redactedBodyPaths, notes, options = {}) {
  let redacted = redactPlainTextSecrets(value, path, redactedBodyPaths, notes);
  if (options.jsonLines) {
    redacted = redactJsonLineSecrets(redacted, path, redactedBodyPaths, notes);
  }
  return redacted;
}

function updateTextStats(container) {
  if (!container || typeof container !== 'object' || typeof container.text !== 'string') return;
  container.byteLength = Buffer.byteLength(container.text, 'utf8');
  container.sha256 = container.text ? sha256(container.text) : null;
}

function redactStringArray(values, path, redactedBodyPaths, notes) {
  if (!Array.isArray(values)) return values;
  return values.map((value, index) => (
    typeof value === 'string'
      ? redactPlainTextSecrets(value, `${path}[${index}]`, redactedBodyPaths, notes)
      : cloneValue(value)
  ));
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

  if (redacted.cli && typeof redacted.cli === 'object') {
    redacted.cli.args = redactStringArray(redacted.cli.args, 'cli.args', redactedBodyPaths, notes);

    if (redacted.cli.stdin?.text) {
      redacted.cli.stdin.text = redactCliText(
        redacted.cli.stdin.text,
        'cli.stdin.text',
        redactedBodyPaths,
        notes
      );
      updateTextStats(redacted.cli.stdin);
    }

    if (redacted.cli.stdout?.text) {
      redacted.cli.stdout.text = redactCliText(
        redacted.cli.stdout.text,
        'cli.stdout.text',
        redactedBodyPaths,
        notes,
        { jsonLines: true }
      );
      updateTextStats(redacted.cli.stdout);
    }
    if (Array.isArray(redacted.cli.stdout?.lines)) {
      redacted.cli.stdout.lines = redacted.cli.stdout.lines.map((line, index) => (
        typeof line === 'string'
          ? redactCliText(line, `cli.stdout.lines[${index}]`, redactedBodyPaths, notes, { jsonLines: true })
          : cloneValue(line)
      ));
    }
    if (Array.isArray(redacted.cli.stdout?.malformedLines)) {
      redacted.cli.stdout.malformedLines = redactStringArray(
        redacted.cli.stdout.malformedLines,
        'cli.stdout.malformedLines',
        redactedBodyPaths,
        notes
      );
    }
    if (typeof redacted.cli.stdout?.finalBuffer === 'string') {
      redacted.cli.stdout.finalBuffer = redactCliText(
        redacted.cli.stdout.finalBuffer,
        'cli.stdout.finalBuffer',
        redactedBodyPaths,
        notes,
        { jsonLines: true }
      );
    }
    if (Array.isArray(redacted.cli.stdout?.jsonlEvents)) {
      redacted.cli.stdout.jsonlEvents = redactBodySecrets(
        redacted.cli.stdout.jsonlEvents,
        'cli.stdout.jsonlEvents',
        redactedBodyPaths
      );
    }
    if (Array.isArray(redacted.cli.stdout?.chunks)) {
      redacted.cli.stdout.chunks = redacted.cli.stdout.chunks.map((chunk, index) => {
        const next = cloneValue(chunk);
        if (typeof next?.text === 'string') {
          next.text = redactCliText(
            next.text,
            `cli.stdout.chunks[${index}].text`,
            redactedBodyPaths,
            notes,
            { jsonLines: true }
          );
          next.byteLength = Buffer.byteLength(next.text, 'utf8');
          next.sha256 = next.text ? sha256(next.text) : null;
        }
        return next;
      });
    }

    if (redacted.cli.stderr?.text) {
      redacted.cli.stderr.text = redactCliText(
        redacted.cli.stderr.text,
        'cli.stderr.text',
        redactedBodyPaths,
        notes
      );
      updateTextStats(redacted.cli.stderr);
    }
    if (Array.isArray(redacted.cli.stderr?.chunks)) {
      redacted.cli.stderr.chunks = redacted.cli.stderr.chunks.map((chunk, index) => {
        const next = cloneValue(chunk);
        if (typeof next?.text === 'string') {
          next.text = redactPlainTextSecrets(
            next.text,
            `cli.stderr.chunks[${index}].text`,
            redactedBodyPaths,
            notes
          );
          next.byteLength = Buffer.byteLength(next.text, 'utf8');
          next.sha256 = next.text ? sha256(next.text) : null;
        }
        return next;
      });
    }
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
