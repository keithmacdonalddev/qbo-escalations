'use strict';

// ---------------------------------------------------------------------------
// Approved triage cases — single source of truth for "operator-approved parser
// output → triage test input".
//
// The triage agent test must NEVER run on synthetic fixtures. It runs only on
// REAL escalation-parser outputs that an operator has approved. Those approvals
// are persisted in the ImageParserFixtureBaseline collection (with a 1-entry
// built-in seed as a read-time fallback). This module owns:
//
//   1. The DB-facing resolution + serialization of those approved outputs
//      (extracted verbatim from routes/pipeline-tests.js so BOTH the parser
//      route and the triage route share ONE implementation — no cross-route
//      import smell, no drift).
//   2. The flatten that turns "image fixtures + their approved templates" into
//      a flat list of runnable triage cases, each with a stable id.
//
// Path/filesystem knowledge (which image fixtures exist, their URLs) stays in
// routes/pipeline-tests.js. The case loader here accepts an injected
// "fixture asset provider" so this module never needs to know about disk paths.
// ---------------------------------------------------------------------------

const ImageParserFixtureBaseline = require('../models/ImageParserFixtureBaseline');
const { getBuiltInConfirmedOutput } = require('./image-parser-confirmed-outputs');

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function imageParserBaselineDbAvailable() {
  return Boolean(ImageParserFixtureBaseline.db && ImageParserFixtureBaseline.db.readyState === 1);
}

// ---------------------------------------------------------------------------
// Accepted-output serialization. Extracted verbatim from pipeline-tests.js.
// ---------------------------------------------------------------------------
function serializeAcceptedOutput(output, fixtureName, fallback = {}) {
  if (!output) return null;
  const expectedText = safeString(output.expectedText, fallback.expectedText || '');
  if (!expectedText) return null;
  return {
    id: String(output._id || output.id || fallback.id || ''),
    fixtureName: safeString(output.fixtureName, fixtureName),
    expectedText,
    source: safeString(output.source, fallback.source || 'saved') || 'saved',
    sourceResultId: safeString(output.sourceResultId, fallback.sourceResultId || ''),
    sourceProvider: safeString(output.sourceProvider, fallback.sourceProvider || ''),
    sourceModel: safeString(output.sourceModel, fallback.sourceModel || ''),
    promptId: safeString(output.promptId, fallback.promptId || 'escalation-template-parser') || 'escalation-template-parser',
    promptVersion: safeString(output.promptVersion, fallback.promptVersion || ''),
    promptSha256: safeString(output.promptSha256, fallback.promptSha256 || ''),
    confirmedBy: safeString(output.confirmedBy, fallback.confirmedBy || 'operator') || 'operator',
    operatorNote: safeString(output.operatorNote, fallback.operatorNote || ''),
    createdAt: output.createdAt || fallback.createdAt || null,
    updatedAt: output.updatedAt || fallback.updatedAt || null,
  };
}

function collectAcceptedOutputsFromBaseline(baseline) {
  if (!baseline) return [];
  const fixtureName = safeString(baseline.fixtureName, '');
  const outputs = [];
  const seenText = new Set();

  function addOutput(output, fallback = {}) {
    const serialized = serializeAcceptedOutput(output, fixtureName, fallback);
    if (!serialized || seenText.has(serialized.expectedText)) return;
    seenText.add(serialized.expectedText);
    outputs.push({
      ...serialized,
      outputIndex: outputs.length,
    });
  }

  if (Array.isArray(baseline.acceptableOutputs)) {
    baseline.acceptableOutputs.forEach((output) => addOutput(output, {
      source: 'saved',
      updatedAt: output?.updatedAt || baseline.updatedAt || null,
    }));
  }

  addOutput(baseline, {
    source: 'saved',
    updatedAt: baseline.updatedAt || null,
  });

  return outputs;
}

function serializeImageParserBaseline(doc) {
  if (!doc) return null;
  const baseline = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const outputs = collectAcceptedOutputsFromBaseline(baseline);
  return {
    ...baseline,
    id: String(baseline._id || baseline.id || ''),
    outputs,
    outputCount: outputs.length,
    expectedText: outputs[0]?.expectedText || safeString(baseline.expectedText, ''),
  };
}

// ---------------------------------------------------------------------------
// Baseline resolution. Extracted verbatim from pipeline-tests.js (the parser
// route now requires these from here so the behavior is shared, not copied).
// ---------------------------------------------------------------------------
async function findBaselineByFixtureName(fixtureName) {
  if (!imageParserBaselineDbAvailable() || typeof ImageParserFixtureBaseline.findOne !== 'function') {
    return null;
  }
  const query = ImageParserFixtureBaseline.findOne({ fixtureName });
  return query && typeof query.lean === 'function' ? query.lean() : query;
}

async function resolveConfirmedOutputSetForFixture(fixtureName) {
  const cleanFixtureName = safeString(fixtureName, '').trim();
  if (!cleanFixtureName) return null;

  const saved = await findBaselineByFixtureName(cleanFixtureName);
  if (saved) {
    const baseline = serializeImageParserBaseline(saved);
    if (baseline?.outputs?.length) {
      return {
        fixtureName: cleanFixtureName,
        expectedText: baseline.outputs[0].expectedText,
        outputs: baseline.outputs,
        outputCount: baseline.outputs.length,
        source: 'saved',
        updatedAt: baseline.updatedAt || null,
        baseline,
      };
    }
  }

  const builtIn = getBuiltInConfirmedOutput(cleanFixtureName);
  if (!builtIn) return null;
  const builtInOutput = serializeAcceptedOutput({
    fixtureName: cleanFixtureName,
    expectedText: safeString(builtIn.expectedText, ''),
    source: safeString(builtIn.source, 'built-in-seed') || 'built-in-seed',
    confirmedBy: safeString(builtIn.confirmedBy, 'operator') || 'operator',
  }, cleanFixtureName);
  return {
    fixtureName: cleanFixtureName,
    expectedText: builtInOutput?.expectedText || '',
    outputs: builtInOutput ? [{ ...builtInOutput, outputIndex: 0 }] : [],
    outputCount: builtInOutput ? 1 : 0,
    source: safeString(builtIn.source, 'built-in-seed') || 'built-in-seed',
    updatedAt: null,
    baseline: {
      fixtureName: cleanFixtureName,
      source: safeString(builtIn.source, 'built-in-seed') || 'built-in-seed',
      confirmedBy: safeString(builtIn.confirmedBy, 'operator') || 'operator',
      expectedText: builtInOutput?.expectedText || '',
      outputs: builtInOutput ? [{ ...builtInOutput, outputIndex: 0 }] : [],
      outputCount: builtInOutput ? 1 : 0,
    },
  };
}

async function resolveConfirmedOutputForFixture(fixtureName) {
  const outputSet = await resolveConfirmedOutputSetForFixture(fixtureName);
  if (!outputSet?.outputs?.length) return null;
  return {
    ...outputSet,
    expectedText: outputSet.outputs[0].expectedText,
  };
}

// ---------------------------------------------------------------------------
// Triage-case construction.
// ---------------------------------------------------------------------------

// buildCaseLabel turns the 9-label escalation-template text into a short,
// human-readable one-liner for the picker. Prefer the CLIENT/CONTACT line, then
// CX IS ATTEMPTING TO, then CASE, then the first non-empty field — whatever
// best identifies the case at a glance. Truncated so the picker stays tidy.
const LABEL_FIELD_PRIORITY = [
  'CLIENT/CONTACT',
  'CX IS ATTEMPTING TO',
  'CASE',
  'COID/MID',
];

function truncateLabel(value, max = 80) {
  const clean = safeString(value, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function buildCaseLabel(expectedText) {
  const text = safeString(expectedText, '');
  if (!text.trim()) return 'Approved escalation case';
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  const fieldMap = new Map();
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toUpperCase();
    const val = line.slice(idx + 1).trim();
    if (key && val && !fieldMap.has(key)) fieldMap.set(key, val);
  }

  // Name-like fields read naturally on their own; identifier fields get a label.
  const PREFIXLESS_FIELDS = new Set(['CLIENT/CONTACT', 'CX IS ATTEMPTING TO']);
  for (const field of LABEL_FIELD_PRIORITY) {
    const val = fieldMap.get(field);
    if (val) {
      const prefix = PREFIXLESS_FIELDS.has(field) ? '' : `${field}: `;
      return truncateLabel(`${prefix}${val}`);
    }
  }

  // Fall back to the first non-empty field value, or the first line.
  const firstVal = [...fieldMap.values()][0];
  return truncateLabel(firstVal || lines[0]);
}

function makeTriageCaseId(sourceFixtureName, outputIndex) {
  return `${safeString(sourceFixtureName, '')}#${safeNumber(outputIndex, 0)}`;
}

// flattenTemplatesFromFixtureAssets converts the parser test-asset list (each
// asset = one image fixture, carrying its approvedTemplates[]) into the flat
// triage-asset list. This is the SAME shape routes/pipeline-tests.js previously
// produced inline as listTriageTemplateAssets — extracted here so both routes
// agree on it.
function flattenTemplatesFromFixtureAssets(parserAssets, { triageAgentId } = {}) {
  const assets = Array.isArray(parserAssets) ? parserAssets : [];
  return assets.flatMap((asset) => {
    const approvedTemplates = Array.isArray(asset.approvedTemplates) ? asset.approvedTemplates : [];
    return approvedTemplates.map((template, index) => {
      const outputIndex = template.outputIndex ?? index;
      return {
        kind: 'approved-parser-template',
        agentId: triageAgentId || 'triage-agent',
        id: makeTriageCaseId(asset.name, outputIndex),
        name: `${asset.name} · template ${outputIndex + 1}`,
        sourceFixtureName: asset.name,
        fixtureName: asset.name,
        sourceImageUrl: asset.url,
        thumbnailUrl: asset.thumbnailUrl,
        imageUrl: asset.url,
        mimeType: asset.mimeType,
        expectedText: template.expectedText,
        approvedTemplate: template,
        outputIndex,
        source: safeString(template.source || asset.confirmedOutputSource, ''),
        updatedAt: template.updatedAt || asset.confirmedOutputUpdatedAt || null,
        programmaticCheckReady: true,
      };
    });
  });
}

// buildTriageCaseFromAsset narrows a flattened triage asset down to the
// runnable triage case contract.
function buildTriageCaseFromAsset(asset) {
  if (!asset) return null;
  const expectedText = safeString(asset.expectedText, '');
  const approved = asset.approvedTemplate || {};
  return {
    id: safeString(asset.id, makeTriageCaseId(asset.sourceFixtureName, asset.outputIndex)),
    sourceFixtureName: safeString(asset.sourceFixtureName, ''),
    outputIndex: safeNumber(asset.outputIndex, 0),
    label: buildCaseLabel(expectedText),
    parserText: expectedText,
    provider: safeString(approved.sourceProvider, ''),
    model: safeString(approved.sourceModel, ''),
    confirmedBy: safeString(approved.confirmedBy, 'operator') || 'operator',
    approvedAt: approved.updatedAt || approved.createdAt || asset.updatedAt || null,
    sourceImageUrl: safeString(asset.imageUrl || asset.sourceImageUrl, ''),
    thumbnailUrl: safeString(asset.thumbnailUrl, ''),
    source: safeString(asset.source, ''),
  };
}

// listApprovedTriageCases is the public entrypoint the triage route calls.
// It REUSES the same fixture-asset provider the parser route already exposes,
// so "operator approves a parser output" → "case appears here" is automatic.
//
// `loadParserTemplateAssets` must resolve to the flattened triage-asset list
// (i.e. the output of flattenTemplatesFromFixtureAssets / listTriageTemplateAssets).
async function listApprovedTriageCases(loadTriageTemplateAssets) {
  if (typeof loadTriageTemplateAssets !== 'function') {
    throw new Error('listApprovedTriageCases requires a triage-template-asset loader.');
  }
  const assets = await loadTriageTemplateAssets();
  const cases = (Array.isArray(assets) ? assets : [])
    .map(buildTriageCaseFromAsset)
    .filter((entry) => entry && entry.parserText);
  // Stable ordering by source image then output index keeps the picker and the
  // "run all" loop deterministic across requests.
  cases.sort((a, b) => {
    const bySource = a.sourceFixtureName.localeCompare(b.sourceFixtureName);
    if (bySource !== 0) return bySource;
    return a.outputIndex - b.outputIndex;
  });
  return cases;
}

async function getApprovedTriageCaseById(loadTriageTemplateAssets, id) {
  const wanted = safeString(id, '').trim();
  if (!wanted) return null;
  const cases = await listApprovedTriageCases(loadTriageTemplateAssets);
  return cases.find((entry) => entry.id === wanted) || null;
}

function chooseRandomCase(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return null;
  return cases[Math.floor(Math.random() * cases.length)];
}

module.exports = {
  // shared low-level helpers (used by routes/pipeline-tests.js)
  safeString,
  safeNumber,
  imageParserBaselineDbAvailable,
  serializeAcceptedOutput,
  collectAcceptedOutputsFromBaseline,
  serializeImageParserBaseline,
  findBaselineByFixtureName,
  resolveConfirmedOutputSetForFixture,
  resolveConfirmedOutputForFixture,
  flattenTemplatesFromFixtureAssets,
  // triage-case API (used by routes/triage-tests.js)
  buildCaseLabel,
  makeTriageCaseId,
  buildTriageCaseFromAsset,
  listApprovedTriageCases,
  getApprovedTriageCaseById,
  chooseRandomCase,
};
