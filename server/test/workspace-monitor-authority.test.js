'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const GmailAuth = require('../src/models/GmailAuth');
const gmail = require('../src/services/gmail');
const calendar = require('../src/services/calendar');
const autoActions = require('../src/services/workspace-auto-actions');
const labelCache = require('../src/lib/label-cache');
const workspaceMonitor = require('../src/services/workspace-monitor');

test('background monitor selects only an allowed connected account and remains suggestion-only', async () => {
  const originals = {
    getAll: GmailAuth.getAll,
    listMessages: gmail.listMessages,
    listEvents: calendar.listEvents,
    getLabelMap: labelCache.getLabelMap,
    evaluateAutoActions: autoActions.evaluateAutoActions,
    executeCategorization: autoActions.executeCategorization,
    executeSilentActions: autoActions.executeSilentActions,
    executeNotifyActions: autoActions.executeNotifyActions,
    autoSaveEntityFacts: autoActions.autoSaveEntityFacts,
  };
  const reads = [];
  const writes = [];
  const forbiddenWrite = (name) => async () => {
    writes.push(name);
    throw new Error(`${name} must not run`);
  };

  GmailAuth.getAll = async () => [
    { email: 'primary-not-allowed@example.com' },
    { email: 'allowed@example.com' },
  ];
  gmail.listMessages = async (params) => {
    reads.push({ service: 'gmail', account: params.accountEmail });
    return {
      ok: true,
      messages: [{
        id: 'm1',
        from: 'Deals <offers@amazon.ca>',
        subject: 'Suggestion fixture',
        labels: ['INBOX'],
        account: params.accountEmail,
      }],
    };
  };
  calendar.listEvents = async (params) => {
    reads.push({ service: 'calendar', account: params.account });
    return { ok: true, events: [] };
  };
  labelCache.getLabelMap = async () => null;
  autoActions.evaluateAutoActions = async () => ({ silent: [], notify: [], ask: [] });
  autoActions.executeCategorization = forbiddenWrite('executeCategorization');
  autoActions.executeSilentActions = forbiddenWrite('executeSilentActions');
  autoActions.executeNotifyActions = forbiddenWrite('executeNotifyActions');
  autoActions.autoSaveEntityFacts = forbiddenWrite('autoSaveEntityFacts');

  try {
    workspaceMonitor.stopMonitor();
    await workspaceMonitor.executeBackgroundWork({
      emailMonitoring: true,
      calendarMonitoring: true,
      emailOrganization: true,
      allowedAccounts: ['ALLOWED@EXAMPLE.COM'],
    });
    assert.deepEqual(reads, [
      { service: 'gmail', account: 'allowed@example.com' },
      { service: 'calendar', account: 'allowed@example.com' },
    ]);
    assert.deepEqual(writes, []);

    workspaceMonitor.stopMonitor();
    reads.length = 0;
    await workspaceMonitor.executeBackgroundWork({
      emailMonitoring: true,
      calendarMonitoring: true,
      emailOrganization: true,
      allowedAccounts: ['missing@example.com'],
    });
    assert.deepEqual(reads, [], 'no default account may be used when the allowlist cannot be proven');
    assert.deepEqual(writes, []);
  } finally {
    GmailAuth.getAll = originals.getAll;
    gmail.listMessages = originals.listMessages;
    calendar.listEvents = originals.listEvents;
    labelCache.getLabelMap = originals.getLabelMap;
    autoActions.evaluateAutoActions = originals.evaluateAutoActions;
    autoActions.executeCategorization = originals.executeCategorization;
    autoActions.executeSilentActions = originals.executeSilentActions;
    autoActions.executeNotifyActions = originals.executeNotifyActions;
    autoActions.autoSaveEntityFacts = originals.autoSaveEntityFacts;
    workspaceMonitor.stopMonitor();
  }
});
