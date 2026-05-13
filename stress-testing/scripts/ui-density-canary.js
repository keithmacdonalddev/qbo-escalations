'use strict';

const assert = require('node:assert/strict');

const {
  closeSession,
  runAgentBrowserBatch,
  startClientDevServer,
} = require('./agent-browser-utils');

const DESKTOP = { width: 1868, height: 869 };
const MOBILE = { width: 390, height: 844 };
const DOCK_WIDTH_BY_MODE = {
  chat: 320,
  workspace: 304,
  standard: 296,
  dense: 280,
};

const ROUTES = [
  { id: 'workspace', hash: '#/workspace', dockMode: 'workspace' },
  { id: 'workspace-inbox', hash: '#/workspace/inbox', dockMode: 'workspace' },
  { id: 'workspace-calendar', hash: '#/workspace/calendar', dockMode: 'workspace' },
  { id: 'usage', hash: '#/usage', dockMode: 'dense' },
  { id: 'analytics', hash: '#/analytics', dockMode: 'dense' },
  { id: 'templates', hash: '#/templates', dockMode: 'dense' },
  { id: 'playbook', hash: '#/playbook', dockMode: 'dense' },
  { id: 'agent-profile', hash: '#/agents/escalation-template-parser', dockMode: 'dense' },
  { id: 'investigations', hash: '#/investigations', dockMode: 'dense' },
  { id: 'chat', hash: '#/chat', dockMode: 'chat' },
];

const CASE_TEMPLATE = [
  'COID/MID: 123456',
  'CASE: 1514487',
  'CLIENT/CONTACT: Bassam Ibrahim',
  'CX IS ATTEMPTING TO: Remove or stop CPP deductions for all active employees and two terminated employees.',
  'EXPECTED OUTCOME: CPP should not be deducted from payroll for these employees.',
  'ACTUAL OUTCOME: CPP is still calculating and the employee profile does not clearly show why.',
  'KB/TOOLS USED: Payroll settings, employee tax setup, test account.',
  'TRIED TEST ACCOUNT: Yes',
  'TS STEPS: Confirm CPP exemption status, compare expected versus actual employee tax setup, document blocked controls.',
].join('\n');

const CASE_MESSAGES = [
  {
    role: 'user',
    content: CASE_TEMPLATE,
    timestamp: '2026-05-13T00:00:00.000Z',
  },
  {
    role: 'assistant',
    content: [
      '1. What the Agent Is Attempting',
      '',
      'The customer is trying to remove CPP deductions but the expected and actual payroll outcomes conflict. Confirm whether CPP should be exempted, stopped for future payroll, or corrected for prior runs.',
      '',
      'Immediate next step: ask for the exact blocker shown in the employee profile and whether payroll has already been processed for the affected employees.',
    ].join('\n'),
    provider: 'codex',
    modelUsed: 'gpt-5.5',
    responseTimeMs: 1200,
    usage: {
      totalTokens: 1240,
    },
    timestamp: '2026-05-13T00:00:04.000Z',
  },
];

function trimBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function makeUrl(baseUrl, hash) {
  return `${trimBaseUrl(baseUrl)}/${hash}`;
}

function encodeScript(script) {
  return Buffer.from(script, 'utf8').toString('base64');
}

function unwrapBatchResultValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return value.result;
    }
    if (Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, 'url')) {
      return value.url;
    }
  }
  return value;
}

function metricsScript() {
  return `(() => {
    const q = (selector) => document.querySelector(selector);
    const qa = (selector) => Array.from(document.querySelectorAll(selector));
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
        right: Math.round(b.right),
        bottom: Math.round(b.bottom),
      };
    };
    const visible = (el) => {
      const b = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const badNativeControls = qa('input, textarea, select').filter((el) => {
      if (!visible(el)) return false;
      const style = getComputedStyle(el);
      const whiteBg = style.backgroundColor === 'rgb(255, 255, 255)';
      const blackText = style.color === 'rgb(0, 0, 0)';
      return whiteBg || blackText;
    }).map((el) => ({
      tag: el.tagName,
      type: el.getAttribute('type') || '',
      className: String(el.className || ''),
      value: el.value || el.placeholder || '',
    })).slice(0, 8);
    const dock = q('.app-global-dock-wrapper');
    const main = q('.app-shell-main-column');
    const shell = q('.app-shell-body');
    const workflow = q('.case-workflow-surface');
    return {
      hash: window.location.hash,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      dockMode: dock?.dataset?.dockMode || '',
      dock: rect(dock),
      main: rect(main),
      shell: rect(shell),
      badNativeControls,
      caseWorkflow: rect(workflow),
      caseWorkflowCount: qa('.case-workflow-surface').filter(visible).length,
      pageText: document.body.innerText.slice(0, 500),
    };
  })()`;
}

function seedCaseWorkflowScript() {
  return `(() => {
    const messages = ${JSON.stringify(CASE_MESSAGES)};
    sessionStorage.setItem('qbo-chat-messages', JSON.stringify(messages));
    sessionStorage.removeItem('qbo-chat-conversationId');
    sessionStorage.setItem('qbo-chat-route', '#/chat');
    window.location.hash = '#/chat';
    window.location.reload();
    return true;
  })()`;
}

function createCommand(label, args) {
  return { label, args };
}

function createEval(label, script) {
  return createCommand(label, ['eval', '-b', encodeScript(script)]);
}

function buildViewportCommands(baseUrl, viewport, prefix) {
  const commands = [
    createCommand(null, ['set', 'viewport', String(viewport.width), String(viewport.height)]),
  ];

  for (const route of ROUTES) {
    commands.push(
      createCommand(null, ['open', makeUrl(baseUrl, route.hash)]),
      createCommand(null, ['wait', '--fn', "Boolean(document.querySelector('.app-shell-body')) && document.body.innerText.length > 0"]),
      createEval(`${prefix}:${route.id}`, metricsScript())
    );
  }

  return commands;
}

function buildCaseWorkflowCommands(baseUrl) {
  return [
    createCommand(null, ['set', 'viewport', String(DESKTOP.width), String(DESKTOP.height)]),
    createCommand(null, ['open', makeUrl(baseUrl, '#/chat')]),
    createCommand(null, ['wait', '--fn', "Boolean(document.querySelector('.app-shell-body'))"]),
    createEval('case:seeded', seedCaseWorkflowScript()),
    createCommand(null, ['wait', '--fn', "Boolean(document.querySelector('.case-workflow-surface'))"]),
    createEval('case:metrics', metricsScript()),
  ];
}

function collectOutputs(commandSpecs, batchResult) {
  const outputs = {};
  commandSpecs.forEach((spec, index) => {
    if (!spec.label) return;
    outputs[spec.label] = unwrapBatchResultValue(batchResult?.parsed?.[index]?.result ?? null);
  });
  return outputs;
}

function findBatchFailure(entries) {
  return Array.isArray(entries)
    ? entries.find((entry) => entry?.success === false) || null
    : null;
}

function assertRouteMetrics(metrics, route, viewport) {
  assert.ok(metrics, `${route.id} produced no metrics`);
  assert.ok(metrics.overflowX <= 1, `${route.id} has horizontal overflow: ${metrics.overflowX}px`);
  assert.equal(metrics.badNativeControls.length, 0, `${route.id} has native-looking controls: ${JSON.stringify(metrics.badNativeControls)}`);
  assert.ok(metrics.main?.w > 0, `${route.id} did not render a main content column`);

  if (viewport.width >= 900) {
    assert.equal(metrics.dockMode, route.dockMode, `${route.id} dock mode mismatch`);
    const expectedDockWidth = DOCK_WIDTH_BY_MODE[route.dockMode];
    assert.ok(metrics.dock?.w > 0, `${route.id} did not render the global dock`);
    assert.ok(
      Math.abs(metrics.dock.w - expectedDockWidth) <= 4,
      `${route.id} dock width ${metrics.dock.w}px did not match ${expectedDockWidth}px ${route.dockMode} mode`
    );
    assert.ok(
      metrics.main.right <= metrics.dock.x + 2,
      `${route.id} main column overlaps the dock: main right ${metrics.main.right}, dock x ${metrics.dock.x}`
    );
  }
}

function assertViewportOutputs(outputs, viewport, prefix) {
  return ROUTES.map((route) => {
    const metrics = outputs[`${prefix}:${route.id}`];
    assertRouteMetrics(metrics, route, viewport);
    return {
      route: route.id,
      overflowX: metrics.overflowX,
      dockMode: metrics.dockMode,
      dockWidth: metrics.dock?.w || 0,
      badNativeControlCount: metrics.badNativeControls.length,
    };
  });
}

function assertCaseWorkflowMetrics(metrics) {
  assert.ok(metrics, 'case workflow produced no metrics');
  assert.ok(metrics.caseWorkflowCount >= 1, 'case workflow fixture did not render the workflow surface');
  assert.ok(metrics.caseWorkflow?.h > 0, 'case workflow surface has no visible height');
  assert.ok(metrics.caseWorkflow.h <= 620, `case workflow surface is too tall: ${metrics.caseWorkflow.h}px`);
  assert.ok(metrics.overflowX <= 1, `case workflow has horizontal overflow: ${metrics.overflowX}px`);
  assert.equal(metrics.badNativeControls.length, 0, `case workflow has native-looking controls: ${JSON.stringify(metrics.badNativeControls)}`);
}

async function runCanary(baseUrl, session) {
  const commandSpecs = [
    ...buildViewportCommands(baseUrl, DESKTOP, 'desktop'),
    ...buildViewportCommands(baseUrl, MOBILE, 'mobile'),
    ...buildCaseWorkflowCommands(baseUrl),
  ];
  const batchResult = await runAgentBrowserBatch(session, commandSpecs.map((spec) => spec.args), {
    bail: false,
  });
  const failure = findBatchFailure(batchResult.parsed);
  if (failure) {
    throw new Error(`${failure.command.join(' ')}: ${failure.error}`);
  }

  const outputs = collectOutputs(commandSpecs, batchResult);
  const desktop = assertViewportOutputs(outputs, DESKTOP, 'desktop');
  const mobile = assertViewportOutputs(outputs, MOBILE, 'mobile');
  const caseWorkflow = outputs['case:metrics'];
  assertCaseWorkflowMetrics(caseWorkflow);

  return {
    desktop,
    mobile,
    caseWorkflow: {
      height: caseWorkflow.caseWorkflow?.h || 0,
      overflowX: caseWorkflow.overflowX,
    },
  };
}

async function main() {
  const session = `ui-density-${Date.now()}`;
  let client = null;
  const baseUrl = process.env.UI_DENSITY_BASE_URL
    ? trimBaseUrl(process.env.UI_DENSITY_BASE_URL)
    : null;

  try {
    const resolvedBaseUrl = baseUrl || (client = await startClientDevServer({
      proxyTarget: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:4000',
    })).baseUrl;

    const result = await runCanary(resolvedBaseUrl, session);
    console.log(JSON.stringify({
      ok: true,
      baseUrl: resolvedBaseUrl,
      ...result,
    }, null, 2));
  } finally {
    await closeSession(session);
    if (client) {
      await client.stop();
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
}

module.exports = {
  runCanary,
  ROUTES,
};
