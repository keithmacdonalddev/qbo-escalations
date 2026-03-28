'use strict';

const express = require('express');
const mongoose = require('mongoose');
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

router.get('/image-archive/stats', (req, res) => {
  const result = getArchiveStats();
  if (!result.ok) {
    return res.status(500).json({ ok: false, code: 'ARCHIVE_STATS_FAILED', error: result.error });
  }
  return res.json({ ok: true, ...result.stats });
});

router.get('/image-archive/all', (req, res) => {
  const { grade, dateFrom, dateTo, conversationId, limit = '200', offset = '0' } = req.query;
  const result = getAllImages({
    grade: grade || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    conversationId: conversationId || undefined,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });
  return res.json({ ok: true, ...result });
});

router.get('/image-archive/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const result = getArchive(conversationId);
  if (!result.ok) {
    return res.status(500).json({ ok: false, code: 'ARCHIVE_READ_FAILED', error: result.error });
  }
  return res.json({ ok: true, images: result.images, count: result.images.length });
});

router.get('/image-archive/:conversationId/:imageId/file', (req, res) => {
  const { conversationId, imageId } = req.params;
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const result = getImageFile(conversationId, imageId);
  if (!result.ok) {
    return res.status(404).json({ ok: false, code: 'IMAGE_NOT_FOUND', error: result.error });
  }
  res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.sendFile(result.filePath);
});

router.get('/image-archive/:conversationId/:imageId/metadata', (req, res) => {
  const { conversationId, imageId } = req.params;
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const archive = getArchive(conversationId);
  if (!archive.ok) {
    return res.status(500).json({ ok: false, code: 'ARCHIVE_READ_FAILED', error: archive.error });
  }
  const entry = archive.images.find((image) => image._imageId === imageId);
  if (!entry) {
    return res.status(404).json({ ok: false, code: 'IMAGE_NOT_FOUND', error: 'Image metadata not found' });
  }
  return res.json({ ok: true, metadata: entry });
});

module.exports = router;
