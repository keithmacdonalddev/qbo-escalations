'use strict';

const express = require('express');
const mongoose = require('mongoose');
const Conversation = require('../../models/Conversation');
const { estimateBase64Bytes } = require('../../lib/chat-image');
const {
  getArchive,
  getAllImages,
  getImageFile,
  getArchiveStats,
} = require('../../lib/image-archive');

const router = express.Router();

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value);
}

function buildConversationImageId(messageIndex, imageIndex) {
  return `msg-${messageIndex}-img-${imageIndex}`;
}

function parseConversationImageId(imageId) {
  const match = /^msg-(\d+)-img-(\d+)$/.exec(String(imageId || ''));
  if (!match) return null;
  return {
    messageIndex: Number.parseInt(match[1], 10),
    imageIndex: Number.parseInt(match[2], 10),
  };
}

function getImageMimeType(image) {
  const match = typeof image === 'string'
    ? image.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/)
    : null;
  return match ? match[1].toLowerCase() : 'image/png';
}

function getImagePayload(image) {
  if (typeof image !== 'string') return '';
  const match = image.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
  return (match ? match[1] : image).replace(/\s+/g, '');
}

function extensionFromMime(mimeType) {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
  };
  return map[mimeType] || 'png';
}

function buildConversationImageEntry(conversation, message, messageIndex, image, imageIndex) {
  const mimeType = getImageMimeType(image);
  const payload = getImagePayload(image);
  const extension = extensionFromMime(mimeType);
  const timestamp = message && message.timestamp
    ? new Date(message.timestamp)
    : new Date(conversation.updatedAt || conversation.createdAt || Date.now());

  return {
    version: 0,
    conversationId: String(conversation._id),
    messageIndex,
    imageIndex,
    userPrompt: message && typeof message.content === 'string' ? message.content : '',
    modelParsing: '',
    thinking: '',
    parseFields: null,
    triageCard: null,
    grade: null,
    provider: (message && message.provider) || conversation.provider || 'unknown',
    usage: (message && message.usage) || null,
    image: {
      fileName: `image-${messageIndex}-${imageIndex}.${extension}`,
      extension,
      mimeSubtype: mimeType.replace(/^image\//, ''),
      sizeBytes: estimateBase64Bytes(payload),
    },
    archivedAt: timestamp.toISOString(),
    createdAt: timestamp.toISOString(),
    source: 'conversation',
    _imageId: buildConversationImageId(messageIndex, imageIndex),
  };
}

async function getConversationBackfillImages({ grade, dateFrom, dateTo, conversationId, limit, offset } = {}) {
  if (grade) {
    return { images: [], total: 0 };
  }

  const query = { 'messages.images.0': { $exists: true } };
  if (conversationId) query._id = conversationId;

  const conversations = await Conversation.find(query)
    .select('_id provider createdAt updatedAt messages.content messages.provider messages.usage messages.timestamp messages.images')
    .lean();

  const dateFromMs = dateFrom ? new Date(dateFrom).getTime() : null;
  const dateToMs = dateTo ? new Date(`${dateTo}T23:59:59.999Z`).getTime() : null;
  const all = [];

  for (const conversation of conversations) {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    messages.forEach((message, messageIndex) => {
      const images = Array.isArray(message.images) ? message.images : [];
      images.forEach((image, imageIndex) => {
        if (typeof image !== 'string' || !image.trim()) return;
        const entry = buildConversationImageEntry(conversation, message, messageIndex, image, imageIndex);
        const archivedMs = new Date(entry.archivedAt).getTime();
        if (dateFromMs && archivedMs < dateFromMs) return;
        if (dateToMs && archivedMs > dateToMs) return;
        all.push(entry);
      });
    });
  }

  all.sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());

  const normalizedOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : Number.MAX_SAFE_INTEGER;
  return {
    images: all.slice(normalizedOffset, normalizedOffset + normalizedLimit),
    total: all.length,
  };
}

async function getConversationBackfillStats() {
  const conversations = await Conversation.find({ 'messages.images.0': { $exists: true } })
    .select('_id messages.images')
    .lean();

  let totalImages = 0;
  let totalSizeBytes = 0;

  for (const conversation of conversations) {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    for (const message of messages) {
      const images = Array.isArray(message.images) ? message.images : [];
      for (const image of images) {
        totalImages += 1;
        totalSizeBytes += estimateBase64Bytes(getImagePayload(image));
      }
    }
  }

  return {
    totalConversations: conversations.length,
    totalImages,
    totalSizeBytes,
    totalSizeMB: Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100,
    gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
  };
}

async function getConversationBackfillImage(conversationId, imageId) {
  const loc = parseConversationImageId(imageId);
  if (!loc) return null;

  const conversation = await Conversation.findById(conversationId)
    .select('_id provider createdAt updatedAt messages.content messages.provider messages.usage messages.timestamp messages.images')
    .lean();
  if (!conversation) return null;

  const message = Array.isArray(conversation.messages) ? conversation.messages[loc.messageIndex] : null;
  const image = message && Array.isArray(message.images) ? message.images[loc.imageIndex] : null;
  if (typeof image !== 'string' || !image.trim()) return null;

  const payload = getImagePayload(image);
  return {
    metadata: buildConversationImageEntry(conversation, message, loc.messageIndex, image, loc.imageIndex),
    buffer: Buffer.from(payload, 'base64'),
    contentType: getImageMimeType(image),
  };
}

router.get('/image-archive/stats', async (req, res) => {
  const result = getArchiveStats();
  if (!result.ok) {
    return res.status(500).json({ ok: false, code: 'ARCHIVE_STATS_FAILED', error: result.error });
  }
  if (result.stats.totalImages > 0) {
    return res.json({ ok: true, ...result.stats });
  }
  const fallbackStats = await getConversationBackfillStats();
  return res.json({ ok: true, ...fallbackStats });
});

router.get('/image-archive/all', async (req, res) => {
  const { grade, dateFrom, dateTo, conversationId, limit = '200', offset = '0' } = req.query;
  if (conversationId && !isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const parsedLimit = Number.parseInt(limit, 10);
  const parsedOffset = Number.parseInt(offset, 10);
  const result = getAllImages({
    grade: grade || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    conversationId: conversationId || undefined,
    limit: parsedLimit,
    offset: parsedOffset,
  });
  if (result.total > 0) {
    return res.json({ ok: true, ...result });
  }
  const fallback = await getConversationBackfillImages({
    grade: grade || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    conversationId: conversationId || undefined,
    limit: parsedLimit,
    offset: parsedOffset,
  });
  return res.json({ ok: true, ...fallback });
});

router.get('/image-archive/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const result = getArchive(conversationId);
  if (!result.ok) {
    return res.status(500).json({ ok: false, code: 'ARCHIVE_READ_FAILED', error: result.error });
  }
  if (result.images.length > 0) {
    return res.json({ ok: true, images: result.images, count: result.images.length });
  }
  const fallback = await getConversationBackfillImages({ conversationId });
  return res.json({ ok: true, images: fallback.images, count: fallback.total });
});

router.get('/image-archive/:conversationId/:imageId/file', async (req, res) => {
  const { conversationId, imageId } = req.params;
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const result = getImageFile(conversationId, imageId);
  if (result.ok) {
    res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(result.filePath);
  }

  const fallback = await getConversationBackfillImage(conversationId, imageId);
  if (!fallback) {
    return res.status(404).json({ ok: false, code: 'IMAGE_NOT_FOUND', error: result.error || 'Image not found' });
  }

  res.setHeader('Content-Type', fallback.contentType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(fallback.buffer);
});

router.get('/image-archive/:conversationId/:imageId/metadata', async (req, res) => {
  const { conversationId, imageId } = req.params;
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const archive = getArchive(conversationId);
  if (!archive.ok) {
    return res.status(500).json({ ok: false, code: 'ARCHIVE_READ_FAILED', error: archive.error });
  }
  const entry = archive.images.find((image) => image._imageId === imageId);
  if (entry) {
    return res.json({ ok: true, metadata: entry });
  }
  const fallback = await getConversationBackfillImage(conversationId, imageId);
  if (!fallback) {
    return res.status(404).json({ ok: false, code: 'IMAGE_NOT_FOUND', error: 'Image metadata not found' });
  }
  return res.json({ ok: true, metadata: fallback.metadata });
});

module.exports = router;
