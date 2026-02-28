#!/usr/bin/env node
/**
 * Memory Capture Hook - PostToolUse
 *
 * Automatically captures tool usage observations to session files.
 * Runs after every tool invocation in Claude Code.
 *
 * Handles mechanical consolidation only (no AI agents spawned):
 * - Triggers every 30 observations OR 10 minutes
 * - Consolidates repetitive file touches
 * - Keeps session files lean but informative
 *
 * Storage: .claude/memory/sessions/YYYY-MM-DD.md
 *
 * IMPORTANT: This hook uses PROJECT-relative paths only.
 * Never uses the home directory ~/.claude/ folder.
 *
 * NOTE: NO PROCESS SPAWNING - consolidation is mechanical only.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));
const SESSIONS_DIR = join(PROJECT_ROOT, '.claude', 'memory', 'sessions');
const CONSOLIDATION_STATE_FILE = join(PROJECT_ROOT, '.claude', 'memory', '.consolidation-state.json');

// Safety check: ensure we're not accidentally using home directory
const HOME_CLAUDE = join(homedir(), '.claude');
if (SESSIONS_DIR.startsWith(HOME_CLAUDE)) {
  console.error('ERROR: Refusing to use home .claude directory');
  process.exit(1);
}

// Ensure sessions directory exists
if (!existsSync(SESSIONS_DIR)) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Consolidation thresholds
const OBSERVATION_THRESHOLD = 30; // Consolidate every 30 observations
const TIME_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// Read hook input from stdin
let input = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    const hookData = JSON.parse(input);
    captureObservation(hookData);
  } catch (e) {
    // Silent fail - don't break Claude Code if hook fails
    process.exit(0);
  }
});

// Timeout safety - exit if no input after 3 seconds
setTimeout(() => process.exit(0), 3000);

/**
 * Get or initialize consolidation state
 */
function getConsolidationState() {
  try {
    if (existsSync(CONSOLIDATION_STATE_FILE)) {
      const state = JSON.parse(readFileSync(CONSOLIDATION_STATE_FILE, 'utf-8'));
      return state;
    }
  } catch (e) {
    // Corrupted or missing - reset
  }
  return {
    lastConsolidationTime: Date.now(),
    observationsSinceConsolidation: 0,
    lastConsolidationDate: new Date().toISOString().split('T')[0]
  };
}

/**
 * Save consolidation state
 */
function saveConsolidationState(state) {
  try {
    writeFileSync(CONSOLIDATION_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    // Silent fail
  }
}

/**
 * Check if consolidation is needed and run it (mechanical only, no spawning)
 */
function checkAndConsolidate(dateStr, sessionFile) {
  const state = getConsolidationState();
  const now = Date.now();

  // Reset counter if it's a new day
  if (state.lastConsolidationDate !== dateStr) {
    state.lastConsolidationTime = now;
    state.observationsSinceConsolidation = 0;
    state.lastConsolidationDate = dateStr;
  }

  // Increment observation count
  state.observationsSinceConsolidation++;

  const timeSinceLastConsolidation = now - state.lastConsolidationTime;
  const shouldConsolidate =
    state.observationsSinceConsolidation >= OBSERVATION_THRESHOLD ||
    timeSinceLastConsolidation >= TIME_THRESHOLD_MS;

  if (shouldConsolidate && existsSync(sessionFile)) {
    try {
      // Run mechanical consolidation only (no AI agent spawning)
      runConsolidation(sessionFile);

      state.lastConsolidationTime = now;
      state.observationsSinceConsolidation = 0;
    } catch (e) {
      // Silent fail - don't break main functionality
    }
  }

  saveConsolidationState(state);
}

/**
 * Run consolidation on the session file
 *
 * Strategy:
 * 1. Parse all observations
 * 2. Find repetitive patterns (same file touched 3+ times in 10 min window)
 * 3. Compress those into summary lines
 * 4. Keep last 30 minutes of observations detailed
 * 5. Write back consolidated file
 */
function runConsolidation(sessionFile) {
  const content = readFileSync(sessionFile, 'utf-8');
  const lines = content.split('\n');

  // Separate header and observations
  const header = [];
  const observations = [];
  const sessionMarkers = [];
  let inHeader = true;

  for (const line of lines) {
    // Session end markers stay as-is
    if (line.startsWith('**Session ended at')) {
      sessionMarkers.push({ type: 'end', line });
      continue;
    }

    // Horizontal rules stay as-is
    if (line.trim() === '---') {
      if (inHeader) {
        header.push(line);
      }
      continue;
    }

    // Header lines (before first observation)
    if (inHeader && !line.startsWith('- **')) {
      header.push(line);
      continue;
    }

    // First observation marks end of header
    if (line.startsWith('- **')) {
      inHeader = false;
      observations.push(parseLine(line));
    }
  }

  // If too few observations, don't consolidate
  if (observations.length < 50) {
    return;
  }

  // Find the cutoff time (30 minutes ago)
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - 30 * 60 * 1000);

  // Separate recent vs old observations
  const recentObservations = [];
  const oldObservations = [];

  for (const obs of observations) {
    if (obs.timestamp && obs.timestamp > cutoffTime) {
      recentObservations.push(obs);
    } else {
      oldObservations.push(obs);
    }
  }

  // Consolidate old observations
  const consolidatedOld = consolidateObservations(oldObservations);

  // Rebuild the file
  const rebuiltLines = [...header, ''];

  // Add consolidated old observations
  for (const obs of consolidatedOld) {
    rebuiltLines.push(obs.line);
  }

  // Add a separator if we have old consolidated AND recent detailed
  if (consolidatedOld.length > 0 && recentObservations.length > 0) {
    rebuiltLines.push('');
    rebuiltLines.push('---');
    rebuiltLines.push('');
  }

  // Add recent observations (unchanged)
  for (const obs of recentObservations) {
    rebuiltLines.push(obs.line);
  }

  // Add any session markers at the end
  for (const marker of sessionMarkers) {
    rebuiltLines.push('');
    rebuiltLines.push(marker.line);
  }

  // Write back
  writeFileSync(sessionFile, rebuiltLines.join('\n'));
}

/**
 * Parse an observation line into structured data
 */
function parseLine(line) {
  // Format: - **HH:MM** | EMOJI Tool | `file` [Type]
  const timeMatch = line.match(/\*\*(\d{2}:\d{2})\*\*/);
  const time = timeMatch ? timeMatch[1] : null;

  // Try to extract the tool and file
  const toolMatch = line.match(/\| ([📖✏️🔧🔍🔎💻🌐🤖⚡📓]?\s?\w+) \|/);
  const tool = toolMatch ? toolMatch[1].trim() : null;

  // Extract file path if present
  const fileMatch = line.match(/`([^`]+)`/);
  const file = fileMatch ? fileMatch[1] : null;

  // Parse time into Date for comparison
  let timestamp = null;
  if (time) {
    const [hours, minutes] = time.split(':').map(Number);
    const today = new Date();
    timestamp = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
  }

  return { line, time, tool, file, timestamp };
}

/**
 * Consolidate repetitive observations
 *
 * Groups by file and consolidates runs of 3+ touches within 10 min windows
 */
function consolidateObservations(observations) {
  if (observations.length === 0) return [];

  const result = [];
  const fileGroups = new Map(); // file -> array of observations

  // First pass: identify files touched multiple times
  for (const obs of observations) {
    if (obs.file) {
      const fileName = getFileName(obs.file);
      if (!fileGroups.has(fileName)) {
        fileGroups.set(fileName, []);
      }
      fileGroups.get(fileName).push(obs);
    } else {
      // Non-file observations pass through
      result.push(obs);
    }
  }

  // Second pass: consolidate repetitive file touches
  for (const [fileName, group] of fileGroups) {
    if (group.length >= 3) {
      // Consolidate this group
      const startTime = group[0].time;
      const endTime = group[group.length - 1].time;
      const tools = [...new Set(group.map(o => o.tool).filter(Boolean))];
      const toolStr = tools.length > 0 ? tools.join('/') : 'multiple ops';

      const consolidatedLine = `- **${startTime}-${endTime}** | Heavy activity | \`${fileName}\` (${group.length} touches: ${toolStr})`;
      result.push({ line: consolidatedLine, time: startTime, consolidated: true });
    } else {
      // Too few to consolidate, keep as-is
      result.push(...group);
    }
  }

  // Sort by time
  result.sort((a, b) => {
    if (!a.time || !b.time) return 0;
    return a.time.localeCompare(b.time);
  });

  return result;
}

function captureObservation(hookData) {
  const { tool_name, tool_input, tool_output } = hookData || {};

  if (!tool_name) {
    process.exit(0);
    return;
  }

  // Skip noisy/internal tools
  const skipTools = ['TodoWrite', 'TodoRead', 'AskUserQuestion', 'StructuredOutput'];
  if (skipTools.includes(tool_name)) {
    process.exit(0);
    return;
  }

  const now = new Date();
  // Use local date (not UTC) to match local timestamps
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`; // YYYY-MM-DD local
  const timeStr = now.toTimeString().split(' ')[0].slice(0, 5); // HH:MM local
  const sessionFile = join(SESSIONS_DIR, `${dateStr}.md`);

  // Extract relevant info based on tool type
  let observation = formatObservation(tool_name, tool_input, tool_output, timeStr);

  if (!observation) {
    process.exit(0);
    return;
  }

  // Create file header if new file
  if (!existsSync(sessionFile)) {
    const header = `# Session: ${dateStr}\n\n> Auto-captured by memory hooks. Search with /mem-search.\n\n---\n\n`;
    appendFileSync(sessionFile, header);
  }

  // Append observation
  appendFileSync(sessionFile, observation + '\n');

  // Check if consolidation is needed
  checkAndConsolidate(dateStr, sessionFile);

  // Output success (Claude Code expects JSON response)
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}

// Helper functions for richer observations
function getFileType(filePath) {
  if (!filePath) return '';
  const ext = filePath.split('.').pop()?.toLowerCase();
  const typeMap = {
    'js': 'JS', 'jsx': 'React', 'ts': 'TS', 'tsx': 'React/TS',
    'css': 'CSS', 'scss': 'SCSS', 'html': 'HTML',
    'json': 'JSON', 'md': 'Markdown', 'yaml': 'YAML', 'yml': 'YAML',
    'py': 'Python', 'rb': 'Ruby', 'go': 'Go', 'rs': 'Rust',
    'sql': 'SQL', 'sh': 'Shell', 'bash': 'Shell',
    'env': 'Env', 'gitignore': 'Git'
  };
  return typeMap[ext] || '';
}

function getFileName(filePath) {
  if (!filePath) return 'unknown';
  return filePath.split(/[/\\]/).pop() || filePath;
}

function categorizeBashCommand(cmd) {
  if (!cmd) return '';
  const lower = cmd.toLowerCase();
  if (lower.startsWith('git ')) return 'Git';
  if (lower.startsWith('npm ') || lower.startsWith('yarn ') || lower.startsWith('pnpm ')) return 'Package';
  if (lower.startsWith('node ')) return 'Node';
  if (lower.includes('test')) return 'Test';
  if (lower.startsWith('ls') || lower.startsWith('dir') || lower.startsWith('find')) return 'Files';
  if (lower.startsWith('cat') || lower.startsWith('head') || lower.startsWith('tail')) return 'Read';
  if (lower.startsWith('grep') || lower.startsWith('rg')) return 'Search';
  return '';
}

function detectError(output) {
  if (!output) return false;
  const errorPatterns = /error:|Error:|ERROR|failed|Failed|FAILED|exception|Exception/i;
  return errorPatterns.test(output);
}

function getOutputStats(output) {
  if (!output) return '';
  const lines = (output.match(/\n/g) || []).length + 1;
  if (lines > 100) return `~${Math.round(lines / 10) * 10} lines`;
  if (lines > 20) return `${lines} lines`;
  return '';
}

function formatObservation(toolName, input, output, time) {
  const truncate = (str, max = 200) => {
    if (!str) return '';
    const s = String(str);
    return s.length > max ? s.slice(0, max) + '...' : s;
  };

  const hasError = detectError(output);
  const errorMark = hasError ? ' ⚠️' : '';

  switch (toolName) {
    case 'Read': {
      const fileType = getFileType(input?.file_path);
      const fileName = getFileName(input?.file_path);
      const typeTag = fileType ? ` [${fileType}]` : '';
      return `- **${time}** | 📖 Read | \`${fileName}\`${typeTag}`;
    }

    case 'Write': {
      const fileType = getFileType(input?.file_path);
      const fileName = getFileName(input?.file_path);
      const typeTag = fileType ? ` [${fileType}]` : '';
      return `- **${time}** | ✏️ Write | \`${fileName}\`${typeTag}`;
    }

    case 'Edit': {
      const fileType = getFileType(input?.file_path);
      const fileName = getFileName(input?.file_path);
      const typeTag = fileType ? ` [${fileType}]` : '';
      return `- **${time}** | 🔧 Edit | \`${fileName}\`${typeTag}`;
    }

    case 'Glob': {
      const matchCount = (output?.match(/\n/g) || []).length;
      const pattern = input?.pattern || '';
      return `- **${time}** | 🔍 Glob | \`${pattern}\` → ${matchCount} files`;
    }

    case 'Grep': {
      const matchCount = (output?.match(/\n/g) || []).length;
      const pattern = truncate(input?.pattern, 40);
      const path = input?.path ? getFileName(input.path) : 'cwd';
      return `- **${time}** | 🔎 Grep | \`${pattern}\` in ${path} → ${matchCount} matches`;
    }

    case 'Bash': {
      const cmd = truncate(input?.command, 70);
      const category = categorizeBashCommand(input?.command);
      const catTag = category ? ` [${category}]` : '';
      const stats = getOutputStats(output);
      const statsTag = stats ? ` (${stats})` : '';
      return `- **${time}** | 💻 Bash | \`${cmd}\`${catTag}${statsTag}${errorMark}`;
    }

    case 'WebFetch': {
      const url = input?.url || '';
      const domain = url.match(/https?:\/\/([^/]+)/)?.[1] || url;
      return `- **${time}** | 🌐 Fetch | ${domain}`;
    }

    case 'WebSearch':
      return `- **${time}** | 🔍 Search | "${truncate(input?.query, 60)}"`;

    case 'Task': {
      const agent = input?.subagent_type || 'agent';
      const desc = truncate(input?.description, 50);
      return `- **${time}** | 🤖 Agent | ${agent}: ${desc}`;
    }

    case 'TeammateTool':
      return `- **${time}** | 👥 Team | Spawned teammate: ${truncate(input?.name || input?.description, 50)}`;

    case 'SendMessage':
      return `- **${time}** | 💬 Team | Message to ${input?.recipient || 'teammate'}: ${truncate(input?.content, 50)}`;

    case 'Skill':
      return `- **${time}** | ⚡ Skill | /${input?.skill} ${input?.args || ''}`.trim();

    case 'NotebookEdit':
      return `- **${time}** | 📓 Notebook | ${getFileName(input?.notebook_path)}`;

    default:
      return `- **${time}** | ${toolName}${errorMark}`;
  }
}
