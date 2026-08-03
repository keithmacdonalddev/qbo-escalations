'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { connect, disconnect } = require('./_mongo-helper');
const WorkspaceActionApproval = require('../src/models/WorkspaceActionApproval');
const WorkspaceActionRecord = require('../src/models/WorkspaceActionRecord');
const {
  evaluateWorkspaceAction,
  hashWorkspaceAction,
} = require('../src/services/workspace-action-policy');
const {
  executeWorkspaceActions,
  parseWorkspaceActions,
} = require('../src/services/workspace-request-helpers');
const {
  createAgentToolControlStreamFilter,
} = require('../src/services/agent-tool-action-envelope');
const { createWorkspaceExecutionState } = require('../src/services/workspace-tools/execution-state');

function workspaceToolEnvelope(actions, overrides = {}) {
  return JSON.stringify({
    type: 'agent_tool_actions',
    version: '1',
    mode: 'execute',
    actions,
    ...overrides,
  });
}

function enabledAuthority(overrides = {}) {
  return {
    enabled: true,
    policy: {
      proactiveEnabled: true,
      emailMonitoring: true,
      calendarMonitoring: true,
      emailOrganization: true,
      draftReplies: true,
      personalCalendarHolds: true,
      maxAutomaticBatchSize: 25,
      allowedAccounts: [],
      ...overrides,
    },
  };
}

test.before(async () => {
  await connect();
});

test.after(async () => {
  await WorkspaceActionApproval.deleteMany({});
  await WorkspaceActionRecord.deleteMany({});
  await disconnect();
});

test.beforeEach(async () => {
  await WorkspaceActionApproval.deleteMany({});
  await WorkspaceActionRecord.deleteMany({});
});

test('effective Google account is normalized before hashing, policy, and handler execution', async () => {
  const authority = enabledAuthority({ allowedAccounts: ['allowed@example.com'] });
  const state = createWorkspaceExecutionState({
    connectedGmailAccounts: ['ALLOWED@EXAMPLE.COM'],
    defaultGmailAccount: 'Allowed@Example.com',
  });
  let receivedParams = null;

  const [result] = await executeWorkspaceActions(
    [{ tool: 'gmail.search', params: { q: 'is:unread' } }],
    state,
    {
      authority,
      toolHandlers: {
        'gmail.search': async (params) => {
          receivedParams = params;
          return { ok: true, messages: [] };
        },
      },
    },
  );

  assert.equal(result.status, 'ok');
  assert.equal(receivedParams.account, 'allowed@example.com');
  assert.equal(
    hashWorkspaceAction('gmail.search', { q: 'is:unread', account: 'ALLOWED@EXAMPLE.COM' }),
    hashWorkspaceAction('gmail.search', { account: 'allowed@example.com', q: 'is:unread' }),
  );

  let disconnectedHandlerCalled = false;
  const [blocked] = await executeWorkspaceActions(
    [{ tool: 'gmail.search', params: { q: 'is:unread', account: 'allowed@example.com' } }],
    createWorkspaceExecutionState({ connectedGmailAccounts: [] }),
    {
      authority,
      toolHandlers: {
        'gmail.search': async () => {
          disconnectedHandlerCalled = true;
          return { ok: true };
        },
      },
    },
  );
  assert.equal(blocked.blocked, true);
  assert.match(blocked.error, /could not be verified as a connected Google account/i);
  assert.equal(disconnectedHandlerCalled, false);

  const [defaultPolicyBlocked] = await executeWorkspaceActions(
    [{ tool: 'gmail.search', params: { q: 'is:unread', account: 'not-connected@example.com' } }],
    createWorkspaceExecutionState({ connectedGmailAccounts: ['connected@example.com'] }),
    {
      authority: enabledAuthority(),
      toolHandlers: { 'gmail.search': async () => ({ ok: true }) },
    },
  );
  assert.equal(defaultPolicyBlocked.blocked, true);
  assert.match(defaultPolicyBlocked.error, /could not be verified as a connected Google account/i);
});

test('gmail.batchModify destructive addLabelNames alias requires confirmation before preparation', () => {
  const decision = evaluateWorkspaceAction(
    {
      tool: 'gmail.batchModify',
      params: { messageIds: ['m1'], addLabelNames: [' trash '] },
    },
    enabledAuthority(),
  );
  assert.equal(decision.decision, 'confirmation-required');
  assert.match(decision.reason, /destructive Gmail label/i);
});

test('Workspace parser accepts only an exact structured envelope and makes legacy ACTION text inert', async () => {
  const valid = parseWorkspaceActions(workspaceToolEnvelope([
    { tool: 'db.searchInvestigations', params: { query: 'valid', limit: 3 } },
  ]));
  assert.deepEqual(valid, [
    { tool: 'db.searchInvestigations', params: { query: 'valid', limit: 3 } },
  ]);

  const rejected = [
    {
      output: 'ACTION: {"tool":"db.searchInvestigations","params":{"query":"legacy"}}',
      code: 'LEGACY_ACTION_PROTOCOL_REJECTED',
    },
    {
      output: `Planning first.\n${workspaceToolEnvelope([{ tool: 'db.searchInvestigations', params: {} }])}`,
      code: 'TOOL_ACTION_ENVELOPE_NOT_STANDALONE',
    },
    {
      output: workspaceToolEnvelope([
        { tool: 'gmail.archive', params: { messageId: 'm1', surprise: true } },
      ]),
      code: 'TOOL_ACTION_PARAMS_SCHEMA_INVALID',
    },
    {
      output: workspaceToolEnvelope([
        { tool: 'calendar.createEvent', params: { summary: 'Missing times' } },
      ]),
      code: 'TOOL_ACTION_PARAMS_SCHEMA_INVALID',
    },
    {
      output: workspaceToolEnvelope([
        { tool: 'db.searchInvestigations', params: { query: 'valid' }, extra: true },
      ]),
      code: 'TOOL_ACTION_SHAPE_INVALID',
    },
    {
      output: workspaceToolEnvelope([
        { tool: 'not.a.workspace.tool', params: {} },
      ]),
      code: 'TOOL_ACTION_UNKNOWN_TOOL',
    },
  ];
  for (const fixture of rejected) {
    const parsed = parseWorkspaceActions(fixture.output);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].invalidOutput, true);
    assert.equal(parsed[0].code, fixture.code);
  }

  let validHandlerCalls = 0;
  const legacyAction = parseWorkspaceActions(rejected[0].output);
  const results = await executeWorkspaceActions(legacyAction, createWorkspaceExecutionState({}), {
    authority: enabledAuthority(),
    toolHandlers: {
      'db.searchInvestigations': async () => {
        validHandlerCalls += 1;
        return { ok: true, results: [] };
      },
    },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].invalidOutput, true);
  assert.equal(results[0].blocked, true);
  assert.equal(results[0].code, 'LEGACY_ACTION_PROTOCOL_REJECTED');
  assert.equal(validHandlerCalls, 0);
});

test('Workspace stream filter never exposes structured control JSON or legacy ACTION lines', () => {
  function runChunks(chunks) {
    const visible = [];
    const controls = [];
    const filter = createAgentToolControlStreamFilter({
      parseOptions: {
        knownToolNames: ['db.searchInvestigations'],
        maxActions: 6,
      },
      onVisibleText: (text) => visible.push(text),
      onControlDetected: (result) => controls.push(result),
    });
    for (const chunk of chunks) filter.push(chunk);
    const state = filter.finish();
    return { text: visible.join(''), controls, state };
  }

  const envelope = workspaceToolEnvelope([
    { tool: 'db.searchInvestigations', params: { query: 'hidden control' } },
  ]);
  const structured = runChunks([
    envelope.slice(0, 7),
    envelope.slice(7, 31),
    envelope.slice(31),
  ]);
  assert.equal(structured.text, '');
  assert.equal(structured.state.controlDetected, true);
  assert.equal(structured.controls[0].kind, 'actions');

  const wrapped = runChunks(['Visible lead. ', envelope.slice(0, 20), envelope.slice(20)]);
  assert.equal(wrapped.text, 'Visible lead. ');
  assert.equal(wrapped.state.controlDetected, true);

  const legacy = runChunks([
    'Visible lead.\nACT',
    'ION: {"tool":"db.searchInvestigations",',
    '"params":{}}\nVisible tail.',
  ]);
  assert.equal(legacy.text, 'Visible lead.\nVisible tail.');
  assert.equal(legacy.controls[0].code, 'LEGACY_ACTION_PROTOCOL_REJECTED');

  const prose = runChunks(['Ordinary prose with ', '{braces}', ' remains visible.']);
  assert.equal(prose.text, 'Ordinary prose with {braces} remains visible.');
  assert.equal(prose.state.controlDetected, false);
});

test('programmatic action execution revalidates params before handler dispatch', async () => {
  let handlerCalls = 0;
  const [result] = await executeWorkspaceActions(
    [{ tool: 'memory.delete', params: { key: 'valid-key', surprise: true } }],
    createWorkspaceExecutionState({}),
    {
      authority: enabledAuthority(),
      toolHandlers: {
        'memory.delete': async () => {
          handlerCalls += 1;
          return { ok: true };
        },
      },
    },
  );
  assert.equal(result.invalidOutput, true);
  assert.equal(result.blocked, true);
  assert.match(result.error, /unsupported parameter/i);
  assert.equal(handlerCalls, 0);
});

test('resolved ok:false handler result is execution failure, not success evidence', async () => {
  const [result] = await executeWorkspaceActions(
    [{ tool: 'memory.save', params: { type: 'fact', key: 'k', content: 'v' } }],
    createWorkspaceExecutionState({}),
    {
      authority: enabledAuthority(),
      toolHandlers: { 'memory.save': async () => ({ ok: false, error: 'store rejected write' }) },
    },
  );
  assert.equal(result.status, 'error');
  assert.match(result.error, /store rejected write/i);
  const evidence = await WorkspaceActionRecord.findOne({ tool: 'memory.save' }).lean();
  assert.equal(evidence.status, 'error');
});

test('calendar.createEvent is not blindly retried after a transient-looking failure', async () => {
  let calls = 0;
  const [result] = await executeWorkspaceActions(
    [{ tool: 'calendar.createEvent', params: { summary: 'Focus', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' } }],
    createWorkspaceExecutionState({
      connectedGmailAccounts: ['calendar@example.com'],
      defaultCalendarAccount: 'calendar@example.com',
    }),
    {
      authority: enabledAuthority(),
      toolHandlers: {
        'calendar.createEvent': async () => {
          calls += 1;
          throw new Error('503 timeout after submission');
        },
      },
    },
  );
  assert.equal(calls, 1);
  assert.match(result.error, /503 timeout/);
});

test('failure suppression is per execution and fingerprints include canonical parameter values', async () => {
  let calls = 0;
  const handler = async () => {
    calls += 1;
    throw new Error('deterministic failure');
  };
  const options = {
    authority: enabledAuthority(),
    toolHandlers: { 'db.searchInvestigations': handler },
  };
  const stateA = createWorkspaceExecutionState({});

  await executeWorkspaceActions([{ tool: 'db.searchInvestigations', params: { query: 'alpha' } }], stateA, options);
  await executeWorkspaceActions([{ tool: 'db.searchInvestigations', params: { query: 'alpha' } }], stateA, options);
  const [suppressed] = await executeWorkspaceActions([{ tool: 'db.searchInvestigations', params: { query: 'alpha' } }], stateA, options);
  assert.equal(suppressed.failFast, true);
  assert.equal(calls, 2);

  await executeWorkspaceActions([{ tool: 'db.searchInvestigations', params: { query: 'beta' } }], stateA, options);
  assert.equal(calls, 3, 'different parameter values must not collide');

  await executeWorkspaceActions(
    [{ tool: 'db.searchInvestigations', params: { query: 'alpha' } }],
    createWorkspaceExecutionState({}),
    options,
  );
  assert.equal(calls, 4, 'a new execution must not inherit process-global failures');
});

test('cancellation stops later actions and aborts with a deterministic code', async () => {
  let cancelled = false;
  let secondCalled = false;
  await assert.rejects(
    executeWorkspaceActions(
      [
        { tool: 'db.searchInvestigations', params: { query: 'first' } },
        { tool: 'db.getInvestigation', params: { invNumber: 'INV-2' } },
      ],
      createWorkspaceExecutionState({}),
      {
        authority: enabledAuthority(),
        shouldAbort: () => cancelled,
        toolHandlers: {
          'db.searchInvestigations': async () => {
            cancelled = true;
            return { ok: true };
          },
          'db.getInvestigation': async () => {
            secondCalled = true;
            return { ok: true };
          },
        },
      },
    ),
    (err) => err?.code === 'ABORTED',
  );
  assert.equal(secondCalled, false);
});

test('tool deadline aborts an abort-aware read and stops scheduling later actions', async () => {
  let signalSeen = false;
  let secondCalled = false;
  const results = await executeWorkspaceActions(
    [
      { tool: 'web.search', params: { query: 'public documentation' } },
      { tool: 'db.searchInvestigations', params: { query: 'should not run' } },
    ],
    createWorkspaceExecutionState({}),
    {
      authority: enabledAuthority(),
      perToolTimeoutMs: 10,
      toolHandlers: {
        'web.search': async (_params, { signal }) => new Promise((_resolve, reject) => {
          signalSeen = Boolean(signal);
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
        'db.searchInvestigations': async () => {
          secondCalled = true;
          return { ok: true };
        },
      },
    },
  );
  assert.equal(signalSeen, true);
  assert.equal(results.length, 1);
  assert.match(results[0].error, /timed out/i);
  assert.equal(results[0].outcomeUnknown, undefined);
  assert.equal(secondCalled, false);
});

test('write timeout is outcome-unknown, is not retried, and blocks the same write in-run', async () => {
  let calls = 0;
  const state = createWorkspaceExecutionState({
    connectedGmailAccounts: ['calendar@example.com'],
    defaultCalendarAccount: 'calendar@example.com',
  });
  const action = { tool: 'calendar.createEvent', params: { summary: 'Focus', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' } };
  const options = {
    authority: enabledAuthority(),
    perToolTimeoutMs: 10,
    toolHandlers: {
      'calendar.createEvent': async () => {
        calls += 1;
        return new Promise(() => {});
      },
    },
  };

  const [timedOut] = await executeWorkspaceActions([action], state, options);
  assert.equal(calls, 1);
  assert.equal(timedOut.status, 'outcome-unknown');
  assert.equal(timedOut.outcomeUnknown, true);
  assert.equal(timedOut.evidenceIncomplete, true);
  assert.equal(timedOut.retrySafe, false);
  const evidence = await WorkspaceActionRecord.findOne({ tool: 'calendar.createEvent' }).lean();
  assert.equal(evidence.status, 'outcome-unknown');

  const [suppressed] = await executeWorkspaceActions([action], state, options);
  assert.equal(suppressed.failFast, true);
  assert.equal(calls, 1);
});

test('external success with evidence persistence failure is reported as success with an evidence warning', async () => {
  const originalCreate = WorkspaceActionRecord.create;
  const originalConsoleError = console.error;
  WorkspaceActionRecord.create = async () => { throw new Error('evidence store unavailable'); };
  console.error = () => {};
  try {
    const [result] = await executeWorkspaceActions(
      [{ tool: 'db.searchInvestigations', params: { query: 'safe read' } }],
      createWorkspaceExecutionState({}),
      {
        authority: enabledAuthority(),
        toolHandlers: { 'db.searchInvestigations': async () => ({ ok: true, results: [] }) },
      },
    );
    assert.equal(result.status, 'ok');
    assert.equal(result.result.ok, true);
    assert.equal(result.evidenceIncomplete, true);
    assert.match(result.evidenceWarning, /succeeded.*evidence could not be saved/i);
  } finally {
    WorkspaceActionRecord.create = originalCreate;
    console.error = originalConsoleError;
  }
});
