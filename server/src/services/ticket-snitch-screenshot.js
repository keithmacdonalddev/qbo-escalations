'use strict';

const path = require('node:path');
const sharp = require('sharp');

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_SCREENSHOT_DIMENSION = 8_192;
const MAX_SCREENSHOT_PIXELS = 25_000_000;
const SUPPORTED_FORMATS = new Map([
  ['png', { contentType: 'image/png', extension: '.png' }],
  ['jpeg', { contentType: 'image/jpeg', extension: '.jpg' }],
  ['webp', { contentType: 'image/webp', extension: '.webp' }],
]);

class ScreenshotValidationError extends Error {
  constructor(message, { code = 'SCREENSHOT_INVALID', status = 400 } = {}) {
    super(message);
    this.name = 'ScreenshotValidationError';
    this.code = code;
    this.status = status;
  }
}

function safeFilename(value, extension) {
  const base = path.basename(String(value || 'qbo-page-screenshot'))
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .trim()
    .slice(0, 150) || 'qbo-page-screenshot';
  const stem = base.slice(0, Math.max(1, base.length - path.extname(base).length));
  return `${stem}${extension}`;
}

function decodeCanonicalBase64(value) {
  const encoded = String(value || '');
  if (!encoded || encoded.length > Math.ceil(MAX_SCREENSHOT_BYTES * 1.4)) {
    throw new ScreenshotValidationError('Screenshots may be at most 5 MB.', {
      code: 'SCREENSHOT_TOO_LARGE',
      status: 413,
    });
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new ScreenshotValidationError('The screenshot encoding is invalid.', {
      code: 'SCREENSHOT_ENCODING_INVALID',
    });
  }
  const buffer = Buffer.from(encoded, 'base64');
  const canonicalInput = encoded.replace(/=+$/, '');
  const canonicalDecoded = buffer.toString('base64').replace(/=+$/, '');
  if (!buffer.length || canonicalInput !== canonicalDecoded) {
    throw new ScreenshotValidationError('The screenshot encoding is invalid.', {
      code: 'SCREENSHOT_ENCODING_INVALID',
    });
  }
  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new ScreenshotValidationError('Screenshots may be at most 5 MB.', {
      code: 'SCREENSHOT_TOO_LARGE',
      status: 413,
    });
  }
  return buffer;
}

async function prepareScreenshotEvidence(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ScreenshotValidationError('Choose a PNG, JPEG, or WebP screenshot.');
  }
  const buffer = decodeCanonicalBase64(input.base64);
  try {
    const metadata = await sharp(buffer, {
      animated: true,
      failOn: 'warning',
      limitInputPixels: MAX_SCREENSHOT_PIXELS,
    }).metadata();
    const format = SUPPORTED_FORMATS.get(metadata.format);
    if (!format) {
      throw new ScreenshotValidationError('Use a PNG, JPEG, or WebP screenshot.', {
        code: 'SCREENSHOT_TYPE_NOT_ALLOWED',
        status: 415,
      });
    }
    if (!metadata.width || !metadata.height) {
      throw new ScreenshotValidationError('The screenshot dimensions could not be verified.');
    }
    if ((metadata.pages || 1) > 1) {
      throw new ScreenshotValidationError('Animated or multi-frame screenshots are not allowed.', {
        code: 'SCREENSHOT_MULTIFRAME_NOT_ALLOWED',
        status: 415,
      });
    }
    if (
      metadata.width > MAX_SCREENSHOT_DIMENSION
      || metadata.height > MAX_SCREENSHOT_DIMENSION
      || metadata.width * metadata.height > MAX_SCREENSHOT_PIXELS
    ) {
      throw new ScreenshotValidationError(
        'The screenshot is too large to process safely. Use an image no larger than 8192 pixels on either side and 25 million pixels total.',
        { code: 'SCREENSHOT_DIMENSIONS_TOO_LARGE', status: 413 },
      );
    }

    let pipeline = sharp(buffer, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: MAX_SCREENSHOT_PIXELS,
    }).rotate();
    if (metadata.format === 'png') {
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
    } else if (metadata.format === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
    } else {
      pipeline = pipeline.webp({ quality: 90, effort: 4 });
    }
    const normalized = await pipeline.toBuffer();
    if (normalized.length > MAX_SCREENSHOT_BYTES) {
      throw new ScreenshotValidationError('The safely processed screenshot is larger than 5 MB.', {
        code: 'SCREENSHOT_TOO_LARGE',
        status: 413,
      });
    }
    return {
      filename: safeFilename(input.filename, format.extension),
      contentType: format.contentType,
      base64: normalized.toString('base64'),
      description: 'User-approved screenshot captured with the QBO Escalations feedback report.',
      kind: 'screenshot',
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    if (error instanceof ScreenshotValidationError) throw error;
    throw new ScreenshotValidationError(
      'The screenshot could not be safely decoded. Use a valid single-frame PNG, JPEG, or WebP image.',
    );
  }
}

module.exports = {
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_DIMENSION,
  MAX_SCREENSHOT_PIXELS,
  ScreenshotValidationError,
  prepareScreenshotEvidence,
};
