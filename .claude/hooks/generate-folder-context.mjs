#!/usr/bin/env node
/**
 * Folder Context Generator - Stop Hook
 *
 * Generates/updates CLAUDE.md files in folders with significant activity.
 * These files give Claude folder-specific context when working in those areas.
 *
 * Rules:
 * - NEVER touch root CLAUDE.md (user's main doc)
 * - Skip .git/, node_modules/, .claude/
 * - Only create in folders with 5+ observations
 * - Auto-manage all other CLAUDE.md files
 *
 * IMPORTANT: This hook uses PROJECT-relative paths only.
 * Never uses the home directory ~/.claude/ folder.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));
const SESSIONS_DIR = join(PROJECT_ROOT, '.claude', 'memory', 'sessions');

// Safety check: ensure we're not accidentally using home directory
const HOME_CLAUDE = join(homedir(), '.claude');
if (SESSIONS_DIR.startsWith(HOME_CLAUDE)) {
  console.error('ERROR: Refusing to use home .claude directory');
  process.exit(1);
}

// Folders to never touch
const SKIP_PATTERNS = [
  'node_modules',
  '.git',
  '.claude',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  'venv'
];

// Minimum observations before creating a folder CLAUDE.md
const MIN_OBSERVATIONS = 5;

function shouldSkipFolder(folderPath) {
  const relativePath = relative(PROJECT_ROOT, folderPath);

  // Never touch root
  if (relativePath === '' || relativePath === '.') {
    return true;
  }

  // Skip protected patterns
  for (const pattern of SKIP_PATTERNS) {
    if (relativePath.includes(pattern)) {
      return true;
    }
  }

  return false;
}

function extractFolderFromObservation(line) {
  // Extract file path from observation line
  // Format: - **14:32** | Read | `src/components/Dashboard.jsx`
  // Or: - **14:32** | Read | `C:/Users/.../myBrain/src/components/Dashboard.jsx`
  const match = line.match(/\| (?:Read|Write|Edit) \| `([^`]+)`/);
  if (match) {
    let filePath = match[1];

    // Normalize path separators
    filePath = filePath.replace(/\\/g, '/');

    // Convert absolute path to relative if it's within PROJECT_ROOT
    const normalizedRoot = PROJECT_ROOT.replace(/\\/g, '/');
    if (filePath.startsWith(normalizedRoot)) {
      filePath = filePath.slice(normalizedRoot.length);
      // Remove leading slash if present
      if (filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
    }

    const folder = dirname(filePath);
    return folder === '.' ? null : folder;
  }
  return null;
}

function getRecentSessions(days = 7) {
  if (!existsSync(SESSIONS_DIR)) {
    return [];
  }

  const files = readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, days);

  return files.map(f => join(SESSIONS_DIR, f));
}

function collectFolderObservations() {
  const folderStats = new Map(); // folder -> { count, observations[] }

  const sessionFiles = getRecentSessions(7);

  for (const sessionFile of sessionFiles) {
    const content = readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n');
    const sessionDate = sessionFile.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || 'unknown';

    for (const line of lines) {
      if (!line.startsWith('- **')) continue;

      const folder = extractFolderFromObservation(line);
      if (!folder || folder === '.') continue;

      // Normalize folder path
      const normalizedFolder = folder.replace(/\\/g, '/');

      if (!folderStats.has(normalizedFolder)) {
        folderStats.set(normalizedFolder, { count: 0, observations: [] });
      }

      const stats = folderStats.get(normalizedFolder);
      stats.count++;

      // Keep last 15 observations per folder
      if (stats.observations.length < 15) {
        stats.observations.push({ date: sessionDate, line });
      }
    }
  }

  return folderStats;
}

const START_TAG = '<memory-context>';
const END_TAG = '</memory-context>';

/**
 * Replace only the tagged section, preserving user content outside tags.
 * If no tags exist, append tagged content at the end.
 */
function replaceTaggedContent(existingContent, newContent) {
  if (!existingContent) {
    return `${START_TAG}\n${newContent}\n${END_TAG}`;
  }

  const startIdx = existingContent.indexOf(START_TAG);
  const endIdx = existingContent.indexOf(END_TAG);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace only tagged section
    return existingContent.substring(0, startIdx) +
      `${START_TAG}\n${newContent}\n${END_TAG}` +
      existingContent.substring(endIdx + END_TAG.length);
  }

  // No tags exist - append at end
  return existingContent.trim() + `\n\n${START_TAG}\n${newContent}\n${END_TAG}`;
}

function generateFolderClaudeMd(folder, stats) {
  // Normalize folder path (should already be relative from extractFolderFromObservation)
  const normalizedFolder = folder.replace(/\\/g, '/');
  const fullPath = join(PROJECT_ROOT, normalizedFolder);

  // Safety check
  if (shouldSkipFolder(fullPath)) {
    return false;
  }

  // Check folder exists
  if (!existsSync(fullPath)) {
    return false;
  }

  const claudeMdPath = join(fullPath, 'CLAUDE.md');

  // Group observations by date
  const byDate = new Map();
  for (const obs of stats.observations) {
    if (!byDate.has(obs.date)) {
      byDate.set(obs.date, []);
    }
    byDate.get(obs.date).push(obs.line);
  }

  // Generate the auto-content (goes inside tags)
  let autoContent = `## Recent Activity (${stats.count} observations)\n\n`;
  autoContent += `> Auto-generated by memory system. Edit content OUTSIDE these tags.\n\n`;

  for (const [date, observations] of byDate) {
    autoContent += `### ${date}\n\n`;
    for (const obs of observations) {
      autoContent += obs + '\n';
    }
    autoContent += '\n';
  }

  autoContent += `*Last updated: ${new Date().toISOString().split('T')[0]}*`;

  // Read existing content if file exists
  let existingContent = '';
  if (existsSync(claudeMdPath)) {
    existingContent = readFileSync(claudeMdPath, 'utf-8');
  } else {
    // New file - add a header for user content
    existingContent = `# ${normalizedFolder}\n\n<!-- Add your notes about this folder here. Content outside <memory-context> tags is preserved. -->\n\n`;
  }

  // Replace only tagged section, preserve user content
  const finalContent = replaceTaggedContent(existingContent, autoContent);

  writeFileSync(claudeMdPath, finalContent);
  return true;
}

// Main execution
try {
  const folderStats = collectFolderObservations();
  let created = 0;
  let skipped = 0;

  for (const [folder, stats] of folderStats) {
    if (stats.count < MIN_OBSERVATIONS) {
      skipped++;
      continue;
    }

    if (generateFolderClaudeMd(folder, stats)) {
      created++;
    } else {
      skipped++;
    }
  }

  // Output for Claude Code
  console.log(JSON.stringify({
    continue: true,
    suppressOutput: true
  }));

} catch (e) {
  // Silent fail
  console.log(JSON.stringify({
    continue: true,
    suppressOutput: true
  }));
}

process.exit(0);
