const fs = require('fs');
const path = require('path');

const PLAYBOOK_ROOT = path.resolve(__dirname, '..', '..', '..', 'playbook');
const SEARCH_CHUNK_MAX_CHARS = 1400;
const SEARCH_CHUNK_MIN_CHARS = 180;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'your', 'have', 'into',
  'about', 'when', 'where', 'what', 'which', 'then', 'than', 'just', 'into',
  'they', 'their', 'will', 'would', 'should', 'could', 'there', 'here', 'also',
  'after', 'before', 'while', 'were', 'been', 'them', 'some', 'more', 'most',
  'need', 'does', 'dont', 'cant', 'cannot', 'user', 'agent', 'qbo', 'quickbooks',
]);

let cachedPrompt = null;
let cachedCorePrompt = '';
let cachedCategories = [];
let cachedDocuments = [];
let cachedChunks = [];
let watcher = null;

/**
 * Recursively read all .md files from a directory.
 */
function readMarkdownFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      results.push({
        name: entry.name.replace('.md', ''),
        path: fullPath,
        content: fs.readFileSync(fullPath, 'utf-8'),
      });
    }
  }
  return results;
}

function normalizeSourceName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-');
}

function tokenizeForSearch(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  const deduped = [];
  const seen = new Set();
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    deduped.push(word);
  }
  return deduped;
}

function buildTokenFrequency(text) {
  const freq = Object.create(null);
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }
  return freq;
}

function splitMarkdownSections(content) {
  const lines = String(content || '').split(/\r?\n/);
  const sections = [];
  let currentHeading = 'Overview';
  let buffer = [];

  function flush() {
    const text = buffer.join('\n').trim();
    if (!text) return;
    sections.push({ heading: currentHeading, text });
    buffer = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (sections.length === 0) {
    sections.push({ heading: 'Overview', text: String(content || '').trim() });
  }
  return sections;
}

function splitSectionToChunks(sectionText) {
  const chunks = [];
  const normalized = String(sectionText || '').trim();
  if (!normalized) return chunks;
  if (normalized.length <= SEARCH_CHUNK_MAX_CHARS) {
    chunks.push(normalized);
    return chunks;
  }

  const paragraphs = normalized
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  let current = '';
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= SEARCH_CHUNK_MAX_CHARS) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current.trim());
      current = '';
    }

    if (paragraph.length <= SEARCH_CHUNK_MAX_CHARS) {
      current = paragraph;
      continue;
    }

    // Hard split very large blocks.
    for (let i = 0; i < paragraph.length; i += SEARCH_CHUNK_MAX_CHARS) {
      const part = paragraph.slice(i, i + SEARCH_CHUNK_MAX_CHARS).trim();
      if (part) chunks.push(part);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length >= SEARCH_CHUNK_MIN_CHARS || chunks.length === 1);
}

function buildSearchChunks(documents) {
  const chunks = [];
  for (const document of documents) {
    const docSections = splitMarkdownSections(document.content);
    let idx = 0;
    for (const section of docSections) {
      const sectionChunks = splitSectionToChunks(section.text);
      for (const sectionChunk of sectionChunks) {
        const text = `# ${section.heading}\n\n${sectionChunk}`.trim();
        const tokenFreq = buildTokenFrequency(text);
        chunks.push({
          id: `${document.sourceType}:${document.sourceName}:${idx}`,
          sourceType: document.sourceType,
          sourceName: document.sourceName,
          path: document.path,
          title: section.heading,
          text,
          textLower: text.toLowerCase(),
          tokenFreq,
          chars: text.length,
        });
        idx += 1;
      }
    }
  }
  return chunks;
}

function buildRetrievalScore(chunk, queryTokens, queryLower) {
  let score = 0;
  for (const token of queryTokens) {
    const freq = chunk.tokenFreq[token] || 0;
    if (!freq) continue;
    score += 1 + Math.min(freq, 4) * 0.15;
  }
  if (queryLower && queryLower.length >= 8 && chunk.textLower.includes(queryLower)) {
    score += 2;
  }
  if (queryTokens.some((token) => chunk.sourceName.includes(token))) {
    score += 0.75;
  }
  return Number(score.toFixed(3));
}

function normalizeAllowedNames(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    const normalized = normalizeSourceName(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Build the system prompt from all playbook files and refresh cached search index.
 */
function buildSystemPrompt() {
  const sections = [];
  const documents = [];

  // Load the main system prompt if it exists.
  const mainPromptPath = path.join(PLAYBOOK_ROOT, 'system-prompt.md');
  let mainPrompt = '';
  if (fs.existsSync(mainPromptPath)) {
    mainPrompt = fs.readFileSync(mainPromptPath, 'utf-8');
    sections.push('[SYSTEM PROMPT]');
    sections.push(mainPrompt);
    sections.push('');
    documents.push({
      sourceType: 'system',
      sourceName: 'system-prompt',
      path: mainPromptPath,
      content: mainPrompt,
    });
  }

  // Load category-specific guides.
  const categoriesDir = path.join(PLAYBOOK_ROOT, 'categories');
  const categoryFiles = readMarkdownFiles(categoriesDir);
  const categories = [];

  for (const file of categoryFiles) {
    categories.push(file.name);
    sections.push('[CATEGORY: ' + file.name + ']');
    sections.push(file.content);
    sections.push('');
    documents.push({
      sourceType: 'category',
      sourceName: normalizeSourceName(file.name),
      path: file.path,
      content: file.content,
    });
  }

  // Load templates.
  const templatesDir = path.join(PLAYBOOK_ROOT, 'templates');
  const templateFiles = readMarkdownFiles(templatesDir);
  for (const file of templateFiles) {
    sections.push('[TEMPLATE: ' + file.name + ']');
    sections.push(file.content);
    sections.push('');
    documents.push({
      sourceType: 'template',
      sourceName: normalizeSourceName(file.name),
      path: file.path,
      content: file.content,
    });
  }

  // Load remaining top-level .md files.
  const alreadyLoaded = new Set(['system-prompt.md']);
  const topLevelFiles = fs.readdirSync(PLAYBOOK_ROOT, { withFileTypes: true })
    .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.md') && !alreadyLoaded.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of topLevelFiles) {
    const label = entry.name.replace('.md', '').replace(/-/g, ' ').toUpperCase();
    const sourceName = normalizeSourceName(entry.name.replace('.md', ''));
    const fullPath = path.join(PLAYBOOK_ROOT, entry.name);
    const content = fs.readFileSync(fullPath, 'utf-8');
    sections.push('[' + label + ']');
    sections.push(content);
    sections.push('');
    documents.push({
      sourceType: 'top-level',
      sourceName,
      path: fullPath,
      content,
    });
  }

  cachedPrompt = sections.join('\n');
  cachedCorePrompt = mainPrompt || '';
  cachedCategories = categories;
  cachedDocuments = documents;
  cachedChunks = buildSearchChunks(documents);

  console.log('Playbook loaded: ' + categoryFiles.length + ' categories, '
    + templateFiles.length + ' templates (' + cachedPrompt.length + ' chars, '
    + cachedChunks.length + ' retrieval chunks)');
}

/**
 * Start watching the playbook directory for changes.
 */
function startWatcher() {
  if (watcher) return;
  if (process.env.NODE_ENV === 'test') return;
  if (!fs.existsSync(PLAYBOOK_ROOT)) {
    console.warn('Playbook directory not found at ' + PLAYBOOK_ROOT + ' -- skipping watcher');
    return;
  }

  try {
    watcher = fs.watch(PLAYBOOK_ROOT, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        console.log('Playbook changed: ' + filename + ' -- reloading');
        buildSystemPrompt();
      }
    });
    watcher.on('error', (err) => {
      console.warn('Playbook watcher error:', err.message);
    });
  } catch (err) {
    console.warn('Could not start playbook watcher:', err.message);
  }
}

function ensureLoaded() {
  if (!cachedPrompt) {
    buildSystemPrompt();
    startWatcher();
  }
}

/**
 * Get the full concatenated system prompt.
 */
function getSystemPrompt() {
  ensureLoaded();
  return cachedPrompt;
}

/**
 * Get only the core system prompt instructions from system-prompt.md.
 */
function getCoreSystemPrompt() {
  ensureLoaded();
  return cachedCorePrompt;
}

/**
 * Search playbook chunks using lexical matching.
 */
function searchPlaybookChunks(query, options = {}) {
  ensureLoaded();
  const queryText = String(query || '').trim();
  if (!queryText) return [];

  const topKRaw = Number.parseInt(options.topK, 10);
  const topK = Number.isFinite(topKRaw) && topKRaw > 0 ? Math.min(topKRaw, 50) : 6;
  const minScoreRaw = Number(options.minScore);
  const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : 1;
  const queryTokens = tokenizeForSearch(queryText);
  const queryLower = queryText.toLowerCase();

  const allowedCategories = normalizeAllowedNames(options.allowedCategories);
  const allowedTemplates = normalizeAllowedNames(options.allowedTemplates);
  const allowedTopLevel = normalizeAllowedNames(options.allowedTopLevel);

  const scored = [];
  for (const chunk of cachedChunks) {
    if (
      chunk.sourceType === 'category'
      && allowedCategories.length > 0
      && !allowedCategories.includes(chunk.sourceName)
    ) continue;
    if (
      chunk.sourceType === 'template'
      && allowedTemplates.length > 0
      && !allowedTemplates.includes(chunk.sourceName)
    ) continue;
    if (
      chunk.sourceType === 'top-level'
      && allowedTopLevel.length > 0
      && !allowedTopLevel.includes(chunk.sourceName)
    ) continue;

    const score = buildRetrievalScore(chunk, queryTokens, queryLower);
    if (score < minScore) continue;
    scored.push({ chunk, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.chunk.chars - b.chunk.chars;
  });

  return scored.slice(0, topK).map((entry) => ({
    id: entry.chunk.id,
    sourceType: entry.chunk.sourceType,
    sourceName: entry.chunk.sourceName,
    path: entry.chunk.path,
    title: entry.chunk.title,
    text: entry.chunk.text,
    score: entry.score,
    chars: entry.chunk.chars,
  }));
}

/**
 * Get the list of available categories.
 */
function getCategories() {
  ensureLoaded();
  return cachedCategories;
}

/**
 * Get basic playbook source metadata.
 */
function getPlaybookSourceInfo() {
  ensureLoaded();
  return cachedDocuments.map((doc) => ({
    sourceType: doc.sourceType,
    sourceName: doc.sourceName,
    path: doc.path,
    chars: String(doc.content || '').length,
  }));
}

/**
 * Force reload the playbook from disk.
 */
function reloadPlaybook() {
  buildSystemPrompt();
}

module.exports = {
  getSystemPrompt,
  getCoreSystemPrompt,
  getCategories,
  getPlaybookSourceInfo,
  searchPlaybookChunks,
  reloadPlaybook,
};

