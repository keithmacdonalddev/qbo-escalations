const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRoomActionGroups,
} = require('../src/services/room-action-groups');
const {
  acquireChatLock,
  releaseChatLock,
  isChatAgentActive,
} = require('../src/services/workspace-runtime');

test('room workspace adapter utils', async (t) => {
  t.beforeEach(() => {
    releaseChatLock();
  });

  t.after(() => {
    releaseChatLock();
  });

  await t.test('normalizeRoomActionGroups preserves grouped action batches and adds statuses', () => {
    const groups = normalizeRoomActionGroups([
      {
        iteration: 2,
        results: [
          { tool: 'gmail.search', result: { ok: true } },
          { tool: 'calendar.createEvent', error: 'failed' },
        ],
      },
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].iteration, 2);
    assert.equal(groups[0].results[0].status, 'success');
    assert.equal(groups[0].results[1].status, 'error');
  });

  await t.test('normalizeRoomActionGroups wraps flat action results into a single room batch', () => {
    const groups = normalizeRoomActionGroups([
      { tool: 'gmail.search', result: { ok: true } },
      { tool: 'gmail.send', error: 'denied' },
    ], 3);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].iteration, 3);
    assert.equal(groups[0].results.length, 2);
    assert.equal(groups[0].results[0].status, 'success');
    assert.equal(groups[0].results[1].status, 'error');
  });

  await t.test('releaseChatLock only clears the lock for the matching owner when one is provided', () => {
    assert.equal(acquireChatLock('owner-a'), true);
    assert.equal(isChatAgentActive(), true);

    assert.equal(releaseChatLock('owner-b'), false);
    assert.equal(isChatAgentActive(), true);

    assert.equal(releaseChatLock('owner-a'), true);
    assert.equal(isChatAgentActive(), false);
  });
});
