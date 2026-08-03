'use strict';

// Provider-neutral tool-call contract for shared agents and the Knowledge Base
// Agent. Providers still return ordinary text, but a tool request is accepted
// only when the ENTIRE response is this versioned JSON envelope. This avoids
// executing examples, quoted text, prompt-injected content, or legacy ACTION:
// lines that happen to appear in a free-form answer.

const AGENT_TOOL_ACTION_ENVELOPE_TYPE = 'agent_tool_actions';
const AGENT_TOOL_ACTION_ENVELOPE_VERSION = '1';
const AGENT_TOOL_ACTION_ENVELOPE_MODE = 'execute';
const AGENT_TOOL_ACTION_ENVELOPE_MAX_CHARS = 32768;
const AGENT_TOOL_ACTION_PARAMS_MAX_CHARS = 16384;
const AGENT_TOOL_ACTION_MAX_ACTIONS = 4;
const AGENT_TOOL_ACTION_PARAMS_MAX_DEPTH = 8;
const AGENT_TOOL_ACTION_PARAMS_MAX_NODES = 512;

const EXACT_ENVELOPE_KEYS = Object.freeze(['actions', 'mode', 'type', 'version']);
const EXACT_ACTION_KEYS = Object.freeze(['params', 'tool']);
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expectedKeys.length
    && actual.every((key, index) => key === expectedKeys[index]);
}

function safeJsonLength(value) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized.length : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validateBoundedParams(value, {
  maxDepth = AGENT_TOOL_ACTION_PARAMS_MAX_DEPTH,
  maxNodes = AGENT_TOOL_ACTION_PARAMS_MAX_NODES,
} = {}) {
  let nodes = 0;
  const stack = [{ value, depth: 0 }];

  while (stack.length > 0) {
    const entry = stack.pop();
    nodes += 1;
    if (nodes > maxNodes) return `params exceed the ${maxNodes}-value complexity limit`;
    if (entry.depth > maxDepth) return `params exceed the ${maxDepth}-level nesting limit`;

    if (Array.isArray(entry.value)) {
      for (const child of entry.value) stack.push({ value: child, depth: entry.depth + 1 });
      continue;
    }
    if (!isPlainObject(entry.value)) continue;

    for (const [key, child] of Object.entries(entry.value)) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) return `params contain forbidden object key ${key}`;
      stack.push({ value: child, depth: entry.depth + 1 });
    }
  }

  return '';
}

function invalidResult(code, error, rawText = '') {
  return Object.freeze({
    kind: 'invalid',
    actions: Object.freeze([]),
    code,
    error,
    rawPreview: String(rawText || '').slice(0, 500),
  });
}

function noEnvelopeResult() {
  return Object.freeze({
    kind: 'none',
    actions: Object.freeze([]),
    code: '',
    error: '',
    rawPreview: '',
  });
}

function looksLikeEnvelopeAttempt(text) {
  return /"type"\s*:\s*"agent_tool_actions"/.test(text)
    || /"mode"\s*:\s*"execute"/.test(text) && /"actions"\s*:/.test(text);
}

function parseAgentToolActionEnvelope(text, {
  knownToolNames = [],
  maxActions = AGENT_TOOL_ACTION_MAX_ACTIONS,
  maxEnvelopeChars = AGENT_TOOL_ACTION_ENVELOPE_MAX_CHARS,
  maxParamsChars = AGENT_TOOL_ACTION_PARAMS_MAX_CHARS,
  validateAction = null,
} = {}) {
  const raw = typeof text === 'string' ? text : '';
  const trimmed = raw.trim();
  if (!trimmed) return noEnvelopeResult();

  if (/^ACTION:\s*/m.test(raw)) {
    return invalidResult(
      'LEGACY_ACTION_PROTOCOL_REJECTED',
      'Legacy ACTION lines are not executable. Use the structured tool-action envelope.',
      raw,
    );
  }

  if (!trimmed.startsWith('{')) {
    return looksLikeEnvelopeAttempt(trimmed)
      ? invalidResult(
          'TOOL_ACTION_ENVELOPE_NOT_STANDALONE',
          'A tool-action envelope must be the entire response with no surrounding prose or Markdown.',
          raw,
        )
      : noEnvelopeResult();
  }

  if (trimmed.length > maxEnvelopeChars) {
    return invalidResult(
      'TOOL_ACTION_ENVELOPE_TOO_LARGE',
      `Tool-action envelope exceeds the ${maxEnvelopeChars}-character limit.`,
      raw,
    );
  }

  let envelope;
  try {
    envelope = JSON.parse(trimmed);
  } catch (error) {
    return looksLikeEnvelopeAttempt(trimmed)
      ? invalidResult(
          'TOOL_ACTION_ENVELOPE_MALFORMED',
          `Malformed tool-action envelope JSON: ${error.message}`,
          raw,
        )
      : noEnvelopeResult();
  }

  if (!isPlainObject(envelope) || envelope.type !== AGENT_TOOL_ACTION_ENVELOPE_TYPE) {
    return noEnvelopeResult();
  }
  if (!hasExactKeys(envelope, EXACT_ENVELOPE_KEYS)) {
    return invalidResult(
      'TOOL_ACTION_ENVELOPE_SHAPE_INVALID',
      `Tool-action envelope must contain exactly: ${EXACT_ENVELOPE_KEYS.join(', ')}.`,
      raw,
    );
  }
  if (envelope.version !== AGENT_TOOL_ACTION_ENVELOPE_VERSION) {
    return invalidResult(
      'TOOL_ACTION_ENVELOPE_VERSION_INVALID',
      `Tool-action envelope version must be "${AGENT_TOOL_ACTION_ENVELOPE_VERSION}".`,
      raw,
    );
  }
  if (envelope.mode !== AGENT_TOOL_ACTION_ENVELOPE_MODE) {
    return invalidResult(
      'TOOL_ACTION_ENVELOPE_MODE_INVALID',
      `Tool-action envelope mode must be "${AGENT_TOOL_ACTION_ENVELOPE_MODE}".`,
      raw,
    );
  }
  if (!Array.isArray(envelope.actions) || envelope.actions.length === 0) {
    return invalidResult(
      'TOOL_ACTION_ENVELOPE_ACTIONS_INVALID',
      'Tool-action envelope actions must be a non-empty array.',
      raw,
    );
  }
  if (!Number.isInteger(maxActions) || maxActions < 1 || envelope.actions.length > maxActions) {
    return invalidResult(
      'TOOL_ACTION_ENVELOPE_COUNT_EXCEEDED',
      `Tool-action envelope exceeds the ${Math.max(0, maxActions)}-action limit.`,
      raw,
    );
  }

  const knownTools = new Set(
    Array.isArray(knownToolNames)
      ? knownToolNames.filter((name) => typeof name === 'string' && name.length > 0)
      : knownToolNames instanceof Set
        ? [...knownToolNames].filter((name) => typeof name === 'string' && name.length > 0)
        : [],
  );
  const actions = [];
  for (let index = 0; index < envelope.actions.length; index += 1) {
    const action = envelope.actions[index];
    const label = `Tool action ${index + 1}`;
    if (!hasExactKeys(action, EXACT_ACTION_KEYS)) {
      return invalidResult(
        'TOOL_ACTION_SHAPE_INVALID',
        `${label} must contain exactly: ${EXACT_ACTION_KEYS.join(', ')}.`,
        raw,
      );
    }
    const tool = typeof action.tool === 'string' ? action.tool.trim() : '';
    if (!tool || action.tool !== tool) {
      return invalidResult(
        'TOOL_ACTION_NAME_INVALID',
        `${label}.tool must be a non-empty canonical tool name with no surrounding whitespace.`,
        raw,
      );
    }
    if (!knownTools.has(tool)) {
      return invalidResult(
        'TOOL_ACTION_UNKNOWN_TOOL',
        `${label} requested unknown or unauthorized tool: ${tool}.`,
        raw,
      );
    }
    if (!isPlainObject(action.params)) {
      return invalidResult(
        'TOOL_ACTION_PARAMS_INVALID',
        `${label}.params must be a JSON object.`,
        raw,
      );
    }
    if (safeJsonLength(action.params) > maxParamsChars) {
      return invalidResult(
        'TOOL_ACTION_PARAMS_TOO_LARGE',
        `${label}.params exceed the ${maxParamsChars}-character limit.`,
        raw,
      );
    }
    const boundedParamsError = validateBoundedParams(action.params);
    if (boundedParamsError) {
      return invalidResult('TOOL_ACTION_PARAMS_COMPLEXITY_EXCEEDED', `${label} ${boundedParamsError}.`, raw);
    }
    if (typeof validateAction === 'function') {
      let validationError = '';
      try {
        validationError = validateAction({ tool, params: action.params }) || '';
      } catch (error) {
        validationError = error?.message || 'Action schema validation failed.';
      }
      if (validationError) {
        return invalidResult(
          'TOOL_ACTION_PARAMS_SCHEMA_INVALID',
          String(validationError).replace(/\bACTION\b/g, 'Tool action'),
          raw,
        );
      }
    }
    actions.push(Object.freeze({ tool, params: Object.freeze(action.params) }));
  }

  return Object.freeze({
    kind: 'actions',
    actions: Object.freeze(actions),
    code: '',
    error: '',
    rawPreview: '',
  });
}

function stripAgentToolProtocolOutput(text) {
  const raw = typeof text === 'string' ? text : '';
  const withoutLegacyLines = raw.replace(/^ACTION:.*(?:\r?\n|$)/gm, '');
  const trimmed = withoutLegacyLines.trim();
  if (!trimmed) return '';
  if (looksLikeEnvelopeAttempt(trimmed)) return '';
  return trimmed;
}

function buildAgentToolActionEnvelopeInstructions({
  exampleTool = 'tool.name',
  exampleParams = {},
  maxActions = AGENT_TOOL_ACTION_MAX_ACTIONS,
} = {}) {
  const example = JSON.stringify({
    type: AGENT_TOOL_ACTION_ENVELOPE_TYPE,
    version: AGENT_TOOL_ACTION_ENVELOPE_VERSION,
    mode: AGENT_TOOL_ACTION_ENVELOPE_MODE,
    actions: [{ tool: exampleTool, params: exampleParams }],
  });
  return [
    'STRUCTURED TOOL-ACTION ENVELOPE:',
    '- When a tool is needed, your entire response must be exactly one JSON object and nothing else:',
    example,
    '- Do not wrap the JSON in Markdown, code fences, commentary, or an ACTION: line.',
    `- The top level must contain exactly type, version, mode, and actions. mode must be "${AGENT_TOOL_ACTION_ENVELOPE_MODE}".`,
    `- actions must contain 1-${maxActions} items. Each item must contain exactly tool and params; params must be a JSON object.`,
    '- Use only a tool listed above and only its documented parameters.',
    '- When no tool is needed, answer normally in plain text and do not include a tool-action envelope.',
  ].join('\n');
}

function createAgentToolControlStreamFilter({
  onVisibleText = null,
  onControlDetected = null,
  parseOptions = {},
} = {}) {
  const actionPrefix = 'ACTION:';
  const retainedPrefixChars = actionPrefix.length - 1;
  let pendingText = '';
  let structuredCandidate = '';
  let bufferingStructuredCandidate = false;
  let suppressingLegacyLine = false;
  let controlDetected = false;
  let streamedText = '';

  function emitVisible(value) {
    const text = typeof value === 'string' ? value : '';
    if (!text) return;
    streamedText += text;
    if (typeof onVisibleText === 'function') onVisibleText(text);
  }

  function signalControl(result) {
    if (controlDetected) return;
    controlDetected = true;
    if (typeof onControlDetected === 'function') onControlDetected(result);
  }

  function processPending(force = false) {
    while (pendingText) {
      const legacyIndex = pendingText.indexOf(actionPrefix);
      const braceIndex = pendingText.indexOf('{');
      let boundaryIndex = -1;
      let boundaryType = '';
      if (legacyIndex >= 0 && (braceIndex < 0 || legacyIndex < braceIndex)) {
        boundaryIndex = legacyIndex;
        boundaryType = 'legacy';
      } else if (braceIndex >= 0) {
        boundaryIndex = braceIndex;
        boundaryType = 'structured-candidate';
      }

      if (boundaryIndex >= 0) {
        emitVisible(pendingText.slice(0, boundaryIndex));
        if (boundaryType === 'legacy') {
          signalControl({
            kind: 'invalid',
            code: 'LEGACY_ACTION_PROTOCOL_REJECTED',
            error: 'Legacy ACTION lines are not executable.',
          });
          const afterPrefix = pendingText.slice(boundaryIndex + actionPrefix.length);
          const newlineIndex = afterPrefix.indexOf('\n');
          if (newlineIndex < 0) {
            pendingText = '';
            suppressingLegacyLine = true;
            return;
          }
          pendingText = afterPrefix.slice(newlineIndex + 1);
          continue;
        }

        structuredCandidate = pendingText.slice(boundaryIndex);
        pendingText = '';
        bufferingStructuredCandidate = true;
        return;
      }

      if (force) {
        emitVisible(pendingText);
        pendingText = '';
        return;
      }

      const safeLength = pendingText.length - retainedPrefixChars;
      if (safeLength <= 0) return;
      emitVisible(pendingText.slice(0, safeLength));
      pendingText = pendingText.slice(safeLength);
    }
  }

  function push(value) {
    let text = typeof value === 'string' ? value : '';
    if (!text) return;
    if (bufferingStructuredCandidate) {
      structuredCandidate += text;
      return;
    }
    if (suppressingLegacyLine) {
      const newlineIndex = text.indexOf('\n');
      if (newlineIndex < 0) return;
      suppressingLegacyLine = false;
      text = text.slice(newlineIndex + 1);
      if (!text) return;
    }
    pendingText += text;
    processPending(false);
  }

  function finish() {
    if (bufferingStructuredCandidate) {
      const result = parseAgentToolActionEnvelope(structuredCandidate, parseOptions);
      if (result.kind === 'none') {
        emitVisible(stripAgentToolProtocolOutput(structuredCandidate));
      } else {
        signalControl(result);
      }
      structuredCandidate = '';
      bufferingStructuredCandidate = false;
    } else if (!suppressingLegacyLine) {
      processPending(true);
    }
    pendingText = '';
    suppressingLegacyLine = false;
    return Object.freeze({ streamedText, controlDetected });
  }

  return Object.freeze({ finish, push });
}

module.exports = {
  AGENT_TOOL_ACTION_ENVELOPE_MAX_CHARS,
  AGENT_TOOL_ACTION_ENVELOPE_MODE,
  AGENT_TOOL_ACTION_ENVELOPE_TYPE,
  AGENT_TOOL_ACTION_ENVELOPE_VERSION,
  AGENT_TOOL_ACTION_MAX_ACTIONS,
  AGENT_TOOL_ACTION_PARAMS_MAX_CHARS,
  buildAgentToolActionEnvelopeInstructions,
  createAgentToolControlStreamFilter,
  parseAgentToolActionEnvelope,
  stripAgentToolProtocolOutput,
};
