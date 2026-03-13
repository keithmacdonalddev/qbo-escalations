/**
 * Image Archive — permanent on-disk storage for chat images with full metadata.
 *
 * Directory layout:
 *   server/data/image-archive/{conversationId}/{timestamp}-{index}/
 *     image.{ext}     — decoded image file
 *     metadata.json   — conversation context, AI parsing, quality grade
 */

const path = require('path');
const fs = require('fs');

const ARCHIVE_ROOT = path.resolve(__dirname, '..', '..', 'data', 'image-archive');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try { return String(value); } catch { return fallback; }
}

/**
 * Detect MIME subtype from a data-URL prefix or raw base64.
 * Returns { extension, buffer } after decoding.
 */
function decodeBase64Image(base64Input) {
  const input = safeString(base64Input, '').trim();
  if (!input) return null;

  const dataUrlMatch = input.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
  const subtype = dataUrlMatch ? dataUrlMatch[1].toLowerCase() : '';
  const payload = (dataUrlMatch ? dataUrlMatch[2] : input).replace(/\s+/g, '');

  if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload)) return null;

  const buffer = Buffer.from(payload, 'base64');
  if (!buffer || buffer.length === 0) return null;

  let extension = 'png';
  if (subtype) {
    if (subtype === 'jpeg' || subtype === 'pjpeg') extension = 'jpg';
    else if (subtype === 'svg+xml') extension = 'svg';
    else if (['webp', 'avif', 'heic', 'heif', 'gif', 'bmp', 'tiff'].includes(subtype)) extension = subtype;
    else {
      const clean = subtype.replace(/[^a-z0-9]/g, '');
      if (clean) extension = clean;
    }
  }

  return { buffer, extension, sizeBytes: buffer.length, mimeSubtype: subtype || 'png' };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Auto-grade the quality of an AI image parsing response.
 *
 * Heuristics:
 *   - Length of parsing response (more detail = higher signal)
 *   - Identification of specific elements (field names, numbers, identifiers)
 *   - Presence of structured sections from the expected format
 *   - Uncertainty indicators (hedging lowers grade)
 *
 * Returns { grade: 'A'|'B'|'C'|'D'|'F', reason: string }
 */
function gradeImageParsing(parsing) {
  const text = safeString(parsing, '').trim();
  if (!text) return { grade: 'F', reason: 'No parsing output produced' };

  let score = 0;
  const reasons = [];

  // Length scoring (0-25 points)
  const len = text.length;
  if (len >= 800) { score += 25; reasons.push('detailed response'); }
  else if (len >= 400) { score += 18; reasons.push('moderate detail'); }
  else if (len >= 150) { score += 10; reasons.push('brief response'); }
  else { score += 3; reasons.push('very short response'); }

  // Structured sections (0-30 points)
  const expectedSections = [
    'What the Agent Is Attempting',
    'Expected vs Actual Outcome',
    'Troubleshooting Steps',
    'Diagnosis',
    'Steps for Agent',
    'Customer-Facing Explanation',
  ];
  const sectionHits = expectedSections.filter((s) => text.toLowerCase().includes(s.toLowerCase())).length;
  const sectionScore = Math.round((sectionHits / expectedSections.length) * 30);
  score += sectionScore;
  if (sectionHits === expectedSections.length) reasons.push('all sections present');
  else if (sectionHits >= 4) reasons.push(`${sectionHits}/${expectedSections.length} sections`);
  else if (sectionHits > 0) reasons.push(`only ${sectionHits} sections`);

  // Specific element identification (0-25 points)
  const specifics = [
    /\b(COID|coid)\b/,
    /\b(MID|mid)\b/,
    /\bcase\s*#?\s*\d+/i,
    /\b\d{6,}\b/,                     // long numbers (IDs, case numbers)
    /\b(payroll|bank.?feed|reconcil|permission|billing|tax|invoice)/i,
    /\b(error|fail|unable|cannot|blocked)/i,
    /\b(incognito|browser|cache|clear)/i,
  ];
  const specificHits = specifics.filter((rx) => rx.test(text)).length;
  const specificScore = Math.round((specificHits / specifics.length) * 25);
  score += specificScore;
  if (specificHits >= 5) reasons.push('strong element identification');
  else if (specificHits >= 3) reasons.push('partial element identification');
  else if (specificHits > 0) reasons.push('minimal element identification');

  // Uncertainty penalty (0 to -10 points)
  const uncertaintyPatterns = [
    /\b(unclear|unreadable|cannot\s+determine|unable\s+to\s+read|hard\s+to\s+tell)\b/i,
    /\b(possibly|maybe|might\s+be|appears?\s+to\s+be|looks?\s+like)\b/i,
    /\b(I('m| am)\s+(not\s+sure|uncertain))\b/i,
  ];
  const uncertaintyHits = uncertaintyPatterns.filter((rx) => rx.test(text)).length;
  if (uncertaintyHits >= 3) { score -= 10; reasons.push('high uncertainty'); }
  else if (uncertaintyHits >= 2) { score -= 5; reasons.push('moderate uncertainty'); }
  else if (uncertaintyHits === 1) { score -= 2; reasons.push('slight uncertainty'); }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  // Map score to letter grade
  let grade;
  if (score >= 80) grade = 'A';
  else if (score >= 65) grade = 'B';
  else if (score >= 45) grade = 'C';
  else if (score >= 25) grade = 'D';
  else grade = 'F';

  return { grade, score, reason: reasons.join('; ') || 'No notable qualities' };
}

// ---------------------------------------------------------------------------
// Archive Operations
// ---------------------------------------------------------------------------

/**
 * Save an image and its metadata to the archive.
 *
 * @param {Object} opts
 * @param {string} opts.conversationId   — Mongo conversation _id
 * @param {number} opts.messageIndex     — Index of the user message in the conversation
 * @param {string} opts.base64Image      — Raw base64 (with or without data-URL prefix)
 * @param {string} opts.userPrompt       — The user's text prompt that accompanied the image
 * @param {string} opts.modelParsing     — The AI model's full parsing/response about the image
 * @param {Object} [opts.parseFields]    — Structured parse fields extracted by triage
 * @param {Object} [opts.triageCard]     — The server triage card generated for this image
 * @param {string} [opts.provider]       — AI provider used (e.g. 'claude', 'codex')
 * @param {Object} [opts.usage]          — Token usage metadata
 * @param {number} [opts.imageIndex]     — Index when multiple images per message (default 0)
 * @param {Date}   [opts.timestamp]      — Override timestamp (defaults to now)
 * @returns {{ ok: boolean, archivePath?: string, imageFile?: string, metadataFile?: string, error?: string }}
 */
function archiveImage(opts) {
  try {
    const {
      conversationId,
      messageIndex,
      base64Image,
      userPrompt,
      modelParsing,
      parseFields,
      triageCard,
      provider,
      usage,
      imageIndex = 0,
      timestamp,
    } = opts || {};

    if (!conversationId || !base64Image) {
      return { ok: false, error: 'conversationId and base64Image are required' };
    }

    const decoded = decodeBase64Image(base64Image);
    if (!decoded) {
      return { ok: false, error: 'Failed to decode base64 image data' };
    }

    const ts = timestamp ? new Date(timestamp).getTime() : Date.now();
    const folderName = `${ts}-${imageIndex}`;
    const archiveDir = path.join(ARCHIVE_ROOT, String(conversationId), folderName);
    ensureDir(archiveDir);

    // Write image file
    const imageFileName = `image.${decoded.extension}`;
    const imagePath = path.join(archiveDir, imageFileName);
    fs.writeFileSync(imagePath, decoded.buffer);

    // Grade the parsing
    const grade = gradeImageParsing(modelParsing);

    // Build metadata
    const metadata = {
      version: 1,
      conversationId: String(conversationId),
      messageIndex: typeof messageIndex === 'number' ? messageIndex : null,
      imageIndex,
      userPrompt: safeString(userPrompt, ''),
      modelParsing: safeString(modelParsing, ''),
      parseFields: parseFields && typeof parseFields === 'object' ? parseFields : null,
      triageCard: triageCard && typeof triageCard === 'object' ? triageCard : null,
      grade,
      provider: safeString(provider, 'unknown'),
      usage: usage && typeof usage === 'object' ? usage : null,
      image: {
        fileName: imageFileName,
        extension: decoded.extension,
        mimeSubtype: decoded.mimeSubtype,
        sizeBytes: decoded.sizeBytes,
      },
      archivedAt: new Date(ts).toISOString(),
      createdAt: new Date().toISOString(),
    };

    const metadataPath = path.join(archiveDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return {
      ok: true,
      archivePath: archiveDir,
      imageFile: imagePath,
      metadataFile: metadataPath,
      imageId: folderName,
    };
  } catch (err) {
    return { ok: false, error: err.message || 'Archive write failed' };
  }
}

/**
 * Archive multiple images from a single message (fire-and-forget friendly).
 *
 * @param {Object} opts — Same as archiveImage but with `images` array instead of `base64Image`
 * @returns {Array<{ ok, imageId?, error? }>}
 */
function archiveImages(opts) {
  const { images, ...rest } = opts || {};
  if (!Array.isArray(images) || images.length === 0) return [];

  const results = [];
  for (let i = 0; i < images.length; i++) {
    results.push(archiveImage({
      ...rest,
      base64Image: images[i],
      imageIndex: i,
    }));
  }
  return results;
}

/**
 * Retrieve all archived image metadata for a conversation.
 *
 * @param {string} conversationId
 * @returns {{ ok: boolean, images?: Array<Object>, error?: string }}
 */
function getArchive(conversationId) {
  try {
    const convDir = path.join(ARCHIVE_ROOT, String(conversationId));
    if (!fs.existsSync(convDir)) {
      return { ok: true, images: [] };
    }

    const entries = fs.readdirSync(convDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    const images = [];
    for (const entry of entries) {
      const metaPath = path.join(convDir, entry.name, 'metadata.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const raw = fs.readFileSync(metaPath, 'utf8');
        const metadata = JSON.parse(raw);
        metadata._imageId = entry.name;
        images.push(metadata);
      } catch {
        // Skip corrupted metadata files
      }
    }

    return { ok: true, images };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to read archive' };
  }
}

/**
 * Resolve the absolute file path for a specific archived image.
 *
 * @param {string} conversationId
 * @param {string} imageId — The folder name (e.g. "1709123456789-0")
 * @returns {{ ok: boolean, filePath?: string, contentType?: string, error?: string }}
 */
function getImageFile(conversationId, imageId) {
  try {
    const imageDir = path.join(ARCHIVE_ROOT, String(conversationId), String(imageId));
    if (!fs.existsSync(imageDir)) {
      return { ok: false, error: 'Image not found' };
    }

    const metaPath = path.join(imageDir, 'metadata.json');
    let fileName = 'image.png'; // fallback
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.image && meta.image.fileName) fileName = meta.image.fileName;
      } catch { /* use fallback */ }
    }

    const filePath = path.join(imageDir, fileName);
    if (!fs.existsSync(filePath)) {
      // Try to find any image.* file
      const files = fs.readdirSync(imageDir).filter((f) => f.startsWith('image.'));
      if (files.length === 0) return { ok: false, error: 'Image file missing from archive' };
      const found = path.join(imageDir, files[0]);
      const ext = path.extname(files[0]).slice(1);
      return { ok: true, filePath: found, contentType: extensionToMime(ext) };
    }

    const ext = path.extname(fileName).slice(1);
    return { ok: true, filePath, contentType: extensionToMime(ext) };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to resolve image file' };
  }
}

/**
 * Get summary stats for the entire archive.
 *
 * @returns {{ ok: boolean, stats?: Object, error?: string }}
 */
function getArchiveStats() {
  try {
    ensureDir(ARCHIVE_ROOT);
    const conversations = fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    let totalImages = 0;
    let totalSizeBytes = 0;
    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };

    for (const conv of conversations) {
      const convDir = path.join(ARCHIVE_ROOT, conv.name);
      const imageDirs = fs.readdirSync(convDir, { withFileTypes: true })
        .filter((e) => e.isDirectory());

      for (const imgDir of imageDirs) {
        totalImages++;
        const metaPath = path.join(convDir, imgDir.name, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta.image && meta.image.sizeBytes) totalSizeBytes += meta.image.sizeBytes;
            if (meta.grade && meta.grade.grade) {
              gradeDistribution[meta.grade.grade] = (gradeDistribution[meta.grade.grade] || 0) + 1;
            }
          } catch { /* skip */ }
        }
      }
    }

    return {
      ok: true,
      stats: {
        totalConversations: conversations.length,
        totalImages,
        totalSizeBytes,
        totalSizeMB: Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100,
        gradeDistribution,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to compute archive stats' };
  }
}

/**
 * Retrieve all archived images across every conversation with optional filtering.
 *
 * @param {Object} [opts]
 * @param {string} [opts.grade]            — Filter by grade letter (A/B/C/D/F)
 * @param {string} [opts.dateFrom]         — ISO date string, include images archived on or after
 * @param {string} [opts.dateTo]           — ISO date string, include images archived on or before
 * @param {string} [opts.conversationId]   — Exact conversationId match
 * @param {number} [opts.limit=200]        — Max images to return
 * @param {number} [opts.offset=0]         — Pagination offset
 * @returns {{ images: Array<Object>, total: number }}
 */
function getAllImages({ grade, dateFrom, dateTo, conversationId, limit = 200, offset = 0 } = {}) {
  ensureDir(ARCHIVE_ROOT);

  // Determine which conversation directories to scan
  let convDirs;
  if (conversationId) {
    const single = path.join(ARCHIVE_ROOT, String(conversationId));
    convDirs = fs.existsSync(single) ? [{ name: String(conversationId) }] : [];
  } else {
    convDirs = fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory());
  }

  const dateFromMs = dateFrom ? new Date(dateFrom).getTime() : null;
  const dateToMs = dateTo ? new Date(dateTo + 'T23:59:59.999Z').getTime() : null;

  const all = [];

  for (const conv of convDirs) {
    const convDir = path.join(ARCHIVE_ROOT, conv.name);
    let imageDirs;
    try {
      imageDirs = fs.readdirSync(convDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch { continue; }

    for (const imgDir of imageDirs) {
      const metaPath = path.join(convDir, imgDir.name, 'metadata.json');
      if (!fs.existsSync(metaPath)) continue;

      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch { continue; }

      // Apply grade filter
      if (grade && meta.grade && meta.grade.grade !== grade.toUpperCase()) continue;

      // Apply date filters
      if (meta.archivedAt) {
        const archivedMs = new Date(meta.archivedAt).getTime();
        if (dateFromMs && archivedMs < dateFromMs) continue;
        if (dateToMs && archivedMs > dateToMs) continue;
      }

      meta._imageId = imgDir.name;
      all.push(meta);
    }
  }

  // Sort newest first
  all.sort((a, b) => {
    const ta = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
    const tb = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
    return tb - ta;
  });

  return {
    images: all.slice(offset, offset + limit),
    total: all.length,
  };
}

// ---------------------------------------------------------------------------
// MIME helpers
// ---------------------------------------------------------------------------

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

module.exports = {
  archiveImage,
  archiveImages,
  gradeImageParsing,
  getArchive,
  getAllImages,
  getImageFile,
  getArchiveStats,
  ARCHIVE_ROOT,
};
