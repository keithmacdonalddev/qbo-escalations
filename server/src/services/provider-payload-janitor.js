'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const ProviderCallPackage = require('../models/ProviderCallPackage');
const { getDefaultPayloadRoot } = require('./provider-call-package-payload-store');

const DATE_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PACKAGE_ID_PATTERN = /^[a-f0-9]{24}$/i;
const DEFAULT_ORPHAN_GRACE_MS = 15 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastRunAt = 0;
let inFlight = null;

function insideRoot(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function listCandidateDirectories(payloadRoot) {
  let dateEntries;
  try {
    dateEntries = await fs.readdir(payloadRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const candidates = [];
  for (const dateEntry of dateEntries) {
    if (!dateEntry.isDirectory() || !DATE_FOLDER_PATTERN.test(dateEntry.name)) continue;
    const datePath = path.resolve(payloadRoot, dateEntry.name);
    if (!insideRoot(payloadRoot, datePath)) continue;
    const packageEntries = await fs.readdir(datePath, { withFileTypes: true });
    for (const packageEntry of packageEntries) {
      if (!packageEntry.isDirectory() || !PACKAGE_ID_PATTERN.test(packageEntry.name)) continue;
      const packagePath = path.resolve(datePath, packageEntry.name);
      if (!insideRoot(payloadRoot, packagePath)) continue;
      const stat = await fs.stat(packagePath);
      candidates.push({
        dateFolder: dateEntry.name,
        packageId: packageEntry.name.toLowerCase(),
        packagePath,
        modifiedAtMs: stat.mtimeMs,
      });
    }
  }
  return candidates;
}

async function removeCandidate(payloadRoot, candidate) {
  if (!insideRoot(payloadRoot, candidate.packagePath)) {
    throw new Error('Refused to remove a provider payload directory outside the configured root.');
  }
  await fs.rm(candidate.packagePath, { recursive: true, force: true });
}

async function runProviderPayloadJanitor({
  payloadRoot = getDefaultPayloadRoot(),
  now = new Date(),
  orphanGraceMs = DEFAULT_ORPHAN_GRACE_MS,
  model = ProviderCallPackage,
} = {}) {
  const resolvedRoot = path.resolve(payloadRoot);
  const checkedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(checkedAt.getTime())) throw new Error('Provider payload janitor requires a valid now value.');
  const candidates = await listCandidateDirectories(resolvedRoot);
  if (candidates.length === 0) {
    return { checked: 0, removed: 0, retained: 0, removedPackageIds: [] };
  }

  const documents = await model.find({ _id: { $in: candidates.map((entry) => entry.packageId) } })
    .select('_id expiresAt')
    .lean();
  const documentById = new Map(documents.map((document) => [String(document._id), document]));
  const graceMs = Number.isFinite(Number(orphanGraceMs)) ? Math.max(0, Number(orphanGraceMs)) : DEFAULT_ORPHAN_GRACE_MS;
  const removedPackageIds = [];

  for (const candidate of candidates) {
    const document = documentById.get(candidate.packageId);
    const expiresAtMs = document?.expiresAt ? new Date(document.expiresAt).getTime() : NaN;
    const documentExpired = Number.isFinite(expiresAtMs) && expiresAtMs <= checkedAt.getTime();
    const oldEnoughToBeOrphaned = candidate.modifiedAtMs <= checkedAt.getTime() - graceMs;
    if (!documentExpired && (document || !oldEnoughToBeOrphaned)) continue;
    await removeCandidate(resolvedRoot, candidate);
    removedPackageIds.push(candidate.packageId);
  }

  return {
    checked: candidates.length,
    removed: removedPackageIds.length,
    retained: candidates.length - removedPackageIds.length,
    removedPackageIds,
  };
}

function maybeRunProviderPayloadJanitor(options = {}) {
  const nowMs = Date.now();
  const minIntervalMs = Number.isFinite(Number(options.minIntervalMs))
    ? Math.max(0, Number(options.minIntervalMs))
    : DEFAULT_MIN_INTERVAL_MS;
  if (inFlight) return inFlight;
  if (nowMs - lastRunAt < minIntervalMs) return Promise.resolve({ skipped: true, reason: 'interval' });
  inFlight = runProviderPayloadJanitor(options)
    .then((result) => {
      lastRunAt = Date.now();
      return result;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function resetProviderPayloadJanitorForTests() {
  lastRunAt = 0;
  inFlight = null;
}

module.exports = {
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_ORPHAN_GRACE_MS,
  maybeRunProviderPayloadJanitor,
  resetProviderPayloadJanitorForTests,
  runProviderPayloadJanitor,
};
