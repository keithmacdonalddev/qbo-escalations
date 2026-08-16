#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_STALE_MS = 2 * 60 * 60 * 1000;
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SHELL_TOOL_NAMES = new Set(['Bash', 'PowerShell']);

function tokenize(value) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s|]+)/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

export function extractBrowserInvocations(command) {
  if (typeof command !== 'string' || !command.trim()) return [];

  const invocations = [];
  const pattern = /(?:^|&&|\|\||;|\r?\n)\s*(?:&\s*)?(?:npx(?:\.cmd)?\s+)?agent-browser(?:\.cmd|\.exe)?\b([^;\r\n]*?)(?=&&|\|\||;|\r?\n|$)/gim;
  let match;
  while ((match = pattern.exec(command)) !== null) {
    const tokens = tokenize(match[1]);
    const sessionFlagIndex = tokens.findIndex((token) => token === '--session' || token.startsWith('--session='));
    let sessionName = null;
    if (sessionFlagIndex >= 0) {
      const flag = tokens[sessionFlagIndex];
      sessionName = flag === '--session' ? tokens[sessionFlagIndex + 1] ?? null : flag.slice('--session='.length);
    }

    invocations.push({
      tokens,
      sessionName,
      hasSessionFlag: sessionFlagIndex >= 0,
      isCloseAll: tokens.includes('close') && tokens.includes('--all'),
      isSafeUnscoped: (
        tokens.includes('--help')
        || tokens.includes('--version')
        || tokens[0] === 'help'
        || tokens[0] === 'doctor'
        || tokens[0] === 'install'
        || (tokens[0] === 'skills' && ['get', 'list'].includes(tokens[1]))
        || (tokens[0] === 'session' && tokens[1] === 'list')
      ),
    });
  }
  return invocations;
}

function commandFromInput(input) {
  if (!SHELL_TOOL_NAMES.has(input?.tool_name)) return '';
  return typeof input?.tool_input?.command === 'string' ? input.tool_input.command : '';
}

function identityFromInput(input) {
  return {
    sessionId: String(input?.session_id || 'unknown-session'),
    turnId: String(input?.turn_id || 'session'),
    agentId: String(input?.agent_id || 'main'),
  };
}

function sameOwner(record, identity) {
  return record.sessionId === identity.sessionId
    && record.turnId === identity.turnId
    && record.agentId === identity.agentId;
}

function defaultStateRoot(projectRoot) {
  const key = createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 16);
  return join(tmpdir(), 'qbo-agent-browser-guard', key);
}

function runAgentBrowser(args, timeoutMs = 10_000) {
  const options = {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  };
  const result = process.platform === 'win32'
    ? spawnSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', ['agent-browser', ...args].join(' ')],
      options,
    )
    : spawnSync('agent-browser', args, options);
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || ''),
  };
}

function parseLiveSessions(result) {
  if (!result?.ok) return null;
  try {
    const payload = JSON.parse(result.stdout.trim());
    const sessions = payload?.data?.sessions;
    return Array.isArray(sessions) && sessions.every((name) => typeof name === 'string')
      ? new Set(sessions)
      : null;
  } catch {
    return null;
  }
}

export function createBrowserSessionGuard(options = {}) {
  const projectRoot = resolve(options.projectRoot || process.cwd());
  const stateRoot = resolve(options.stateRoot || defaultStateRoot(projectRoot));
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const now = options.now || (() => Date.now());
  const browser = options.browser || {
    list: () => parseLiveSessions(runAgentBrowser(['session', 'list', '--json'], 5_000)),
    close: (sessionName) => runAgentBrowser(['--session', sessionName, 'close'], 10_000).ok,
  };

  function ensureStateRoot() {
    mkdirSync(stateRoot, { recursive: true });
  }

  function listRecords() {
    if (!existsSync(stateRoot)) return [];
    const records = [];
    for (const name of readdirSync(stateRoot)) {
      if (!name.endsWith('.json')) continue;
      const path = join(stateRoot, name);
      try {
        const record = JSON.parse(readFileSync(path, 'utf8'));
        if (!SESSION_NAME_PATTERN.test(record.sessionName)) continue;
        records.push({ ...record, path });
      } catch {
        // Ignore malformed temporary state. It grants no cleanup authority.
      }
    }
    return records;
  }

  function saveRecord(input, sessionName) {
    ensureStateRoot();
    const identity = identityFromInput(input);
    const key = createHash('sha256')
      .update(JSON.stringify({ ...identity, sessionName }))
      .digest('hex');
    const path = join(stateRoot, `${key}.json`);
    const temporaryPath = `${path}.${process.pid}.tmp`;
    let previous = null;
    if (existsSync(path)) {
      try {
        previous = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        previous = null;
      }
    }
    const record = {
      schemaVersion: 1,
      ...identity,
      sessionName,
      createdAt: previous?.createdAt || now(),
      updatedAt: now(),
    };
    writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, path);
  }

  function removeRecord(record) {
    rmSync(record.path, { force: true });
  }

  function recordsForEvent(input) {
    const identity = identityFromInput(input);
    const eventName = input?.hook_event_name;
    return listRecords().filter((record) => {
      if (record.sessionId !== identity.sessionId) return false;
      if (eventName === 'SessionEnd' || eventName === 'StopFailure') return true;
      if (eventName === 'SubagentStop' && input?.agent_id) return record.agentId === identity.agentId;
      if (input?.turn_id) return record.turnId === identity.turnId;
      return true;
    });
  }

  function cleanup(records) {
    if (records.length === 0) return { ok: true, failed: [] };
    const before = browser.list();
    if (!(before instanceof Set)) {
      return { ok: false, failed: [...new Set(records.map((record) => record.sessionName))] };
    }

    const names = [...new Set(records.map((record) => record.sessionName))];
    for (const name of names) {
      if (before.has(name)) browser.close(name);
    }

    let after = browser.list();
    if (!(after instanceof Set)) return { ok: false, failed: names };
    let failed = names.filter((name) => after.has(name));
    // Windows can briefly keep the session socket visible after a successful
    // close. Retry only the same recorded names, then verify once more.
    if (failed.length > 0) {
      for (const name of failed) browser.close(name);
      after = browser.list();
      if (!(after instanceof Set)) return { ok: false, failed };
      failed = failed.filter((name) => after.has(name));
    }
    for (const record of records) {
      if (!failed.includes(record.sessionName)) removeRecord(record);
    }
    return { ok: failed.length === 0, failed };
  }

  function preToolUse(input) {
    const invocations = extractBrowserInvocations(commandFromInput(input));
    if (invocations.length === 0) return undefined;

    for (const invocation of invocations) {
      if (invocation.isCloseAll) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'Browser cleanup must close an exact owned --session. close --all could stop another agent\'s work.',
          },
        };
      }
      if (!invocation.sessionName && !invocation.isSafeUnscoped) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'Use a unique literal agent-browser --session name so this turn can close only its own browser.',
          },
        };
      }
      if (invocation.hasSessionFlag && !SESSION_NAME_PATTERN.test(invocation.sessionName || '')) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'agent-browser --session must be a literal 1-80 character name using letters, numbers, dot, underscore, or hyphen.',
          },
        };
      }
    }

    const identity = identityFromInput(input);
    const records = listRecords();
    const conflict = invocations
      .filter((invocation) => invocation.sessionName)
      .find((invocation) => records.some((record) => (
        record.sessionName === invocation.sessionName && !sameOwner(record, identity)
      )));
    if (conflict) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Browser session "${conflict.sessionName}" is already owned by another turn. Choose a new unique name.`,
        },
      };
    }
    return undefined;
  }

  function postToolUse(input) {
    for (const invocation of extractBrowserInvocations(commandFromInput(input))) {
      if (SESSION_NAME_PATTERN.test(invocation.sessionName || '')) {
        saveRecord(input, invocation.sessionName);
      }
    }
    return undefined;
  }

  function cleanupAtStop(input) {
    const result = cleanup(recordsForEvent(input));
    if (result.ok) return {};
    const names = result.failed.join(', ');
    if (input?.stop_hook_active) {
      return { systemMessage: `Browser cleanup remains incomplete for: ${names}. Report this clearly; do not claim browser acceptance.` };
    }
    return {
      decision: 'block',
      reason: `Browser cleanup failed for: ${names}. Close those exact sessions, verify session list, then finish.`,
    };
  }

  function cleanupStale(input) {
    const cutoff = now() - staleMs;
    const stale = listRecords().filter((record) => Number(record.updatedAt) <= cutoff);
    const result = cleanup(stale);
    if (result.ok) return undefined;
    return {
      hookSpecificOutput: {
        hookEventName: input?.hook_event_name || 'SessionStart',
        additionalContext: `Expired browser cleanup remains incomplete for: ${result.failed.join(', ')}. Do not reuse those names.`,
      },
    };
  }

  function handle(input) {
    try {
      switch (input?.hook_event_name) {
        case 'PreToolUse':
          return preToolUse(input);
        case 'PostToolUse':
        case 'PostToolUseFailure':
          return postToolUse(input);
        case 'Stop':
        case 'SubagentStop':
          return cleanupAtStop(input);
        case 'SessionEnd':
        case 'StopFailure':
          cleanup(recordsForEvent(input));
          return undefined;
        case 'SessionStart':
          return cleanupStale(input);
        default:
          return undefined;
      }
    } catch {
      if (input?.hook_event_name === 'Stop' || input?.hook_event_name === 'SubagentStop') {
        if (input?.stop_hook_active) {
          return { systemMessage: 'Browser cleanup guard failed. Report browser acceptance as incomplete.' };
        }
        return {
          decision: 'block',
          reason: 'Browser cleanup guard failed unexpectedly. Inspect exact owned sessions before finishing.',
        };
      }
      return undefined;
    }
  }

  return { handle, listRecords, stateRoot };
}

async function readStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

async function main() {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw || '{}');
    const output = createBrowserSessionGuard().handle(input);
    if (output !== undefined) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch {
    // Fail open so a malformed local state file cannot brick the coding session.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
