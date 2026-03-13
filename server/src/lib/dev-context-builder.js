/**
 * dev-context-builder.js — Consolidated context builder for dev agent system prompts.
 *
 * Caches CLAUDE.md and the project file tree with 5-minute TTLs, assembles
 * the full system prompt with hard character caps per section, and exposes
 * health metrics for the /api/dev/health endpoint.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLAUDE_MD_PATH = path.join(PROJECT_ROOT, 'CLAUDE.md');

// Hard character caps per section
const CAPS = {
  role: 3200,
  claudeMd: 20000,
  fileTree: 4000,
  memory: 6000,
};

const CACHE_TTL = 300_000; // 5 minutes

// ── CLAUDE.md cache ────────────────────────────────────────────────────────

let claudeMdCache = { content: '', hash: '', loadedAt: null };

function getCachedClaudeMd() {
  if (claudeMdCache.content && claudeMdCache.loadedAt && (Date.now() - claudeMdCache.loadedAt < CACHE_TTL)) {
    return claudeMdCache;
  }
  try {
    const raw = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');
    const content = raw.slice(0, CAPS.claudeMd);
    const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
    claudeMdCache = { content, hash, loadedAt: Date.now() };
  } catch {
    claudeMdCache = { content: '', hash: '', loadedAt: Date.now() };
  }
  return claudeMdCache;
}

// ── File tree cache ────────────────────────────────────────────────────────

// Reuse the exact same ignore set and logic from /api/dev/tree in dev.js
const TREE_IGNORE = new Set([
  'node_modules', '.git', '.claude', 'dist', 'build',
  '.next', '__pycache__', '.DS_Store', 'NUL',
]);

const TREE_MAX_DEPTH = 4;

let fileTreeCache = { text: '', generatedAt: null, fileCount: 0 };

/**
 * Recursive directory walker — mirrors buildTree() from dev.js /api/dev/tree
 * but returns indented text lines instead of JSON objects.
 */
function walkTree(dir, depth, lines, indent) {
  if (depth > TREE_MAX_DEPTH) return 0;
  let count = 0;
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (TREE_IGNORE.has(item.name)) continue;
      if (item.name.startsWith('.') && item.name !== '.env.example') continue;

      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        lines.push(`${indent}${item.name}/`);
        count += walkTree(fullPath, depth + 1, lines, indent + '  ');
      } else {
        lines.push(`${indent}${item.name}`);
        count += 1;
      }
    }
  } catch { /* unreadable directory — skip */ }
  return count;
}

function refreshFileTreeCache() {
  const lines = [];
  const fileCount = walkTree(PROJECT_ROOT, 0, lines, '');
  let text = lines.join('\n');
  if (text.length > CAPS.fileTree) {
    text = text.slice(0, CAPS.fileTree) + '\n... (truncated)';
  }
  fileTreeCache = { text, generatedAt: Date.now(), fileCount };
}

function getCachedFileTreeText() {
  if (fileTreeCache.text && fileTreeCache.generatedAt && (Date.now() - fileTreeCache.generatedAt < CACHE_TTL)) {
    return fileTreeCache;
  }
  refreshFileTreeCache();
  return fileTreeCache;
}

// ── System prompt assembly ─────────────────────────────────────────────────

/**
 * Build the full system prompt by combining role, CLAUDE.md, file tree, and memory.
 *
 * @param {string} roleText - The role identity text (CLAUDE_ROLE or CODEX_ROLE)
 * @param {string} [memoryText] - Formatted memory entries text
 * @returns {string} Assembled system prompt
 */
function buildFullSystemPrompt(roleText, memoryText) {
  const claudeMd = getCachedClaudeMd();
  const treeData = getCachedFileTreeText();

  const sections = [
    (roleText || '').slice(0, CAPS.role),
    claudeMd.content ? `\nPROJECT DOCUMENTATION (CLAUDE.md):\n${claudeMd.content}` : '',
    treeData.text ? `\nPROJECT FILE TREE (${treeData.fileCount} files):\n${treeData.text}` : '',
    memoryText ? `\nAGENT MEMORY:\n${memoryText.slice(0, CAPS.memory)}` : '',
  ].filter(Boolean);

  return sections.join('\n\n');
}

// ── Prompt version snapshotting ──────────────────────────────────────────

let _lastSnapshotHash = null;
let _lastSnapshotTime = 0;
const SNAPSHOT_COOLDOWN = 60_000; // 60s minimum between snapshots

/**
 * Snapshot the current prompt state if the hash changed (async fire-and-forget).
 * Called from buildDevSystemPrompt on every dev chat message.
 * Requires PromptVersion model — lazy-loaded to avoid circular deps.
 */
function snapshotPromptVersion(assembledPrompt, providerInfo) {
  const claudeMd = getCachedClaudeMd();
  const treeData = getCachedFileTreeText();

  const hashInput = [claudeMd.hash, String(treeData.generatedAt), assembledPrompt.slice(0, 200)].join('|');
  const contextHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

  // Fast in-memory check before hitting DB
  const now = Date.now();
  if (contextHash === _lastSnapshotHash && (now - _lastSnapshotTime < SNAPSHOT_COOLDOWN)) return;

  // Async — don't block the caller
  setImmediate(async () => {
    try {
      const PromptVersion = require('../models/PromptVersion');
      const lastVersion = await PromptVersion.findOne().sort({ createdAt: -1 }).select('createdAt contextHash').lean();
      const cooldownOk = !lastVersion || (now - new Date(lastVersion.createdAt).getTime() > SNAPSHOT_COOLDOWN);
      const hashIsNew = !lastVersion || lastVersion.contextHash !== contextHash;
      if (!cooldownOk || !hashIsNew) {
        _lastSnapshotHash = contextHash;
        _lastSnapshotTime = now;
        return;
      }

      const sections = {
        role: { chars: assembledPrompt.indexOf('\nPROJECT DOCUMENTATION'), cap: CAPS.role },
        claudeMd: { chars: claudeMd.content.length, cap: CAPS.claudeMd, hash: claudeMd.hash },
        fileTree: { chars: treeData.text.length, cap: CAPS.fileTree, fileCount: treeData.fileCount },
        memory: { chars: Math.max(0, assembledPrompt.length - assembledPrompt.lastIndexOf('\nAGENT MEMORY:\n')), cap: CAPS.memory },
      };

      await PromptVersion.create({
        contextHash,
        assembledPrompt,
        totalChars: assembledPrompt.length,
        estimatedTokens: Math.ceil(assembledPrompt.length / 4),
        sections,
        provider: providerInfo || null,
      });
      await PromptVersion.pruneOldVersions();

      _lastSnapshotHash = contextHash;
      _lastSnapshotTime = now;
    } catch { /* non-critical */ }
  });
}

// ── Health reporting ───────────────────────────────────────────────────────

function getContextHealth() {
  const claudeMd = getCachedClaudeMd();
  const tree = getCachedFileTreeText();
  return {
    prompt: {
      systemPromptLoaded: true,
      claudeMdHash: claudeMd.hash || null,
      claudeMdLoadedAt: claudeMd.loadedAt ? new Date(claudeMd.loadedAt).toISOString() : null,
      claudeMdLength: claudeMd.content.length,
    },
    tree: {
      fresh: tree.generatedAt ? (Date.now() - tree.generatedAt < CACHE_TTL) : false,
      generatedAt: tree.generatedAt ? new Date(tree.generatedAt).toISOString() : null,
      fileCount: tree.fileCount,
      textLength: tree.text.length,
    },
  };
}

module.exports = {
  buildFullSystemPrompt,
  snapshotPromptVersion,
  getCachedClaudeMd,
  getCachedFileTreeText,
  getContextHealth,
  CAPS,
  TREE_IGNORE,
};
