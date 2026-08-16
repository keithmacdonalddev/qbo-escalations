import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createBrowserSessionGuard,
  extractBrowserInvocations,
} from '../agent-harness/browser-session-guard.mjs';

function fixture(t, options = {}) {
  const stateRoot = mkdtempSync(join(tmpdir(), 'browser-session-guard-test-'));
  t.after(() => rmSync(stateRoot, { recursive: true, force: true }));
  const live = new Set(options.live || []);
  const closed = [];
  const closeAttempts = new Map();
  const browser = {
    list: () => options.listFails ? null : new Set(live),
    close: (name) => {
      closed.push(name);
      const attempt = (closeAttempts.get(name) || 0) + 1;
      closeAttempts.set(name, attempt);
      const alwaysFails = options.closeFails?.includes(name);
      const failsOnce = options.closeFailsOnce?.includes(name) && attempt === 1;
      if (!alwaysFails && !failsOnce) live.delete(name);
      return !alwaysFails && !failsOnce;
    },
  };
  const guard = createBrowserSessionGuard({
    stateRoot,
    browser,
    now: options.now || (() => 10_000),
    staleMs: options.staleMs ?? 1_000,
  });
  return { guard, live, closed };
}

function toolInput(command, overrides = {}) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: 'chat-a',
    turn_id: 'turn-a',
    tool_name: 'Bash',
    tool_input: { command },
    ...overrides,
  };
}

test('extracts exact named sessions without mistaking quoted documentation for a command', () => {
  const parsed = extractBrowserInvocations('agent-browser --session qa-123 open about:blank; agent-browser session list --json');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sessionName, 'qa-123');
  assert.equal(parsed[1].isSafeUnscoped, true);
  assert.deepEqual(extractBrowserInvocations('rg -n "agent-browser close" docs'), []);
});

test('pre-tool guard rejects unnamed sessions and broad cleanup', (t) => {
  const { guard } = fixture(t);
  const unnamed = guard.handle(toolInput('agent-browser open about:blank', { hook_event_name: 'PreToolUse' }));
  assert.equal(unnamed.hookSpecificOutput.permissionDecision, 'deny');

  const broad = guard.handle(toolInput('agent-browser close --all', { hook_event_name: 'PreToolUse' }));
  assert.equal(broad.hookSpecificOutput.permissionDecision, 'deny');

  const list = guard.handle(toolInput('agent-browser session list --json', { hook_event_name: 'PreToolUse' }));
  assert.equal(list, undefined);
});

test('stop closes only the exact session recorded for the turn', (t) => {
  const { guard, live, closed } = fixture(t, { live: ['owned-session', 'other-agent-session'] });
  guard.handle(toolInput('agent-browser --session owned-session open about:blank'));
  const output = guard.handle(toolInput('', { hook_event_name: 'Stop' }));

  assert.deepEqual(output, {});
  assert.deepEqual(closed, ['owned-session']);
  assert.equal(live.has('other-agent-session'), true);
  assert.deepEqual(guard.listRecords(), []);
});

test('repeated use refreshes one ownership record instead of multiplying it', (t) => {
  const { guard } = fixture(t);
  guard.handle(toolInput('agent-browser --session repeated snapshot -i'));
  guard.handle(toolInput('agent-browser --session repeated get url'));
  assert.equal(guard.listRecords().length, 1);
});

test('failed cleanup blocks one stop pass and preserves the ownership record', (t) => {
  const { guard } = fixture(t, { live: ['stuck-session'], closeFails: ['stuck-session'] });
  guard.handle(toolInput('agent-browser --session stuck-session open about:blank'));

  const first = guard.handle(toolInput('', { hook_event_name: 'Stop' }));
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /stuck-session/);
  assert.equal(guard.listRecords().length, 1);

  const second = guard.handle(toolInput('', { hook_event_name: 'Stop', stop_hook_active: true }));
  assert.match(second.systemMessage, /incomplete/);
});

test('cleanup retries the same owned session once before declaring failure', (t) => {
  const { guard, closed } = fixture(t, { live: ['slow-close'], closeFailsOnce: ['slow-close'] });
  guard.handle(toolInput('agent-browser --session slow-close open about:blank'));

  assert.deepEqual(guard.handle(toolInput('', { hook_event_name: 'Stop' })), {});
  assert.deepEqual(closed, ['slow-close', 'slow-close']);
  assert.deepEqual(guard.listRecords(), []);
});

test('an unexpected cleanup error blocks completion instead of silently leaking', (t) => {
  const { guard } = fixture(t);
  guard.handle(toolInput('agent-browser --session guard-error open about:blank'));

  const failing = createBrowserSessionGuard({
    stateRoot: guard.stateRoot,
    browser: { list: () => { throw new Error('boom'); }, close: () => false },
  });
  const result = failing.handle(toolInput('', { hook_event_name: 'Stop' }));
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /failed unexpectedly/);
});

test('a session name already owned by another turn is rejected', (t) => {
  const { guard } = fixture(t);
  guard.handle(toolInput('agent-browser --session shared-name open about:blank'));
  const result = guard.handle(toolInput(
    'agent-browser --session shared-name snapshot -i',
    { hook_event_name: 'PreToolUse', session_id: 'chat-b', turn_id: 'turn-b' },
  ));
  assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /already owned/);
});

test('session start cleans expired records but preserves fresh records', (t) => {
  let clock = 1_000;
  const { guard, live, closed } = fixture(t, {
    live: ['expired-session', 'fresh-session'],
    now: () => clock,
    staleMs: 1_000,
  });
  guard.handle(toolInput('agent-browser --session expired-session open about:blank'));
  clock = 1_500;
  guard.handle(toolInput('agent-browser --session fresh-session open about:blank', { session_id: 'chat-b' }));
  clock = 2_250;

  guard.handle({ hook_event_name: 'SessionStart', session_id: 'chat-c' });
  assert.deepEqual(closed, ['expired-session']);
  assert.equal(live.has('fresh-session'), true);
  assert.deepEqual(guard.listRecords().map((record) => record.sessionName), ['fresh-session']);
});
