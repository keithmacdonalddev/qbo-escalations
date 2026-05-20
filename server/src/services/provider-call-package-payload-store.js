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
    externalized = await externalizeField(prepared, fieldPath, payloadOptions) || externalized;
  }
  externalized = await externalizeResponseChunks(prepared, payloadOptions) || externalized;

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
