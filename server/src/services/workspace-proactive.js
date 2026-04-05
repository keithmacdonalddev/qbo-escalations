'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');

const CLAUDE_ISOLATED_ROOT = path.join(os.tmpdir(), 'qbo-escalations-claude-isolated');

// ---------------------------------------------------------------------------
// Workspace Proactive AI Reasoning
//
// Lightweight service that triggers short Claude CLI calls when the background
// monitor detects something worth reasoning about. Returns a brief advisory
// message with optional suggested actions the user can click to trigger full
// agent conversations.
//
// Safety:
//   - Max 3 AI calls per hour (hard cap)
//   - Same alert fingerprint won't re-trigger within 1 hour
//   - AI is advisory only — never executes actions
//   - 30-second timeout — fast fail
//   - Low reasoning effort to keep costs down
// ---------------------------------------------------------------------------

function getProactiveSystemPrompt() {
  return getRenderedAgentPrompt('workspace-proactive');
}

function ensureIsolatedClaudeRoot() {
  try {
    fs.mkdirSync(CLAUDE_ISOLATED_ROOT, { recursive: true });
  } catch {
    // Surface the real spawn failure later if this directory cannot be used.
  }
  return CLAUDE_ISOLATED_ROOT;
}

const MAX_CALLS_PER_HOUR = 3;
const PROACTIVE_TIMEOUT_MS = 30_000;
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Rate-limiting state
let _callLog = [];          // timestamps of recent calls
const _reasonedAlerts = new Map(); // fingerprint -> timestamp

// ---------------------------------------------------------------------------
// Fingerprint an alert for deduplication
// ---------------------------------------------------------------------------

function alertFingerprint(alert) {
  return `${alert.type || 'unknown'}:${alert.sourceId || ''}:${alert.severity || ''}`;
}

// ---------------------------------------------------------------------------
// Prune stale entries from rate-limit and dedup trackers
// ---------------------------------------------------------------------------

function pruneState() {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  _callLog = _callLog.filter(ts => ts > cutoff);

  for (const [fp, ts] of _reasonedAlerts) {
    if (ts <= cutoff) _reasonedAlerts.delete(fp);
  }
}

// ---------------------------------------------------------------------------
// Should we trigger an AI call for this alert?
// ---------------------------------------------------------------------------

async function shouldTriggerAI(alert) {
  if (!alert) return false;

  pruneState();

  // Trigger for urgent AND warning alerts, plus severity changes
  // 'info' alerts are excluded — only actionable severities trigger AI reasoning
  const isActionable = alert.severity === 'urgent' || alert.severity === 'warning';
  const severityChanged = !!alert.severityChanged;
  if (!isActionable && !severityChanged) return false;

  // Check dedup — don't re-reason about the same alert within 1 hour
  const fp = alertFingerprint(alert);
  if (_reasonedAlerts.has(fp)) return false;

  // Check rate limit — max N calls per hour
  if (_callLog.length >= MAX_CALLS_PER_HOUR) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Parse Claude's response into structured output
// ---------------------------------------------------------------------------

function parseProactiveResponse(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const suggestedActions = [];
  const messageLines = [];

  for (const line of lines) {
    if (line.startsWith('SUGGEST:')) {
      const action = line.slice('SUGGEST:'.length).trim();
      if (action) suggestedActions.push(action);
    } else {
      messageLines.push(line);
    }
  }

  const message = messageLines.join('\n').trim();
  return {
    shouldAct: message.length > 0,
    message,
    suggestedActions,
  };
}

// ---------------------------------------------------------------------------
// Evaluate a proactive situation using Claude CLI subprocess
// ---------------------------------------------------------------------------

async function evaluateProactiveAction(trigger) {
  // trigger: { type: 'alert'|'pattern'|'entity', data: {...}, context: string }
  const prompt = `${getProactiveSystemPrompt()}\n\n---\nSituation:\n${trigger.context || JSON.stringify(trigger.data, null, 2)}`;

  // Record the call attempt for rate limiting (cap at 100 entries)
  _callLog.push(Date.now());
  if (_callLog.length > 100) {
    _callLog = _callLog.slice(-100);
  }

  // Record the alert fingerprint for dedup
  if (trigger.data) {
    _reasonedAlerts.set(alertFingerprint(trigger.data), Date.now());
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child;

    const args = ['-p', '--output-format', 'text', '--max-turns', '1'];

    // Use low effort to keep costs down
    args.push('--effort', 'low');

    try {
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: ensureIsolatedClaudeRoot(),
        env: {
          ...process.env,
          CLAUDECODE: undefined,
          CLAUDE_PROJECT_DIR: '',
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        },
      });
    } catch (err) {
      return reject(new Error(`Proactive CLI spawn error: ${err.message}`));
    }

    // Pipe the prompt via stdin
    try {
      child.stdin.end(prompt);
    } catch {
      // Process error handler will surface if needed
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error('Proactive AI call timed out after ' + PROACTIVE_TIMEOUT_MS + 'ms'));
    }, PROACTIVE_TIMEOUT_MS);

    child.stdout.on('data', (d) => {
      if (!settled) stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      if (!settled) stderr += d.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;

      if (code !== 0 && !stdout) {
        return reject(new Error(`Proactive CLI exited with code ${code}: ${(stderr || '').slice(0, 300)}`));
      }

      try {
        const result = parseProactiveResponse(stdout);
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse proactive response: ${err.message}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(new Error(`Proactive CLI error: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Status / debugging
// ---------------------------------------------------------------------------

function getProactiveStatus() {
  pruneState();
  return {
    callsThisHour: _callLog.length,
    maxCallsPerHour: MAX_CALLS_PER_HOUR,
    reasonedAlertsCount: _reasonedAlerts.size,
    reasonedAlertFingerprints: Array.from(_reasonedAlerts.keys()),
  };
}

// ---------------------------------------------------------------------------
// Reset (for testing / admin)
// ---------------------------------------------------------------------------

function resetProactiveState() {
  _callLog = [];
  _reasonedAlerts.clear();
}

module.exports = {
  shouldTriggerAI,
  evaluateProactiveAction,
  getProactiveStatus,
  resetProactiveState,
  // Exported for testing/inspection
  alertFingerprint,
  parseProactiveResponse,
};
