const test = require('node:test');
const assert = require('node:assert/strict');

const { _internal } = require('../src/routes/escalations');

test('escalations path guard blocks sibling-prefix traversal', () => {
  const root = 'C:\\repo\\uploads';
  assert.equal(_internal.isPathWithinRoot(root, 'C:\\repo\\uploads\\esc\\a.png'), true);
  assert.equal(_internal.isPathWithinRoot(root, 'C:\\repo\\uploads-other\\a.png'), false);
  assert.equal(_internal.isPathWithinRoot(root, 'C:\\repo\\uploads\\..\\secret.png'), false);
});
