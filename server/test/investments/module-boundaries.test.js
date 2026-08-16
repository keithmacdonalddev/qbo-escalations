'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_SRC = path.join(ROOT, 'server', 'src');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');

function visit(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? visit(absolute) : [absolute];
  });
}

function isInside(file, directory) {
  const relative = path.relative(directory, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveLocalImport(sourceFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(sourceFile), specifier);
  const candidates = [base, `${base}.js`, `${base}.jsx`, `${base}.css`, path.join(base, 'index.js')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || base;
}

function listImportSpecifiers(file) {
  const source = fs.readFileSync(file, 'utf8');
  const specifiers = [];
  for (const pattern of [
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ]) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

const SERVER_OWNED_ROOTS = [
  path.join(SERVER_SRC, 'modules', 'investments'),
  path.join(SERVER_SRC, 'routes', 'investments'),
  path.join(SERVER_SRC, 'services', 'investments'),
];
const SERVER_OWNED_FILES = new Set([
  path.join(SERVER_SRC, 'models', 'QuestradeConnection.js'),
  path.join(SERVER_SRC, 'models', 'InvestmentAccount.js'),
  path.join(SERVER_SRC, 'models', 'InvestmentSyncRun.js'),
  path.join(SERVER_SRC, 'models', 'InvestmentSnapshot.js'),
  path.join(SERVER_SRC, 'services', 'investment-account-events.js'),
  path.join(SERVER_SRC, 'services', 'realtime-channels', 'investment-account.js'),
]);
const SERVER_SHARED_ALLOWLIST = new Set([path.join(SERVER_SRC, 'lib', 'field-encryption.js')]);

const CLIENT_OWNED_ROOTS = [path.join(CLIENT_SRC, 'components', 'investments')];
const CLIENT_OWNED_FILES = new Set([
  path.join(CLIENT_SRC, 'api', 'investments.js'),
  path.join(CLIENT_SRC, 'hooks', 'useQuestradeConnection.js'),
  path.join(CLIENT_SRC, 'hooks', 'useInvestmentSnapshotWorkbench.js'),
]);
const CLIENT_SHARED_ALLOWLIST = new Set([
  path.join(CLIENT_SRC, 'api', 'http.js'),
  path.join(CLIENT_SRC, 'api', 'realtime.js'),
  path.join(CLIENT_SRC, 'components', 'connected-accounts', 'AnchoredSettingsControl.jsx'),
  path.join(CLIENT_SRC, 'components', 'connected-accounts', 'ConnectedAccountCard.jsx'),
]);

function isOwned(file, roots, files) {
  return files.has(file) || roots.some((root) => isInside(file, root));
}

test('Investments source imports only owned code and reviewed shared seams', () => {
  const serverOwned = visit(SERVER_SRC).filter((file) => isOwned(file, SERVER_OWNED_ROOTS, SERVER_OWNED_FILES));
  for (const file of serverOwned.filter((value) => value.endsWith('.js'))) {
    for (const specifier of listImportSpecifiers(file)) {
      const resolved = resolveLocalImport(file, specifier);
      if (!resolved || !isInside(resolved, SERVER_SRC)) continue;
      assert.ok(
        isOwned(resolved, SERVER_OWNED_ROOTS, SERVER_OWNED_FILES) || SERVER_SHARED_ALLOWLIST.has(resolved),
        `${path.relative(ROOT, file)} imports unapproved shared or domain code: ${path.relative(ROOT, resolved)}`,
      );
    }
  }

  const clientOwned = visit(CLIENT_SRC).filter((file) => isOwned(file, CLIENT_OWNED_ROOTS, CLIENT_OWNED_FILES));
  for (const file of clientOwned.filter((value) => /\.(?:js|jsx)$/.test(value))) {
    for (const specifier of listImportSpecifiers(file)) {
      const resolved = resolveLocalImport(file, specifier);
      if (!resolved || !isInside(resolved, CLIENT_SRC)) continue;
      assert.ok(
        isOwned(resolved, CLIENT_OWNED_ROOTS, CLIENT_OWNED_FILES) || CLIENT_SHARED_ALLOWLIST.has(resolved),
        `${path.relative(ROOT, file)} imports unapproved shared or domain code: ${path.relative(ROOT, resolved)}`,
      );
    }
  }
});

test('shared app files use only the public Investments entry points', () => {
  const serverApp = fs.readFileSync(path.join(SERVER_SRC, 'app.js'), 'utf8');
  assert.match(serverApp, /require\(['"]\.\/modules\/investments['"]\)/);
  assert.doesNotMatch(serverApp, /routes\/investments|services\/investments|QuestradeConnection/);

  const settings = fs.readFileSync(path.join(CLIENT_SRC, 'components', 'Settings.jsx'), 'utf8');
  assert.match(settings, /from ['"]\.\/investments\/index\.js['"]/);
  assert.doesNotMatch(settings, /hooks\/useQuestradeConnection|investments\/QuestradeConnectedAccount/);

  const routesRoot = path.join(SERVER_SRC, 'routes');
  for (const file of visit(routesRoot).filter((value) => value.endsWith('.js'))) {
    if (isInside(file, path.join(routesRoot, 'investments'))) continue;
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /(?:\/api\/investments|providers\/questrade|questrade[^@\s]*\.(?:com|ca))/i,
      `${path.relative(ROOT, file)} contains an Investments or Questrade provider route outside Investments ownership.`,
    );
  }
});

test('creating the public server module performs no lifecycle or storage work', () => {
  const modulePath = path.join(SERVER_SRC, 'modules', 'investments');
  const probe = `
    process.env.NODE_ENV = 'test';
    const fs = require('node:fs');
    const fsp = require('node:fs/promises');
    const http = require('node:http');
    const https = require('node:https');
    const net = require('node:net');
    const tls = require('node:tls');
    const childProcess = require('node:child_process');
    const blocked = (name) => () => { throw new Error(name + ' was called during module registration'); };
    fs.writeFileSync = blocked('fs.writeFileSync');
    fsp.writeFile = blocked('fs.promises.writeFile');
    http.request = blocked('http.request');
    https.request = blocked('https.request');
    net.connect = blocked('net.connect');
    tls.connect = blocked('tls.connect');
    childProcess.execFile = blocked('child_process.execFile');
    global.setTimeout = blocked('setTimeout');
    global.setInterval = blocked('setInterval');
    const investments = require(${JSON.stringify(modulePath)}).createInvestmentsModule();
    if (investments.apiBasePath !== '/api/investments' || typeof investments.router !== 'function') process.exit(3);
  `;
  const result = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, encoding: 'utf8', timeout: 10_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'Investments module probe failed.');
});
