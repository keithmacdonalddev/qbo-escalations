'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const {
  ScreenshotValidationError,
  prepareScreenshotEvidence,
} = require('../src/services/ticket-snitch-screenshot');

test('screenshot validation verifies image bytes and removes metadata', async () => {
  const source = await sharp({
    create: { width: 80, height: 40, channels: 3, background: '#2d6cdf' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const prepared = await prepareScreenshotEvidence({
    filename: '../customer-view.png',
    contentType: 'image/png',
    base64: source.toString('base64'),
  });
  const metadata = await sharp(Buffer.from(prepared.base64, 'base64')).metadata();
  assert.equal(prepared.contentType, 'image/jpeg');
  assert.equal(prepared.filename, 'customer-view.jpg');
  assert.equal(prepared.kind, 'screenshot');
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.pages, undefined);
});

test('screenshot validation rejects malformed encodings and non-images', async () => {
  await assert.rejects(
    prepareScreenshotEvidence({ filename: 'bad.png', contentType: 'image/png', base64: 'not%%%base64' }),
    (error) => error instanceof ScreenshotValidationError && error.code === 'SCREENSHOT_ENCODING_INVALID',
  );
  await assert.rejects(
    prepareScreenshotEvidence({ filename: 'notes.png', contentType: 'image/png', base64: Buffer.from('not an image').toString('base64') }),
    (error) => error instanceof ScreenshotValidationError && error.code === 'SCREENSHOT_INVALID',
  );
});

test('screenshot validation enforces conservative dimensions before forwarding', async () => {
  const tooWide = await sharp({
    create: { width: 8_193, height: 1, channels: 3, background: '#fff' },
  }).png().toBuffer();
  await assert.rejects(
    prepareScreenshotEvidence({ filename: 'too-wide.png', contentType: 'image/png', base64: tooWide.toString('base64') }),
    (error) => error instanceof ScreenshotValidationError && error.code === 'SCREENSHOT_DIMENSIONS_TOO_LARGE' && error.status === 413,
  );
});
