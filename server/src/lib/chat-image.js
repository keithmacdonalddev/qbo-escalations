'use strict';

const { transcribeImage } = require('../services/claude');

const DEFAULT_CHAT_MAX_IMAGES = 6;
const DEFAULT_CHAT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_CHAT_MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;
const IMAGE_TRANSCRIBE_TIMEOUT_MS = parsePositiveInt(
  process.env.CHAT_IMAGE_TRANSCRIBE_TIMEOUT_MS,
  45_000
);

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getChatMaxImages() {
  return parsePositiveInt(process.env.CHAT_MAX_IMAGES_PER_REQUEST, DEFAULT_CHAT_MAX_IMAGES);
}

function getChatMaxImageBytes() {
  return parsePositiveInt(process.env.CHAT_MAX_IMAGE_BYTES, DEFAULT_CHAT_MAX_IMAGE_BYTES);
}

function getChatMaxTotalImageBytes() {
  return parsePositiveInt(process.env.CHAT_MAX_TOTAL_IMAGE_BYTES, DEFAULT_CHAT_MAX_TOTAL_IMAGE_BYTES);
}

function extractBase64Payload(image) {
  const trimmed = safeString(image, '').trim();
  const dataUrlMatch = trimmed.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
  return dataUrlMatch ? dataUrlMatch[1] : trimmed;
}

function estimateBase64Bytes(base64Payload) {
  const normalized = safeString(base64Payload, '').replace(/\s+/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : (normalized.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function normalizeChatImages(images) {
  if (images === undefined || images === null) {
    return { ok: true, images: [], totalBytes: 0 };
  }
  if (!Array.isArray(images)) {
    return { ok: false, code: 'INVALID_IMAGES', error: 'images must be an array of base64 strings' };
  }
  if (images.length > getChatMaxImages()) {
    return {
      ok: false,
      code: 'TOO_MANY_IMAGES',
      error: `Maximum ${getChatMaxImages()} images per request`,
    };
  }

  const maxImageBytes = getChatMaxImageBytes();
  const maxTotalBytes = getChatMaxTotalImageBytes();
  let totalBytes = 0;
  const normalizedImages = [];

  for (const rawImage of images) {
    if (typeof rawImage !== 'string') {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Each image must be a base64 string' };
    }
    const trimmed = rawImage.trim();
    if (!trimmed) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Each image must be a non-empty base64 string' };
    }
    const bytes = estimateBase64Bytes(extractBase64Payload(trimmed));
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Unable to decode image payload' };
    }
    if (bytes > maxImageBytes) {
      return {
        ok: false,
        code: 'IMAGE_TOO_LARGE',
        error: `Image exceeds ${maxImageBytes} bytes`,
      };
    }
    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      return {
        ok: false,
        code: 'IMAGES_TOO_LARGE',
        error: `Total image payload exceeds ${maxTotalBytes} bytes`,
      };
    }
    normalizedImages.push(trimmed);
  }

  return { ok: true, images: normalizedImages, totalBytes };
}

async function transcribeImageForChat(images, options = {}) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const startedAt = Date.now();
  try {
    const result = await transcribeImage(images[0], {
      model: options.model || undefined,
      reasoningEffort: options.reasoningEffort || 'medium',
      timeoutMs: options.timeoutMs || IMAGE_TRANSCRIBE_TIMEOUT_MS,
    });
    return {
      text: result && result.text ? result.text : '',
      usage: result && result.usage ? result.usage : null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    console.warn('[chat] Image transcription failed (non-fatal):', err.message);
    return null;
  }
}

function buildTranscriptionRefBlock(transcriptionText) {
  const text = safeString(transcriptionText, '').trim();
  if (!text) return '';
  return [
    '\n\n--- IMAGE TRANSCRIPTION (server-extracted, use as primary text reference) ---',
    text,
    '--- END IMAGE TRANSCRIPTION ---\n',
  ].join('\n');
}

module.exports = {
  buildTranscriptionRefBlock,
  extractBase64Payload,
  estimateBase64Bytes,
  normalizeChatImages,
  transcribeImageForChat,
};
