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

function clickVisibleButtonByText(binary, text) {
  const script = `(() => { const target = [...document.querySelectorAll('button')].find((button) => button.offsetParent && button.textContent.trim() === ${JSON.stringify(text)}); if (!target) return false; target.click(); return true; })()`;
  if (JSON.parse(mainRun(binary, ['eval', script])) !== true) {
    throw new Error(`Could not click the visible "${text}" button.`);
  }
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

    let accounts = snapshot(binary);
    mainRun(binary, ['click', findRef(accounts, 'button', /^Open Questrade$/)]);
    let detail = snapshot(binary);
    findRef(detail, 'button', /^Close Questrade account settings$/);
    const body = mainRun(binary, ['get', 'text', 'body']);
    assertIncludes(body, 'Questrade', 'Live Questrade detail');
    if (body.includes('Simulated data')) throw new Error('The normal Questrade connection journey is showing simulator wording.');
    const initialTokenField = JSON.parse(mainRun(binary, ['eval', `Boolean(document.querySelector('input[aria-label="Questrade token"], input[type="password"]'))`]));
    if (initialTokenField) throw new Error('The token field appeared before the user chose Connect Questrade.');
    if (body.includes('Connect your Margin account')) {
      mainRun(binary, ['click', findRef(detail, 'button', /^Connect Questrade/)]);
      const tokenInput = JSON.parse(mainRun(binary, ['eval', `(() => { const input = [...document.querySelectorAll('input')].find((node) => node.labels?.[0]?.textContent?.includes('Authorization token')); return { found: Boolean(input), type: input?.type, value: input?.value }; })()`]));
      if (!tokenInput.found || tokenInput.type !== 'password' || tokenInput.value !== '') throw new Error('The one-time token field is not a blank masked input.');
      detail = snapshot(binary);
      mainRun(binary, ['click', findRef(detail, 'button', /^Cancel$/)]);
    } else {
      assertIncludes(body, 'Connected', 'Live saved Questrade detail');
      assertIncludes(body, 'Margin account', 'Live saved Questrade detail');
    }
    detail = snapshot(binary);
    mainRun(binary, ['click', findRef(detail, 'button', /^Close Questrade account settings$/)]);
    mainRun(binary, ['wait', '--text', 'Connected Accounts']);
    mainRun(binary, ['screenshot', desktopShot]);
    if (!fs.existsSync(desktopShot) || fs.statSync(desktopShot).size === 0) throw new Error('Desktop screenshot was not created.');

    const overview = snapshot(binary);
    mainRun(binary, ['click', findRef(overview, 'button', /^Developer Tools/)]);
    mainRun(binary, ['wait', '--text', 'Questrade Simulation']);
    const renderedSelect = JSON.parse(mainRun(binary, ['eval', `(() => { const select = document.querySelector('.questrade-scenario-control select'); const rect = select?.getBoundingClientRect(); return { label: select?.getAttribute('aria-label'), width: rect?.width || 0, height: rect?.height || 0 }; })()`]));
    if (renderedSelect.label !== 'Simulated Questrade state' || renderedSelect.width <= 0 || renderedSelect.height <= 0) {
      throw new Error('Developer Tools does not visibly contain the accessible Questrade simulator.');
    }

    const scenarios = [
      ['healthy-margin', 'Connected'],
      ['choose-account', 'Choose the account to use'],
      ['partial-access', 'Some account services need attention'],
      ['offline', 'Questrade could not be reached'],
      ['rate-limited', 'Questrade asked the app to wait'],
      ['token-expired', 'Authorization needs renewal'],
      ['revocation-pending', 'Questrade could not confirm revocation'],
      ['malicious-api-server', 'Unsafe connection blocked'],
      ['locked', 'Credential access is locked'],
      ['key-store-unavailable', 'Secure storage is unavailable'],
      ['service-unavailable', 'Questrade is temporarily unavailable'],
      ['disconnected', 'Connect your Margin account'],
    ];
    for (const [scenario, expected] of scenarios) {
      mainRun(binary, ['select', '.questrade-scenario-control select', scenario]);
      assertIncludes(waitForBodyText(binary, expected), expected, scenario);
    }

    console.log('[investments-browser] Stage 2 fixtures rendered; checking safe account selection.');
    mainRun(binary, ['select', '.questrade-scenario-control select', 'choose-account']);
    let simulation = snapshot(binary);
    clickVisibleButtonByText(binary, 'Margin account 2Active›');
    assertIncludes(waitForBodyText(binary, 'Connected'), 'Connected', 'safe account selection');

    console.log('[investments-browser] Safe account selection passed; checking reauthorization.');
    mainRun(binary, ['select', '.questrade-scenario-control select', 'token-expired']);
    simulation = snapshot(binary);
    clickVisibleButtonByText(binary, 'Reconnect Questrade…');
    mainRun(binary, ['fill', '.questrade-token-form input', 'stage2-safe-sample']);
    simulation = snapshot(binary);
    clickVisibleButtonByText(binary, 'Renew authorization');
    assertIncludes(waitForBodyText(binary, 'Connected'), 'Connected', 'safe reauthorization');

    console.log('[investments-browser] Safe reauthorization passed; checking retry.');
    mainRun(binary, ['select', '.questrade-scenario-control select', 'offline']);
    simulation = snapshot(binary);
    clickVisibleButtonByText(binary, 'Try again');
    assertIncludes(waitForBodyText(binary, 'Connected'), 'Connected', 'safe verification retry');

    console.log('[investments-browser] Safe retry passed; checking disconnect.');
    mainRun(binary, ['select', '.questrade-scenario-control select', 'healthy-margin']);
    simulation = snapshot(binary);
    clickVisibleButtonByText(binary, 'Disconnect Questrade…');
    simulation = snapshot(binary);
    clickVisibleButtonByText(binary, 'Disconnect');
    assertIncludes(waitForBodyText(binary, 'Connect your Margin account'), 'Connect your Margin account', 'safe disconnect');

    console.log('[investments-browser] Safe disconnect passed; checking revocation retry.');
    mainRun(binary, ['select', '.questrade-scenario-control select', 'revocation-pending']);
    simulation = snapshot(binary);
    clickVisibleButtonByText(binary, 'Retry revocation');
    assertIncludes(waitForBodyText(binary, 'Connect your Margin account'), 'Connect your Margin account', 'safe revocation retry');

    const network = JSON.parse(mainRun(binary, ['network', 'requests', '--json']));
    const requests = network.data?.requests || [];
    if (requests.some((entry) => /questrade\.com/i.test(entry.url || ''))) {
      throw new Error('A simulated browser journey contacted a questrade.com host.');
    }
    if (!requests.some((entry) => /\/api\/investments\/providers\/questrade\//.test(entry.url || ''))) {
      throw new Error('The Investments browser route was not observed.');
    }

    const developerTools = snapshot(binary);
    mainRun(binary, ['click', findRef(developerTools, 'button', /^Connected Accounts/)]);
    mainRun(binary, ['set', 'viewport', '390', '844', '2']);
    mainRun(binary, ['set', 'media', 'dark', 'reduced-motion']);
    mainRun(binary, ['wait', '--text', 'Connected Accounts']);
    accounts = snapshot(binary);
    mainRun(binary, ['click', findRef(accounts, 'button', /^Open Questrade$/)]);
    detail = snapshot(binary);
    findRef(detail, 'button', /^Close Questrade account settings$/);
    mainRun(binary, ['screenshot', '--full', mobileShot]);
    if (!fs.existsSync(mobileShot) || fs.statSync(mobileShot).size === 0) throw new Error('Mobile screenshot was not created.');
    const bounds = JSON.parse(mainRun(binary, ['eval', `(() => { const r = document.querySelector('.settings-account-sheet').getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth, pageWidth: document.documentElement.scrollWidth }; })()`]));
    if (bounds.left < 0 || bounds.right > bounds.width + 1) throw new Error('The Questrade settings sheet overflows the mobile viewport.');
    if (bounds.pageWidth > bounds.width + 1) throw new Error('Connected Accounts creates horizontal page overflow on mobile.');

    const errors = mainRun(binary, ['errors']);
    if (errors) throw new Error(`Browser page errors were reported: ${errors.slice(0, 500)}`);
    const consoleOutput = mainRun(binary, ['console']);
    if (/\[(?:error|warning)\]/i.test(consoleOutput)) throw new Error('Browser console contains an error or warning.');

    console.log('[investments-browser] passed: live connection boundary without mutation, desktop, mobile, reduced-motion, Stage 2 development fixtures and recovery journeys, console, and no-live-Questrade network checks.');
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
