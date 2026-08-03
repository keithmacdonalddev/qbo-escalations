'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getDefaultPayloadRoot } = require('./provider-call-package-payload-store');

const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const REF_MARKER = 'server/data/provider-call-packages/';

function payloadError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.payloadStatus = status;
  return error;
}

function resolveContainedPayloadPath(ref, options = {}) {
  const storedRef = typeof ref?.ref === 'string' ? ref.ref.replace(/\\/g, '/') : '';
  if (!storedRef || !storedRef.startsWith(REF_MARKER)) {
    throw payloadError('PROVIDER_PAYLOAD_REF_INVALID', 'invalid-ref', 'Provider payload reference is missing or outside the managed payload namespace.');
  }
  const relativeRef = storedRef.slice(REF_MARKER.length);
  const payloadRoot = path.resolve(options.payloadRoot || getDefaultPayloadRoot());
  const fullPath = path.resolve(payloadRoot, ...relativeRef.split('/'));
  const relativePath = path.relative(payloadRoot, fullPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw payloadError('PROVIDER_PAYLOAD_REF_INVALID', 'invalid-ref', 'Provider payload reference escaped the managed payload root.');
  }
  return { payloadRoot, fullPath, relativePath };
}

async function loadProviderPayloadText(ref, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : DEFAULT_MAX_PAYLOAD_BYTES;
  const { fullPath, relativePath } = resolveContainedPayloadPath(ref, options);
  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw payloadError('PROVIDER_PAYLOAD_MISSING', 'missing', `Provider payload is missing: ${relativePath}`);
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw payloadError('PROVIDER_PAYLOAD_REF_INVALID', 'invalid-ref', 'Provider payload reference does not identify a regular file.');
  }
  if (stat.size > maxBytes) {
    throw payloadError('PROVIDER_PAYLOAD_TOO_LARGE', 'too-large', `Provider payload exceeds the ${maxBytes}-byte read limit.`);
  }
  if (!Number.isFinite(Number(ref?.byteLength)) || Number(ref.byteLength) !== stat.size) {
    throw payloadError('PROVIDER_PAYLOAD_INTEGRITY_FAILED', 'integrity-failed', 'Provider payload byte length does not match its stored manifest.');
  }
  if (!/^[a-f0-9]{64}$/.test(String(ref?.sha256 || ''))) {
    throw payloadError('PROVIDER_PAYLOAD_REF_INVALID', 'invalid-ref', 'Provider payload reference does not contain a valid SHA-256 digest.');
  }
  const bytes = await fs.readFile(fullPath);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (digest !== ref.sha256) {
    throw payloadError('PROVIDER_PAYLOAD_INTEGRITY_FAILED', 'integrity-failed', 'Provider payload SHA-256 does not match its stored manifest.');
  }
  return {
    ok: true,
    status: 'verified',
    text: bytes.toString(ref.encoding === 'utf8' || !ref.encoding ? 'utf8' : ref.encoding),
    byteLength: stat.size,
    sha256: digest,
    relativePath,
  };
}

module.exports = {
  DEFAULT_MAX_PAYLOAD_BYTES,
  loadProviderPayloadText,
  resolveContainedPayloadPath,
};
