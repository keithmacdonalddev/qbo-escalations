const fs = require('fs');
const path = require('path');
const { reloadPlaybook } = require('./playbook-loader');

const PLAYBOOK_ROOT = path.resolve(__dirname, '..', '..', '..', 'playbook');
const CATEGORIES_DIR = path.join(PLAYBOOK_ROOT, 'categories');
const EDGE_CASES_PATH = path.join(PLAYBOOK_ROOT, 'edge-cases.md');
const VERSIONS_ROOT = path.join(PLAYBOOK_ROOT, 'versions');
const VERSIONS_CATEGORIES_DIR = path.join(VERSIONS_ROOT, 'categories');
const VERSIONS_EDGE_CASES_DIR = path.join(VERSIONS_ROOT, 'edge-cases');
const MAX_VERSIONS = 20;
const REVIEWED_SECTION_HEADING = '## Reviewed Case Learnings';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function safeCategoryName(name) {
  return safeString(name, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function normalizeMarkdown(content) {
  return safeString(content, '').replace(/\r\n/g, '\n');
}

function clampConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.6;
  return Math.max(0, Math.min(1, num));
}

function formatConfidence(confidence) {
  const normalized = clampConfidence(confidence);
  const pct = Math.round(normalized * 100);
  if (normalized >= 0.8) return `High (${pct}%)`;
  if (normalized >= 0.55) return `Medium (${pct}%)`;
  return `Low (${pct}%)`;
}

function formatSentence(text, fallback = 'Needs review.') {
  const compact = safeString(text, '').replace(/\s+/g, ' ').trim();
  if (!compact) return fallback;
  if (/[.!?]$/.test(compact)) return compact;
  return compact + '.';
}

function formatList(text, fallbackItem = 'Document the confirmed resolution steps during review.') {
  const lines = safeString(text, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[\).\s]+/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return [`1. ${fallbackItem}`];
  return lines.map((line, index) => `${index + 1}. ${line}`);
}

function relativePlaybookPath(filePath) {
  return path.relative(PLAYBOOK_ROOT, filePath).replace(/\\/g, '/');
}

function categoryFilePath(category) {
  const safeName = safeCategoryName(category);
  if (!safeName) return null;
  return path.join(CATEGORIES_DIR, `${safeName}.md`);
}

function hasCategoryPlaybook(category) {
  const filePath = categoryFilePath(category);
  return Boolean(filePath) && fs.existsSync(filePath);
}

function snapshotVersion(targetPath, versionsDir, label) {
  if (!fs.existsSync(targetPath)) return;
  ensureDir(versionsDir);

  const ts = Date.now();
  const snapshotPath = path.join(versionsDir, `${ts}.md`);
  fs.writeFileSync(snapshotPath, fs.readFileSync(targetPath, 'utf-8'), 'utf-8');

  const safeLabel = safeString(label, '').trim();
  if (safeLabel) {
    fs.writeFileSync(path.join(versionsDir, `${ts}.label`), safeLabel, 'utf-8');
  }

  const snapshots = fs.readdirSync(versionsDir)
    .filter((entry) => /^\d+\.md$/.test(entry))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  if (snapshots.length <= MAX_VERSIONS) return;
  const toDelete = snapshots.slice(0, snapshots.length - MAX_VERSIONS);
  for (const entry of toDelete) {
    const base = entry.replace(/\.md$/, '');
    try { fs.unlinkSync(path.join(versionsDir, entry)); } catch { /* ignore */ }
    try { fs.unlinkSync(path.join(versionsDir, `${base}.label`)); } catch { /* ignore */ }
  }
}

function insertEntryIntoSection(content, entryMarkdown) {
  const normalized = normalizeMarkdown(content).trimEnd();
  const sectionIndex = normalized.indexOf(REVIEWED_SECTION_HEADING);

  if (sectionIndex === -1) {
    if (!normalized) {
      return `${REVIEWED_SECTION_HEADING}\n\n${entryMarkdown.trim()}\n`;
    }
    return `${normalized}\n\n---\n\n${REVIEWED_SECTION_HEADING}\n\n${entryMarkdown.trim()}\n`;
  }

  const afterHeading = sectionIndex + REVIEWED_SECTION_HEADING.length;
  const remainder = normalized.slice(afterHeading);
  const nextSectionMatch = remainder.match(/\n##\s+/);

  if (!nextSectionMatch) {
    return `${normalized}\n\n${entryMarkdown.trim()}\n`;
  }

  const insertIndex = afterHeading + nextSectionMatch.index;
  return (
    normalized.slice(0, insertIndex).trimEnd()
    + '\n\n'
    + entryMarkdown.trim()
    + '\n\n'
    + normalized.slice(insertIndex).trimStart()
  );
}

function buildKnowledgeEntryMarkdown({ knowledge, escalation }) {
  const marker = `knowledge-candidate:${knowledge._id}`;
  const title = safeString(knowledge.title, '').trim() || 'Reviewed Case Learning';
  const symptom = formatSentence(
    knowledge.symptom || knowledge.summary || escalation.actualOutcome || escalation.attemptingTo,
    'Symptoms need review.'
  );
  const rootCause = formatSentence(knowledge.rootCause, 'Root cause needs review.');
  const summary = safeString(knowledge.summary, '').trim();
  const escalationPath = safeString(knowledge.escalationPath, '').trim();
  const signals = Array.isArray(knowledge.keySignals)
    ? knowledge.keySignals.map((signal) => safeString(signal, '').trim()).filter(Boolean)
    : [];
  const reusableAs = safeString(knowledge.reusableOutcome, 'case-history-only').replace(/-/g, ' ');
  const category = safeString(knowledge.category || escalation.category, 'unknown').replace(/-/g, ' ');
  const sourceParts = [];
  if (escalation.caseNumber) sourceParts.push(`Case #${escalation.caseNumber}`);
  if (escalation.resolvedAt) {
    sourceParts.push(`resolved ${new Date(escalation.resolvedAt).toISOString().slice(0, 10)}`);
  } else if (escalation.updatedAt) {
    sourceParts.push(`reviewed ${new Date(escalation.updatedAt).toISOString().slice(0, 10)}`);
  }

  const lines = [
    `<!-- ${marker} -->`,
    `### ${title}`,
    '',
    `**Category:** ${category}`,
    `**Reusable as:** ${reusableAs}`,
  ];

  if (summary) {
    lines.push(`**Summary:** ${formatSentence(summary, '')}`);
  }

  lines.push(
    '',
    `**Symptoms:** ${symptom}`,
    '',
    `**Root cause:** ${rootCause}`,
    '',
    '**Resolution:**',
    ...formatList(knowledge.exactFix),
  );

  if (escalationPath) {
    lines.push('', `**Escalation path:** ${formatSentence(escalationPath, '')}`);
  }

  if (signals.length > 0) {
    lines.push('', '**Signals to look for:**', ...signals.map((signal) => `- ${signal}`));
  }

  lines.push(
    '',
    `**Confidence:** ${formatConfidence(knowledge.confidence)}`,
    `**Source:** Reviewed escalation${sourceParts.length > 0 ? ` (${sourceParts.join(', ')})` : ''}.`,
  );

  return {
    marker,
    title,
    markdown: lines.join('\n').trim(),
  };
}

function removeMarkerBlock(content, marker) {
  const normalized = normalizeMarkdown(content);
  const markerComment = `<!-- ${marker} -->`;
  const markerIndex = normalized.indexOf(markerComment);
  if (markerIndex === -1) return { content: normalized, removed: false };

  // Find the end of this entry: the next marker comment, the next ## heading, or EOF
  const afterMarker = markerIndex + markerComment.length;
  const remaining = normalized.slice(afterMarker);

  // Look for the next knowledge-candidate marker or next ## heading (not ###)
  const nextMarkerMatch = remaining.match(/\n(?=<!-- knowledge-candidate:)/);
  const nextH2Match = remaining.match(/\n(?=## )/);

  let endOffset;
  if (nextMarkerMatch && nextH2Match) {
    endOffset = Math.min(nextMarkerMatch.index, nextH2Match.index);
  } else if (nextMarkerMatch) {
    endOffset = nextMarkerMatch.index;
  } else if (nextH2Match) {
    endOffset = nextH2Match.index;
  } else {
    endOffset = remaining.length;
  }

  const before = normalized.slice(0, markerIndex).replace(/\n+$/, '');
  const after = normalized.slice(afterMarker + endOffset).replace(/^\n+/, '');

  const result = after
    ? before + '\n\n' + after
    : before;

  return { content: result.trimEnd() + '\n', removed: true };
}

function resolvePublishedFilePath(knowledge) {
  const docType = safeString(knowledge.publishedDocType, '');
  const docPath = safeString(knowledge.publishedDocPath, '');

  if (docType === 'category') {
    // publishedDocPath is relative to playbook root, e.g. "categories/payroll.md"
    if (docPath) return path.join(PLAYBOOK_ROOT, docPath.replace(/\//g, path.sep));
    // Fallback: derive from category
    const cat = safeString(knowledge.category, '');
    return categoryFilePath(cat);
  }

  if (docType === 'edge-case') {
    return EDGE_CASES_PATH;
  }

  // Last resort: try the relative path directly
  if (docPath) return path.join(PLAYBOOK_ROOT, docPath.replace(/\//g, path.sep));
  return null;
}

function resolveVersionsDir(knowledge) {
  const docType = safeString(knowledge.publishedDocType, '');
  if (docType === 'category') {
    const cat = safeString(knowledge.category, '');
    const safeName = safeCategoryName(cat);
    return safeName ? path.join(VERSIONS_CATEGORIES_DIR, safeName) : null;
  }
  if (docType === 'edge-case') {
    return VERSIONS_EDGE_CASES_DIR;
  }
  return null;
}

function unpublishKnowledgeCandidate({ knowledge }) {
  if (!knowledge || !knowledge._id) {
    const err = new Error('Knowledge candidate is required for unpublish');
    err.code = 'KNOWLEDGE_REQUIRED';
    throw err;
  }

  const marker = safeString(knowledge.publishedMarker, '') || `knowledge-candidate:${knowledge._id}`;
  const filePath = resolvePublishedFilePath(knowledge);

  if (!filePath || !fs.existsSync(filePath)) {
    const err = new Error('Published playbook file not found');
    err.code = 'PUBLISHED_FILE_NOT_FOUND';
    throw err;
  }

  const currentContent = fs.readFileSync(filePath, 'utf-8');
  if (!currentContent.includes(marker)) {
    // Already gone — treat as idempotent success
    return {
      ok: true,
      removed: false,
      filePath,
      relativePath: relativePlaybookPath(filePath),
      marker,
    };
  }

  // Snapshot before removal
  const versionsDir = resolveVersionsDir(knowledge);
  if (versionsDir) {
    snapshotVersion(filePath, versionsDir, `unpublish:${safeString(knowledge.title, knowledge._id)}`);
  }

  const result = removeMarkerBlock(currentContent, marker);
  fs.writeFileSync(filePath, result.content, 'utf-8');
  reloadPlaybook();

  return {
    ok: true,
    removed: true,
    filePath,
    relativePath: relativePlaybookPath(filePath),
    marker,
  };
}

function publishKnowledgeCandidate({ knowledge, escalation }) {
  if (!knowledge || !knowledge._id) {
    const err = new Error('Knowledge candidate is required for publish');
    err.code = 'KNOWLEDGE_REQUIRED';
    throw err;
  }

  const target = safeString(knowledge.publishTarget, '');
  let filePath;
  let versionsDir;
  let docType;

  if (target === 'category') {
    const rawCategory = safeString(knowledge.category || escalation.category, '');
    filePath = categoryFilePath(rawCategory);
    if (!filePath) {
      const err = new Error('Selected category does not have a playbook file');
      err.code = 'CATEGORY_PLAYBOOK_NOT_FOUND';
      throw err;
    }
    if (!fs.existsSync(filePath)) {
      ensureDir(path.dirname(filePath));
      const displayName = rawCategory.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      fs.writeFileSync(
        filePath,
        `# ${displayName} Escalations\n\nKnowledge entries added from resolved escalations.\n`,
        'utf-8'
      );
    }
    versionsDir = path.join(VERSIONS_CATEGORIES_DIR, safeCategoryName(rawCategory));
    docType = 'category';
  } else if (target === 'edge-case') {
    filePath = EDGE_CASES_PATH;
    versionsDir = VERSIONS_EDGE_CASES_DIR;
    docType = 'edge-case';
    if (!fs.existsSync(filePath)) {
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(
        filePath,
        '# Edge Cases — Cross-Category Weirdness\n\nIssues that do not fit neatly into one category.\n',
        'utf-8'
      );
    }
  } else {
    const err = new Error('Only category or edge-case targets can be published');
    err.code = 'INVALID_PUBLISH_TARGET';
    throw err;
  }

  const currentContent = fs.readFileSync(filePath, 'utf-8');
  const entry = buildKnowledgeEntryMarkdown({ knowledge, escalation });

  if (currentContent.includes(entry.marker)) {
    return {
      ok: true,
      inserted: false,
      docType,
      filePath,
      relativePath: relativePlaybookPath(filePath),
      marker: entry.marker,
      sectionTitle: REVIEWED_SECTION_HEADING,
      title: entry.title,
    };
  }

  snapshotVersion(filePath, versionsDir, `knowledge:${entry.title}`);
  const nextContent = insertEntryIntoSection(currentContent, entry.markdown);
  fs.writeFileSync(filePath, nextContent, 'utf-8');
  reloadPlaybook();

  return {
    ok: true,
    inserted: true,
    docType,
    filePath,
    relativePath: relativePlaybookPath(filePath),
    marker: entry.marker,
    sectionTitle: REVIEWED_SECTION_HEADING,
    title: entry.title,
  };
}

module.exports = {
  hasCategoryPlaybook,
  publishKnowledgeCandidate,
  unpublishKnowledgeCandidate,
};
