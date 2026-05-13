'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ASSETS_DIR = path.join(ROOT, 'client', 'dist', 'assets');

const LIMITS = {
  initialJsBytes: 400 * 1024,
  initialCssBytes: 460 * 1024,
  maxJsChunkBytes: 500 * 1024,
};

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function listAssetFiles(extension) {
  assert.ok(fs.existsSync(ASSETS_DIR), `Missing ${ASSETS_DIR}. Run npm --prefix client run build first.`);
  return fs.readdirSync(ASSETS_DIR)
    .filter((name) => name.endsWith(extension))
    .map((name) => {
      const filePath = path.join(ASSETS_DIR, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        bytes: stat.size,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

function findInitialAsset(files, extension) {
  const matches = files.filter((file) => file.name.startsWith('index-') && file.name.endsWith(extension));
  assert.equal(matches.length, 1, `Expected one initial ${extension} asset, found ${matches.length}: ${matches.map((file) => file.name).join(', ')}`);
  return matches[0];
}

function assertUnderLimit(asset, limit, label) {
  assert.ok(
    asset.bytes <= limit,
    `${label} is ${formatBytes(asset.bytes)}, above ${formatBytes(limit)} (${asset.name})`
  );
}

function main() {
  const jsFiles = listAssetFiles('.js');
  const cssFiles = listAssetFiles('.css');
  const initialJs = findInitialAsset(jsFiles, '.js');
  const initialCss = findInitialAsset(cssFiles, '.css');
  const largestJs = jsFiles[0];

  assertUnderLimit(initialJs, LIMITS.initialJsBytes, 'Initial JS bundle');
  assertUnderLimit(initialCss, LIMITS.initialCssBytes, 'Initial CSS bundle');
  assertUnderLimit(largestJs, LIMITS.maxJsChunkBytes, 'Largest JS chunk');

  console.log(JSON.stringify({
    ok: true,
    limits: {
      initialJs: formatBytes(LIMITS.initialJsBytes),
      initialCss: formatBytes(LIMITS.initialCssBytes),
      maxJsChunk: formatBytes(LIMITS.maxJsChunkBytes),
    },
    observed: {
      initialJs: {
        name: initialJs.name,
        size: formatBytes(initialJs.bytes),
      },
      initialCss: {
        name: initialCss.name,
        size: formatBytes(initialCss.bytes),
      },
      largestJs: {
        name: largestJs.name,
        size: formatBytes(largestJs.bytes),
      },
    },
  }, null, 2));
}

main();
