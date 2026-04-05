'use strict';

const fs = require('fs');
const path = require('path');

const PARSER_ARCHIVE_ROOT = path.resolve(__dirname, '..', '..', 'data', 'image-parser-archive');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function extensionToMime(ext) {
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    heic: 'image/heic',
    heif: 'image/heif',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    ico: 'image/x-icon',
  };
  return map[String(ext).toLowerCase()] || 'application/octet-stream';
}

function decodeBase64Image(base64Input) {
  const input = typeof base64Input === 'string' ? base64Input.trim() : '';
  if (!input) return null;

  const dataUrlMatch = input.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
  const subtype = dataUrlMatch ? dataUrlMatch[1].toLowerCase() : '';
  const payload = (dataUrlMatch ? dataUrlMatch[2] : input).replace(/\s+/g, '');

  if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload)) return null;

  const buffer = Buffer.from(payload, 'base64');
  if (!buffer || buffer.length === 0) return null;

  let extension = 'png';
  if (subtype === 'jpeg' || subtype === 'pjpeg') extension = 'jpg';
  else if (subtype === 'svg+xml') extension = 'svg';
  else if (subtype) {
    const clean = subtype.replace(/[^a-z0-9]/g, '');
    if (clean) extension = clean;
  }

  return {
    buffer,
    extension,
    contentType: extensionToMime(extension),
    sizeBytes: buffer.length,
  };
}

function archiveParserImage(parseResultId, base64Image) {
  try {
    if (!parseResultId || !base64Image) {
      return { ok: false, error: 'parseResultId and base64Image are required' };
    }

    const decoded = decodeBase64Image(base64Image);
    if (!decoded) {
      return { ok: false, error: 'Failed to decode parser image data' };
    }

    const archiveDir = path.join(PARSER_ARCHIVE_ROOT, String(parseResultId));
    ensureDir(archiveDir);

    const fileName = `source.${decoded.extension}`;
    const filePath = path.join(archiveDir, fileName);
    fs.writeFileSync(filePath, decoded.buffer);

    return {
      ok: true,
      fileName,
      filePath,
      contentType: decoded.contentType,
      sizeBytes: decoded.sizeBytes,
    };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to archive parser image' };
  }
}

function getParserImageFile(parseResultId, preferredFileName = '') {
  try {
    const archiveDir = path.join(PARSER_ARCHIVE_ROOT, String(parseResultId));
    if (!fs.existsSync(archiveDir)) {
      return { ok: false, error: 'Parser image not found' };
    }

    let fileName = preferredFileName || '';
    if (!fileName) {
      const found = fs.readdirSync(archiveDir).find((entry) => entry.startsWith('source.'));
      if (!found) return { ok: false, error: 'Parser image file missing from archive' };
      fileName = found;
    }

    const filePath = path.join(archiveDir, fileName);
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'Parser image file missing from archive' };
    }

    return {
      ok: true,
      filePath,
      contentType: extensionToMime(path.extname(fileName).slice(1)),
    };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to resolve parser image file' };
  }
}

module.exports = {
  archiveParserImage,
  getParserImageFile,
  PARSER_ARCHIVE_ROOT,
};
