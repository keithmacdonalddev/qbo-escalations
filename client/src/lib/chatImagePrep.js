const DEFAULT_MAX_EDGE = 2200;
const ORIGINAL_FILE_THRESHOLD_BYTES = 6 * 1024 * 1024;
const TEXT_HEAVY_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024;
const MAX_ORIGINAL_EDGE = 2600;
const WEBP_QUALITY = 0.9;
const JPEG_QUALITY = 0.93;
const TEXT_HEAVY_JPEG_QUALITY = 0.96;

function estimateDataUrlBytes(input) {
  const source = typeof input === 'string' ? input : '';
  if (!source) return 0;
  const commaIndex = source.indexOf(',');
  const base64 = commaIndex >= 0 ? source.slice(commaIndex + 1) : source;
  if (!base64) return 0;
  const normalized = base64.replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : (normalized.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function detectDataUrlMimeType(input, fallback = '') {
  const source = typeof input === 'string' ? input : '';
  const match = source.match(/^data:([^;,]+)[;,]/i);
  return match ? match[1].toLowerCase() : String(fallback || '').toLowerCase();
}

function getFileName(file) {
  return String(file?.name || '').trim().toLowerCase();
}

function looksLikeTextHeavyImage(file, width, height) {
  const type = String(file?.type || '').toLowerCase();
  const name = getFileName(file);
  if (type === 'image/png') return true;
  if (/(screenshot|screen shot|snip|capture)/.test(name)) return true;
  if (!width || !height) return false;
  const megapixels = (width * height) / 1_000_000;
  return megapixels <= 4 && file.size <= 2 * 1024 * 1024;
}

function shouldPreserveOriginal(file, width, height, textHeavy, maxEdge) {
  const maxDimension = Math.max(width || 0, height || 0);
  const threshold = textHeavy ? TEXT_HEAVY_FILE_THRESHOLD_BYTES : ORIGINAL_FILE_THRESHOLD_BYTES;
  return file.size <= threshold && maxDimension <= Math.max(maxEdge, MAX_ORIGINAL_EDGE);
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({ image, revoke: () => URL.revokeObjectURL(objectUrl) });
    image.onerror = (event) => {
      URL.revokeObjectURL(objectUrl);
      reject(event);
    };
    image.src = objectUrl;
  });
}

function buildPreparedMeta({
  file,
  src,
  optimized,
  textHeavy,
  sourceWidth,
  sourceHeight,
  preparedWidth,
  preparedHeight,
  attachedAt,
  preparedAt,
  prepDurationMs,
}) {
  const originalBytes = Number.isFinite(file?.size) ? file.size : 0;
  const preparedBytes = src ? estimateDataUrlBytes(src) : 0;
  const mimeType = detectDataUrlMimeType(src, file?.type || '');
  return {
    source: 'upload',
    name: String(file?.name || ''),
    mimeType,
    originalBytes,
    preparedBytes,
    originalWidth: sourceWidth || 0,
    originalHeight: sourceHeight || 0,
    preparedWidth: preparedWidth || sourceWidth || 0,
    preparedHeight: preparedHeight || sourceHeight || 0,
    optimized: Boolean(optimized),
    textHeavy: Boolean(textHeavy),
    prepDurationMs: Math.max(0, Math.round(prepDurationMs || 0)),
    attachedAt,
    preparedAt,
    compressionRatio: originalBytes > 0 && preparedBytes > 0
      ? Math.round((preparedBytes / originalBytes) * 1000) / 1000
      : 0,
  };
}

export async function prepareImageForChat(file, options = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return null;
  }

  const prepStartedAt = new Date().toISOString();
  const prepStartedMs = Date.now();
  const maxEdge = Number.isFinite(options.maxEdge) && options.maxEdge > 0
    ? options.maxEdge
    : DEFAULT_MAX_EDGE;

  let loaded = null;
  try {
    loaded = await loadImageFromFile(file);
    const { image } = loaded;
    const sourceWidth = image.naturalWidth || image.width || 0;
    const sourceHeight = image.naturalHeight || image.height || 0;
    const textHeavy = looksLikeTextHeavyImage(file, sourceWidth, sourceHeight);
    if (!sourceWidth || !sourceHeight) {
      const src = await readBlobAsDataUrl(file);
      const preparedAt = new Date().toISOString();
      return {
        src,
        optimized: false,
        meta: buildPreparedMeta({
          file,
          src,
          optimized: false,
          textHeavy,
          sourceWidth,
          sourceHeight,
          preparedWidth: sourceWidth,
          preparedHeight: sourceHeight,
          attachedAt: prepStartedAt,
          preparedAt,
          prepDurationMs: Date.now() - prepStartedMs,
        }),
      };
    }

    if (shouldPreserveOriginal(file, sourceWidth, sourceHeight, textHeavy, maxEdge)) {
      const src = await readBlobAsDataUrl(file);
      const preparedAt = new Date().toISOString();
      return {
        src,
        optimized: false,
        width: sourceWidth,
        height: sourceHeight,
        meta: buildPreparedMeta({
          file,
          src,
          optimized: false,
          textHeavy,
          sourceWidth,
          sourceHeight,
          preparedWidth: sourceWidth,
          preparedHeight: sourceHeight,
          attachedAt: prepStartedAt,
          preparedAt,
          prepDurationMs: Date.now() - prepStartedMs,
        }),
      };
    }

    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      const src = await readBlobAsDataUrl(file);
      const preparedAt = new Date().toISOString();
      return {
        src,
        optimized: false,
        meta: buildPreparedMeta({
          file,
          src,
          optimized: false,
          textHeavy,
          sourceWidth,
          sourceHeight,
          preparedWidth: sourceWidth,
          preparedHeight: sourceHeight,
          attachedAt: prepStartedAt,
          preparedAt,
          prepDurationMs: Date.now() - prepStartedMs,
        }),
      };
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    let src = '';
    if (String(file.type || '').toLowerCase() === 'image/png') {
      src = canvas.toDataURL('image/png');
    } else if (textHeavy) {
      src = canvas.toDataURL('image/jpeg', TEXT_HEAVY_JPEG_QUALITY);
      if (!src.startsWith('data:image/jpeg')) {
        src = canvas.toDataURL('image/webp', WEBP_QUALITY);
      }
    } else {
      src = canvas.toDataURL('image/webp', WEBP_QUALITY);
      if (!src.startsWith('data:image/webp')) {
        src = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      }
    }
    if (!src || src === 'data:,') {
      const fallbackSrc = await readBlobAsDataUrl(file);
      const preparedAt = new Date().toISOString();
      return {
        src: fallbackSrc,
        optimized: false,
        meta: buildPreparedMeta({
          file,
          src: fallbackSrc,
          optimized: false,
          textHeavy,
          sourceWidth,
          sourceHeight,
          preparedWidth: sourceWidth,
          preparedHeight: sourceHeight,
          attachedAt: prepStartedAt,
          preparedAt,
          prepDurationMs: Date.now() - prepStartedMs,
        }),
      };
    }

    const preparedAt = new Date().toISOString();
    return {
      src,
      optimized: true,
      width: targetWidth,
      height: targetHeight,
      meta: buildPreparedMeta({
        file,
        src,
        optimized: true,
        textHeavy,
        sourceWidth,
        sourceHeight,
        preparedWidth: targetWidth,
        preparedHeight: targetHeight,
        attachedAt: prepStartedAt,
        preparedAt,
        prepDurationMs: Date.now() - prepStartedMs,
      }),
    };
  } catch {
    const src = await readBlobAsDataUrl(file);
    const preparedAt = new Date().toISOString();
    return {
      src,
      optimized: false,
      meta: buildPreparedMeta({
        file,
        src,
        optimized: false,
        textHeavy: false,
        sourceWidth: 0,
        sourceHeight: 0,
        preparedWidth: 0,
        preparedHeight: 0,
        attachedAt: prepStartedAt,
        preparedAt,
        prepDurationMs: Date.now() - prepStartedMs,
      }),
    };
  } finally {
    loaded?.revoke?.();
  }
}
