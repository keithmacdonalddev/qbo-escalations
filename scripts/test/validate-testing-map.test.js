'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assess, validateTestingMap } = require('../validate-testing-map');

function fixture() {
  return {
    map: {
      testInventory: { roots: ['client/src'], infrastructure: [] },
      capabilities: [{
        id: 'critical-flow',
        label: 'Critical flow',
        userOutcome: 'The important flow works.',
        risk: 'critical',
        owner: 'Test',
        sourcePaths: ['client/src/flow.js'],
        requiredCheckTypes: ['component', 'browser'],
        evidence: [
          { type: 'component', groupId: 'client', paths: ['client/src/flow.test.js'] },
          { type: 'browser', groupId: 'browser', paths: ['browser/run.js'] },
        ],
        knownGaps: [],
      }],
    },
    profiles: {
      groups: {
        client: { capabilities: ['critical-flow'] },
        browser: { capabilities: ['critical-flow'] },
      },
    },
  };
}

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testing-map-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'client', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'browser'), { recursive: true });
  fs.writeFileSync(path.join(root, 'client', 'src', 'flow.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(root, 'client', 'src', 'flow.test.js'), '');
  fs.writeFileSync(path.join(root, 'browser', 'run.js'), '');
  return root;
}

test('validation fails when a referenced test file is missing', (t) => {
  const root = makeRoot(t);
  const { map, profiles } = fixture();
  fs.rmSync(path.join(root, 'browser', 'run.js'));

  const result = validateTestingMap(map, profiles, root);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('missing evidence file browser/run.js')));
});

test('validation reports a newly added unmapped test file', (t) => {
  const root = makeRoot(t);
  const { map, profiles } = fixture();
  fs.writeFileSync(path.join(root, 'client', 'src', 'new-behavior.test.js'), '');

  const result = validateTestingMap(map, profiles, root);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Unmapped test file: client/src/new-behavior.test.js')));
});

test('critical capability without required browser evidence is weakly tested', () => {
  const { map } = fixture();
  map.capabilities[0].evidence.pop();

  assert.equal(assess(map.capabilities[0]), 'weakly-tested');
});

test('pinned reviewed server inventory does not blanket-accept a new server test', (t) => {
  const root = makeRoot(t);
  const { map, profiles } = fixture();
  map.testInventory.roots.push('server/test');
  map.testInventory.reviewedCategories = [{
    category: 'reviewed-server-suite',
    reason: 'Explicitly reviewed baseline.',
    paths: ['server/test/existing.test.js'],
  }];
  fs.mkdirSync(path.join(root, 'server', 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server', 'test', 'existing.test.js'), '');
  fs.writeFileSync(path.join(root, 'server', 'test', 'new.test.js'), '');

  const result = validateTestingMap(map, profiles, root);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('Unmapped test file: server/test/new.test.js.'));
});

test('unknown capability IDs declared by groups are rejected', (t) => {
  const root = makeRoot(t);
  const { map, profiles } = fixture();
  profiles.groups.client.capabilities.push('not-a-capability');

  const result = validateTestingMap(map, profiles, root);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('Group client declares unknown capability not-a-capability.'));
});
