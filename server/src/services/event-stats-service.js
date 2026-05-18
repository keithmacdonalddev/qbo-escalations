'use strict';

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');

// Phases tracked in caseIntake.runs[]. Mirror of the stage->phase map used by
// the client (StageEventLogPanel) and case-intake.js.
const PHASE_BY_STAGE = {
  parser: 'parse-template',
  inv: 'known-issue-search',
  triage: 'triage',
  main: 'analyst',
};
const STAGE_IDS = Object.keys(PHASE_BY_STAGE);

// Number of recent completed runs averaged for the live progress-bar
// denominator. Five smooths out one-off short runs without lagging behind
// real shifts in pipeline behaviour.
const MOVING_AVG_WINDOW = 5;

function getRunEventCount(run) {
  if (!run || typeof run !== 'object') return 0;
  const explicit = Number(run.eventCount);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  // Legacy fallback: if eventCount was never persisted, derive it from the
  // events array but exclude `ui`-category entries so historical UI noise
  // doesn't inflate the totals.
  if (Array.isArray(run.events)) {
    return run.events.filter((ev) => ev?.category !== 'ui').length;
  }
  return 0;
}

function isCompletedRun(run) {
  if (!run || typeof run !== 'object') return false;
  return run.status === 'completed' || run.status === 'failed';
}

function summarizeStageFromIntake(intake) {
  const runs = Array.isArray(intake?.runs) ? intake.runs : [];
  const summary = {};
  for (const stageId of STAGE_IDS) {
    const phase = PHASE_BY_STAGE[stageId];
    const run = runs.find((r) => r && r.phase === phase);
    summary[stageId] = {
      count: getRunEventCount(run),
      completed: isCompletedRun(run),
    };
  }
  return summary;
}

/**
 * Per-stage moving-average denominator for the live progress bar plus
 * all-time event totals for the sessions page.
 *
 * Scans up to `windowSize * 6` recent conversations (defaults to 30) so
 * we get a fresh sample even when many runs failed before producing
 * meaningful counts.
 */
async function getEventStats({ windowSize = MOVING_AVG_WINDOW } = {}) {
  if (mongoose.connection.readyState !== 1) {
    return {
      byStage: STAGE_IDS.reduce((acc, key) => {
        acc[key] = { avg: 0, samples: 0 };
        return acc;
      }, {}),
      totals: { allTime: 0, perSession: 0, sessionCount: 0 },
    };
  }

  const scanLimit = Math.max(windowSize * 6, windowSize);
  const conversations = await Conversation.find({ 'caseIntake.runs.0': { $exists: true } })
    .select('caseIntake updatedAt')
    .sort({ updatedAt: -1 })
    .limit(scanLimit)
    .lean()
    .maxTimeMS(8000);

  const perStageSamples = STAGE_IDS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});

  let allTimeTotal = 0;
  let sessionsWithEvents = 0;

  for (const conversation of conversations) {
    const summary = summarizeStageFromIntake(conversation.caseIntake);
    let sessionTotal = 0;
    for (const stageId of STAGE_IDS) {
      const stage = summary[stageId];
      if (stage.completed && stage.count > 0 && perStageSamples[stageId].length < windowSize) {
        perStageSamples[stageId].push(stage.count);
      }
      sessionTotal += stage.count;
    }
    allTimeTotal += sessionTotal;
    if (sessionTotal > 0) sessionsWithEvents += 1;
  }

  const byStage = {};
  for (const stageId of STAGE_IDS) {
    const samples = perStageSamples[stageId];
    if (samples.length === 0) {
      byStage[stageId] = { avg: 0, samples: 0 };
      continue;
    }
    const sum = samples.reduce((a, b) => a + b, 0);
    byStage[stageId] = {
      avg: Math.round(sum / samples.length),
      samples: samples.length,
    };
  }

  const perSession = sessionsWithEvents > 0
    ? Math.round(allTimeTotal / sessionsWithEvents)
    : 0;

  return {
    byStage,
    totals: {
      allTime: allTimeTotal,
      perSession,
      sessionCount: sessionsWithEvents,
    },
    windowSize,
  };
}

/**
 * Sum the per-run event counts for a single conversation. Used by the
 * sessions list/detail to surface per-session totals without rehydrating
 * the full events arrays.
 */
function sumCaseIntakeEvents(intake) {
  const runs = Array.isArray(intake?.runs) ? intake.runs : [];
  let total = 0;
  for (const run of runs) {
    total += getRunEventCount(run);
  }
  return total;
}

module.exports = {
  PHASE_BY_STAGE,
  STAGE_IDS,
  MOVING_AVG_WINDOW,
  getEventStats,
  sumCaseIntakeEvents,
};
