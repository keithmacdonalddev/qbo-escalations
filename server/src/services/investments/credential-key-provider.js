'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const KEY_BYTES = 32;
const KEY_FILE_NAME = 'questrade-credential-key.v1';

const PROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$plain = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($plain)
$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$protected = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($bytes))
`;

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function invokePowerShell(script, input, options = {}) {
  const execFileFn = options.execFileFn || execFile;
  return new Promise((resolve, reject) => {
    const child = execFileFn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)],
      { windowsHide: true, timeout: options.timeoutMs || 10_000, maxBuffer: 8 * 1024 },
      (error, stdout) => {
        if (error) return reject(new Error('Windows could not unlock the local credential key.'));
        return resolve(String(stdout || '').trim());
      },
    );
    child.stdin.end(input);
  });
}

function defaultKeyPath(env = process.env) {
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'qbo-escalations', 'secure', KEY_FILE_NAME);
}

function readEnvironmentKey(env = process.env) {
  const raw = String(env.QUESTRADE_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) throw new Error('QUESTRADE_TOKEN_ENCRYPTION_KEY must contain exactly 32 base64-encoded bytes.');
  return key;
}

function createCredentialKeyProvider(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const keyPath = options.keyPath || defaultKeyPath(env);
  const readFile = options.readFile || fs.readFile;
  const writeFile = options.writeFile || fs.writeFile;
  const mkdir = options.mkdir || fs.mkdir;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const protect = options.protect || ((value) => invokePowerShell(PROTECT_SCRIPT, value, options));
  const unprotect = options.unprotect || ((value) => invokePowerShell(UNPROTECT_SCRIPT, value, options));

  function getStatus() {
    try {
      if (readEnvironmentKey(env)) return { available: true, source: 'environment' };
    } catch (error) {
      return { available: false, source: 'environment', reason: error.message };
    }
    if (platform !== 'win32') {
      return { available: false, source: 'unavailable', reason: 'Windows credential protection is unavailable on this computer.' };
    }
    return { available: true, source: 'windows-user-credential-store' };
  }

  async function loadKey() {
    const environmentKey = readEnvironmentKey(env);
    if (environmentKey) return environmentKey;
    if (platform !== 'win32') throw new Error('No supported local credential key store is available.');
    const protectedValue = (await readFile(keyPath, 'utf8')).trim();
    const decoded = Buffer.from(await unprotect(protectedValue), 'base64');
    if (decoded.length !== KEY_BYTES) throw new Error('The local credential key has an invalid length.');
    return decoded;
  }

  async function ensureKey() {
    const environmentKey = readEnvironmentKey(env);
    if (environmentKey) return environmentKey;
    if (platform !== 'win32') throw new Error('No supported local credential key store is available.');
    try {
      return await loadKey();
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const key = randomBytes(KEY_BYTES);
    const protectedValue = await protect(key.toString('base64'));
    await mkdir(path.dirname(keyPath), { recursive: true });
    await writeFile(keyPath, protectedValue, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return key;
  }

  return { ensureKey, getStatus, keyPath, loadKey };
}

module.exports = { KEY_FILE_NAME, createCredentialKeyProvider, defaultKeyPath, readEnvironmentKey };
