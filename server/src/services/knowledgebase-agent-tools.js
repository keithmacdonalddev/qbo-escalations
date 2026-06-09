'use strict';

// Knowledge Base Agent write tools.
//
// These are the real tools the Knowledge Base Agent uses to inspect and EDIT
// the open KB draft (a KnowledgeCandidate). They are exposed to the model via
// the text-`ACTION:` protocol (see knowledgebase-agent-tool-loop.js) and run
// here, server-side, scoped to a single open record.
//
// HARD SAFETY BOUNDARY (crown-jewel guarantee): the agent may EDIT draft text
// fields only. It can NEVER approve, publish, deprecate, redact, or change
// trust/review status. This is enforced structurally on two layers:
//   1. Every write goes through `updateKnowledgeRecord` with the reviewer actor
//      ({ actor: 'knowledgebase-agent', role: 'reviewer' }). The reviewer role
//      grants review/feedback/relationship/export — NOT publish/deprecate/redact.
//   2. `kb.updateDraft` whitelists only editable text/array fields and strips
//      any reviewStatus / publishTarget / reusableOutcome / allowedUsesOverride
//      / trustStateOverride keys before the payload ever reaches the service.

const KnowledgeCandidate = require('../models/KnowledgeCandidate');
const {
  EDITABLE_TEXT_FIELDS,
  updateKnowledgeRecord,
} = require('./knowledgebase-management-service');
const {
  getCandidateQualityIssues,
  buildDraftHarnessChecks,
} = require('./knowledgebase-agent-service');
const { searchKnowledge } = require('./knowledgebase-service');

const KNOWLEDGEBASE_AGENT_ID = 'knowledgebase-agent';
const KB_AGENT_ACTOR = Object.freeze({ actor: KNOWLEDGEBASE_AGENT_ID, role: 'reviewer' });

// Editable array fields the agent may also fill. `updateKnowledgeRecord` accepts
// these via `sanitizeKnowledgePatch` separately from EDITABLE_TEXT_FIELDS.
const EDITABLE_ARRAY_FIELDS = ['keySignals', 'importantBoundaries'];

// Fields the agent may NEVER set, regardless of how the model phrases it. These
// gate approval/publication/trust and are human-only. Stripped before write.
const FORBIDDEN_FIELDS = new Set([
  'reviewStatus',
  'publishTarget',
  'reusableOutcome',
  'allowedUsesOverride',
  'trustStateOverride',
  'confidence',
  'scope',
  'actionRecommendations',
]);

const EDITABLE_FIELD_SET = new Set([...EDITABLE_TEXT_FIELDS, ...EDITABLE_ARRAY_FIELDS]);

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function objectIdString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    if (value._id && value._id !== value) return objectIdString(value._id);
    return value.toString();
  } catch {
    return '';
  }
}

// A field counts as "empty" (and so safe to auto-fill in proactive mode) when it
// has no meaningful content. Arrays are empty when they have no entries.
function isFieldEmpty(value) {
  if (Array.isArray(value)) return value.length === 0;
  return safeString(value, '').trim().length === 0;
}

function snapshotFieldValue(candidate, field) {
  const value = candidate?.[field];
  if (Array.isArray(value)) return value.map((item) => safeString(item, ''));
  return safeString(value, '');
}

function readEditableFields(candidate) {
  const out = {};
  for (const field of EDITABLE_FIELD_SET) {
    out[field] = snapshotFieldValue(candidate, field);
  }
  return out;
}

// ---- Tool metadata (rendered into the system prompt) -----------------------

const KB_AGENT_TOOL_METADATA = {
  'kb.readDraft': {
    kind: 'read',
    description: 'Read the current editable values of the open KB draft plus completeness warnings.',
    params: '{}',
  },
  'kb.searchKnowledgeBase': {
    kind: 'read',
    description: 'Search existing/related KB entries and candidates for context, duplicates, or contradictions.',
    params: '{ query, limit? }',
  },
  'kb.checkCompleteness': {
    kind: 'read',
    description: 'Check the open draft for missing/weak fields and which required fields still need work.',
    params: '{}',
  },
  'kb.updateDraft': {
    kind: 'write',
    description: 'Apply edits to one or more editable draft fields and report exactly what changed (with prior values for undo).',
    params: '{ fields: { <editableField>: value, ... }, mode: "proactive"|"explicit", note? }',
  },
};

function buildKbAgentToolLines() {
  const editable = [...EDITABLE_TEXT_FIELDS, ...EDITABLE_ARRAY_FIELDS].join(', ');
  const lines = [
    'KNOWLEDGE BASE AGENT TOOLS:',
    '- Use kb.readDraft / kb.checkCompleteness before editing so you know what is already there.',
    '- Use kb.searchKnowledgeBase to check for related or conflicting saved entries.',
    '- Use kb.updateDraft to actually save edits. The save is applied directly to the draft.',
    `- Editable fields: ${editable}.`,
    '- You can NEVER approve, publish, deprecate, redact, or change review/trust status — those are human-only and any such field you pass is ignored.',
  ];
  for (const [tool, meta] of Object.entries(KB_AGENT_TOOL_METADATA)) {
    lines.push(`- ${tool}: ${meta.description} Params: ${meta.params}`);
  }
  lines.push('');
  lines.push('AUTONOMY RULES:');
  lines.push('- On your own initiative (mode "proactive"), only fill fields that are EMPTY or flagged incomplete. Never overwrite a field the reviewer already wrote unless they ask — if you think it should change, ask first in chat.');
  lines.push('- When the reviewer gives an explicit edit command (e.g. "rewrite the summary", "set the customer goal to ..."), use mode "explicit" and edit the requested fields.');
  lines.push('- After a successful kb.updateDraft, state in plain language exactly which fields you changed.');
  lines.push('');
  lines.push('ACTION FORMAT:');
  lines.push('ACTION: {"tool": "kb.updateDraft", "params": {"fields": {"customerGoal": "..."}, "mode": "explicit"}}');
  lines.push('Emit one or more ACTION lines. After results come back, either emit more ACTION lines or give the final answer with no ACTION lines.');
  return lines.join('\n');
}

const KB_AGENT_TOOL_LINES = buildKbAgentToolLines();

// ---- Handlers --------------------------------------------------------------
//
// Handlers are created per-request bound to the open recordId so the agent can
// only ever touch the draft the reviewer is looking at. `loadCandidate` re-reads
// the current doc each call so completeness/read reflect prior edits in the loop.

function createKbAgentToolHandlers({ recordId, candidateId } = {}) {
  const targetId = objectIdString(candidateId) || objectIdString(recordId);

  async function loadCandidate() {
    if (!targetId) {
      const err = new Error('Knowledge Base Agent tools require an open KB draft.');
      err.code = 'KNOWLEDGE_AGENT_RECORD_REQUIRED';
      throw err;
    }
    const candidate = await KnowledgeCandidate.findById(targetId).lean();
    if (!candidate) {
      const err = new Error('Knowledge record not found.');
      err.code = 'KNOWLEDGE_RECORD_NOT_FOUND';
      throw err;
    }
    return candidate;
  }

  const handlers = {
    'kb.readDraft': async () => {
      const candidate = await loadCandidate();
      return {
        ok: true,
        recordId: `candidate:${objectIdString(candidate._id)}`,
        reviewStatus: safeString(candidate.reviewStatus, 'draft'),
        fields: readEditableFields(candidate),
        qualityIssues: getCandidateQualityIssues(candidate),
      };
    },

    'kb.searchKnowledgeBase': async (params = {}) => {
      const query = safeString(params.query, '').trim();
      if (!query) return { ok: false, error: 'query is required' };
      const limit = Math.min(Math.max(Number(params.limit) || 6, 1), 12);
      const result = await searchKnowledge({
        query,
        includeCandidates: true,
        includeLegacy: false,
        limit,
      });
      const ownId = targetId ? `candidate:${targetId}` : '';
      const records = (result.records || [])
        .filter((record) => record.id !== ownId)
        .slice(0, limit)
        .map((record) => ({
          id: record.id,
          title: record.title,
          category: record.category,
          reviewStatus: record.reviewStatus,
          trustState: record.trustState,
          summary: record.summary,
          finalOutcome: record.finalOutcome,
          keySignals: record.keySignals,
        }));
      return { ok: true, query, count: records.length, records };
    },

    'kb.checkCompleteness': async () => {
      const candidate = await loadCandidate();
      const checks = buildDraftHarnessChecks(candidate, candidate.sourceSnapshot || {});
      const requiredMissing = checks
        .filter((check) => !check.optional && !check.passed)
        .map((check) => check.label);
      const optionalMissing = checks
        .filter((check) => check.optional && !check.passed)
        .map((check) => check.label);
      return {
        ok: true,
        qualityIssues: getCandidateQualityIssues(candidate),
        requiredMissing,
        optionalMissing,
        checks: checks.map((check) => ({
          id: check.id,
          label: check.label,
          passed: Boolean(check.passed),
          optional: Boolean(check.optional),
        })),
      };
    },

    'kb.updateDraft': async (params = {}) => {
      const rawFields = params.fields && typeof params.fields === 'object' ? params.fields : {};
      const mode = params.mode === 'explicit' ? 'explicit' : 'proactive';
      const candidate = await loadCandidate();

      // Step 1: separate forbidden keys (crown-jewel boundary) from unknown keys
      // and from real editable keys.
      const strippedForbidden = [];
      const ignoredUnknown = [];
      const requested = {};
      for (const [key, value] of Object.entries(rawFields)) {
        if (FORBIDDEN_FIELDS.has(key)) {
          strippedForbidden.push(key);
          continue;
        }
        if (!EDITABLE_FIELD_SET.has(key)) {
          ignoredUnknown.push(key);
          continue;
        }
        requested[key] = value;
      }

      // Step 2: proactive overwrite guard — only fill empty/flagged fields on the
      // agent's own initiative. Non-empty fields are skipped and surfaced so the
      // agent asks the reviewer first.
      const skippedNonEmpty = [];
      const toWrite = {};
      for (const [field, value] of Object.entries(requested)) {
        if (mode === 'proactive' && !isFieldEmpty(candidate[field])) {
          skippedNonEmpty.push(field);
          continue;
        }
        toWrite[field] = value;
      }

      if (Object.keys(toWrite).length === 0) {
        return {
          ok: false,
          applied: false,
          changedFields: [],
          skippedNonEmpty,
          strippedForbidden,
          ignoredUnknown,
          reason: skippedNonEmpty.length
            ? 'All requested fields already have reviewer-authored content. Ask the reviewer before overwriting them, or resend with mode "explicit" only if they asked.'
            : 'No editable fields were provided.',
        };
      }

      // Step 3: capture prior values BEFORE the write (for undo), then write
      // through the governed service with the reviewer actor.
      const priorByField = {};
      for (const field of Object.keys(toWrite)) {
        priorByField[field] = snapshotFieldValue(candidate, field);
      }

      const result = await updateKnowledgeRecord(targetId, toWrite, KB_AGENT_ACTOR);
      const updated = result.record || {};

      const changedFields = Object.keys(toWrite).map((field) => ({
        field,
        prior: priorByField[field],
        next: field in updated ? updated[field] : toWrite[field],
      }));

      const auditEvents = Array.isArray(updated.auditEvents) ? updated.auditEvents : [];
      const lastAudit = auditEvents.length ? auditEvents[auditEvents.length - 1] : null;

      return {
        ok: true,
        applied: true,
        mode,
        changedFields,
        skippedNonEmpty,
        strippedForbidden,
        ignoredUnknown,
        note: safeString(params.note, ''),
        auditEventId: lastAudit?.eventId || '',
        reviewStatus: safeString(updated.reviewStatus, 'draft'),
      };
    },
  };

  return handlers;
}

module.exports = {
  KNOWLEDGEBASE_AGENT_ID,
  KB_AGENT_ACTOR,
  KB_AGENT_TOOL_LINES,
  KB_AGENT_TOOL_METADATA,
  EDITABLE_FIELD_SET,
  EDITABLE_ARRAY_FIELDS,
  FORBIDDEN_FIELDS,
  buildKbAgentToolLines,
  createKbAgentToolHandlers,
};
