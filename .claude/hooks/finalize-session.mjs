#!/usr/bin/env node
/**
 * Memory Finalize Hook - Stop/SessionEnd
 *
 * 1. Adds a session end marker to today's session file
 * 2. Kills the background memory agent if running
 *
 * IMPORTANT: This hook uses PROJECT-relative paths only.
 */

import { appendFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));
const SESSIONS_DIR = join(PROJECT_ROOT, '.claude', 'memory', 'sessions');
const MEMORY_DIR = join(PROJECT_ROOT, '.claude', 'memory');
const PID_FILE = join(MEMORY_DIR, '.memory-agent.pid');

// Safety check
const HOME_CLAUDE = join(homedir(), '.claude');
if (SESSIONS_DIR.startsWith(HOME_CLAUDE)) {
  console.error('ERROR: Refusing to use home .claude directory');
  process.exit(1);
}

/**
 * Kill the memory agent if running
 */
function killMemoryAgent() {
  if (!existsSync(PID_FILE)) return { killed: false, reason: 'no pid file' };

  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());
    if (isNaN(pid)) {
      unlinkSync(PID_FILE);
      return { killed: false, reason: 'invalid pid' };
    }

    // Kill the process
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /F /PID ${pid} 2>nul`, { encoding: 'utf-8' });
      } catch (e) {
        // Process might already be dead
      }
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (e) {
        // Process might already be dead
      }
    }

    // Remove PID file
    unlinkSync(PID_FILE);
    return { killed: true, pid };
  } catch (e) {
    return { killed: false, reason: e.message };
  }
}

/**
 * Add session end marker
 */
function addSessionEndMarker() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  const timeStr = now.toTimeString().split(' ')[0].slice(0, 5);
  const sessionFile = join(SESSIONS_DIR, `${dateStr}.md`);

  if (!existsSync(sessionFile)) return;

  const content = readFileSync(sessionFile, 'utf-8');

  // Check for recent end marker (prevent duplicates within 2 min)
  const lastEndMatch = content.match(/\*\*Session ended at (\d{2}:\d{2})\*\*/g);
  if (lastEndMatch && lastEndMatch.length > 0) {
    const lastEndTime = lastEndMatch[lastEndMatch.length - 1].match(/(\d{2}):(\d{2})/);
    if (lastEndTime) {
      const lastMins = parseInt(lastEndTime[1]) * 60 + parseInt(lastEndTime[2]);
      const nowMins = parseInt(timeStr.split(':')[0]) * 60 + parseInt(timeStr.split(':')[1]);
      if (Math.abs(nowMins - lastMins) < 2) return;
    }
  }

  // Count observations
  const observationCount = (content.match(/^- \*\*/gm) || []).length;

  const endMarker = `\n---\n\n**Session ended at ${timeStr}** (${observationCount} observations)\n\n`;
  appendFileSync(sessionFile, endMarker);
}

// Main
try {
  // 1. Kill memory agent
  killMemoryAgent();

  // 2. Add session end marker
  addSessionEndMarker();

  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
} catch (e) {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
}

process.exit(0);
