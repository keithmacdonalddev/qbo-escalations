#!/usr/bin/env node
/**
 * Memory Context Injection Hook - SessionStart
 *
 * 1. Injects recent session history into Claude's context at session start
 * 2. Spawns a live background Haiku agent for continuous memory management
 *
 * Agent lifecycle:
 * - Spawned here at session start (child process)
 * - Dies automatically when VS Code/terminal closes
 * - SessionEnd hook kills PID as backup
 * - 4-hour timeout as safety net
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { spawn, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));
const SESSIONS_DIR = join(PROJECT_ROOT, '.claude', 'memory', 'sessions');
const MEMORY_DIR = join(PROJECT_ROOT, '.claude', 'memory');
const PID_FILE = join(MEMORY_DIR, '.memory-agent.pid');
const LOGS_DIR = join(PROJECT_ROOT, '.claude', 'logs');

// Safety check
const HOME_CLAUDE = join(homedir(), '.claude');
if (SESSIONS_DIR.startsWith(HOME_CLAUDE)) {
  console.error('ERROR: Refusing to use home .claude directory');
  process.exit(1);
}

// Ensure directories exist
[MEMORY_DIR, LOGS_DIR].forEach(dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

const DAYS_TO_SHOW = 3;
const MAX_LINES_PER_DAY = 30;

function log(msg) {
  try {
    appendFileSync(join(LOGS_DIR, 'memory-agent.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

function isProcessRunning(pid) {
  try {
    if (process.platform === 'win32') {
      return execSync(`tasklist /FI "PID eq ${pid}" 2>nul`, { encoding: 'utf-8' }).includes(pid.toString());
    }
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function isAgentAlreadyRunning() {
  if (!existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());
    if (isNaN(pid)) { unlinkSync(PID_FILE); return false; }
    if (isProcessRunning(pid)) return true;
    unlinkSync(PID_FILE);
    return false;
  } catch (e) {
    return false;
  }
}

function spawnMemoryAgent() {
  if (isAgentAlreadyRunning()) {
    log('Agent already running, skipping spawn');
    return { spawned: false, reason: 'already running' };
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const prompt = `You are a LIVE MEMORY AGENT. Monitor and maintain memory files continuously.

SESSION FILE: .claude/memory/sessions/${dateStr}.md
MEMORY FILE: .claude/memory.md

LOOP (every 2-3 min):
1. Read session file, count observation lines (lines starting with "- **")
2. If 50+ new lines since last check:
   - Consolidate repeated file touches (3+ touches in 10min = summary line)
   - Keep last 30 min detailed, summarize older
   - Extract decisions to memory.md if found
3. Sleep 2 min, repeat

EXIT after 4 hours OR if no changes for 30 min.
Work silently. Be conservative. Never delete, only consolidate.
START NOW.`;

  try {
    log('Spawning memory agent...');
    const isWin = process.platform === 'win32';
    const child = spawn('claude', ['-p', prompt, '--model', 'haiku'], {
      detached: !isWin,
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: isWin,
      windowsHide: true,
      cwd: PROJECT_ROOT
    });

    if (child.pid) {
      writeFileSync(PID_FILE, child.pid.toString());
      log(`Agent spawned PID: ${child.pid}`);
      if (!isWin) child.unref();
      return { spawned: true, pid: child.pid };
    }
    return { spawned: false, reason: 'no pid' };
  } catch (e) {
    log(`Spawn error: ${e.message}`);
    return { spawned: false, reason: e.message };
  }
}

function getRecentSessions() {
  if (!existsSync(SESSIONS_DIR)) return null;
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.md')).sort().reverse().slice(0, DAYS_TO_SHOW);
  if (!files.length) return null;

  let ctx = '## Recent Session History\n\n> Auto-injected. Search with `/mem-search`.\n\n';
  for (const file of files) {
    const content = readFileSync(join(SESSIONS_DIR, file), 'utf-8');
    const obs = content.split('\n').filter(l => l.startsWith('- **')).slice(0, MAX_LINES_PER_DAY);
    if (obs.length) ctx += `### ${file.replace('.md','')}\n\n${obs.join('\n')}\n\n`;
  }
  return ctx;
}

// Main
try {
  const agent = spawnMemoryAgent();
  let output = getRecentSessions() || '';

  if (output) {
    if (agent.spawned) output += `\n---\n*Live memory agent active (PID: ${agent.pid}).*\n`;
    else if (agent.reason === 'already running') output += `\n---\n*Live memory agent already running.*\n`;
    else output += `\n---\n*Agent spawn skipped: ${agent.reason}*\n`;
  }

  if (process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1') {
    output += '\n*Agent Teams enabled. Use Shift+Tab for Delegate Mode. In-process mode (Windows).*\n';
  }

  console.log(JSON.stringify({ continue: true, suppressOutput: false, hookSpecificOutput: output }));
} catch (e) {
  log(`Hook error: ${e.message}`);
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
}

process.exit(0);
