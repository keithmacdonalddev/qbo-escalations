#!/usr/bin/env node
/**
 * Config Freshness Monitor — SessionStart hook
 *
 * Diffs the project's actual top-level directories and model files against
 * what CLAUDE.md documents. Injects a one-line warning when drift is detected.
 * Silent when everything matches.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));
const CLAUDE_MD = join(PROJECT_ROOT, 'CLAUDE.md');
const MODELS_DIR = join(PROJECT_ROOT, 'server', 'src', 'models');
const REQUIRED_HARNESS_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'AGENT_HARNESS.md',
  '.claude/hooks/pm-rules.sh',
  '.claude/hooks/runtime-guard.mjs',
  '.claude/hooks/workspace-guard.mjs',
  '.claude/memory/MEMORY.md',
  '.claude/memory/project-overview.md',
  '.codex/config.toml',
  '.codex/hooks/pm-rules.ps1',
  '.codex/memory/PROJECT_MEMORY.md',
  '.codex/memory/AGENT_HANDOFF.md',
  'docs/agent-harness/HOOK_REGISTRY.md',
  'docs/agent-harness/MEMORY_POLICY.md',
  'docs/agent-harness/SKILL_CATALOG.md',
];

// Dirs to ignore when scanning disk
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.claude', 'coverage', 'tmp', 'dist', '.vscode',
  '.idea', '__pycache__', '.next', '.cache'
]);

function parseDocumentedDirs(claudeMd) {
  // Extract the architecture code block
  const blockMatch = claudeMd.match(/## Architecture\s*\n+```[^\n]*\n([\s\S]*?)```/);
  if (!blockMatch) return [];

  const tree = blockMatch[1];
  // Match top-level directory entries: lines like "├── client/" or "└── docs/"
  // These are direct children — they have the tree prefix but no deeper nesting indicator before the name
  const dirPattern = /^[│├└─\s]+(\w[\w.-]*)\/\s/gm;
  const dirs = [];
  let m;
  while ((m = dirPattern.exec(tree)) !== null) {
    // Only grab top-level: the prefix before the name should not contain another directory level
    // Top-level entries have exactly one tree connector (├── or └──) with no │ indentation suggesting depth
    const lineUpToName = tree.substring(tree.lastIndexOf('\n', m.index) + 1, m.index + m[0].length);
    // Top-level lines start with ├── or └── (possibly with leading qbo-escalations/ line)
    // Sub-dirs have │   ├── pattern (pipe + spaces before connector)
    if (/^[├└]/.test(lineUpToName.trim())) {
      dirs.push(m[1]);
    }
  }
  return dirs;
}

function getActualDirs() {
  try {
    return readdirSync(PROJECT_ROOT)
      .filter(name => {
        if (name.startsWith('.') || IGNORED_DIRS.has(name)) return false;
        try {
          return statSync(join(PROJECT_ROOT, name)).isDirectory();
        } catch { return false; }
      });
  } catch { return []; }
}

function countModelFiles() {
  try {
    return readdirSync(MODELS_DIR).filter(f => f.endsWith('.js')).length;
  } catch { return 0; }
}

// --- Main ---
try {
  const claudeMd = readFileSync(CLAUDE_MD, 'utf-8');
  const documentedDirs = parseDocumentedDirs(claudeMd);
  const actualDirs = getActualDirs();
  const modelCount = countModelFiles();
  const missingHarness = REQUIRED_HARNESS_FILES.filter((relativePath) => !existsSync(join(PROJECT_ROOT, relativePath)));

  const documentedSet = new Set(documentedDirs);
  const actualSet = new Set(actualDirs);

  const newDirs = actualDirs.filter(d => !documentedSet.has(d));
  const missingDirs = documentedDirs.filter(d => !actualSet.has(d));

  const parts = [];

  if (newDirs.length > 0) {
    parts.push(`+${newDirs.length} undocumented dir${newDirs.length > 1 ? 's' : ''} (${newDirs.join(', ')})`);
  }
  if (missingDirs.length > 0) {
    parts.push(`-${missingDirs.length} missing dir${missingDirs.length > 1 ? 's' : ''} (${missingDirs.join(', ')})`);
  }
  if (missingHarness.length > 0) {
    parts.push(`missing harness files: ${missingHarness.join(', ')}`);
  }

  const overviewPath = join(PROJECT_ROOT, '.claude', 'memory', 'project-overview.md');
  if (existsSync(overviewPath)) {
    const overview = readFileSync(overviewPath, 'utf-8');
    const verified = overview.match(/^last_verified:\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
    if (!verified) {
      parts.push('project memory missing last_verified metadata');
    } else {
      const ageDays = Math.floor((Date.now() - Date.parse(`${verified}T00:00:00Z`)) / 86400000);
      if (ageDays > 90) parts.push(`project memory is ${ageDays} days old`);
    }
  }

  if (parts.length > 0) {
    // Include model count as informational context when drift is detected
    parts.push(`models on disk: ${modelCount}`);
    const warning = `\u26A0 CLAUDE.md drift: ${parts.join(', ')}`;
    console.log(warning);
  }
  // Silent when no drift — no output at all
} catch (e) {
  // Fail silently — don't block session start
  // console.error(`config-freshness error: ${e.message}`);
}
