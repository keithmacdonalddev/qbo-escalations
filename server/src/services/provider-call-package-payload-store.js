'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_INLINE_TEXT_MAX_BYTES = 512 * 1024;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function formatDateFolder(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getDefaultPayloadRoot() {
  return path.resolve(__dirname, '..', '..', 'data', 'provider-call-packages');
}

function sanitizeFileName(value) {
  return String(value || 'payload')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'payload';
}

function buildRef(dateFolder, packageId, fileName) {
  return ['server', 'data', 'provider-call-packages', dateFolder, String(packageId), fileName].join('/');
}

function ensureStorage(envelope) {
  envelope.storage = {
    inline: true,
    externalPayloads: [],
    notes: [],
    truncated: false,
    truncationReason: null,
    ...(envelope.storage && typeof envelope.storage === 'object' ? envelope.storage : {}),
  };
  if (!Array.isArray(envelope.storage.externalPayloads)) {
    envelope.storage.externalPayloads = [];
  }
  if (!Array.isArray(envelope.storage.notes)) {
    envelope.storage.notes = [];
  }
  return envelope.storage;
}

function readPath(target, fieldPath) {
  return fieldPath.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[part];
  }, target);
}

function writePath(target, fieldPath, value) {
  const parts = fieldPath.split('.');
  const last = parts.pop();
  const parent = parts.reduce((current, part) => {
    if (!current || typeof current !== 'object') return null;
    return current[part];
  }, target);
  if (parent && typeof parent === 'object') {
    parent[last] = value;
  }
}

function attachPayloadRef(target, fieldPath, payloadRef) {
  const parentPath = fieldPath.split('.').slice(0, -1).join('.');
  const fieldName = fieldPath.split('.').pop();
  const parent = parentPath ? readPath(target, parentPath) : target;
  if (parent && typeof parent === 'object') {
    parent[`${fieldName}PayloadRef`] = payloadRef;
  }
}

function addStorageNote(storage, note) {
  if (!note || storage.notes.includes(note)) return;
  storage.notes.push(note);
}

async function writeExternalPayload(envelope, fieldPath, text, options, fallbackKind = 'payload') {
  const size = byteLength(text);
  const fileName = `${sanitizeFileName(fieldPath)}.txt`;
  const dateFolder = formatDateFolder(options.now);
  const directory = path.join(options.payloadRoot, dateFolder, String(options.packageId));
  const filePath = path.join(directory, fileName);
  const digest = sha256(text);
  const ref = buildRef(dateFolder, options.packageId, fileName);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');

  const payloadRef = {
    field: fieldPath,
    kind: options.kindByField[fieldPath] || fallbackKind,
    byteLength: size,
    sha256: digest,
    encoding: 'utf8',
    ref,
  };

  envelope.storage.externalPayloads.push(payloadRef);
  return payloadRef;
}

async function externalizeField(envelope, fieldPath, options) {
  const value = readPath(envelope, fieldPath);
  if (value === null || value === undefined) return false;

  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string') return false;

  const size = byteLength(text);
  if (size <= options.maxInlineBytes) return false;

  const payloadRef = await writeExternalPayload(
    envelope,
    fieldPath,
    text,
    options,
    options.kindByField[fieldPath] || 'payload'
  );

  writePath(envelope, fieldPath, null);
  attachPayloadRef(envelope, fieldPath, payloadRef);
  return true;
}

async function externalizeResponseChunks(envelope, options) {
  const chunks = envelope.response?.bodyChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return false;

  const textChunks = chunks
    .map((chunk, index) => ({ chunk, index, text: typeof chunk?.text === 'string' ? chunk.text : null }))
    .filter((entry) => entry.text !== null);
  if (textChunks.length === 0) return false;

  const totalBytes = textChunks.reduce((sum, entry) => sum + byteLength(entry.text), 0);
  const hasOversizedChunk = textChunks.some((entry) => byteLength(entry.text) > options.maxInlineBytes);
  if (totalBytes <= options.maxInlineBytes && !hasOversizedChunk) return false;

  for (const entry of textChunks) {
    const seq = Number.isInteger(entry.chunk.seq) ? entry.chunk.seq : entry.index;
    const fieldPath = `response.bodyChunks[${seq}].text`;
    const payloadRef = await writeExternalPayload(
      envelope,
      fieldPath,
      entry.text,
      options,
      'response_body_chunk'
    );
    entry.chunk.text = null;
    entry.chunk.textPayloadRef = payloadRef;
  }

  return true;
}

async function externalizeCliTextChunks(envelope, streamName, options) {
  const chunks = envelope.cli?.[streamName]?.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return false;

  const textChunks = chunks
    .map((chunk, index) => ({ chunk, index, text: typeof chunk?.text === 'string' ? chunk.text : null }))
    .filter((entry) => entry.text !== null);
  if (textChunks.length === 0) return false;

  const totalBytes = textChunks.reduce((sum, entry) => sum + byteLength(entry.text), 0);
  const hasOversizedChunk = textChunks.some((entry) => byteLength(entry.text) > options.maxInlineBytes);
  if (totalBytes <= options.maxInlineBytes && !hasOversizedChunk) return false;

  for (const entry of textChunks) {
    const seq = Number.isInteger(entry.chunk.seq) ? entry.chunk.seq : entry.index;
    const fieldPath = `cli.${streamName}.chunks[${seq}].text`;
    const payloadRef = await writeExternalPayload(
      envelope,
      fieldPath,
      entry.text,
      options,
      `cli_${streamName}_chunk`
    );
    entry.chunk.text = null;
    entry.chunk.textPayloadRef = payloadRef;
  }

  return true;
}

async function externalizeTextChunks(chunks, rootFieldPath, fallbackKind, envelope, options) {
  if (!Array.isArray(chunks) || chunks.length === 0) return false;

  const textChunks = chunks
    .map((chunk, index) => ({ chunk, index, text: typeof chunk?.text === 'string' ? chunk.text : null }))
    .filter((entry) => entry.text !== null);
  if (textChunks.length === 0) return false;

  const totalBytes = textChunks.reduce((sum, entry) => sum + byteLength(entry.text), 0);
  const hasOversizedChunk = textChunks.some((entry) => byteLength(entry.text) > options.maxInlineBytes);
  if (totalBytes <= options.maxInlineBytes && !hasOversizedChunk) return false;

  for (const entry of textChunks) {
    const seq = Number.isInteger(entry.chunk.seq) ? entry.chunk.seq : entry.index;
    const fieldPath = `${rootFieldPath}[${seq}].text`;
    const payloadRef = await writeExternalPayload(
      envelope,
      fieldPath,
      entry.text,
      options,
      fallbackKind
    );
    entry.chunk.text = null;
    entry.chunk.textPayloadRef = payloadRef;
  }

  return true;
}

async function externalizeLmStudioTextChunks(envelope, options) {
  let externalized = false;
  externalized = await externalizeTextChunks(
    envelope.lmStudio?.response?.bodyChunks,
    'lmStudio.response.bodyChunks',
    'lm_studio_response_body_chunk',
    envelope,
    options
  ) || externalized;
  externalized = await externalizeTextChunks(
    envelope.lmStudio?.stream?.rawChunks,
    'lmStudio.stream.rawChunks',
    'lm_studio_stream_raw_chunk',
    envelope,
    options
  ) || externalized;
  return externalized;
}

async function externalizeLmStudioFrames(envelope, options) {
  const frames = envelope.lmStudio?.stream?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return false;

  const entries = [];
  frames.forEach((frame, index) => {
    if (typeof frame?.rawLine === 'string') {
      entries.push({ frame, index, fieldName: 'rawLine', text: frame.rawLine });
    }
    if (typeof frame?.data === 'string') {
      entries.push({ frame, index, fieldName: 'data', text: frame.data });
    }
  });
  if (entries.length === 0) return false;

  const totalBytes = entries.reduce((sum, entry) => sum + byteLength(entry.text), 0);
  const hasOversizedEntry = entries.some((entry) => byteLength(entry.text) > options.maxInlineBytes);
  if (totalBytes <= options.maxInlineBytes && !hasOversizedEntry) return false;

  for (const entry of entries) {
    const seq = Number.isInteger(entry.frame.seq) ? entry.frame.seq : entry.index;
    const fieldPath = `lmStudio.stream.frames[${seq}].${entry.fieldName}`;
    const payloadRef = await writeExternalPayload(
      envelope,
      fieldPath,
      entry.text,
      options,
      entry.fieldName === 'rawLine' ? 'lm_studio_stream_frame_raw_line' : 'lm_studio_stream_frame_data'
    );
    entry.frame[entry.fieldName] = null;
    entry.frame[`${entry.fieldName}PayloadRef`] = payloadRef;
  }

  return true;
}

async function externalizeLlmGatewayTextChunks(envelope, options) {
  return await externalizeTextChunks(
    envelope.llmGateway?.response?.bodyChunks,
    'llmGateway.response.bodyChunks',
    'llm_gateway_response_body_chunk',
    envelope,
    options
  );
}

async function externalizeGeminiApiTextChunks(envelope, options) {
  return await externalizeTextChunks(
    envelope.geminiApi?.response?.bodyChunks,
    'geminiApi.response.bodyChunks',
    'gemini_api_response_body_chunk',
    envelope,
    options
  );
}

function duplicateJsonMatchesText(envelope, textPath, jsonPath, options) {
  const bodyText = readPath(envelope, textPath);
  const bodyJson = readPath(envelope, jsonPath);
  const bodyJsonText = bodyJson === null || bodyJson === undefined
    ? null
    : JSON.stringify(bodyJson);
  return typeof bodyText === 'string'
    && bodyJsonText === bodyText
    && byteLength(bodyText) > options.maxInlineBytes;
}

function omitDuplicateJsonFromExternalizedText(envelope, storage, textPath, jsonPath, note) {
  const bodyTextRef = readPath(envelope, `${textPath}PayloadRef`);
  if (!bodyTextRef) return false;
  writePath(envelope, jsonPath, null);
  attachPayloadRef(envelope, jsonPath, {
    ...bodyTextRef,
    field: jsonPath,
    kind: `${bodyTextRef.kind}_json`,
    derivedFrom: textPath,
  });
  addStorageNote(storage, note);
  return true;
}

async function externalizeProviderCallPackagePayloads(envelope, options = {}) {
  const prepared = envelope || {};
  const storage = ensureStorage(prepared);
  const payloadOptions = {
    packageId: options.packageId,
    now: options.now || new Date(),
    payloadRoot: options.payloadRoot || getDefaultPayloadRoot(),
    maxInlineBytes: Number.isFinite(options.maxInlineBytes)
      ? options.maxInlineBytes
      : DEFAULT_INLINE_TEXT_MAX_BYTES,
    kindByField: {
      'request.bodyText': 'request_body',
      'request.bodyJson': 'request_body_json',
      'response.bodyText': 'response_body',
      'response.parsedJson': 'response_parsed_json',
      'error.rawBody': 'error_raw_body',
      ...(options.kindByField || {}),
    },
  };

  if (!payloadOptions.packageId) {
    throw new Error('packageId is required for provider call package payload storage');
  }

  const fields = options.fields || [
    'request.bodyText',
    'request.bodyJson',
    'response.bodyText',
    'response.parsedJson',
    'error.rawBody',
  ];

  const requestBodyText = readPath(prepared, 'request.bodyText');
  const requestBodyJson = readPath(prepared, 'request.bodyJson');
  const requestBodyJsonText = requestBodyJson === null || requestBodyJson === undefined
    ? null
    : JSON.stringify(requestBodyJson);
  const shouldDropDuplicateRequestBodyJson = typeof requestBodyText === 'string'
    && requestBodyJsonText === requestBodyText
    && byteLength(requestBodyText) > payloadOptions.maxInlineBytes;
  const shouldDropDuplicateLmStudioRequestBodyJson = duplicateJsonMatchesText(
    prepared,
    'lmStudio.request.bodyText',
    'lmStudio.request.bodyJson',
    payloadOptions
  );
  const shouldDropDuplicateLlmGatewayRequestBodyJson = duplicateJsonMatchesText(
    prepared,
    'llmGateway.request.bodyText',
    'llmGateway.request.bodyJson',
    payloadOptions
  );
  const shouldDropDuplicateLlmGatewayResponseParsedJson = duplicateJsonMatchesText(
    prepared,
    'llmGateway.response.bodyText',
    'llmGateway.response.parsedJson',
    payloadOptions
  );
  const shouldDropDuplicateGeminiApiRequestBodyJson = duplicateJsonMatchesText(
    prepared,
    'geminiApi.request.bodyText',
    'geminiApi.request.bodyJson',
    payloadOptions
  );
  const shouldDropDuplicateGeminiApiResponseParsedJson = duplicateJsonMatchesText(
    prepared,
    'geminiApi.response.bodyText',
    'geminiApi.response.parsedJson',
    payloadOptions
  );

  let externalized = false;
  for (const fieldPath of fields) {
    if (fieldPath === 'request.bodyJson' && shouldDropDuplicateRequestBodyJson) {
      const bodyTextRef = readPath(prepared, 'request.bodyTextPayloadRef');
      if (bodyTextRef) {
        writePath(prepared, 'request.bodyJson', null);
        attachPayloadRef(prepared, 'request.bodyJson', {
          ...bodyTextRef,
          field: 'request.bodyJson',
          kind: 'request_body_json',
          derivedFrom: 'request.bodyText',
        });
        addStorageNote(storage, 'request.bodyJson omitted because it duplicates externalized request.bodyText');
        externalized = true;
        continue;
      }
    }
    if (fieldPath === 'lmStudio.request.bodyJson' && shouldDropDuplicateLmStudioRequestBodyJson) {
      if (omitDuplicateJsonFromExternalizedText(
        prepared,
        storage,
        'lmStudio.request.bodyText',
        'lmStudio.request.bodyJson',
        'lmStudio.request.bodyJson omitted because it duplicates externalized lmStudio.request.bodyText'
      )) {
        externalized = true;
        continue;
      }
    }
    if (fieldPath === 'llmGateway.request.bodyJson' && shouldDropDuplicateLlmGatewayRequestBodyJson) {
      if (omitDuplicateJsonFromExternalizedText(
        prepared,
        storage,
        'llmGateway.request.bodyText',
        'llmGateway.request.bodyJson',
        'llmGateway.request.bodyJson omitted because it duplicates externalized llmGateway.request.bodyText'
      )) {
        externalized = true;
        continue;
      }
    }
    if (fieldPath === 'llmGateway.response.parsedJson' && shouldDropDuplicateLlmGatewayResponseParsedJson) {
      if (omitDuplicateJsonFromExternalizedText(
        prepared,
        storage,
        'llmGateway.response.bodyText',
        'llmGateway.response.parsedJson',
        'llmGateway.response.parsedJson omitted because it duplicates externalized llmGateway.response.bodyText'
      )) {
        externalized = true;
        continue;
      }
    }
    if (fieldPath === 'geminiApi.request.bodyJson' && shouldDropDuplicateGeminiApiRequestBodyJson) {
      if (omitDuplicateJsonFromExternalizedText(
        prepared,
        storage,
        'geminiApi.request.bodyText',
        'geminiApi.request.bodyJson',
        'geminiApi.request.bodyJson omitted because it duplicates externalized geminiApi.request.bodyText'
      )) {
        externalized = true;
        continue;
      }
    }
    if (fieldPath === 'geminiApi.response.parsedJson' && shouldDropDuplicateGeminiApiResponseParsedJson) {
      if (omitDuplicateJsonFromExternalizedText(
        prepared,
        storage,
        'geminiApi.response.bodyText',
        'geminiApi.response.parsedJson',
        'geminiApi.response.parsedJson omitted because it duplicates externalized geminiApi.response.bodyText'
      )) {
        externalized = true;
        continue;
      }
    }
    externalized = await externalizeField(prepared, fieldPath, payloadOptions) || externalized;
  }
  externalized = await externalizeResponseChunks(prepared, payloadOptions) || externalized;
  externalized = await externalizeCliTextChunks(prepared, 'stdout', payloadOptions) || externalized;
  externalized = await externalizeCliTextChunks(prepared, 'stderr', payloadOptions) || externalized;
  externalized = await externalizeLmStudioTextChunks(prepared, payloadOptions) || externalized;
  externalized = await externalizeLmStudioFrames(prepared, payloadOptions) || externalized;
  externalized = await externalizeLlmGatewayTextChunks(prepared, payloadOptions) || externalized;
  externalized = await externalizeGeminiApiTextChunks(prepared, payloadOptions) || externalized;

  storage.inline = !externalized && storage.externalPayloads.length === 0;
  storage.truncated = false;
  storage.truncationReason = null;
  return prepared;
}

module.exports = {
  DEFAULT_INLINE_TEXT_MAX_BYTES,
  externalizeProviderCallPackagePayloads,
  getDefaultPayloadRoot,
  sha256,
};
