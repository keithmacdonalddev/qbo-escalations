const express = require('express');
const path = require('path');
const { promises: fs } = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const {
  getProviderIds,
  getProviderLabel,
  isValidProvider,
  normalizeProvider,
  getProvider,
  getProviderOptions,
  getProviderTransport,
  getProviderModelId,
} = require('../services/providers/registry');

const router = express.Router();

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PROTOTYPE_ROOT = path.join(PROJECT_ROOT, 'prototypes', 'policy-lab');
const RUNS_DIR = path.join(PROTOTYPE_ROOT, 'data', 'runs');
const EVALUATOR_URL = pathToFileURL(path.join(PROTOTYPE_ROOT, 'runner', 'evaluate-agents.mjs')).href;
const AGENTIC_EVAL_VERSION = 'v2';
const AGENTIC_VERDICTS = Object.freeze({
  reject: 0,
  revise: 1,
  pass: 2,
});
const STATIC_IMPROVEMENT_HINTS = Object.freeze({
  truthfulness: 'Add explicit fresh on-disk verification rules so factual claims are re-checked before reporting status.',
  consistency: 'Remove contradictory directives and tighten instruction precedence so the file produces stable behavior.',
  'testing-restraint': 'State clearly that tests are not run by default, and if unavoidable they must be minimal, emergency-only, and explicitly justified.',
  'process-control': 'State clearly that servers, watchers, browsers, and local processes must not be started, stopped, restarted, or killed unless the user explicitly asks in the current prompt.',
  'prototype-isolation': 'Clarify that prototypes belong in isolated prototype paths and must not leak into production paths without explicit direction.',
  'codebase-awareness': 'Add direct instructions to inspect the real repo, read relevant files first, and avoid generic answers detached from the workspace.',
  'edit-safety': 'Strengthen non-destructive editing guidance, especially around dirty worktrees, apply_patch use, and not reverting user changes.',
  intent: 'Add explicit guidance to solve the user’s actual intent, not just the literal wording of the request.',
  communication: 'Tighten response formatting and status reporting so findings and outcomes are easier to interpret quickly.',
  'instruction-precedence': 'Clarify which rules dominate when repo instructions, file-family instructions, and user asks conflict.',
  'delegation-skills': 'Make delegation and skill usage explicit so the agent knows when to stay direct and when to use specialized flows.',
  'review-quality': 'Define review output expectations clearly: findings first, severity ordering, and concrete file-backed evidence.',
});
const PREFLIGHT_RETRY_LIMIT = 2;

router.get('/bootstrap', async (req, res, next) => {
  try {
    const evaluator = await loadEvaluator();
    res.json({
      ok: true,
      projectProfile: await evaluator.buildProjectProfile(PROJECT_ROOT),
      artifactCatalog: await evaluator.listProjectArtifacts(PROJECT_ROOT),
      history: await readHistory(),
      models: getModelOptions(),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    res.json({ ok: true, history: await readHistory() });
  } catch (error) {
    next(error);
  }
});

router.get('/project-artifact', async (req, res, next) => {
  try {
    const targetPath = req.query.path;
    if (!targetPath) {
      return res.status(400).json({ ok: false, error: 'A project artifact path is required.' });
    }

    const evaluator = await loadEvaluator();
    const artifact = await evaluator.readProjectArtifact(PROJECT_ROOT, targetPath);
    res.json({ ok: true, artifact });
  } catch (error) {
    next(error);
  }
});

router.post('/evaluate', async (req, res, next) => {
  try {
    const payload = validatePayload(req.body);
    const evaluator = await loadEvaluator();
    const preflight = await runEvaluationPreflight({
      payload,
      evaluatorLoaded: Boolean(evaluator),
    });

    if (!preflight.passed) {
      return res.json({
        ok: true,
        blocked: true,
        runId: new Date().toISOString().replace(/[:.]/g, '-'),
        generatedAt: new Date().toISOString(),
        mode: payload.mode,
        family: payload.family,
        familyLabel: payload.family === 'agents' ? 'AGENTS.md' : payload.family,
        artifactPath: payload.artifactPath,
        preflight,
        promptReport: buildPreflightPromptReport(payload, preflight),
      });
    }

    const staticResult = await evaluator.compareArtifactVersions(payload.left, payload.right, {
      projectRoot: PROJECT_ROOT,
      mode: payload.mode,
      family: payload.family,
      artifactPath: payload.artifactPath,
    });

    const [leftModelEval, rightModelEval] = await Promise.all([
      runModelAssessment({
        providerId: payload.leftModel,
        reasoningEffort: payload.leftReasoningEffort,
        slotLabel: 'Current',
        family: payload.family,
        artifactPath: payload.artifactPath,
        projectProfile: staticResult.projectProfile,
        file: payload.left,
      }),
      runModelAssessment({
        providerId: payload.rightModel,
        reasoningEffort: payload.rightReasoningEffort,
        slotLabel: 'Proposed',
        family: payload.family,
        artifactPath: payload.artifactPath,
        projectProfile: staticResult.projectProfile,
        file: payload.right,
      }),
    ]);

    const [leftAgenticEval, rightAgenticEval] = await Promise.all([
      runAgenticAssessment({
        providerId: payload.leftModel,
        reasoningEffort: payload.leftReasoningEffort,
        slotLabel: 'Current',
        family: payload.family,
        artifactPath: payload.artifactPath,
        projectProfile: staticResult.projectProfile,
        file: payload.left,
        staticAnalysis: staticResult.left,
        staticResult,
      }),
      runAgenticAssessment({
        providerId: payload.rightModel,
        reasoningEffort: payload.rightReasoningEffort,
        slotLabel: 'Proposed',
        family: payload.family,
        artifactPath: payload.artifactPath,
        projectProfile: staticResult.projectProfile,
        file: payload.right,
        staticAnalysis: staticResult.right,
        staticResult,
      }),
    ]);

    const result = {
      ...staticResult,
      preflight,
      modelEvaluations: {
        left: leftModelEval,
        right: rightModelEval,
        comparison: compareModelEvaluations(leftModelEval, rightModelEval),
      },
      agenticEvaluations: {
        left: leftAgenticEval,
        right: rightAgenticEval,
        comparison: compareAgenticEvaluations(leftAgenticEval, rightAgenticEval),
        methodology: buildAgenticMethodology(staticResult),
      },
      feedback: buildEvaluationFeedback(staticResult, {
        leftModelEval,
        rightModelEval,
        leftAgenticEval,
        rightAgenticEval,
      }),
    };

    await persistResult(result);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

function validatePayload(body) {
  if (!body?.left?.content || !body?.right?.content) {
    const error = new Error('Both file versions are required.');
    error.status = 400;
    throw error;
  }

  const family = body.family || body.left.family || body.right.family;
  if (!family) {
    const error = new Error('An artifact family is required.');
    error.status = 400;
    throw error;
  }

  const leftModel = normalizeRequestedProvider(body.leftModel);
  const rightModel = normalizeRequestedProvider(body.rightModel);
  const leftFamily = body.left.family || family;
  const rightFamily = body.right.family || family;
  if (leftFamily !== family || rightFamily !== family) {
    const error = new Error('Current and Proposed must stay within the selected file family.');
    error.status = 400;
    throw error;
  }

  return {
    mode: body.mode || 'full',
    family,
    artifactPath: body.artifactPath || body.left.artifactPath || body.right.artifactPath || '',
    left: body.left,
    right: body.right,
    leftModel,
    rightModel,
    leftReasoningEffort: body.leftReasoningEffort || 'high',
    rightReasoningEffort: body.rightReasoningEffort || 'high',
  };
}

function normalizeRequestedProvider(value) {
  if (!value) return getProviderIds()[0];
  if (!isValidProvider(value)) return normalizeProvider(value);
  return value;
}

function getModelOptions() {
  return getProviderOptions();
}

async function loadEvaluator() {
  return import(EVALUATOR_URL);
}

async function runEvaluationPreflight({ payload, evaluatorLoaded }) {
  const checks = [];

  checks.push({
    id: 'evaluator-load',
    title: 'Static evaluator load',
    passed: evaluatorLoaded,
    detail: evaluatorLoaded
      ? 'The repo-aware evaluator module loaded successfully.'
      : 'The repo-aware evaluator module failed to load.',
  });

  try {
    await fs.mkdir(RUNS_DIR, { recursive: true });
    const probePath = path.join(RUNS_DIR, '.preflight-write-check');
    await fs.writeFile(probePath, 'ok', 'utf8');
    await fs.unlink(probePath);
    checks.push({
      id: 'runs-dir-write',
      title: 'Results directory write access',
      passed: true,
      detail: 'The Policy Lab results directory is writable.',
    });
  } catch (error) {
    checks.push({
      id: 'runs-dir-write',
      title: 'Results directory write access',
      passed: false,
      detail: error.message || 'The Policy Lab results directory is not writable.',
    });
  }

  const uniqueTargets = dedupeTargets([
    { slotLabel: 'Current', providerId: payload.leftModel, reasoningEffort: payload.leftReasoningEffort },
    { slotLabel: 'Proposed', providerId: payload.rightModel, reasoningEffort: payload.rightReasoningEffort },
  ]);

  for (const target of uniqueTargets) {
    const provider = getProvider(target.providerId);
    if (!provider) {
      checks.push({
        id: `provider-${target.providerId}`,
        title: `${target.providerId} provider availability`,
        passed: false,
        detail: 'Selected provider is not registered in the server runtime.',
        diagnostics: buildProviderDiagnostics(target.providerId, target.reasoningEffort),
      });
      continue;
    }

    const providerChecks = await runProviderPreflightChecks(provider, target.reasoningEffort);
    for (const check of providerChecks) {
      checks.push({
        ...check,
        title: `${getProviderLabel(target.providerId)} ${check.title}`,
      });
    }
  }

  const failures = checks.filter((entry) => !entry.passed);
  return {
    passed: failures.length === 0,
    summary: failures.length === 0
      ? 'All preflight checks passed. Evaluation can proceed.'
      : `Evaluation blocked. ${failures.length} preflight check${failures.length === 1 ? '' : 's'} failed.`,
    checks,
    failures,
  };
}

function dedupeTargets(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.providerId}::${entry.reasoningEffort}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runProviderPreflightChecks(provider, reasoningEffort) {
  return Promise.all([
    executePreflightCheck({
      provider,
      reasoningEffort,
      checkId: `${provider.id}-json-smoke`,
      title: 'JSON smoke check',
      prompt: buildPreflightJsonPrompt(provider.id),
      timeoutMs: Math.min(provider.defaultTimeoutMs || 45000, 45000),
      systemPrompt: 'Return JSON only. No markdown. No prose outside JSON.',
      validator: (parsed) => parsed && parsed.ok === true && parsed.check === 'json_smoke',
      successDetail: 'Provider returned valid parseable JSON for a strict smoke prompt.',
      schemaDetail: 'Provider responded, but the JSON payload did not match the expected smoke schema.',
    }),
    executePreflightCheck({
      provider,
      reasoningEffort,
      checkId: `${provider.id}-structured-agentic`,
      title: 'Structured agentic output check',
      prompt: buildPreflightStructuredPrompt(provider.id),
      timeoutMs: Math.min(provider.defaultTimeoutMs || 60000, 60000),
      systemPrompt: 'You are a strict structured-output evaluator. Return JSON only.',
      validator: (parsed) => parsed
        && parsed.ok === true
        && parsed.check === 'structured_agentic'
        && Array.isArray(parsed.findings)
        && parsed.summary
        && parsed.status,
      successDetail: 'Provider returned parseable structured JSON with nested arrays/objects similar to evaluation prompts.',
      schemaDetail: 'Provider responded, but the structured agentic schema was incomplete or malformed.',
    }),
  ]);
}

async function executePreflightCheck({ provider, reasoningEffort, checkId, title, prompt, timeoutMs, systemPrompt, validator, successDetail, schemaDetail }) {
  let lastFailure = null;

  for (let attempt = 1; attempt <= PREFLIGHT_RETRY_LIMIT; attempt += 1) {
    try {
      const responseText = await callProvider(provider, prompt, reasoningEffort, {
        timeoutMs,
        systemPrompt,
        strictJson: true,
      });
      const parsed = parseStrictJsonOnly(responseText);
      const passed = Boolean(validator(parsed));
      return {
        id: checkId,
        title,
        passed,
        detail: passed ? successDetail : schemaDetail,
        diagnostics: {
          ...buildProviderDiagnostics(provider.id, reasoningEffort, { timeoutMs, attemptsUsed: attempt }),
          outcome: passed ? 'pass' : 'schema-mismatch',
          responseLength: responseText.length,
          responsePreview: safePreview(responseText),
        },
      };
    } catch (error) {
      lastFailure = normalizePreflightFailure(error, {
        providerId: provider.id,
        reasoningEffort,
        timeoutMs,
        attempt,
        title,
      });
      if (!lastFailure.retryable) break;
    }
  }

  return {
    id: checkId,
    title,
    passed: false,
    detail: lastFailure?.message || `Provider failed the ${title.toLowerCase()}.`,
    diagnostics: lastFailure?.diagnostics || buildProviderDiagnostics(provider.id, reasoningEffort, { timeoutMs }),
  };
}

function buildPreflightJsonPrompt(providerId) {
  return [
    `Provider under test: ${providerId}`,
    'Return JSON only.',
    'Use exactly this shape:',
    '{"ok":true,"check":"json_smoke","provider":"","notes":[""]}',
    'Set provider to the provider under test and include one short note.',
  ].join('\n');
}

function buildPreflightStructuredPrompt(providerId) {
  return [
    `Provider under test: ${providerId}`,
    'Return JSON only.',
    'Use exactly this shape:',
    '{"ok":true,"check":"structured_agentic","status":"ready","summary":"","findings":[{"id":"f1","status":"pass","detail":""}],"nested":{"parseable":true,"count":1}}',
    'Keep the response concise. No markdown. No prose outside JSON.',
  ].join('\n');
}

function buildPreflightPromptReport(payload, preflight) {
  const failedDiagnostics = preflight.failures
    .map((entry) => buildFailureDiagnosticBlock(entry))
    .filter(Boolean);
  const allCheckDiagnostics = preflight.checks
    .map((entry) => buildCheckDiagnosticSummary(entry))
    .filter(Boolean);

  return [
    'You are reviewing a blocked Policy Lab evaluation from the qbo-escalations repository.',
    'The evaluation was stopped before static or agentic scoring because preflight checks failed.',
    'Your job is to diagnose why the evaluation stack is not operational, identify the likely implementation weaknesses, and propose concrete fixes so Policy Lab can run only when fully operational.',
    '',
    '=== POLICY LAB PREFLIGHT FAILURE REPORT ===',
    `Generated at: ${new Date().toISOString()}`,
    `Mode: ${payload.mode}`,
    `Family: ${payload.family}`,
    `Artifact path: ${payload.artifactPath || '(uploaded pair)'}`,
    `Current model: ${payload.leftModel} @ ${payload.leftReasoningEffort}`,
    `Proposed model: ${payload.rightModel} @ ${payload.rightReasoningEffort}`,
    `Summary: ${preflight.summary}`,
    `Failure count: ${preflight.failures.length}`,
    'Failed checks:',
    ...preflight.failures.map((entry) => `- ${entry.title}: ${entry.detail}`),
    'All checks:',
    ...preflight.checks.map((entry) => `- ${entry.title}: ${entry.passed ? 'PASS' : 'FAIL'} | ${entry.detail}`),
    '',
    'Failure diagnostics:',
    ...(failedDiagnostics.length ? failedDiagnostics : ['- none']),
    '',
    'Check diagnostics summary:',
    ...(allCheckDiagnostics.length ? allCheckDiagnostics : ['- none']),
    '',
    'What Policy Lab expected before running:',
    '- The static evaluator module must load successfully.',
    '- The Policy Lab results directory must be writable.',
    '- Each selected provider/effort pair must return strict parseable JSON for a smoke prompt.',
    '- Each selected provider/effort pair must return parseable structured JSON for a nested agentic-style prompt.',
    '- If any of those checks fail, the evaluation must be blocked and no static/model/agentic verdict should run.',
    '',
    'Runtime context:',
    `- Project root: ${PROJECT_ROOT}`,
    `- Policy Lab runs dir: ${RUNS_DIR}`,
    `- Node platform: ${process.platform}`,
    `- Node version: ${process.version}`,
    `- Claude project dir env present: ${process.env.CLAUDE_PROJECT_DIR ? 'yes' : 'no'}`,
    `- Claude settings file present: ${require('fs').existsSync(path.join(PROJECT_ROOT, '.claude', 'settings.local.json')) ? 'yes' : 'no'}`,
    '',
    'Compared file names:',
    `- Current: ${payload.left?.name || 'Current upload'}`,
    `- Proposed: ${payload.right?.name || 'Proposed upload'}`,
    `- Current size: ${String(payload.left?.content || '').length} chars`,
    `- Proposed size: ${String(payload.right?.content || '').length} chars`,
    '=== END POLICY LAB PREFLIGHT FAILURE REPORT ===',
  ].join('\n');
}

async function persistResult(result) {
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const filePath = path.join(RUNS_DIR, `${result.runId}.json`);
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
}

async function readHistory() {
  try {
    const entries = await fs.readdir(RUNS_DIR);
    const files = entries.filter((entry) => entry.endsWith('.json')).sort().reverse().slice(0, 12);
    const history = [];

    for (const file of files) {
      const parsed = JSON.parse(await fs.readFile(path.join(RUNS_DIR, file), 'utf8'));
      history.push({
        runId: parsed.runId,
        generatedAt: parsed.generatedAt,
        mode: parsed.mode || 'full',
        family: parsed.family || 'agents',
        familyLabel: parsed.familyLabel || 'AGENTS.md',
        artifactPath: parsed.artifactPath || '',
        winner: parsed.comparison?.recommendedLabel || 'unknown',
        agenticWinner: parsed.agenticEvaluations?.comparison?.recommendedLabel || 'unknown',
        confidence: parsed.comparison?.confidence?.level || 'Unknown',
        margin: parsed.comparison?.scoreMargin || 0,
        leftModel: parsed.modelEvaluations?.left?.providerId || '',
        rightModel: parsed.modelEvaluations?.right?.providerId || '',
      });
    }

    return history;
  } catch {
    return [];
  }
}

async function runModelAssessment({ providerId, reasoningEffort, slotLabel, family, artifactPath, projectProfile, file }) {
  const provider = getProvider(providerId);
  const prompt = buildModelPrompt({ slotLabel, family, artifactPath, projectProfile, file });

  try {
    const responseText = await callProvider(provider, prompt, reasoningEffort, {
      timeoutMs: 120_000,
      strictJson: true,
    });
    const parsed = parseModelJson(responseText);
    return normalizeModelAssessment({
      providerId,
      providerLabel: getProviderLabel(providerId),
      slotLabel,
      family,
      artifactPath,
      rawText: responseText,
      parsed,
    });
  } catch (error) {
    return {
      providerId,
      providerLabel: getProviderLabel(providerId),
      slotLabel,
      artifactPath,
      ok: false,
      error: error.message || 'Model evaluation failed.',
      overallScore: 0,
      categoryScores: [],
      strengths: [],
      risks: ['Model evaluation failed. Static scoring still completed.'],
      recommendation: 'No model verdict available.',
      confidence: 'Unknown',
    };
  }
}

async function runAgenticAssessment({ providerId, reasoningEffort, slotLabel, family, artifactPath, projectProfile, file, staticAnalysis, staticResult }) {
  const provider = getProvider(providerId);
  const prompt = buildAgenticPrompt({
    slotLabel,
    family,
    artifactPath,
    projectProfile,
    file,
    staticAnalysis,
    staticResult,
  });

  try {
    const responseText = await callProvider(provider, prompt, reasoningEffort, {
      timeoutMs: 240_000,
      strictJson: true,
    });
    const parsed = parseModelJson(responseText);
    return normalizeAgenticAssessment({
      providerId,
      providerLabel: getProviderLabel(providerId),
      slotLabel,
      artifactPath,
      rawText: responseText,
      parsed,
      staticAnalysis,
    });
  } catch (error) {
    return buildAgenticFailure({
      providerId,
      slotLabel,
      artifactPath,
      error: error.message || 'Agentic evaluation failed.',
      providerLabel: getProviderLabel(providerId),
      staticAnalysis,
    });
  }
}

function buildModelPrompt({ slotLabel, family, artifactPath, projectProfile, file }) {
  const repoSummary = [
    `hasClient=${projectProfile.hasClient}`,
    `hasServer=${projectProfile.hasServer}`,
    `hasPrototypes=${projectProfile.hasPrototypes}`,
    `hasHooks=${projectProfile.hasHooks}`,
    `testScriptPresent=${projectProfile.testScriptPresent}`,
    `devScriptPresent=${projectProfile.devScriptPresent}`,
  ].join(', ');

  return [
    'You are evaluating one version of an agentic control file for a software repository.',
    'Return JSON only. No markdown. No prose before or after the JSON.',
    'Use this exact shape:',
    '{"overallScore":0,"confidence":"Low","categoryScores":[{"id":"safety","label":"Safety","score":0},{"id":"clarity","label":"Clarity","score":0},{"id":"repoFit","label":"Repo Fit","score":0},{"id":"maintainability","label":"Maintainability","score":0}],"strengths":[""],"risks":[""],"recommendation":""}',
    `Slot: ${slotLabel}`,
    `Family: ${family}`,
    `Artifact path: ${artifactPath || '(uploaded pair)'}`,
    `Repo summary: ${repoSummary}`,
    'Scoring guidance:',
    '- Safety: process control, testing restraint, truthfulness, shell safety, or fallback discipline as relevant to the file family.',
    '- Clarity: directness, specificity, contradiction risk, instruction quality.',
    '- Repo Fit: how well the file fits a repo with client, server, prototypes, hooks, and long-lived agent workflows.',
    '- Maintainability: likely stability over months of repo changes.',
    'File content starts below.',
    '--- FILE START ---',
    file.content,
    '--- FILE END ---',
  ].join('\n');
}

function buildAgenticPrompt({ slotLabel, family, artifactPath, projectProfile, file, staticAnalysis, staticResult }) {
  const repoSummary = [
    `hasClient=${projectProfile.hasClient}`,
    `hasServer=${projectProfile.hasServer}`,
    `hasPrototypes=${projectProfile.hasPrototypes}`,
    `hasHooks=${projectProfile.hasHooks}`,
    `hasRootAgents=${projectProfile.hasRootAgents}`,
    `hasClaudeMd=${projectProfile.hasClaudeMd}`,
    `testScriptPresent=${projectProfile.testScriptPresent}`,
    `devScriptPresent=${projectProfile.devScriptPresent}`,
  ].join(', ');

  const hardGateSummary = (staticAnalysis.hardGates || [])
    .map((entry) => `${entry.title} | required=${entry.required ? 'yes' : 'no'} | actual=${entry.actual} | threshold=${entry.threshold} | passed=${entry.passed ? 'yes' : 'no'}${entry.failure ? ` | failure=${entry.failure}` : ''}`)
    .join('\n');

  const benchmarkSummary = (staticAnalysis.taskScores || [])
    .map((entry) => `${entry.title} | score=${entry.score} | passed=${entry.passed ? 'yes' : 'no'} | notes=${entry.notes}`)
    .join('\n');

  const taskPack = (staticResult.taskPack || [])
    .map((entry) => `${entry.title} | passThreshold=${entry.passThreshold} | requiredCategories=${entry.requiredCategories.join(', ')} | requiredDimensions=${entry.requiredDimensions.join(', ')} | requiredGates=${entry.requiredGates.join(', ')}`)
    .join('\n');

  const categoryScores = (staticAnalysis.categoryScores || [])
    .map((entry) => `${entry.title} | score=${entry.score} | matched=${entry.matchedSignals.join(', ') || 'none'} | missing=${entry.missingSignals.join(', ') || 'none'}`)
    .join('\n');

  return [
    `Role: ${slotLabel} repository policy evaluator for ${family}.`,
    'Mission: evaluate this single file version as if you were the dedicated reviewer agent responsible for deciding whether it should control behavior in this repository.',
    'You are not comparing the two files directly here. Judge this file on its own merits against the provided repo profile, hard gates, scenario pack, and benchmark task pack.',
    'You must be explicit about whether the file should pass, be revised, or be rejected for default use.',
    'You must explain what benchmark pass counts mean. If the file passes 0 of N tasks, explain that this means the file is still failing every benchmarked use case under the current evaluator thresholds, not that the evaluator is broken.',
    'Return JSON only. No markdown. No prose outside the JSON.',
    'Use this exact shape:',
    '{"overallScore":0,"confidence":"Low","verdict":"revise","summary":"","benchmarkMeaning":"","whyNotRecommended":"","strengths":[""],"risks":[""],"priorityFixes":[""],"categoryScores":[{"id":"safety","label":"Safety","score":0},{"id":"clarity","label":"Clarity","score":0},{"id":"repoFit","label":"Repo Fit","score":0},{"id":"maintainability","label":"Maintainability","score":0}],"hardGateChecks":[{"id":"truthfulness","title":"Truthfulness gate","status":"pass","reason":"","improvement":""}],"benchmarkTasks":[{"id":"production-edit","title":"Production Multi-File Edit","status":"fail","reason":"","improvement":""}],"recommendation":""}',
    `Repo summary: ${repoSummary}`,
    `Artifact path: ${artifactPath || '(uploaded pair)'}`,
    `Static overall score: ${staticAnalysis.overallScore}`,
    `Static category average: ${staticAnalysis.categoryAverage}`,
    `Static scenario average: ${staticAnalysis.scenarioAverage}`,
    `Static benchmark average: ${staticAnalysis.taskAverage}`,
    'Static dimensions:',
    JSON.stringify(staticAnalysis.dimensions, null, 2),
    'Static risk flags:',
    (staticAnalysis.riskFlags || []).join('\n') || 'none',
    'Static hard gate results:',
    hardGateSummary || 'none',
    'Static category scores:',
    categoryScores || 'none',
    'Benchmark task pack used by the evaluator:',
    taskPack || 'none',
    'Static benchmark results for this file:',
    benchmarkSummary || 'none',
    'File content starts below.',
    '--- FILE START ---',
    file.content,
    '--- FILE END ---',
  ].join('\n');
}

function callProvider(provider, prompt, reasoningEffort, options = {}) {
  if (getProviderTransport(provider.id) === 'claude') {
    return callClaudeEvaluator(provider, prompt, reasoningEffort, options);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let collected = '';
    let timeoutId = null;

    const cleanup = provider.chat({
      messages: [{ role: 'user', content: prompt }],
      images: [],
      systemPrompt: options.systemPrompt || 'You are a strict software policy evaluator. Return JSON only.',
      reasoningEffort,
      onChunk: (chunk) => {
        if (typeof chunk === 'string') collected += chunk;
      },
      onDone: (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(typeof result === 'string' && result.trim() ? result : collected);
      },
      onError: (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      },
    });

    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { cleanup(); } catch {}
      reject(new Error(`Model evaluation timed out for ${provider.id}.`));
    }, options.timeoutMs || provider.defaultTimeoutMs || 120_000);
  });
}

async function callClaudeEvaluator(provider, prompt, reasoningEffort, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-lab-claude-'));
  const model = getProviderModelId(provider.id);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'];
  if (model) args.push('--model', model);
  if (reasoningEffort) args.push('--effort', normalizeClaudeEvalEffort(reasoningEffort));

  const stdinPrompt = options.systemPrompt
    ? `System instructions:\n${options.systemPrompt}\n\n${prompt}`
    : prompt;

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let stderrOutput = '';
    let assistantResponse = '';
    let resultResponse = '';
    let child;

    try {
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: tempDir,
        env: {
          ...process.env,
          CLAUDECODE: undefined,
          CLAUDE_PROJECT_DIR: tempDir,
        },
      });
    } catch (error) {
      void cleanupClaudeEvalTempDir(tempDir);
      reject(error);
      return;
    }

    try {
      child.stdin.end(stdinPrompt);
    } catch {
      // Let the process error handler/reporting path deal with broken stdin cases.
    }

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch {}
      void cleanupClaudeEvalTempDir(tempDir);
      reject(new Error(`Model evaluation timed out for ${provider.id}.`));
    }, options.timeoutMs || provider.defaultTimeoutMs || 120_000);

    child.stdout.on('data', (chunk) => {
      if (settled) return;
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const event = parseJsonLine(line);
        if (!event) continue;
        const text = extractClaudeStreamText(event);
        if (!text) continue;
        if (event.type === 'result') {
          resultResponse = text;
        } else {
          assistantResponse += text;
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      if (settled) return;
      stderrOutput += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (settled) return;
      settled = true;

      const trailingEvent = parseJsonLine(stdoutBuffer);
      if (trailingEvent) {
        const trailingText = extractClaudeStreamText(trailingEvent);
        if (trailingText) {
          if (trailingEvent.type === 'result') resultResponse = trailingText;
          else assistantResponse += trailingText;
        }
      }

      void cleanupClaudeEvalTempDir(tempDir);

      if (code !== 0) {
        reject(new Error(formatClaudeEvalFailure(code, stderrOutput || resultResponse || assistantResponse)));
        return;
      }

      resolve(normalizeEvaluatorResponse(resultResponse || assistantResponse));
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      if (settled) return;
      settled = true;
      void cleanupClaudeEvalTempDir(tempDir);
      reject(error);
    });
  });
}

function normalizeClaudeEvalEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') return normalized;
  return 'high';
}

function parseJsonLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractClaudeStreamText(message) {
  if (message.type === 'assistant' && message.message && Array.isArray(message.message.content)) {
    return message.message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
  if (message.type === 'result' && typeof message.result === 'string') {
    return message.result;
  }
  if (message.type === 'content_block_delta' && message.delta && typeof message.delta.text === 'string') {
    return message.delta.text;
  }
  return '';
}

function formatClaudeEvalFailure(code, output) {
  const preview = String(output || '').trim().slice(0, 500);
  if (!preview) return `Claude evaluator exited with code ${code}.`;
  return `Claude evaluator exited with code ${code}: ${preview}`;
}

async function cleanupClaudeEvalTempDir(tempDir) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore temp dir cleanup failures.
  }
}

function parseModelJson(text) {
  const trimmed = normalizeEvaluatorResponse(text);
  if (!trimmed) throw new Error('Model returned an empty response.');

  try {
    return JSON.parse(trimmed);
  } catch {
    const candidate = extractFirstJsonObject(trimmed);
    if (!candidate) throw new Error('Model did not return valid JSON.');
    return JSON.parse(candidate);
  }
}

function parseStrictJsonOnly(text) {
  const trimmed = normalizeEvaluatorResponse(text);
  if (!trimmed) throw new Error('Model returned an empty response.');
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const enriched = new Error(buildStrictJsonFailureMessage(trimmed, error));
    enriched.code = 'STRICT_JSON_PARSE_FAILED';
    enriched.preflightDiagnostics = {
      classification: classifyJsonParseFailure(trimmed, error),
      responseLength: trimmed.length,
      responsePreview: safePreview(trimmed),
      firstNonWhitespace: trimmed[0] || '',
      hasJsonObject: /\{[\s\S]*\}/.test(trimmed),
      parseError: error.message || 'Invalid JSON',
    };
    throw enriched;
  }
}

function buildProviderDiagnostics(providerId, reasoningEffort, overrides = {}) {
  return {
    providerId,
    providerLabel: getProviderLabel(providerId),
    transport: getProviderTransport(providerId),
    modelId: getProviderModelId(providerId) || '(cli default)',
    reasoningEffort,
    timeoutMs: overrides.timeoutMs || null,
    attemptsUsed: overrides.attemptsUsed || 1,
  };
}

function normalizePreflightFailure(error, { providerId, reasoningEffort, timeoutMs, attempt, title }) {
  const diagnostics = {
    ...buildProviderDiagnostics(providerId, reasoningEffort, { timeoutMs, attemptsUsed: attempt }),
    stage: title,
    errorCode: error?.code || '',
    message: error?.message || `Provider failed ${title}.`,
    retryable: isRetryablePreflightError(error),
  };

  if (error?.preflightDiagnostics) {
    Object.assign(diagnostics, error.preflightDiagnostics);
  }

  return {
    message: diagnostics.message,
    retryable: diagnostics.retryable,
    diagnostics,
  };
}

function isRetryablePreflightError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'TIMEOUT'
    || code === 'ETIMEDOUT'
    || message.includes('timed out')
    || message.includes('rate limit')
    || message.includes('temporarily unavailable');
}

function classifyJsonParseFailure(text, error) {
  const preview = String(text || '').trimStart();
  if (!preview) return 'empty-response';
  if (!preview.startsWith('{') && !preview.startsWith('[')) {
    if (/pm rules|rules loaded|verification needed/i.test(preview)) return 'hook-output-before-json';
    return 'non-json-preamble';
  }
  if (/\}\s*\S/.test(preview)) return 'trailing-content-after-json';
  return error?.message?.includes('Unexpected end of JSON input')
    ? 'truncated-json'
    : 'invalid-json';
}

function buildStrictJsonFailureMessage(text, error) {
  const classification = classifyJsonParseFailure(text, error);
  if (classification === 'hook-output-before-json') {
    return 'Strict JSON parse failed because non-model hook output appeared before the JSON payload. This usually indicates repo hook or prompt injection text leaking into the evaluator channel.';
  }
  if (classification === 'non-json-preamble') {
    return `Strict JSON parse failed because the response began with non-JSON content. Preview: ${safePreview(text)}`;
  }
  if (classification === 'trailing-content-after-json') {
    return `Strict JSON parse failed because extra content appeared after the JSON payload. Preview: ${safePreview(text)}`;
  }
  if (classification === 'truncated-json') {
    return 'Strict JSON parse failed because the provider returned truncated JSON.';
  }
  return error.message || 'Strict JSON parse failed.';
}

function safePreview(value, limit = 280) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function normalizeEvaluatorResponse(value) {
  let text = String(value || '').trim();
  if (!text) return '';

  text = stripJsonCodeFence(text);
  const candidate = extractFirstJsonObject(text);
  if (candidate) return candidate.trim();
  return text;
}

function stripJsonCodeFence(text) {
  let current = String(text || '').trim();
  let changed = true;

  while (changed) {
    changed = false;
    const fencedMatch = current.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fencedMatch) {
      current = fencedMatch[1].trim();
      changed = true;
    }
  }

  return current;
}

function extractFirstJsonObject(text) {
  const source = String(text || '');
  const startIndices = [];
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{' || char === '[') startIndices.push(i);
  }

  for (const start of startIndices) {
    for (let end = source.length; end > start; end -= 1) {
      const candidate = source.slice(start, end).trim();
      if (!candidate) continue;
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // keep scanning
      }
    }
  }

  return '';
}

function buildFailureDiagnosticBlock(entry) {
  const diagnostics = entry.diagnostics;
  if (!diagnostics) return '';
  return [
    `- ${entry.title}`,
    `  provider=${diagnostics.providerId || 'n/a'} | label=${diagnostics.providerLabel || 'n/a'} | transport=${diagnostics.transport || 'n/a'} | model=${diagnostics.modelId || 'n/a'} | effort=${diagnostics.reasoningEffort || 'n/a'}`,
    `  timeoutMs=${diagnostics.timeoutMs || 'n/a'} | attemptsUsed=${diagnostics.attemptsUsed || 1} | retryable=${diagnostics.retryable ? 'yes' : 'no'} | classification=${diagnostics.classification || 'n/a'}`,
    `  errorCode=${diagnostics.errorCode || 'n/a'}`,
    `  message=${diagnostics.message || entry.detail}`,
    diagnostics.parseError ? `  parseError=${diagnostics.parseError}` : null,
    diagnostics.responseLength != null ? `  responseLength=${diagnostics.responseLength}` : null,
    diagnostics.responsePreview ? `  responsePreview=${diagnostics.responsePreview}` : null,
  ].filter(Boolean).join('\n');
}

function buildCheckDiagnosticSummary(entry) {
  const diagnostics = entry.diagnostics;
  if (!diagnostics) return `- ${entry.title}: no extra diagnostics`;
  return `- ${entry.title}: provider=${diagnostics.providerId || 'n/a'} | transport=${diagnostics.transport || 'n/a'} | model=${diagnostics.modelId || 'n/a'} | effort=${diagnostics.reasoningEffort || 'n/a'} | attempts=${diagnostics.attemptsUsed || 1} | outcome=${entry.passed ? 'pass' : diagnostics.classification || diagnostics.message || 'fail'}`;
}

function normalizeModelAssessment({ providerId, providerLabel, slotLabel, artifactPath, parsed, rawText }) {
  const categoryScores = Array.isArray(parsed.categoryScores)
    ? parsed.categoryScores
        .map((entry) => ({
          id: String(entry.id || '').trim() || 'category',
          label: String(entry.label || entry.id || 'Category'),
          score: clampScore(entry.score),
        }))
        .slice(0, 6)
    : [];

  return {
    providerId,
    providerLabel,
    slotLabel,
    artifactPath,
    ok: true,
    overallScore: clampScore(parsed.overallScore),
    confidence: normalizeConfidence(parsed.confidence),
    categoryScores,
    strengths: toStringList(parsed.strengths),
    risks: toStringList(parsed.risks),
    recommendation: String(parsed.recommendation || '').trim() || 'No recommendation provided.',
    rawText,
  };
}

function normalizeAgenticAssessment({ providerId, providerLabel, slotLabel, artifactPath, parsed, rawText, staticAnalysis }) {
  const hardGateChecks = normalizeStatusEntries(parsed.hardGateChecks, 'hard-gate');
  const benchmarkTasks = normalizeStatusEntries(parsed.benchmarkTasks, 'task');
  const hardGateFailures = hardGateChecks.filter((entry) => entry.status === 'fail');
  const benchmarkPassCount = benchmarkTasks.filter((entry) => entry.status === 'pass').length;
  const verdict = normalizeVerdict(parsed.verdict, hardGateFailures.length, benchmarkPassCount, benchmarkTasks.length);

  return {
    providerId,
    providerLabel,
    slotLabel,
    artifactPath,
    ok: true,
    overallScore: clampScore(parsed.overallScore),
    confidence: normalizeConfidence(parsed.confidence),
    verdict,
    summary: String(parsed.summary || '').trim() || `${slotLabel} agentic review completed.`,
    benchmarkMeaning: String(parsed.benchmarkMeaning || '').trim() || defaultBenchmarkMeaning(slotLabel, benchmarkPassCount, benchmarkTasks.length, hardGateFailures.length),
    whyNotRecommended: String(parsed.whyNotRecommended || '').trim() || defaultWhyNotRecommended(slotLabel, verdict, hardGateFailures.length),
    categoryScores: normalizeCategoryScores(parsed.categoryScores),
    strengths: toStringList(parsed.strengths),
    risks: toStringList(parsed.risks),
    priorityFixes: toStringList(parsed.priorityFixes),
    hardGateChecks,
    benchmarkTasks,
    recommendation: String(parsed.recommendation || '').trim() || defaultAgenticRecommendation(slotLabel, verdict),
    rawText,
    benchmarkPassCount,
    benchmarkTotal: benchmarkTasks.length,
    hardGateFailureCount: hardGateFailures.length,
    staticSummary: {
      overallScore: staticAnalysis.overallScore,
      taskAverage: staticAnalysis.taskAverage,
      scenarioAverage: staticAnalysis.scenarioAverage,
    },
  };
}

function buildAgenticFailure({ providerId, providerLabel, slotLabel, artifactPath, error, staticAnalysis }) {
  return {
    providerId,
    providerLabel,
    slotLabel,
    artifactPath,
    ok: false,
    overallScore: 0,
    confidence: 'Unknown',
    verdict: 'revise',
    summary: `${slotLabel} agentic review failed.`,
    benchmarkMeaning: 'The full agentic reviewer did not complete, so no benchmark interpretation is available from the agentic path.',
    whyNotRecommended: 'The full agentic reviewer did not complete. Use the static verdict only for this run.',
    categoryScores: [],
    strengths: [],
    risks: ['Agentic evaluation failed. Static evaluation is still available.'],
    priorityFixes: [],
    hardGateChecks: [],
    benchmarkTasks: [],
    recommendation: 'No agentic recommendation available.',
    rawText: '',
    error,
    benchmarkPassCount: 0,
    benchmarkTotal: staticAnalysis.taskScores?.length || 0,
    hardGateFailureCount: staticAnalysis.hardGateFailures?.length || 0,
    staticSummary: {
      overallScore: staticAnalysis.overallScore,
      taskAverage: staticAnalysis.taskAverage,
      scenarioAverage: staticAnalysis.scenarioAverage,
    },
  };
}

function compareModelEvaluations(left, right) {
  const margin = Math.abs((left?.overallScore || 0) - (right?.overallScore || 0));
  const winner = (left?.overallScore || 0) === (right?.overallScore || 0)
    ? 'tie'
    : (left?.overallScore || 0) > (right?.overallScore || 0)
      ? 'left'
      : 'right';
  const sameModel = left?.providerId && right?.providerId && left.providerId === right.providerId;

  return {
    winner,
    sameModel,
    scoreMargin: round1(margin),
    caution: sameModel
      ? ''
      : 'Different models evaluated each file. Treat the AI-model score comparison as directional, not definitive.',
  };
}

function compareAgenticEvaluations(left, right) {
  const leftRank = AGENTIC_VERDICTS[left.verdict] ?? AGENTIC_VERDICTS.revise;
  const rightRank = AGENTIC_VERDICTS[right.verdict] ?? AGENTIC_VERDICTS.revise;
  const sameModel = left?.providerId && right?.providerId && left.providerId === right.providerId;

  let winner = 'tie';
  if (leftRank > rightRank) winner = 'left';
  else if (rightRank > leftRank) winner = 'right';
  else if ((left.benchmarkPassCount || 0) > (right.benchmarkPassCount || 0)) winner = 'left';
  else if ((right.benchmarkPassCount || 0) > (left.benchmarkPassCount || 0)) winner = 'right';
  else if ((left.overallScore || 0) > (right.overallScore || 0)) winner = 'left';
  else if ((right.overallScore || 0) > (left.overallScore || 0)) winner = 'right';

  const winningAssessment = winner === 'left' ? left : right;
  const losingAssessment = winner === 'left' ? right : left;
  const margin = round1(Math.abs((left.overallScore || 0) - (right.overallScore || 0)));
  const recommended = winner !== 'tie' && winningAssessment.verdict === 'pass' && winningAssessment.ok;
  const passDelta = Math.abs((left.benchmarkPassCount || 0) - (right.benchmarkPassCount || 0));
  const confidenceScore = clampScore(35 + margin * 2.2 + passDelta * 8 + (sameModel ? 8 : 0));
  const reasons = [];

  if (winner === 'tie') {
    reasons.push('The two full agentic reviews are too close to separate decisively.');
  } else {
    reasons.push(`${winningAssessment.slotLabel} is stronger in the full agentic review.`);
    reasons.push(`${winningAssessment.slotLabel} verdict: ${winningAssessment.verdict}. ${losingAssessment.slotLabel} verdict: ${losingAssessment.verdict}.`);
    reasons.push(`${winningAssessment.slotLabel} benchmark passes: ${winningAssessment.benchmarkPassCount}/${winningAssessment.benchmarkTotal}. ${losingAssessment.slotLabel}: ${losingAssessment.benchmarkPassCount}/${losingAssessment.benchmarkTotal}.`);
  }

  if (!recommended && winner !== 'tie') {
    reasons.push(`${winningAssessment.slotLabel} is still not recommended by the agentic reviewer because its verdict is ${winningAssessment.verdict}.`);
  }
  if (!sameModel) {
    reasons.push('Different models reviewed each side, so the agentic comparison is directional rather than fully controlled.');
  }

  return {
    winner,
    recommendedLabel: recommended ? winningAssessment.slotLabel : 'No clear winner',
    scoreMargin: margin,
    sameModel,
    confidence: {
      score: round1(confidenceScore),
      level: confidenceScore >= 78 ? 'High' : confidenceScore >= 58 ? 'Medium' : 'Low',
    },
    caution: sameModel ? '' : 'Different models reviewed each side. Treat the agentic comparison as directional rather than fully controlled.',
    reasons,
    conclusion: buildAgenticConclusion(winner, recommended, winningAssessment, losingAssessment),
  };
}

function toStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeCategoryScores(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      id: String(entry.id || '').trim() || 'category',
      label: String(entry.label || entry.id || 'Category').trim() || 'Category',
      score: clampScore(entry.score),
    }))
    .slice(0, 8);
}

function normalizeStatusEntries(value, fallbackPrefix) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => ({
      id: String(entry.id || `${fallbackPrefix}-${index + 1}`),
      title: String(entry.title || entry.id || `${fallbackPrefix}-${index + 1}`),
      status: normalizeStatus(entry.status),
      reason: String(entry.reason || '').trim(),
      improvement: String(entry.improvement || '').trim(),
    }))
    .slice(0, 16);
}

function normalizeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'pass') return 'pass';
  if (normalized === 'fail') return 'fail';
  if (normalized === 'not_required' || normalized === 'not-required') return 'not_required';
  return 'fail';
}

function normalizeVerdict(value, hardGateFailures, benchmarkPassCount, benchmarkTotal) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'pass' || normalized === 'revise' || normalized === 'reject') return normalized;
  if (hardGateFailures > 0 && benchmarkPassCount === 0) return 'reject';
  if (hardGateFailures > 0 || benchmarkPassCount < benchmarkTotal) return 'revise';
  return 'pass';
}

function normalizeConfidence(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 'High';
  if (normalized === 'medium') return 'Medium';
  if (normalized === 'low') return 'Low';
  return 'Unknown';
}

function defaultBenchmarkMeaning(slotLabel, passCount, totalTasks, hardGateFailures) {
  if (!totalTasks) {
    return `${slotLabel} has no benchmark task data for this run.`;
  }
  if (passCount === 0) {
    return `${slotLabel} passes 0 of ${totalTasks} benchmark tasks. That means the file is still failing every benchmarked use case under the current evaluator thresholds, usually because required hard gates are failing or the task scores remain below the required threshold. It does not mean the evaluator is broken.`;
  }
  return `${slotLabel} passes ${passCount} of ${totalTasks} benchmark tasks. Any remaining failures still indicate blocked use cases or benchmark thresholds that have not been met.${hardGateFailures > 0 ? ` ${hardGateFailures} hard gate failure(s) are still contributing to those misses.` : ''}`;
}

function defaultWhyNotRecommended(slotLabel, verdict, hardGateFailures) {
  if (verdict === 'pass') return `${slotLabel} is recommendable in the agentic review.`;
  if (verdict === 'reject') {
    return `${slotLabel} is not recommendable because the agentic review found it too risky for default use${hardGateFailures > 0 ? `, including ${hardGateFailures} hard gate failure(s)` : ''}.`;
  }
  return `${slotLabel} is not recommendable yet because the agentic review still requires revisions before default use.`;
}

function defaultAgenticRecommendation(slotLabel, verdict) {
  if (verdict === 'pass') return `${slotLabel} can be used as the default version.`;
  if (verdict === 'reject') return `${slotLabel} should not be used as the default version.`;
  return `${slotLabel} should be revised and re-evaluated before default use.`;
}

function buildAgenticConclusion(winner, recommended, winningAssessment, losingAssessment) {
  if (winner === 'tie') {
    return 'The full agentic review could not separate the two versions strongly enough to recommend one.';
  }
  if (!recommended) {
    return `${winningAssessment.slotLabel} is stronger in the full agentic review, but it is still not recommended for default use because its verdict is ${winningAssessment.verdict}. ${losingAssessment.slotLabel} remains weaker.`;
  }
  return `${winningAssessment.slotLabel} is the recommended winner in the full agentic review because it achieved a ${winningAssessment.verdict} verdict and performed better across the benchmark tasks.`;
}

function buildAgenticMethodology(staticResult) {
  return {
    version: AGENTIC_EVAL_VERSION,
    process: [
      'Each file is reviewed independently by a dedicated evaluator agent with an explicit role and task contract.',
      'Each evaluator agent receives the repo profile, static category scores, hard-gate outcomes, benchmark task definitions, and the file contents before it scores the file.',
      'Each evaluator agent must explain benchmark pass counts, required revisions, and prioritized fixes in structured JSON.',
      'The final agentic verdict is computed deterministically from the two agentic reviews, rather than asking one side to judge the other inside the same prompt.',
    ],
    taskPackSize: staticResult.taskPack?.length || 0,
    scenarioPackSize: staticResult.scenarioPack?.length || 0,
  };
}

function buildEvaluationFeedback(staticResult, { leftModelEval, rightModelEval, leftAgenticEval, rightAgenticEval }) {
  return {
    staticMeaning: buildStaticMeaning(staticResult, leftModelEval, rightModelEval),
    left: buildSideFeedback(staticResult.left, staticResult.taskBenchmark.leftPassCount, staticResult.taskBenchmark.totalTasks, leftModelEval, leftAgenticEval),
    right: buildSideFeedback(staticResult.right, staticResult.taskBenchmark.rightPassCount, staticResult.taskBenchmark.totalTasks, rightModelEval, rightAgenticEval),
  };
}

function buildStaticMeaning(staticResult, leftModelEval, rightModelEval) {
  const winnerLabel = staticResult.comparison.winner === 'left'
    ? staticResult.left.slotLabel
    : staticResult.comparison.winner === 'right'
      ? staticResult.right.slotLabel
      : 'Neither side';
  const blocked = staticResult.comparison.recommendedLabel === 'No clear winner' && staticResult.comparison.winner !== 'tie';
  return {
    strongerButBlocked: blocked
      ? `${winnerLabel} scored higher than the other file, but the static evaluator still refuses to recommend it because required hard gates are failing or benchmark passes are too weak.`
      : staticResult.comparison.conclusion,
    benchmarkMeaning: 'A benchmark task only passes when its required hard gates pass and its weighted score clears the task threshold. A result like 0 of 7 means the file is still failing every benchmarked use case under the current evaluator rules.',
    modelMeaningLeft: !leftModelEval.ok
      ? `${leftModelEval.slotLabel} model score is 0.0 because the optional model-backed review failed. The static evaluation still completed.`
      : `${leftModelEval.slotLabel} model score reflects the lightweight model review, not the static verdict.`,
    modelMeaningRight: !rightModelEval.ok
      ? `${rightModelEval.slotLabel} model score is 0.0 because the optional model-backed review failed. The static evaluation still completed.`
      : `${rightModelEval.slotLabel} model score reflects the lightweight model review, not the static verdict.`,
  };
}

function buildSideFeedback(analysis, passCount, totalTasks, modelEval, agenticEval) {
  const topWeakCategories = [...(analysis.categoryScores || [])]
    .sort((left, right) => left.score - right.score)
    .slice(0, 3);
  const failedTasks = (analysis.taskScores || []).filter((entry) => !entry.passed);
  const priorities = [];

  for (const gate of analysis.hardGateFailures || []) {
    priorities.push(STATIC_IMPROVEMENT_HINTS[gate.id] || gate.failure);
  }
  for (const entry of topWeakCategories) {
    const hint = STATIC_IMPROVEMENT_HINTS[entry.id];
    if (hint && !priorities.includes(hint)) priorities.push(hint);
  }
  for (const fix of agenticEval.priorityFixes || []) {
    if (!priorities.includes(fix)) priorities.push(fix);
  }

  return {
    benchmarkMeaning: passCount === 0
      ? `${analysis.slotLabel} passes 0 of ${totalTasks} benchmark tasks. That means it currently fails every benchmarked use case in the pack under the evaluator’s hard-gate and threshold rules.`
      : `${analysis.slotLabel} passes ${passCount} of ${totalTasks} benchmark tasks, so ${totalTasks - passCount} use cases still need work.`,
    modelMeaning: !modelEval.ok
      ? `${analysis.slotLabel} model score is 0.0 because the optional model review failed for that side.`
      : `${analysis.slotLabel} model score completed successfully and should be treated as a supplemental lens, not the final authority.`,
    topBlockers: [
      ...(analysis.hardGateFailures || []).map((entry) => entry.failure),
      ...failedTasks.slice(0, 3).map((entry) => `${entry.title}: ${entry.notes}`),
    ],
    priorityFixes: priorities.slice(0, 6),
  };
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, round1(numeric)));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

module.exports = router;
