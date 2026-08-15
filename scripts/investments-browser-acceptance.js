#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const session = `qbo-investments-${process.pid}`;
const desktopShot = path.join(os.tmpdir(), `${session}-desktop.png`);
const mobileShot = path.join(os.tmpdir(), `${session}-mobile.png`);
let commandCounter = 0;

function resolveAgentBrowser() {
  if (process.platform !== 'win32') return 'agent-browser';
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const binary = path.join(appData, 'npm', 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
  return fs.existsSync(binary) ? binary : null;
}

function probe(url, timeoutMs = 2_000) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.once('timeout', () => { request.destroy(); resolve(false); });
    request.once('error', () => resolve(false));
  });
}

function mainRun(binary, args, options = {}) {
  commandCounter += 1;
  const outputPath = path.join(os.tmpdir(), `${session}-command-${commandCounter}.out`);
  const errorPath = path.join(os.tmpdir(), `${session}-command-${commandCounter}.err`);
  const outputFd = fs.openSync(outputPath, 'w');
  const errorFd = fs.openSync(errorPath, 'w');
  try {
    const result = spawnSync(binary, ['--session', session, ...args], {
      windowsHide: true,
      timeout: options.timeout || 45_000,
      stdio: ['ignore', outputFd, errorFd],
    });
    fs.closeSync(outputFd);
    fs.closeSync(errorFd);
    const output = fs.readFileSync(outputPath, 'utf8').trim();
    const errorOutput = fs.readFileSync(errorPath, 'utf8').trim();
    if (result.error || result.status !== 0) {
      throw new Error(`agent-browser ${args.join(' ')} failed: ${errorOutput || result.error?.message || `exit ${result.status}`}`);
    }
    return output;
  } finally {
    try { fs.closeSync(outputFd); } catch {}
    try { fs.closeSync(errorFd); } catch {}
    try { fs.rmSync(outputPath, { force: true }); } catch {}
    try { fs.rmSync(errorPath, { force: true }); } catch {}
  }
}

function snapshot(binary) {
  const result = JSON.parse(mainRun(binary, ['snapshot', '-i', '--json']));
  if (!result.success) throw new Error(result.error || 'Browser snapshot failed.');
  return result.data;
}

function findRef(data, role, namePattern) {
  const match = Object.entries(data.refs || {}).find(([, value]) => (
    value.role === role && namePattern.test(value.name || '')
  ));
  if (!match) {
    const available = Object.values(data.refs || {})
      .filter((value) => value.role === role)
      .map((value) => value.name || '(unnamed)')
      .slice(0, 12)
      .join(', ');
    throw new Error(`Could not find ${role} matching ${namePattern}. Available ${role}s: ${available || 'none'}.`);
  }
  return `@${match[0]}`;
}

function assertIncludes(value, expected, label) {
  if (!String(value).includes(expected)) throw new Error(`${label} did not include "${expected}".`);
}

function waitForBodyText(binary, expected, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const body = mainRun(binary, ['get', 'text', 'body']);
    if (body.includes(expected)) return body;
    mainRun(binary, ['wait', '150']);
  }
  throw new Error(`Rendered page did not show "${expected}" within the bounded wait.`);
}

async function main() {
  const binary = resolveAgentBrowser();
  if (!binary) {
    console.log('[investments-browser] incomplete: agent-browser is not installed.');
    process.exitCode = 124;
    return;
  }
  const [apiReady, webReady] = await Promise.all([
    probe('http://127.0.0.1:4000/api/health'),
    probe('http://localhost:5174/'),
  ]);
  if (!apiReady || !webReady) {
    console.log('[investments-browser] incomplete: the user-owned app is not running on configured ports 4000 and 5174.');
    process.exitCode = 124;
    return;
  }

  try {
    mainRun(binary, ['open', 'http://localhost:5174/#/settings']);
    mainRun(binary, ['wait', '--text', 'Settings']);
    const settings = snapshot(binary);
    mainRun(binary, ['click', findRef(settings, 'button', /^Connected Accounts/)]);
    mainRun(binary, ['wait', '--text', 'Questrade']);
    mainRun(binary, ['wait', '--text', 'Preview connection states']);

    let accounts = snapshot(binary);
    const previewRef = findRef(accounts, 'button', /^Preview Questrade connection states$/);
    const initiallyOpen = JSON.parse(mainRun(binary, ['eval', `document.querySelector('.questrade-preview-tools').open`]));
    if (initiallyOpen) throw new Error('Simulation controls should be collapsed in the normal account view.');
    mainRun(binary, ['click', previewRef]);
    mainRun(binary, ['wait', '150']);
    const openedForTesting = JSON.parse(mainRun(binary, ['eval', `document.querySelector('.questrade-preview-tools').open`]));
    if (!openedForTesting) throw new Error('Simulation controls did not open for Stage 1 testing.');
    const renderedSelect = JSON.parse(mainRun(binary, ['eval', `(() => { const select = document.querySelector('.questrade-scenario-control select'); const rect = select?.getBoundingClientRect(); return { label: select?.getAttribute('aria-label'), width: rect?.width || 0, height: rect?.height || 0 }; })()`]));
    if (renderedSelect.label !== 'Simulated Questrade state' || renderedSelect.width <= 0 || renderedSelect.height <= 0) {
      throw new Error('The disclosed simulated-state selector is not visibly rendered with its accessible name.');
    }
    mainRun(binary, ['select', '.questrade-scenario-control select', 'disconnected']);
    let body = waitForBodyText(binary, 'Questrade is not connected');
    accounts = snapshot(binary);
    mainRun(binary, ['click', findRef(accounts, 'button', /^Preview Questrade connection states$/)]);
    accounts = snapshot(binary);
    assertIncludes(body, 'Margin account · Simulated preview', 'Desktop account card');
    assertIncludes(body, 'Questrade is not connected', 'Disconnected fixture');
    const desktopLayout = JSON.parse(mainRun(binary, ['eval', `(() => { const cards = [...document.querySelectorAll('.settings-accounts-grid > .settings-accounts-card')].map((card) => card.getBoundingClientRect()); return { count: cards.length, topDelta: cards.length > 1 ? Math.abs(cards[0].top - cards[1].top) : null, columns: getComputedStyle(document.querySelector('.settings-accounts-grid')).gridTemplateColumns }; })()`]));
    if (desktopLayout.count < 2 || desktopLayout.topDelta > 2 || desktopLayout.columns.split(' ').length < 2) {
      throw new Error('Compact providers are not presented as equal desktop peers.');
    }
    mainRun(binary, ['screenshot', desktopShot]);
    if (!fs.existsSync(desktopShot) || fs.statSync(desktopShot).size === 0) throw new Error('Desktop screenshot was not created.');

    mainRun(binary, ['click', findRef(accounts, 'button', /^Preview Questrade connection states$/)]);
    mainRun(binary, ['wait', '150']);

    const scenarios = [
      ['healthy-margin', 'margin-demo-01'],
      ['token-expired', 'Reauthorization required'],
      ['malicious-api-server', 'Unsafe server blocked'],
      ['locked', 'Credential locked'],
      ['key-store-unavailable', 'Credential protection unavailable'],
      ['service-unavailable', 'Previous complete snapshot preserved'],
      ['disconnected', 'Questrade is not connected'],
    ];
    for (const [scenario, expected] of scenarios) {
      mainRun(binary, ['select', '.questrade-scenario-control select', scenario]);
      body = waitForBodyText(binary, expected);
      assertIncludes(body, expected, scenario);
    }

    const network = JSON.parse(mainRun(binary, ['network', 'requests', '--json']));
    const requests = network.data?.requests || [];
    if (requests.some((entry) => /questrade\.com/i.test(entry.url || ''))) {
      throw new Error('A simulated browser journey contacted a questrade.com host.');
    }
    if (!requests.some((entry) => /\/api\/investments\/providers\/questrade\//.test(entry.url || ''))) {
      throw new Error('The Investments browser route was not observed.');
    }

    mainRun(binary, ['set', 'viewport', '390', '844', '2']);
    mainRun(binary, ['set', 'media', 'dark', 'reduced-motion']);
    mainRun(binary, ['wait', '--text', 'Connected Accounts']);
    mainRun(binary, ['screenshot', '--full', mobileShot]);
    if (!fs.existsSync(mobileShot) || fs.statSync(mobileShot).size === 0) throw new Error('Mobile screenshot was not created.');
    const bounds = JSON.parse(mainRun(binary, ['eval', `(() => { const r = document.querySelector('.questrade-account-card').getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth, pageWidth: document.documentElement.scrollWidth }; })()`]));
    if (bounds.left < 0 || bounds.right > bounds.width + 1) throw new Error('The Questrade card overflows the mobile viewport.');
    if (bounds.pageWidth > bounds.width + 1) throw new Error('Connected Accounts creates horizontal page overflow on mobile.');
    const mobileColumns = JSON.parse(mainRun(binary, ['eval', `getComputedStyle(document.querySelector('.settings-accounts-grid')).gridTemplateColumns`]));
    if (mobileColumns.split(' ').length !== 1) throw new Error('Connected Accounts did not collapse to one mobile column.');

    const errors = mainRun(binary, ['errors']);
    if (errors) throw new Error(`Browser page errors were reported: ${errors.slice(0, 500)}`);
    const consoleOutput = mainRun(binary, ['console']);
    if (/\[(?:error|warning)\]/i.test(consoleOutput)) throw new Error('Browser console contains an error or warning.');

    console.log('[investments-browser] passed: desktop, mobile, reduced-motion, all seven fixtures, console, and no-live-Questrade network checks.');
  } catch (error) {
    console.error(`[investments-browser] failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    try { mainRun(binary, ['close'], { timeout: 10_000 }); } catch {}
    for (const file of [desktopShot, mobileShot]) {
      try { fs.rmSync(file, { force: true }); } catch {}
    }
  }
}

void main();
