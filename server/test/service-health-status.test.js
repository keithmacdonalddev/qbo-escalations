'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createApp } = require('../src/app');
const agentHealth = require('../src/services/agent-health-service');
const aiManagementScheduler = require('../src/services/ai-management-scheduler');
const knowledgeReviewScheduler = require('../src/services/knowledgebase-agent-scheduler');
const workspaceMonitor = require('../src/services/workspace-monitor');
const workspaceScheduler = require('../src/services/workspace-scheduler');

test('background services expose safe status without starting them', () => {
  const monitor = workspaceMonitor.getStatus();
  const briefing = workspaceScheduler.getStatus();
  const knowledge = knowledgeReviewScheduler.getStatus();
  const aiManagement = aiManagementScheduler.getStatus();
  const agents = agentHealth.getAgentHealthMonitorStatus();

  assert.equal(typeof monitor.tickInProgress, 'boolean');
  assert.equal(typeof monitor.lastTickStatus, 'string');
  assert.equal(typeof monitor.gmail, 'object');
  assert.equal(typeof monitor.calendar, 'object');
  assert.ok(briefing.nextRunAt);
  assert.equal(typeof knowledge.scanInProgress, 'boolean');
  assert.ok(knowledge.nextEligibleDate);
  assert.equal(typeof aiManagement.checkInProgress, 'boolean');
  assert.equal(typeof agents.refreshInProgress, 'boolean');
});

test('Workspace runtime status includes realtime, live-call, and background health', async () => {
  const response = await request(createApp()).get('/api/workspace/status').expect(200);

  assert.equal(response.body.ok, true);
  assert.equal(typeof response.body.workspace.activeSessions, 'number');
  assert.equal(typeof response.body.background.activeTasks, 'number');
  assert.equal(response.body.realtime.path, '/api/realtime');
  assert.equal(response.body.liveCall.path, '/api/live-call-assist/stream');
});

test('provider evidence health has a focused explicit probe and fails honestly without MongoDB', async () => {
  await request(createApp()).get('/api/image-parser/package-store-health').expect(404);
  const response = await request(createApp()).post('/api/image-parser/package-store-health').expect(503);

  assert.equal(response.body.ok, false);
  assert.equal(response.body.packageStore.available, false);
  assert.equal(response.body.packageStore.code, 'PROVIDER_PACKAGE_MONGO_UNAVAILABLE');
});
