'use strict';

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Normalize a raw tool event into a canonical schema at capture time.
 *
 * @param {Object} rawEvent - { tool, status, details } from toToolEvents()
 * @param {string} provider - provider ID (e.g. 'claude', 'gpt-5.3-codex-high')
 * @returns {{ toolFamily: string, operation: string, pathsRead: string[], pathsWritten: string[], raw: Object, provider: string }}
 */
function normalizeToolEvent(rawEvent, provider) {
  if (!rawEvent || !rawEvent.tool) {
    return { toolFamily: 'other', operation: '', pathsRead: [], pathsWritten: [], raw: null, provider: provider || '' };
  }

  const base = {
    toolFamily: classifyToolFamily(rawEvent.tool),
    operation: rawEvent.tool,
    pathsRead: [],
    pathsWritten: [],
    raw: rawEvent.details || null,
    provider: provider || '',
  };

  // Claude tool shapes: details.input.file_path or details.file_path
  if (rawEvent.tool === 'Write' || rawEvent.tool === 'Edit') {
    const fp = rawEvent.details?.input?.file_path || rawEvent.details?.file_path;
    if (fp) base.pathsWritten.push(normalizePath(fp));
  }
  if (rawEvent.tool === 'Read') {
    const fp = rawEvent.details?.input?.file_path || rawEvent.details?.file_path;
    if (fp) base.pathsRead.push(normalizePath(fp));
  }
  if (rawEvent.tool === 'Glob' || rawEvent.tool === 'Grep') {
    const fp = rawEvent.details?.input?.path || rawEvent.details?.file_path;
    if (fp) base.pathsRead.push(normalizePath(fp));
  }
  if (rawEvent.tool === 'Bash' || rawEvent.tool === 'bash') {
    // Bash commands may touch files but we can't reliably determine which
    // Just capture the command for context
  }

  // Codex tool shapes: details.arguments.path or details.input.path
  if (rawEvent.details?.arguments?.path) {
    const fp = normalizePath(rawEvent.details.arguments.path);
    (rawEvent.tool === 'write' || rawEvent.tool === 'edit' ? base.pathsWritten : base.pathsRead).push(fp);
  }
  if (rawEvent.details?.input?.path) {
    const fp = normalizePath(rawEvent.details.input.path);
    // Avoid duplicates from Claude shapes already captured above
    if (!base.pathsRead.includes(fp) && !base.pathsWritten.includes(fp)) {
      base.pathsRead.push(fp);
    }
  }

  return base;
}

/**
 * Convert a potentially absolute path to a project-relative forward-slash path.
 */
function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, '/');
}

/**
 * Classify a tool name into a canonical family.
 */
function classifyToolFamily(toolName) {
  if (!toolName) return 'other';
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'write', 'edit', 'NotebookEdit']);
  const EXECUTE_TOOLS = new Set(['Bash', 'bash', 'shell', 'execute']);
  const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'read', 'glob', 'grep', 'ToolSearch']);
  const SEARCH_TOOLS = new Set(['WebSearch', 'WebFetch']);

  if (WRITE_TOOLS.has(toolName)) return 'file-write';
  if (EXECUTE_TOOLS.has(toolName)) return 'execute';
  if (READ_TOOLS.has(toolName)) return 'file-read';
  if (SEARCH_TOOLS.has(toolName)) return 'search';
  return 'other';
}

/**
 * Extract all unique file paths from an array of normalized tool events.
 */
function extractFilesFromNormalized(normalizedEvents) {
  const files = new Set();
  for (const evt of normalizedEvents) {
    if (!evt) continue;
    for (const p of evt.pathsRead) { if (p) files.add(p); }
    for (const p of evt.pathsWritten) { if (p) files.add(p); }
  }
  return [...files];
}

module.exports = { normalizeToolEvent, extractFilesFromNormalized, normalizePath, classifyToolFamily };
