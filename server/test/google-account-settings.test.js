'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPermissionStatus } = require('../src/services/gmail');

test('Google permissions are reported in plain English and missing access is explicit', () => {
  const status = buildPermissionStatus([
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' '));

  assert.equal(status.permissions.find((permission) => permission.id === 'gmail-read').granted, true);
  assert.equal(status.permissions.find((permission) => permission.id === 'gmail-send').granted, true);
  assert.equal(status.permissions.find((permission) => permission.id === 'calendar').granted, false);
  assert.ok(status.missingPermissions.includes('Read and manage calendar events'));
  assert.ok(status.missingPermissions.includes('Create and manage drafts'));
});
