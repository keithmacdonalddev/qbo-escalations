#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAP_PATH = path.join(ROOT, 'testing', 'app-capabilities.json');
const PROFILES_PATH = path.join(ROOT, 'testing', 'check-profiles.json');
const RISKS = new Set(['critical', 'high', 'normal', 'currently out of scope']);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function normalize(file) {
  return file.replace(/\\/g, '/');
}

function assess(capability) {
  const types = new Set(capability.evidence.map((item) => item.type));
  const completeTypes = capability.requiredCheckTypes.every((type) => types.has(type));
  if (!completeTypes) return types.size === 0 ? 'unknown' : 'weakly-tested';
  // Static declarations can prove that evidence is mapped, not that the latest
  // relevant run completed. Only run-app-checks may emit strongly-tested.
  return 'partially-tested';
}

function validateTestingMap(map, profiles, root = ROOT) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const mappedTests = new Set();
  const groupIds = new Set(Object.keys(profiles.groups || {}));
  for (const capability of map.capabilities || []) {
    if (!capability.id || ids.has(capability.id)) errors.push(`Duplicate or missing capability id: ${capability.id || '(missing)'}`);
    ids.add(capability.id);
    if (!capability.userOutcome) errors.push(`${capability.id}: userOutcome is required.`);
    if (!RISKS.has(capability.risk)) errors.push(`${capability.id}: unknown risk ${capability.risk}.`);
    if (!Array.isArray(capability.requiredCheckTypes) || capability.requiredCheckTypes.length === 0) errors.push(`${capability.id}: requiredCheckTypes are required.`);
    if (capability.risk === 'critical' && capability.requiredCheckTypes.length < 2) errors.push(`${capability.id}: critical capabilities need more than one evidence type.`);
    for (const sourcePath of capability.sourcePaths || []) {
      if (!fs.existsSync(path.join(root, sourcePath))) errors.push(`${capability.id}: missing source file ${sourcePath}.`);
    }
    for (const item of capability.evidence || []) {
      const evidenceGroupIds = item.groupIds || [item.groupId];
      for (const evidenceGroupId of evidenceGroupIds) {
        if (!groupIds.has(evidenceGroupId)) errors.push(`${capability.id}: unknown group ${evidenceGroupId}.`);
        if (!(profiles.groups[evidenceGroupId]?.capabilities || []).includes(capability.id)) {
          errors.push(`${capability.id}: group ${evidenceGroupId} does not declare this capability.`);
        }
      }
      for (const evidencePath of item.paths || []) {
        mappedTests.add(evidencePath);
        if (!fs.existsSync(path.join(root, evidencePath))) errors.push(`${capability.id}: missing evidence file ${evidencePath}.`);
      }
    }
    const assessment = assess(capability);
    if (capability.risk === 'critical' && assessment !== 'strongly-tested') warnings.push(`${capability.id}: ${assessment}; ${capability.knownGaps.join(' ')}`);
  }
  for (const [groupId, group] of Object.entries(profiles.groups || {})) {
    for (const capabilityId of group.capabilities || []) {
      if (!ids.has(capabilityId)) errors.push(`Group ${groupId} declares unknown capability ${capabilityId}.`);
    }
  }
  const infrastructure = new Set(map.testInventory?.infrastructure || []);
  const reviewedTests = new Set();
  for (const category of map.testInventory?.reviewedCategories || []) {
    if (!category.category || !category.reason || !Array.isArray(category.paths)) errors.push('Every reviewed test category needs a category, reason, and paths.');
    for (const reviewedPath of category.paths || []) {
      if (reviewedTests.has(reviewedPath)) errors.push(`Reviewed test is listed more than once: ${reviewedPath}.`);
      reviewedTests.add(reviewedPath);
      if (!fs.existsSync(path.join(root, reviewedPath))) errors.push(`Reviewed test is missing: ${reviewedPath}.`);
    }
  }
  for (const testRoot of map.testInventory?.roots || []) {
    for (const absolute of walk(path.join(root, testRoot))) {
      if (!/\.test\.(js|jsx)$/.test(absolute)) continue;
      const relative = normalize(path.relative(root, absolute));
      if (!mappedTests.has(relative) && !infrastructure.has(relative) && !reviewedTests.has(relative)) errors.push(`Unmapped test file: ${relative}.`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    assessments: Object.fromEntries((map.capabilities || []).map((capability) => [capability.id, assess(capability)])),
  };
}

function main() {
  const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
  const result = validateTestingMap(map, profiles);
  for (const warning of result.warnings) console.warn(`[testing-map] gap: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`[testing-map] ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[testing-map] valid: ${map.capabilities.length} capabilities; ${result.warnings.length} visible critical gaps.`);
}

if (require.main === module) main();

module.exports = { assess, validateTestingMap };
