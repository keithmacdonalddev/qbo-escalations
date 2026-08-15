'use strict';

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;

function normalizeKey(key) {
  const buffer = Buffer.isBuffer(key) ? key : Buffer.from(key || '', 'base64');
  if (buffer.length !== KEY_BYTES) {
    throw new Error('The credential encryption key must be exactly 32 bytes.');
  }
  return buffer;
}

function encryptField(plaintext, key, options = {}) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('A non-empty string is required for encryption.');
  }
  const normalizedKey = normalizeKey(key);
  const iv = options.iv || crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, normalizedKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    algorithm: ALGORITHM,
    keyVersion: Number.isInteger(options.keyVersion) ? options.keyVersion : 1,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptField(envelope, key) {
  if (!envelope || envelope.algorithm !== ALGORITHM) {
    throw new Error('Unsupported encrypted credential format.');
  }
  const normalizedKey = normalizeKey(key);
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, normalizedKey, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('The encrypted credential could not be authenticated.');
  }
}

module.exports = { ALGORITHM, KEY_BYTES, decryptField, encryptField, normalizeKey };
