'use strict';

const assert = require('node:assert/strict');

const Escalation = require('../../../../server/src/models/Escalation');
const Investigation = require('../../../../server/src/models/Investigation');
const KnowledgeCandidate = require('../../../../server/src/models/KnowledgeCandidate');
const Template = require('../../../../server/src/models/Template');
const {
  buildSliceReport,
  createSeed,
  requestJson,
  resetHarnessStubs,
  writeReport,
} = require('../../../scripts/harness-runner-utils');
const { runWithHarness } = require('../../../scripts/fixtures/common');

const SLICE_ID = 'escalation-domain';

function buildEscalationPayload(seed, suffix) {
  return {
    coid: `COID-${seed}-${suffix}`.slice(0, 80),
    mid: `MID-${suffix}`,
    caseNumber: `CASE-${seed}-${suffix}`.slice(0, 80),
    clientContact: `Harness Contact ${suffix}`,
    agentName: 'Harness Agent',
    attemptingTo: `Resolve a technical payroll export problem for ${seed} ${suffix}.`,
    expectedOutcome: 'Payroll export completes and the customer can continue processing.',
    actualOutcome: 'Payroll export stalls with a repeatable technical validation error.',
    tsSteps: 'Reproduced the validation error, checked payroll settings, and reviewed export logs.',
    triedTestAccount: 'yes',
    category: 'technical',
    resolution: `Harness resolution ${suffix}`,
    resolutionNotes: `Harness notes ${suffix}`,
  };
}

async function cleanupCreated(created) {
  const escalationIds = created.escalationIds.filter(Boolean);
  const investigationIds = created.investigationIds.filter(Boolean);
  const templateIds = created.templateIds.filter(Boolean);

  const deleted = {
    knowledgeCandidates: 0,
    escalations: 0,
    investigations: 0,
    templates: 0,
  };

  if (escalationIds.length > 0) {
    const knowledgeResult = await KnowledgeCandidate.deleteMany({ escalationId: { $in: escalationIds } });
    const escalationResult = await Escalation.deleteMany({ _id: { $in: escalationIds } });
    deleted.knowledgeCandidates = knowledgeResult.deletedCount || 0;
    deleted.escalations = escalationResult.deletedCount || 0;
  }

  if (investigationIds.length > 0) {
    const investigationResult = await Investigation.deleteMany({ _id: { $in: investigationIds } });
    deleted.investigations = investigationResult.deletedCount || 0;
  }

  if (templateIds.length > 0) {
    const templateResult = await Template.deleteMany({ _id: { $in: templateIds } });
    deleted.templates = templateResult.deletedCount || 0;
  }

  const [remainingEscalations, remainingInvestigations, remainingTemplates] = await Promise.all([
    escalationIds.length > 0 ? Escalation.countDocuments({ _id: { $in: escalationIds } }) : 0,
    investigationIds.length > 0 ? Investigation.countDocuments({ _id: { $in: investigationIds } }) : 0,
    templateIds.length > 0 ? Template.countDocuments({ _id: { $in: templateIds } }) : 0,
  ]);

  return {
    deleted,
    remaining: {
      escalations: remainingEscalations,
      investigations: remainingInvestigations,
      templates: remainingTemplates,
    },
  };
}

async function runSlice(context = {}) {
  return runWithHarness(context, async (harness) => {
    const startedAt = new Date();
    const seed = createSeed(SLICE_ID);
    const created = {
      escalationIds: [],
      investigationIds: [],
      templateIds: [],
    };
    let cleanupComplete = false;

    try {
      resetHarnessStubs();

      const sourcePayload = buildEscalationPayload(seed, 'source');
      const referencePayload = buildEscalationPayload(seed, 'reference');

      const sourceCreateRes = await requestJson(harness.baseUrl, '/api/escalations', {
        method: 'POST',
        expectStatus: 201,
        json: sourcePayload,
      });
      const sourceEscalationId = sourceCreateRes.data.escalation._id;
      created.escalationIds.push(sourceEscalationId);

      const referenceCreateRes = await requestJson(harness.baseUrl, '/api/escalations', {
        method: 'POST',
        expectStatus: 201,
        json: referencePayload,
      });
      const referenceEscalationId = referenceCreateRes.data.escalation._id;
      created.escalationIds.push(referenceEscalationId);

      const sourcePatchRes = await requestJson(harness.baseUrl, `/api/escalations/${sourceEscalationId}`, {
        method: 'PATCH',
        json: {
          status: 'resolved',
          resolution: `Resolved by harness runner ${seed}`,
          resolutionNotes: 'Confirmed deterministic escalation-domain workflow.',
        },
      });
      assert.equal(sourcePatchRes.data.escalation.status, 'resolved');
      assert.ok(sourcePatchRes.data.escalation.resolvedAt, 'expected resolvedAt to be set');

      const referencePatchRes = await requestJson(harness.baseUrl, `/api/escalations/${referenceEscalationId}`, {
        method: 'PATCH',
        json: {
          status: 'escalated-further',
          resolution: `Reference escalation for ${seed}`,
        },
      });
      assert.equal(referencePatchRes.data.escalation.status, 'escalated-further');

      const sourceGetRes = await requestJson(harness.baseUrl, `/api/escalations/${sourceEscalationId}`);
      assert.equal(sourceGetRes.data.escalation.caseNumber, sourcePayload.caseNumber);

      const listRes = await requestJson(harness.baseUrl, '/api/escalations', {
        query: {
          caseNumber: sourcePayload.caseNumber,
          limit: 5,
        },
      });
      assert.ok(
        listRes.data.escalations.some((entry) => String(entry._id) === String(sourceEscalationId)),
        'expected exact case-number filter to include the source escalation'
      );

      const similarRes = await requestJson(harness.baseUrl, '/api/escalations/similar', {
        query: {
          category: 'technical',
          limit: 50,
        },
      });
      assert.ok(
        similarRes.data.escalations.some((entry) => String(entry._id) === String(referenceEscalationId)),
        'expected category-only similar search to include the reference escalation'
      );

      const referenceDeleteRes = await requestJson(harness.baseUrl, `/api/escalations/${referenceEscalationId}`, {
        method: 'DELETE',
      });
      assert.equal(referenceDeleteRes.data.ok, true);

      const knowledgeGenerateRes = await requestJson(
        harness.baseUrl,
        `/api/escalations/${sourceEscalationId}/knowledge/generate`,
        {
          method: 'POST',
          query: { enrich: 'false' },
          json: { force: true },
        }
      );
      assert.equal(knowledgeGenerateRes.data.ok, true);
      assert.equal(knowledgeGenerateRes.data.generated, true);
      assert.equal(knowledgeGenerateRes.data.enriched, false);

      const knowledgeGetRes = await requestJson(harness.baseUrl, `/api/escalations/${sourceEscalationId}/knowledge`);
      assert.equal(knowledgeGetRes.data.ok, true);
      assert.ok(knowledgeGetRes.data.knowledge, 'expected generated knowledge draft');

      const knowledgePatchRes = await requestJson(harness.baseUrl, `/api/escalations/${sourceEscalationId}/knowledge`, {
        method: 'PATCH',
        json: {
          reviewStatus: 'approved',
          publishTarget: 'case-history-only',
          reusableOutcome: 'case-history-only',
          title: `Harness knowledge ${seed}`,
          summary: 'Harness-approved deterministic knowledge draft.',
          symptom: 'Payroll export validation error',
          rootCause: 'Harness technical scenario',
          exactFix: 'Use the deterministic harness resolution.',
          keySignals: ['payroll export', 'validation error'],
          confidence: 0.8,
        },
      });
      assert.equal(knowledgePatchRes.data.knowledge.reviewStatus, 'approved');

      const knowledgeCandidatesRes = await requestJson(harness.baseUrl, '/api/escalations/knowledge-candidates', {
        query: {
          reviewStatus: 'approved',
          limit: 20,
        },
      });
      assert.ok(
        knowledgeCandidatesRes.data.candidates.some((entry) => String(entry.escalationId?._id || entry.escalationId) === String(sourceEscalationId)),
        'expected approved knowledge candidate list to include the source escalation'
      );

      const blockedPublishRes = await requestJson(
        harness.baseUrl,
        `/api/escalations/${sourceEscalationId}/knowledge/publish`,
        {
          method: 'POST',
          expectStatus: 409,
          json: {},
        }
      );
      assert.equal(blockedPublishRes.data.code, 'KNOWLEDGE_NOT_PUBLISHABLE');

      const invNumber = `INV-${seed}`.slice(0, 80);
      const investigationSubject = `Technical payroll export validation problem ${seed}`;
      const investigationCreateRes = await requestJson(harness.baseUrl, '/api/investigations', {
        method: 'POST',
        expectStatus: 201,
        json: {
          invNumber,
          subject: investigationSubject,
          agentName: 'Harness Agent',
          team: 'Harness',
          category: 'technical',
          source: 'manual',
          notes: 'Created by escalation-domain stress runner.',
          details: 'Deterministic investigation details.',
          workaround: 'Retry after clearing the export queue.',
          symptoms: ['payroll export', 'validation error'],
        },
      });
      const investigationId = investigationCreateRes.data.investigation._id;
      created.investigationIds.push(investigationId);

      const investigationDuplicateRes = await requestJson(harness.baseUrl, '/api/investigations', {
        method: 'POST',
        expectStatus: 200,
        json: {
          invNumber,
          subject: `Duplicate probe ${seed}`,
        },
      });
      assert.equal(investigationDuplicateRes.data.duplicate, true);

      const investigationListRes = await requestJson(harness.baseUrl, '/api/investigations', {
        query: {
          search: investigationSubject,
          limit: 5,
        },
      });
      assert.ok(
        investigationListRes.data.investigations.some((entry) => String(entry._id) === String(investigationId)),
        'expected investigation list search to include created investigation'
      );

      const investigationSearchRes = await requestJson(harness.baseUrl, '/api/investigations/search', {
        query: { q: invNumber },
      });
      assert.ok(Array.isArray(investigationSearchRes.data.results));

      const investigationMatchRes = await requestJson(harness.baseUrl, '/api/investigations/match', {
        query: {
          q: 'technical payroll export validation problem',
          category: 'technical',
        },
      });
      assert.ok(Array.isArray(investigationMatchRes.data.matches));

      const investigationPatchRes = await requestJson(harness.baseUrl, `/api/investigations/${investigationId}`, {
        method: 'PATCH',
        json: {
          status: 'in-progress',
          workaround: 'Harness workaround updated.',
        },
      });
      assert.equal(investigationPatchRes.data.investigation.status, 'in-progress');

      const investigationStatsRes = await requestJson(harness.baseUrl, '/api/investigations/stats');
      assert.equal(investigationStatsRes.data.ok, true);
      assert.ok(investigationStatsRes.data.stats.total >= 1);

      const investigationDeleteRes = await requestJson(harness.baseUrl, `/api/investigations/${investigationId}`, {
        method: 'DELETE',
      });
      assert.equal(investigationDeleteRes.data.ok, true);

      const templateCreateRes = await requestJson(harness.baseUrl, '/api/templates', {
        method: 'POST',
        expectStatus: 201,
        json: {
          category: 'technical',
          title: `Harness technical template ${seed}`,
          body: 'Hello {{CLIENT_NAME}}, case [CASE_NUMBER] is being handled by {{AGENT_NAME}}.',
          variables: ['CLIENT_NAME', 'CASE_NUMBER', 'AGENT_NAME'],
        },
      });
      const templateId = templateCreateRes.data.template._id;
      created.templateIds.push(templateId);

      const templateRenderRes = await requestJson(harness.baseUrl, `/api/templates/${templateId}/render`, {
        method: 'POST',
        json: {
          variables: {
            CLIENT_NAME: 'Harness Customer',
            CASE_NUMBER: sourcePayload.caseNumber,
            AGENT_NAME: 'Harness Agent',
          },
        },
      });
      assert.match(templateRenderRes.data.rendered, /Harness Customer/);
      assert.deepEqual(templateRenderRes.data.unresolvedVars, []);

      const templateUseRes = await requestJson(harness.baseUrl, `/api/templates/${templateId}/use`, {
        method: 'POST',
        json: {},
      });
      assert.equal(templateUseRes.data.usageCount, 1);

      const templateDuplicateRes = await requestJson(harness.baseUrl, `/api/templates/${templateId}/duplicate`, {
        method: 'POST',
        expectStatus: 201,
        json: {},
      });
      const duplicateTemplateId = templateDuplicateRes.data.template._id;
      created.templateIds.push(duplicateTemplateId);
      assert.match(templateDuplicateRes.data.template.title, /\(copy\)$/);

      const templateListRes = await requestJson(harness.baseUrl, '/api/templates', {
        query: { category: 'technical' },
      });
      assert.ok(
        templateListRes.data.templates.some((entry) => String(entry._id) === String(templateId)),
        'expected template list to include created template'
      );

      const duplicateTemplateDeleteRes = await requestJson(harness.baseUrl, `/api/templates/${duplicateTemplateId}`, {
        method: 'DELETE',
      });
      assert.equal(duplicateTemplateDeleteRes.data.ok, true);

      const invalidSimilarRes = await requestJson(harness.baseUrl, '/api/escalations/similar', {
        expectStatus: 400,
      });
      assert.equal(invalidSimilarRes.data.code, 'MISSING_PARAMS');

      const missingTemplateFieldsRes = await requestJson(harness.baseUrl, '/api/templates', {
        method: 'POST',
        expectStatus: 400,
        json: {
          category: 'technical',
        },
      });
      assert.equal(missingTemplateFieldsRes.data.code, 'MISSING_FIELDS');

      const missingInvestigationFieldsRes = await requestJson(harness.baseUrl, '/api/investigations', {
        method: 'POST',
        expectStatus: 400,
        json: {
          subject: 'Missing inv number',
        },
      });
      assert.equal(missingInvestigationFieldsRes.data.code, 'MISSING_FIELDS');

      const cleanup = await cleanupCreated(created);
      cleanupComplete = true;
      assert.deepEqual(cleanup.remaining, {
        escalations: 0,
        investigations: 0,
        templates: 0,
      });

      const finishedAt = new Date();
      const report = buildSliceReport(SLICE_ID, {
        description: 'Exercises escalation CRUD/search/similar, deterministic knowledge drafts, investigation workflows, and template render/use/duplicate behavior through public HTTP APIs.',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        seed,
        baseUrl: harness.baseUrl,
        startupControls: harness.startupControls || null,
        fixtures: [
          {
            id: 'escalation-crud-filter-similar',
            kind: 'workflow',
            description: 'Create two escalations, resolve/update them, fetch by id, filter by case number, find similar by category, and delete the reference escalation.',
            ok: true,
            escalationId: sourceEscalationId,
            assertions: {
              sourceStatus: sourcePatchRes.data.escalation.status,
              sourceResolvedAtSet: Boolean(sourcePatchRes.data.escalation.resolvedAt),
              exactCaseFilterCount: listRes.data.escalations.length,
              similarCount: similarRes.data.count,
              referenceDeleteOk: referenceDeleteRes.data.ok,
            },
          },
          {
            id: 'knowledge-draft-review-gates',
            kind: 'workflow',
            description: 'Generate a deterministic knowledge draft for a resolved escalation, approve it, list it, and verify case-history-only publish is blocked safely.',
            ok: true,
            escalationId: sourceEscalationId,
            assertions: {
              generated: knowledgeGenerateRes.data.generated,
              enriched: knowledgeGenerateRes.data.enriched,
              reviewStatus: knowledgePatchRes.data.knowledge.reviewStatus,
              candidateListCount: knowledgeCandidatesRes.data.candidates.length,
              blockedPublishCode: blockedPublishRes.data.code,
            },
          },
          {
            id: 'investigation-create-search-update-delete',
            kind: 'workflow',
            description: 'Create an investigation, verify duplicate prevention, list/search/match/stats, patch status, and delete it.',
            ok: true,
            investigationId,
            assertions: {
              createdInvNumber: investigationCreateRes.data.investigation.invNumber,
              duplicatePrevented: investigationDuplicateRes.data.duplicate,
              listSearchCount: investigationListRes.data.investigations.length,
              searchResultCount: investigationSearchRes.data.results.length,
              matchCount: investigationMatchRes.data.matches.length,
              patchedStatus: investigationPatchRes.data.investigation.status,
              statsTotal: investigationStatsRes.data.stats.total,
              deleteOk: investigationDeleteRes.data.ok,
            },
          },
          {
            id: 'template-render-use-duplicate-delete',
            kind: 'workflow',
            description: 'Create a template, render variables, increment usage, duplicate it, list by category, and delete the duplicate.',
            ok: true,
            templateId,
            assertions: {
              renderedIncludesClient: templateRenderRes.data.rendered.includes('Harness Customer'),
              unresolvedVarCount: templateRenderRes.data.unresolvedVars.length,
              usageCount: templateUseRes.data.usageCount,
              duplicateTitle: templateDuplicateRes.data.template.title,
              templateListCount: templateListRes.data.templates.length,
              duplicateDeleteOk: duplicateTemplateDeleteRes.data.ok,
            },
          },
          {
            id: 'domain-validation-failures',
            kind: 'validation',
            description: 'Verify validation failures for missing similar-search params, incomplete template create, and incomplete investigation create.',
            ok: true,
            assertions: {
              missingSimilarCode: invalidSimilarRes.data.code,
              missingTemplateFieldsCode: missingTemplateFieldsRes.data.code,
              missingInvestigationFieldsCode: missingInvestigationFieldsRes.data.code,
            },
          },
          {
            id: 'seeded-domain-data-cleanup',
            kind: 'cleanup',
            description: 'Remove all runner-created escalations, knowledge candidates, investigations, and templates from the stress database.',
            ok: true,
            assertions: {
              remainingEscalations: cleanup.remaining.escalations,
              remainingInvestigations: cleanup.remaining.investigations,
              remainingTemplates: cleanup.remaining.templates,
              deletedEscalations: cleanup.deleted.escalations,
              deletedTemplates: cleanup.deleted.templates,
            },
          },
        ],
        notes: [
          `Source escalation ${sourceEscalationId} generated and approved a deterministic knowledge draft.`,
          `Investigation ${invNumber} verified duplicate prevention and route-level delete.`,
          'Runner-created domain data was cleaned up before writing the report.',
        ],
      });

      const paths = writeReport(SLICE_ID, report);
      report.paths = paths;
      return report;
    } finally {
      if (!cleanupComplete) {
        await cleanupCreated(created).catch((err) => {
          console.warn(`[${SLICE_ID}] cleanup failed:`, err.message);
        });
      }
    }
  });
}

if (require.main === module) {
  runSlice().then((report) => {
    console.log(JSON.stringify({
      slice: report.slice,
      ok: report.ok,
      reportPath: report.paths.reportPath,
    }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }).catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
}

module.exports = {
  SLICE_ID,
  cleanupCreated,
  runSlice,
};
