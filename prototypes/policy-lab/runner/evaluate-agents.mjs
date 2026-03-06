import { promises as fs } from 'node:fs';
import path from 'node:path';

const FAMILY_DEFINITIONS = {
  agents: {
    id: 'agents',
    label: 'AGENTS.md',
    description: 'Repository-wide default agent policy.',
  },
  claude: {
    id: 'claude',
    label: 'CLAUDE.md',
    description: 'Provider-specific operating policy.',
  },
  hooks: {
    id: 'hooks',
    label: 'Agentic Hook',
    description: 'Shell or script hook that injects, verifies, or gates workflow.',
  },
  skills: {
    id: 'skills',
    label: 'Skill',
    description: 'Structured workflow instructions stored in SKILL.md.',
  },
  prompts: {
    id: 'prompts',
    label: 'Prompt File',
    description: 'Prompt, system prompt, or instruction template used by the agent.',
  },
  'agent-prompts': {
    id: 'agent-prompts',
    label: 'Agent Definition',
    description: 'Dedicated subagent prompt or role definition.',
  },
  custom: {
    id: 'custom',
    label: 'Custom Agentic File',
    description: 'Any other text file that changes agent behavior.',
  },
};

const COMMON_POLICY_CATEGORIES = [
  definition('truthfulness', 'Truthfulness and Verification', 1.25, [/verify/i, /re-verify/i, /fresh/i, /on disk/i, /never assume/i, /status claim/i, /uncertainty/i]),
  definition('intent', 'Intent Handling', 1.15, [/intent/i, /actual need/i, /real problem/i, /direct question/i, /user intent/i]),
  definition('codebase-awareness', 'Codebase Awareness', 1.05, [/inspect/i, /read/i, /workspace/i, /codebase/i, /rg\b/i, /search/i]),
  definition('edit-safety', 'Edit Safety', 1.1, [/apply_patch/i, /do not revert/i, /dirty worktree/i, /non-destructive/i, /git/i]),
  definition('prototype-isolation', 'Prototype Isolation', 1.2, [/prototype/i, /prototypes\//i, /feature flag/i, /client\/src/i, /server\/src/i]),
  definition('testing-restraint', 'Testing Restraint', 1.2, [/no tests/i, /never run/i, /emergency-only/i, /smallest possible scope/i, /do not modify existing tests/i]),
  definition('process-control', 'Process Control', 1.2, [/never start/i, /never restart/i, /never stop/i, /kill/i, /unless the user explicitly asks/i]),
  definition('communication', 'Communication Discipline', 0.9, [/concise/i, /clear/i, /update/i, /final answer/i, /commentary/i]),
];

const FAMILY_CATEGORY_DEFINITIONS = {
  agents: [
    definition('instruction-precedence', 'Instruction Precedence', 1, [/precedence/i, /default/i, /repository/i, /whole repository/i, /scope/i]),
    definition('delegation-skills', 'Delegation and Skills', 0.95, [/delegate/i, /subagent/i, /team/i, /skill/i, /skills/i]),
    definition('review-quality', 'Review Quality', 0.95, [/review/i, /findings/i, /severity/i, /bugs/i, /risks/i]),
  ],
  claude: [
    definition('instruction-precedence', 'Instruction Precedence', 1, [/precedence/i, /instruction/i, /system/i, /repository/i, /default/i]),
    definition('tool-discipline', 'Tool Discipline', 1, [/tool/i, /use.*tool/i, /shell/i, /apply_patch/i, /browse/i]),
    definition('role-stability', 'Role Stability', 0.95, [/personality/i, /interaction style/i, /working with the user/i, /final answer/i]),
  ],
  hooks: [
    definition('shell-safety', 'Shell Safety', 1.2, [/#!\/bin\/(bash|sh)/i, /set -[a-z]/i, /command -v/i, /\[ -f /i, /rm -f/i, /2>\/dev\/null/i]),
    definition('structured-parsing', 'Structured Parsing', 1.05, [/jq\b/i, /json/i, /grep -o/i, /sed /i, /agent_id/i, /files_touched/i]),
    definition('verifier-flow', 'Verifier Workflow', 1.15, [/verifier/i, /blind review/i, /completion log/i, /pending-verification/i, /haiku/i]),
    definition('idempotence', 'Idempotence and Cleanup', 1, [/\|\| return 0/i, /return 0/i, /exit 0/i, /rm -f/i, /\[ -f /i, /mkdir -p/i]),
    definition('observability', 'Observability', 0.9, [/echo /i, /log/i, /loaded/i, /verification needed/i, /pending/i]),
  ],
  skills: [
    definition('trigger-clarity', 'Trigger Clarity', 1.2, [/use when/i, /trigger/i, /if the user/i, /clearly matches/i, /when relevant/i]),
    definition('workflow-coverage', 'Workflow Coverage', 1.15, [/step/i, /workflow/i, /checklist/i, /when done/i, /completion/i]),
    definition('asset-reuse', 'Asset Reuse', 1, [/scripts\//i, /assets\//i, /template/i, /references\//i, /reuse/i]),
    definition('fallback-handling', 'Fallback Handling', 1.05, [/missing/i, /blocked/i, /fallback/i, /next-best/i, /continue/i]),
    definition('output-contract', 'Output Contract', 0.95, [/deliverable/i, /result/i, /final/i, /log/i, /done/i]),
  ],
  prompts: [
    definition('role-clarity', 'Role Clarity', 1.1, [/you are/i, /role/i, /expert/i, /focus/i, /personality/i]),
    definition('context-hygiene', 'Context Hygiene', 1, [/context/i, /summarize/i, /only load/i, /keep context/i, /avoid deep/i]),
    definition('output-contract', 'Output Contract', 1.05, [/respond/i, /format/i, /final answer/i, /must include/i, /should include/i]),
    definition('escalation-discipline', 'Escalation Discipline', 0.95, [/ask/i, /if blocked/i, /if unclear/i, /escalat/i, /approval/i]),
  ],
  'agent-prompts': [
    definition('role-clarity', 'Role Clarity', 1.15, [/you are/i, /agent/i, /responsible/i, /focus/i, /specialist/i]),
    definition('task-contract', 'Task Contract', 1.05, [/completion/i, /done/i, /checklist/i, /files touched/i, /summary/i]),
    definition('blind-review-discipline', 'Blind Review Discipline', 1, [/independent/i, /blind/i, /verify/i, /review/i, /log/i]),
    definition('context-hygiene', 'Context Hygiene', 0.95, [/relevant context/i, /keep context/i, /do not overload/i, /summarize/i, /minimal/i]),
  ],
  custom: [
    definition('role-clarity', 'Role Clarity', 1, [/you are/i, /must/i, /never/i, /always/i, /instruction/i]),
    definition('output-contract', 'Output Contract', 1, [/respond/i, /output/i, /format/i, /must include/i, /summary/i]),
  ],
};

const CONTRADICTIONS = [
  { title: 'Testing conflict', left: [/no tests/i, /never run.*test/i], right: [/run tests/i, /write tests/i, /always test/i] },
  { title: 'Process-control conflict', left: [/never start/i, /never stop/i, /never restart/i], right: [/start the server/i, /restart server/i, /kill process/i] },
  { title: 'Prototype-scope conflict', left: [/prototype/i, /prototypes\//i], right: [/put .*client\/src/i, /put .*server\/src/i] },
  { title: 'Verbosity conflict', left: [/concise/i], right: [/maximally detailed/i, /exhaustive by default/i] },
];

const AMBIGUITY_PATTERNS = [/\bappropriate\b/gi, /\breasonable\b/gi, /\bquickly\b/gi, /\bsomehow\b/gi, /\bmaybe\b/gi];
const HARD_DIRECTIVE_PATTERNS = [/\bmust\b/gi, /\bnever\b/gi, /\balways\b/gi, /\bdo not\b/gi, /\bonly\b/gi];
const CONDITIONAL_PATTERNS = [/\bif\b/gi, /\bwhen\b/gi, /\bunless\b/gi, /\bexcept\b/gi];
const ACTION_VERB_PATTERNS = [/\buse\b/gi, /\bcheck\b/gi, /\bverify\b/gi, /\binspect\b/gi, /\bavoid\b/gi, /\bwrite\b/gi, /\bread\b/gi, /\bupdate\b/gi];

const BASE_SCENARIOS = [
  scenario('stale-state', 'Stale-State Verification', ['truthfulness', 'codebase-awareness'], ['specificity', 'consistency'], 1.15),
  scenario('long-term-maintenance', 'Long-Term Maintenance', ['truthfulness', 'edit-safety'], ['longTermResilience', 'consistency'], 1.15),
];

export async function compareArtifactVersions(leftFile, rightFile, options) {
  const projectRoot = options.projectRoot;
  const mode = options.mode || 'full';
  const family = normalizeFamily(options.family || leftFile.family || rightFile.family || 'agents');
  const profile = await buildProjectProfile(projectRoot);
  const artifactCatalog = await listProjectArtifacts(projectRoot);
  const artifactPath = options.artifactPath || leftFile.artifactPath || rightFile.artifactPath || '';
  const scenarios = buildScenarioPack(family, profile);
  const taskPack = buildTaskPack(family, profile);
  const left = analyzeArtifact(leftFile, { family, profile, scenarios, taskPack, artifactPath });
  const right = analyzeArtifact(rightFile, { family, profile, scenarios, taskPack, artifactPath });
  const policyComparison = buildPolicyComparison(left, right, family, scenarios);
  const taskBenchmark = buildTaskBenchmarkComparison(left, right, taskPack);
  const comparison = buildOverallComparison(mode, left, right, policyComparison, taskBenchmark, family, profile);

  return {
    runId: new Date().toISOString().replace(/[:.]/g, '-'),
    generatedAt: new Date().toISOString(),
    mode,
    family,
    familyLabel: getFamilyDefinition(family).label,
    artifactPath,
    projectProfile: profile,
    artifactCatalog,
    scenarioPack: scenarios,
    taskPack,
    left,
    right,
    policyComparison,
    taskBenchmark,
    comparison,
  };
}

export async function compareAgents(leftFile, rightFile, options) {
  return compareArtifactVersions(leftFile, rightFile, {
    ...options,
    family: options?.family || 'agents',
  });
}

export async function buildProjectProfile(projectRoot) {
  const packageJson = await readJsonIfPresent(path.join(projectRoot, 'package.json'));
  const artifactCatalog = await listProjectArtifacts(projectRoot);

  return {
    projectRoot,
    hasClient: await pathExists(path.join(projectRoot, 'client')),
    hasServer: await pathExists(path.join(projectRoot, 'server')),
    hasPrototypes: await pathExists(path.join(projectRoot, 'prototypes')),
    hasHooks: artifactCatalog.some((entry) => entry.family === 'hooks'),
    hasRootAgents: artifactCatalog.some((entry) => entry.path === 'AGENTS.md'),
    hasClaudeMd: artifactCatalog.some((entry) => entry.path === 'CLAUDE.md'),
    hasFeaturesFile: await pathExists(path.join(projectRoot, 'FEATURES.md')),
    testScriptPresent: Boolean(packageJson?.scripts?.test),
    devScriptPresent: Boolean(packageJson?.scripts?.dev),
    prototypeNames: await listDirectoryNames(path.join(projectRoot, 'prototypes')),
    artifactCounts: summarizeArtifactCounts(artifactCatalog),
  };
}

export async function listProjectArtifacts(projectRoot) {
  const discovered = [];

  for (const relativePath of ['AGENTS.md', 'CLAUDE.md']) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (await pathExists(absolutePath)) {
      discovered.push(buildArtifactEntry(relativePath));
    }
  }

  const rootedFiles = [
    ...await collectFiles(path.join(projectRoot, '.claude', 'hooks')),
    ...await collectFiles(path.join(projectRoot, '.claude', 'skills')),
    ...await collectFiles(path.join(projectRoot, '.claude', 'agents')),
    ...await collectFiles(path.join(projectRoot, 'prompts')),
    ...await collectFiles(path.join(projectRoot, 'playbook')),
  ];

  for (const absolutePath of rootedFiles) {
    const relativePath = toRelativeProjectPath(projectRoot, absolutePath);
    const artifact = buildArtifactEntry(relativePath);
    if (artifact) discovered.push(artifact);
  }

  return discovered
    .filter(Boolean)
    .filter((entry, index, list) => list.findIndex((candidate) => candidate.path === entry.path) === index)
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function readProjectArtifact(projectRoot, requestedPath) {
  const safePath = requestedPath.replace(/\\/g, '/');
  const absolutePath = path.resolve(projectRoot, safePath);
  if (!absolutePath.startsWith(projectRoot)) {
    throw new Error('Requested path is outside the project root.');
  }

  const content = await fs.readFile(absolutePath, 'utf8');
  const artifact = buildArtifactEntry(safePath) || {
    family: 'custom',
    familyLabel: FAMILY_DEFINITIONS.custom.label,
    path: safePath,
    name: path.basename(safePath),
    title: safePath,
  };

  return {
    slotLabel: 'Current',
    name: artifact.name,
    content,
    family: artifact.family,
    artifactPath: artifact.path,
    familyLabel: artifact.familyLabel,
    title: artifact.title,
  };
}

const FAMILY_SCENARIOS = {
  agents: [
    scenario('prototype-request', 'Prototype Request', ['prototype-isolation', 'truthfulness', 'edit-safety'], ['repoFit', 'consistency'], 1.2),
    scenario('production-edit', 'Production App Edit', ['codebase-awareness', 'edit-safety', 'intent'], ['specificity', 'repoFit'], 1.1),
    scenario('review-findings', 'Review Findings-First', ['review-quality', 'truthfulness', 'communication'], ['clarity'], 1),
    scenario('testing-restraint', 'No-Tests Pressure', ['testing-restraint', 'truthfulness'], ['enforceability', 'consistency'], 1.15),
    scenario('process-safety', 'Process Safety', ['process-control', 'truthfulness'], ['enforceability', 'consistency'], 1.2),
    scenario('delegation', 'Delegation and Skills', ['delegation-skills', 'codebase-awareness', 'intent'], ['repoFit'], 0.95),
    scenario('instruction-precedence', 'Instruction Precedence', ['instruction-precedence', 'communication'], ['clarity', 'consistency'], 1),
  ],
  claude: [
    scenario('provider-policy', 'Provider Policy Stability', ['instruction-precedence', 'role-stability', 'truthfulness'], ['clarity', 'consistency'], 1.1),
    scenario('tooling-discipline', 'Tooling Discipline', ['tool-discipline', 'edit-safety', 'process-control'], ['specificity', 'enforceability'], 1.1),
    scenario('prototype-request', 'Prototype Request', ['prototype-isolation', 'truthfulness'], ['repoFit', 'consistency'], 1.15),
    scenario('testing-restraint', 'No-Tests Pressure', ['testing-restraint', 'truthfulness'], ['enforceability'], 1.15),
    scenario('process-safety', 'Process Safety', ['process-control', 'truthfulness'], ['enforceability', 'consistency'], 1.15),
    scenario('role-stability', 'Role Stability', ['role-stability', 'communication'], ['clarity', 'longTermResilience'], 1),
  ],
  hooks: [
    scenario('hook-safety', 'Hook Safety', ['shell-safety', 'idempotence'], ['enforceability', 'consistency'], 1.2),
    scenario('verification-handoff', 'Verification Handoff', ['verifier-flow', 'structured-parsing'], ['specificity', 'repoFit'], 1.2),
    scenario('missing-dependency', 'Missing Dependency Fallback', ['shell-safety', 'structured-parsing'], ['clarity', 'consistency'], 1.05),
    scenario('rerun-safety', 'Repeated Invocation', ['idempotence', 'observability'], ['longTermResilience', 'consistency'], 1.1),
    scenario('prompt-injection', 'Prompt Injection Quality', ['observability', 'verifier-flow'], ['clarity'], 0.95),
  ],
  skills: [
    scenario('positive-trigger', 'Positive Trigger Case', ['trigger-clarity', 'workflow-coverage'], ['specificity', 'repoFit'], 1.15),
    scenario('negative-trigger', 'Negative Trigger Case', ['trigger-clarity', 'fallback-handling'], ['consistency'], 1.05),
    scenario('multi-step-workflow', 'Multi-Step Workflow', ['workflow-coverage', 'output-contract'], ['clarity', 'enforceability'], 1.1),
    scenario('asset-reuse', 'Local Asset Reuse', ['asset-reuse', 'workflow-coverage'], ['repoFit'], 1),
    scenario('blocked-skill', 'Blocked Skill Fallback', ['fallback-handling', 'output-contract'], ['clarity', 'longTermResilience'], 1),
  ],
  prompts: [
    scenario('role-setup', 'Role Setup', ['role-clarity', 'output-contract'], ['clarity', 'specificity'], 1.15),
    scenario('context-hygiene', 'Context Hygiene', ['context-hygiene', 'communication'], ['longTermResilience', 'clarity'], 1.05),
    scenario('escalation', 'Escalation Discipline', ['escalation-discipline', 'truthfulness'], ['consistency', 'enforceability'], 1),
    scenario('production-edit', 'Production App Edit', ['codebase-awareness', 'edit-safety', 'output-contract'], ['repoFit', 'specificity'], 1.05),
    scenario('testing-restraint', 'No-Tests Pressure', ['testing-restraint', 'truthfulness'], ['enforceability'], 1.1),
  ],
  'agent-prompts': [
    scenario('role-setup', 'Agent Role Setup', ['role-clarity', 'task-contract'], ['clarity', 'specificity'], 1.15),
    scenario('handoff-quality', 'Handoff Quality', ['task-contract', 'blind-review-discipline'], ['repoFit', 'consistency'], 1.1),
    scenario('context-hygiene', 'Context Hygiene', ['context-hygiene', 'communication'], ['clarity', 'longTermResilience'], 1),
    scenario('verification', 'Verification Discipline', ['truthfulness', 'blind-review-discipline'], ['enforceability', 'consistency'], 1.1),
  ],
  custom: [
    scenario('general-control', 'General Control Quality', ['truthfulness', 'output-contract', 'role-clarity'], ['clarity', 'consistency'], 1.1),
    scenario('production-edit', 'Production App Edit', ['codebase-awareness', 'edit-safety', 'truthfulness'], ['repoFit', 'specificity'], 1.05),
    scenario('testing-restraint', 'No-Tests Pressure', ['testing-restraint', 'truthfulness'], ['enforceability'], 1.05),
  ],
};

const FAMILY_TASKS = {
  agents: [
    task('prototype-contained', 'Prototype Containment', ['prototype-isolation', 'edit-safety', 'truthfulness'], ['repoFit', 'consistency'], ['truthfulness', 'consistency', 'prototype-isolation'], 74, 1.25),
    task('production-edit', 'Production Multi-File Edit', ['codebase-awareness', 'edit-safety', 'intent'], ['specificity', 'consistency'], ['truthfulness', 'consistency'], 74, 1.2),
    task('review-findings', 'Review Findings-First', ['review-quality', 'truthfulness', 'communication'], ['clarity'], ['truthfulness'], 72, 1),
    task('testing-restraint', 'Testing Restraint', ['testing-restraint', 'truthfulness'], ['enforceability', 'consistency'], ['testing-restraint', 'truthfulness'], 76, 1.2),
    task('process-safety', 'Process Safety', ['process-control', 'truthfulness'], ['enforceability', 'consistency'], ['process-control', 'truthfulness'], 78, 1.25),
    task('delegation', 'Delegation and Skills', ['delegation-skills', 'codebase-awareness', 'intent'], ['repoFit'], ['consistency'], 70, 0.95),
    task('long-term', 'Long-Term Stability', ['truthfulness', 'prototype-isolation', 'edit-safety'], ['longTermResilience', 'consistency'], ['truthfulness', 'consistency'], 76, 1.25),
  ],
  claude: [
    task('provider-policy', 'Provider Policy Stability', ['instruction-precedence', 'role-stability', 'truthfulness'], ['clarity', 'consistency'], ['truthfulness', 'consistency'], 74, 1.1),
    task('tool-discipline', 'Tooling Discipline', ['tool-discipline', 'edit-safety', 'process-control'], ['specificity', 'enforceability'], ['consistency'], 74, 1.1),
    task('prototype-contained', 'Prototype Containment', ['prototype-isolation', 'truthfulness'], ['repoFit', 'consistency'], ['truthfulness', 'consistency', 'prototype-isolation'], 74, 1.15),
    task('testing-restraint', 'Testing Restraint', ['testing-restraint', 'truthfulness'], ['enforceability'], ['testing-restraint', 'truthfulness'], 76, 1.15),
    task('process-safety', 'Process Safety', ['process-control', 'truthfulness'], ['enforceability', 'consistency'], ['process-control', 'truthfulness'], 77, 1.2),
    task('long-term', 'Long-Term Stability', ['role-stability', 'truthfulness', 'instruction-precedence'], ['longTermResilience', 'consistency'], ['truthfulness', 'consistency'], 76, 1.15),
  ],
  hooks: [
    task('hook-safe-rerun', 'Safe Re-run', ['shell-safety', 'idempotence'], ['consistency', 'longTermResilience'], ['hook-safety', 'consistency'], 74, 1.15),
    task('json-fallback', 'JSON Fallback', ['structured-parsing', 'shell-safety'], ['specificity', 'enforceability'], ['hook-safety'], 72, 1.05),
    task('verification-hand-off', 'Verifier Hand-Off', ['verifier-flow', 'structured-parsing'], ['repoFit', 'consistency'], ['verifier-flow'], 76, 1.25),
    task('prompt-injection', 'Prompt Injection Quality', ['observability', 'verifier-flow'], ['clarity'], ['consistency'], 70, 0.95),
    task('process-neutrality', 'Process Neutrality', ['shell-safety'], ['enforceability', 'consistency'], ['hook-safety'], 74, 1.05),
    task('long-term', 'Long-Term Stability', ['idempotence', 'structured-parsing', 'observability'], ['longTermResilience', 'consistency'], ['hook-safety', 'consistency'], 76, 1.15),
  ],
  skills: [
    task('positive-trigger', 'Positive Trigger', ['trigger-clarity', 'workflow-coverage'], ['specificity', 'repoFit'], ['trigger-clarity'], 74, 1.15),
    task('negative-trigger', 'Negative Trigger Restraint', ['trigger-clarity', 'fallback-handling'], ['consistency'], ['trigger-clarity', 'consistency'], 72, 1.05),
    task('workflow', 'Workflow Completeness', ['workflow-coverage', 'output-contract'], ['clarity', 'enforceability'], ['workflow-coverage'], 75, 1.15),
    task('asset-reuse', 'Asset Reuse', ['asset-reuse', 'workflow-coverage'], ['repoFit'], ['workflow-coverage'], 70, 1),
    task('fallback', 'Blocked Skill Fallback', ['fallback-handling', 'output-contract'], ['clarity', 'longTermResilience'], ['fallback-handling'], 74, 1.05),
    task('long-term', 'Long-Term Stability', ['trigger-clarity', 'workflow-coverage', 'fallback-handling'], ['longTermResilience', 'consistency'], ['consistency'], 75, 1.1),
  ],
  prompts: [
    task('role', 'Role Setup', ['role-clarity', 'output-contract'], ['clarity', 'specificity'], ['truthfulness', 'consistency'], 74, 1.1),
    task('context', 'Context Hygiene', ['context-hygiene', 'communication'], ['longTermResilience', 'clarity'], ['consistency'], 72, 1),
    task('edit', 'Production App Edit', ['codebase-awareness', 'edit-safety', 'output-contract'], ['repoFit', 'specificity'], ['truthfulness', 'consistency'], 73, 1.05),
    task('escalation', 'Escalation Discipline', ['escalation-discipline', 'truthfulness'], ['consistency', 'enforceability'], ['truthfulness', 'consistency'], 73, 1),
    task('testing-restraint', 'Testing Restraint', ['testing-restraint', 'truthfulness'], ['enforceability'], ['testing-restraint', 'truthfulness'], 75, 1.1),
  ],
  'agent-prompts': [
    task('role', 'Agent Role Setup', ['role-clarity', 'task-contract'], ['clarity', 'specificity'], ['consistency'], 74, 1.1),
    task('handoff', 'Handoff Quality', ['task-contract', 'blind-review-discipline'], ['repoFit', 'consistency'], ['blind-review-discipline', 'consistency'], 75, 1.15),
    task('verification', 'Verification Discipline', ['truthfulness', 'blind-review-discipline'], ['enforceability', 'consistency'], ['truthfulness', 'consistency'], 75, 1.1),
    task('context', 'Context Hygiene', ['context-hygiene', 'communication'], ['clarity', 'longTermResilience'], ['consistency'], 72, 1),
    task('long-term', 'Long-Term Stability', ['task-contract', 'truthfulness', 'context-hygiene'], ['longTermResilience', 'consistency'], ['truthfulness', 'consistency'], 75, 1.05),
  ],
  custom: [
    task('general-control', 'General Control Quality', ['truthfulness', 'output-contract', 'role-clarity'], ['clarity', 'consistency'], ['truthfulness', 'consistency'], 72, 1.05),
    task('edit', 'Production App Edit', ['codebase-awareness', 'edit-safety', 'truthfulness'], ['repoFit', 'specificity'], ['truthfulness', 'consistency'], 73, 1.05),
    task('long-term', 'Long-Term Stability', ['truthfulness', 'output-contract'], ['longTermResilience', 'consistency'], ['truthfulness', 'consistency'], 74, 1.05),
  ],
};

const HARD_GATES = {
  common: [
    gate('truthfulness', 'Truthfulness gate', () => true, ({ categoryMap }) => categoryMap.truthfulness || 0, 55, 'Verification language is too weak for reliable factual claims.'),
    gate('consistency', 'Consistency gate', () => true, ({ dimensions }) => dimensions.consistency || 0, 68, 'Internal instruction consistency is too weak for stable behavior.'),
  ],
  agents: [
    gate('prototype-isolation', 'Prototype isolation gate', (profile) => profile.hasPrototypes, ({ categoryMap }) => categoryMap['prototype-isolation'] || 0, 58, 'Prototype isolation is too weak for this repo.'),
    gate('testing-restraint', 'Testing restraint gate', (profile) => profile.testScriptPresent, ({ categoryMap }) => categoryMap['testing-restraint'] || 0, 58, 'Testing restraint is too weak for this repo.'),
    gate('process-control', 'Process control gate', (profile) => profile.devScriptPresent || profile.hasHooks, ({ categoryMap }) => categoryMap['process-control'] || 0, 60, 'Process control is too weak for this repo.'),
  ],
  claude: [
    gate('prototype-isolation', 'Prototype isolation gate', (profile) => profile.hasPrototypes, ({ categoryMap }) => categoryMap['prototype-isolation'] || 0, 58, 'Prototype isolation is too weak for this repo.'),
    gate('testing-restraint', 'Testing restraint gate', (profile) => profile.testScriptPresent, ({ categoryMap }) => categoryMap['testing-restraint'] || 0, 58, 'Testing restraint is too weak for this repo.'),
    gate('process-control', 'Process control gate', (profile) => profile.devScriptPresent || profile.hasHooks, ({ categoryMap }) => categoryMap['process-control'] || 0, 60, 'Process control is too weak for this repo.'),
    gate('tool-discipline', 'Tool discipline gate', () => true, ({ categoryMap }) => categoryMap['tool-discipline'] || 0, 55, 'Tooling guidance is too weak for reliable execution.'),
  ],
  hooks: [
    gate('hook-safety', 'Hook safety gate', () => true, ({ categoryMap }) => average([categoryMap['shell-safety'] || 0, categoryMap.idempotence || 0]), 58, 'Hook safety is too weak for repeatable execution.'),
    gate('verifier-flow', 'Verifier flow gate', (profile, context) => /verify|pending|completion/i.test(context.normalized), ({ categoryMap }) => categoryMap['verifier-flow'] || 0, 52, 'Verifier workflow coverage is too weak for this hook.'),
  ],
  skills: [
    gate('trigger-clarity', 'Trigger clarity gate', () => true, ({ categoryMap }) => categoryMap['trigger-clarity'] || 0, 58, 'Skill trigger guidance is too weak for reliable use.'),
    gate('workflow-coverage', 'Workflow coverage gate', () => true, ({ categoryMap }) => categoryMap['workflow-coverage'] || 0, 58, 'Workflow coverage is too weak for multi-step execution.'),
    gate('fallback-handling', 'Fallback gate', () => true, ({ categoryMap }) => categoryMap['fallback-handling'] || 0, 48, 'Fallback guidance is too weak for blocked or missing dependencies.'),
  ],
  prompts: [
    gate('output-contract', 'Output contract gate', () => true, ({ categoryMap }) => categoryMap['output-contract'] || 0, 55, 'Output contract is too weak for repeatable prompting.'),
    gate('role-clarity', 'Role clarity gate', () => true, ({ categoryMap }) => categoryMap['role-clarity'] || 0, 55, 'Role definition is too weak for stable prompting.'),
  ],
  'agent-prompts': [
    gate('task-contract', 'Task contract gate', () => true, ({ categoryMap }) => categoryMap['task-contract'] || 0, 55, 'Task contract is too weak for reliable agent completion.'),
    gate('blind-review-discipline', 'Blind review gate', (profile, context) => /review|verify|log/i.test(context.normalized), ({ categoryMap }) => categoryMap['blind-review-discipline'] || 0, 50, 'Blind review discipline is too weak for this agent definition.'),
  ],
  custom: [
    gate('output-contract', 'Output contract gate', () => true, ({ categoryMap }) => categoryMap['output-contract'] || 0, 48, 'Output contract is too weak for consistent use.'),
  ],
};

function analyzeArtifact(file, context) {
  const { family, profile, scenarios, taskPack, artifactPath } = context;
  const normalized = normalizeText(file.content);
  const lines = file.content.split(/\r?\n/);
  const directives = extractDirectives(lines);
  const headings = lines.filter((line) => /^#{1,6}\s/.test(line.trim()));
  const bulletCount = lines.filter((line) => /^(\s*[-*]|\s*\d+\.)\s+/.test(line)).length;
  const wordCount = countWords(file.content);
  const lineCount = lines.length;
  const conflicts = findContradictions(normalized);
  const categoryDefinitions = getCategoryDefinitions(family);

  const categoryScores = categoryDefinitions.map((category) => {
    const matchedSignals = category.signals.filter((signal) => signal.test(normalized));
    return {
      id: category.id,
      title: category.title,
      weight: category.weight,
      score: round1((matchedSignals.length / category.signals.length) * 100),
      matchedSignals: matchedSignals.map((signal) => signal.source),
      missingSignals: category.signals.filter((signal) => !signal.test(normalized)).map((signal) => signal.source),
    };
  });

  const categoryMap = Object.fromEntries(categoryScores.map((entry) => [entry.id, entry.score]));
  const ambiguityHits = countPatternHits(normalized, AMBIGUITY_PATTERNS);
  const hardDirectiveHits = countPatternHits(normalized, HARD_DIRECTIVE_PATTERNS);
  const conditionalHits = countPatternHits(normalized, CONDITIONAL_PATTERNS);
  const actionVerbHits = countPatternHits(normalized, ACTION_VERB_PATTERNS);
  const duplicateDirectivePenalty = estimateDuplicatePenalty(directives);
  const lengthPenaltyWeight = family === 'hooks' ? 0.9 : 1;

  const dimensions = {
    clarity: clamp(38 + headings.length * 5 + bulletCount * 1.2 - ambiguityHits * 4 - duplicateDirectivePenalty * 2, 0, 100),
    specificity: clamp(40 + actionVerbHits * 4 + conditionalHits * 4 - ambiguityHits * 3, 0, 100),
    enforceability: clamp(42 + hardDirectiveHits * 4 + conditionalHits * 2 - ambiguityHits * 2, 0, 100),
    consistency: clamp(92 - conflicts.length * 18 - duplicateDirectivePenalty * 3, 0, 100),
    repoFit: scoreRepoFit(family, categoryMap, profile, normalized, artifactPath),
    scopeControl: scoreScopeControl(family, categoryMap, normalized),
  };

  dimensions.longTermResilience = clamp(
    dimensions.clarity * 0.18 +
      dimensions.specificity * 0.22 +
      dimensions.enforceability * 0.16 +
      dimensions.consistency * 0.18 +
      dimensions.repoFit * 0.16 +
      dimensions.scopeControl * 0.1 -
      lengthPenalty(lineCount) * lengthPenaltyWeight,
    0,
    100,
  );

  const hardGates = evaluateHardGates(family, profile, categoryMap, dimensions, normalized);
  const hardGateFailures = hardGates.filter((entry) => entry.required && !entry.passed);
  const scenarioScores = scenarios.map((entry) => scoreScenario(entry, categoryMap, dimensions, hardGates));
  const taskScores = taskPack.map((entry) => scoreTaskBenchmark(entry, categoryMap, dimensions, hardGates));
  const scenarioAverage = round1(weightedAverage(scenarioScores.map((entry) => ({ value: entry.score, weight: entry.weight }))));
  const categoryAverage = round1(weightedAverage(categoryScores.map((entry) => ({ value: entry.score, weight: entry.weight }))));
  const taskAverage = round1(weightedAverage(taskScores.map((entry) => ({ value: entry.score, weight: entry.weight }))));
  const overallScore = clamp(
    scenarioAverage * 0.35 +
      categoryAverage * 0.25 +
      taskAverage * 0.25 +
      dimensions.longTermResilience * 0.1 +
      dimensions.consistency * 0.05,
    0,
    100,
  );

  return {
    family,
    familyLabel: getFamilyDefinition(family).label,
    slotLabel: file.slotLabel || 'Version',
    fileName: file.name || path.basename(artifactPath || 'uploaded.txt'),
    artifactPath: file.artifactPath || artifactPath || '',
    displayName: `${file.slotLabel || 'Version'}${file.name ? ` (${file.name})` : ''}`,
    summary: summarizeFile(file.content),
    metrics: {
      wordCount,
      lineCount,
      directiveCount: directives.length,
    },
    categoryScores,
    scenarioScores,
    taskScores,
    categoryAverage,
    scenarioAverage,
    taskAverage,
    dimensions: mapRoundedValues(dimensions),
    hardGates,
    hardGateFailures,
    conflicts,
    riskFlags: buildRiskFlags(family, categoryMap, dimensions, conflicts, profile, lineCount, wordCount, hardGateFailures),
    overallScore: round1(overallScore),
  };
}

function buildPolicyComparison(left, right, family, scenarios) {
  const margin = round1(Math.abs(left.overallScore - right.overallScore));
  const leftPasses = left.hardGateFailures.length === 0;
  const rightPasses = right.hardGateFailures.length === 0;
  let winner = 'tie';

  if (leftPasses && !rightPasses) winner = 'left';
  else if (!leftPasses && rightPasses) winner = 'right';
  else if (left.overallScore > right.overallScore) winner = 'left';
  else if (right.overallScore > left.overallScore) winner = 'right';

  const winningAnalysis = winner === 'left' ? left : right;
  const losingAnalysis = winner === 'left' ? right : left;
  const confidence = buildConfidence(winner, margin, winningAnalysis, losingAnalysis, leftPasses, rightPasses);
  const reasons = [];

  if (winner === 'tie') {
    reasons.push('Policy scoring could not separate the two versions decisively.');
  } else {
    reasons.push(`${winningAnalysis.slotLabel} scores ${margin.toFixed(1)} points higher on policy scoring.`);
    reasons.push(...topDiffReasons(winningAnalysis, losingAnalysis, scenarios));
    if (winningAnalysis.hardGateFailures.length === 0 && losingAnalysis.hardGateFailures.length > 0) {
      reasons.push(`${winningAnalysis.slotLabel} clears the required hard gates while ${losingAnalysis.slotLabel} does not.`);
    }
  }

  return {
    family,
    winner,
    recommendedLabel: winner === 'tie' ? 'No clear winner' : winningAnalysis.slotLabel,
    scoreMargin: margin,
    confidence,
    reasons,
    leftPassesHardGates: leftPasses,
    rightPassesHardGates: rightPasses,
    conclusion: winner === 'tie'
      ? 'Policy scoring alone cannot separate the two versions decisively.'
      : `${winningAnalysis.slotLabel} is stronger on weighted ${getFamilyDefinition(family).label} policy scoring for this repository. Confidence is ${confidence.level}.`,
  };
}

function buildTaskBenchmarkComparison(left, right, taskPack) {
  const leftAverage = round1(weightedAverage(left.taskScores.map((entry) => ({ value: entry.score, weight: entry.weight }))));
  const rightAverage = round1(weightedAverage(right.taskScores.map((entry) => ({ value: entry.score, weight: entry.weight }))));
  const leftPassCount = left.taskScores.filter((entry) => entry.passed).length;
  const rightPassCount = right.taskScores.filter((entry) => entry.passed).length;
  let winner = 'tie';

  if (leftPassCount > rightPassCount) winner = 'left';
  else if (rightPassCount > leftPassCount) winner = 'right';
  else if (leftAverage > rightAverage) winner = 'left';
  else if (rightAverage > leftAverage) winner = 'right';

  const margin = round1(Math.abs(leftAverage - rightAverage));
  const reasons = [];

  if (winner === 'tie') {
    reasons.push('Use-case benchmark scores are too close to call.');
  } else {
    const winnerAnalysis = winner === 'left' ? left : right;
    const winnerPassCount = winner === 'left' ? leftPassCount : rightPassCount;
    const loserPassCount = winner === 'left' ? rightPassCount : leftPassCount;
    reasons.push(`${winnerAnalysis.slotLabel} performs better across the benchmark pack.`);
    reasons.push(`${winnerAnalysis.slotLabel} passes ${winnerPassCount} of ${taskPack.length} benchmark tasks.`);
    if (winnerPassCount !== loserPassCount) {
      reasons.push(`${winner === 'left' ? right.slotLabel : left.slotLabel} passes only ${loserPassCount} of ${taskPack.length}.`);
    }
  }

  return {
    winner,
    recommendedLabel: winner === 'tie' ? 'No clear winner' : winner === 'left' ? left.slotLabel : right.slotLabel,
    leftAverage,
    rightAverage,
    margin,
    leftPassCount,
    rightPassCount,
    totalTasks: taskPack.length,
    reasons,
  };
}

function buildOverallComparison(mode, left, right, policyComparison, taskBenchmark, family, profile) {
  const leftPasses = left.hardGateFailures.length === 0;
  const rightPasses = right.hardGateFailures.length === 0;
  let winner = 'tie';

  if (mode === 'policy') {
    winner = policyComparison.winner;
  } else if (mode === 'benchmark') {
    winner = taskBenchmark.winner;
  } else {
    if (leftPasses && !rightPasses) winner = 'left';
    else if (!leftPasses && rightPasses) winner = 'right';
    else if (policyComparison.winner === taskBenchmark.winner && policyComparison.winner !== 'tie') winner = policyComparison.winner;
    else {
      const leftComposite = round1(left.overallScore * 0.6 + left.taskAverage * 0.4);
      const rightComposite = round1(right.overallScore * 0.6 + right.taskAverage * 0.4);
      if (Math.abs(leftComposite - rightComposite) < 4) winner = 'tie';
      else winner = leftComposite > rightComposite ? 'left' : 'right';
    }
  }

  const winningAnalysis = winner === 'left' ? left : right;
  const losingAnalysis = winner === 'left' ? right : left;
  const policyMargin = policyComparison.scoreMargin || 0;
  const benchmarkMargin = taskBenchmark.margin || 0;
  const combinedMargin = round1(policyMargin * 0.55 + benchmarkMargin * 0.45);
  const confidence = buildOverallConfidence(winner, combinedMargin, policyComparison, taskBenchmark, leftPasses, rightPasses);
  const makeRecommendation = winner !== 'tie' && confidence.score >= 58 && (winner === 'left' ? leftPasses : rightPasses);
  const reasons = [];

  if (winner === 'tie') {
    reasons.push('The two versions are still too close after combining weighted policy scoring and repo use-case benchmarks.');
    if (!leftPasses || !rightPasses) reasons.push('At least one version still fails required hard gates.');
  } else {
    reasons.push(`${winningAnalysis.slotLabel} is currently the stronger ${getFamilyDefinition(family).label} recommendation for this repository.`);
    reasons.push(...policyComparison.reasons.slice(0, 3));
    reasons.push(...taskBenchmark.reasons.slice(0, 2));
  }

  return {
    family,
    familyLabel: getFamilyDefinition(family).label,
    mode,
    winner,
    recommendedLabel: makeRecommendation ? winningAnalysis.slotLabel : 'No clear winner',
    recommendedFileName: makeRecommendation ? winningAnalysis.fileName : 'No clear winner',
    scoreMargin: combinedMargin,
    confidence,
    reasons,
    hardGateSummary: {
      leftFailures: left.hardGateFailures.map((entry) => entry.title),
      rightFailures: right.hardGateFailures.map((entry) => entry.title),
    },
    conclusion: buildOverallConclusion(mode, family, winner, makeRecommendation, winningAnalysis, losingAnalysis, confidence, profile),
  };
}

function buildOverallConclusion(mode, family, winner, makeRecommendation, winningAnalysis, losingAnalysis, confidence, profile) {
  if (!makeRecommendation) {
    return 'No file is being recommended yet because the separation is weak or a required hard gate is still failing. Tighten the candidate and rerun.';
  }

  const basis = mode === 'policy'
    ? 'policy scoring'
    : mode === 'benchmark'
      ? 'repo use-case benchmarks'
      : 'combined policy scoring and repo use-case benchmarks';
  const familyLabel = getFamilyDefinition(family).label;
  const repoClause = profile.hasPrototypes ? 'prototype, production, and long-term maintenance use cases' : 'the repo use cases';
  return `${winningAnalysis.slotLabel} should be used as the default ${familyLabel} version because it performs better on ${basis}, clears the required safety gates, and is more reliable across ${repoClause}. Confidence is ${confidence.level}. ${losingAnalysis.slotLabel} remains weaker on the measured dimensions.`;
}

function buildConfidence(winner, margin, winningAnalysis, losingAnalysis, leftPasses, rightPasses) {
  if (winner === 'tie') return { level: 'Low', score: 25 };

  const riskDelta = losingAnalysis.riskFlags.length - winningAnalysis.riskFlags.length;
  const consistencyDelta = winningAnalysis.dimensions.consistency - losingAnalysis.dimensions.consistency;
  const gateBonus = leftPasses !== rightPasses ? 15 : 0;
  const score = clamp(35 + margin * 3 + riskDelta * 4 + consistencyDelta * 0.2 + gateBonus, 0, 100);
  return {
    level: score >= 78 ? 'High' : score >= 58 ? 'Medium' : 'Low',
    score: round1(score),
  };
}

function buildOverallConfidence(winner, combinedMargin, policyComparison, taskBenchmark, leftPasses, rightPasses) {
  let score = 35 + combinedMargin * 3 + (leftPasses !== rightPasses ? 12 : 0);
  if (policyComparison.winner !== 'tie' && policyComparison.winner === taskBenchmark.winner) score += 10;
  if (winner === 'tie') score = Math.min(score, 38);
  score = clamp(score, 0, 100);
  return {
    score: round1(score),
    level: score >= 78 ? 'High' : score >= 58 ? 'Medium' : 'Low',
  };
}

function topDiffReasons(winner, loser, scenarios) {
  const categoryDiffs = winner.categoryScores
    .map((entry) => ({
      label: entry.title,
      diff: entry.score - (loser.categoryScores.find((candidate) => candidate.id === entry.id)?.score || 0),
    }))
    .sort((left, right) => right.diff - left.diff)
    .filter((entry) => entry.diff > 0)
    .slice(0, 3)
    .map((entry) => `${winner.slotLabel} is stronger on ${entry.label.toLowerCase()} (+${entry.diff.toFixed(1)} points).`);

  const scenarioDiffs = winner.scenarioScores
    .map((entry) => ({
      title: entry.title,
      diff: entry.score - (loser.scenarioScores.find((candidate) => candidate.id === entry.id)?.score || 0),
      weight: scenarios.find((scenarioEntry) => scenarioEntry.id === entry.id)?.weight || 1,
    }))
    .sort((left, right) => (right.diff * right.weight) - (left.diff * left.weight))
    .filter((entry) => entry.diff > 0)
    .slice(0, 2)
    .map((entry) => `${winner.slotLabel} is more robust on ${entry.title.toLowerCase()} use cases (+${entry.diff.toFixed(1)}).`);

  return [...categoryDiffs, ...scenarioDiffs];
}

function buildScenarioPack(family, profile) {
  const entries = [...BASE_SCENARIOS, ...(FAMILY_SCENARIOS[family] || FAMILY_SCENARIOS.custom)];
  return entries.filter((entry) => {
    if (entry.id === 'prototype-request' || entry.id === 'prototype-contained') return profile.hasPrototypes;
    if (entry.id === 'testing-restraint' || entry.id === 'test-restraint') return profile.testScriptPresent || family === 'hooks' || family === 'skills';
    if (entry.id === 'process-safety') return profile.devScriptPresent || profile.hasHooks || family === 'hooks';
    return true;
  });
}

function buildTaskPack(family, profile) {
  return (FAMILY_TASKS[family] || FAMILY_TASKS.custom).filter((entry) => {
    if (entry.id === 'prototype-contained') return profile.hasPrototypes;
    if (entry.id === 'testing-restraint') return profile.testScriptPresent || family === 'hooks' || family === 'skills';
    if (entry.id === 'process-safety') return profile.devScriptPresent || profile.hasHooks || family === 'hooks';
    return true;
  });
}

function scoreScenario(entry, categoryMap, dimensions, hardGates) {
  const categoryAverage = average(entry.categories.map((category) => categoryMap[category] || 0));
  const dimensionAverage = average(entry.dimensions.map((dimension) => dimensions[dimension] || 0));
  const penalty = requiredGateFailurePenalty(hardGates, gateIdsForScenario(entry.id));
  return {
    id: entry.id,
    title: entry.title,
    weight: entry.weight,
    score: round1(clamp(categoryAverage * 0.7 + dimensionAverage * 0.3 - penalty, 0, 100)),
  };
}

function scoreTaskBenchmark(entry, categoryMap, dimensions, hardGates) {
  const categoryAverage = average(entry.requiredCategories.map((category) => categoryMap[category] || 0));
  const dimensionAverage = average(entry.requiredDimensions.map((dimension) => dimensions[dimension] || 0));
  const failedGates = hardGates.filter((gateEntry) => gateEntry.required && entry.requiredGates.includes(gateEntry.id) && !gateEntry.passed);
  const penalty = failedGates.length * 18;
  const score = clamp(categoryAverage * 0.72 + dimensionAverage * 0.28 - penalty, 0, 100);

  return {
    id: entry.id,
    title: entry.title,
    weight: entry.weight,
    score: round1(score),
    passed: failedGates.length === 0 && score >= entry.passThreshold,
    failedGates: failedGates.map((gateEntry) => gateEntry.title),
    notes: failedGates.length
      ? `Failed hard gates: ${failedGates.map((gateEntry) => gateEntry.title).join(', ')}`
      : score >= entry.passThreshold
        ? 'Passed.'
        : `Below pass threshold ${entry.passThreshold}.`,
  };
}

function evaluateHardGates(family, profile, categoryMap, dimensions, normalized) {
  const entries = [...HARD_GATES.common, ...(HARD_GATES[family] || HARD_GATES.custom)];
  return entries.map((entry) => {
    const required = entry.requiredWhen(profile, { normalized });
    const actual = round1(entry.getActual({ categoryMap, dimensions, profile, normalized }));
    return {
      id: entry.id,
      title: entry.title,
      required,
      threshold: entry.threshold,
      actual,
      passed: !required || actual >= entry.threshold,
      failure: entry.failure,
    };
  });
}

function buildRiskFlags(family, categoryMap, dimensions, conflicts, profile, lineCount, wordCount, hardGateFailures) {
  const flags = [];
  if ((categoryMap.truthfulness || 0) < 45) flags.push('Weak verification language for factual claims.');
  if ((categoryMap['prototype-isolation'] || 100) < 45 && profile.hasPrototypes) flags.push('Prototype isolation guidance is too weak for this repo.');
  if ((categoryMap['testing-restraint'] || 100) < 45 && profile.testScriptPresent) flags.push('Testing restraint is under-specified for a repo with existing test scripts.');
  if ((categoryMap['process-control'] || 100) < 45 && (profile.devScriptPresent || profile.hasHooks)) flags.push('Process-control safety is under-specified for this repo.');
  if (family === 'hooks' && (categoryMap['shell-safety'] || 0) < 45) flags.push('Hook shell safety is under-specified.');
  if (family === 'skills' && (categoryMap['trigger-clarity'] || 0) < 45) flags.push('Skill trigger guidance is too weak.');
  if ((dimensions.consistency || 0) < 60) flags.push('Internal consistency is weak enough to create behavior drift.');
  if (conflicts.length > 0) flags.push(`Detected ${conflicts.length} contradiction signal(s).`);
  if (lineCount < 6 || wordCount < 40) flags.push('Instruction set is likely too thin for reliable control.');
  if (lineCount > 320) flags.push('Instruction set is large enough to risk prompt fatigue and drift.');
  for (const gateEntry of hardGateFailures) flags.push(gateEntry.failure);
  return flags;
}

function scoreRepoFit(family, categoryMap, profile, normalized, artifactPath) {
  const weights = [
    { key: 'truthfulness', weight: 1.2 },
    { key: 'intent', weight: family === 'hooks' || family === 'skills' ? 0.7 : 1.05 },
    { key: 'codebase-awareness', weight: 1.1 },
    { key: 'edit-safety', weight: 1.15 },
    { key: 'prototype-isolation', weight: profile.hasPrototypes ? 1.3 : 0.6 },
    { key: 'testing-restraint', weight: profile.testScriptPresent ? 1.2 : 0.7 },
    { key: 'process-control', weight: profile.devScriptPresent || profile.hasHooks ? 1.2 : 0.7 },
  ];

  const base = weightedAverage(weights.map((entry) => ({ value: categoryMap[entry.key] || 0, weight: entry.weight })));
  let bonus = 0;
  if (artifactPath && normalized.includes(artifactPath.toLowerCase().replace(/\\/g, '/'))) bonus += 6;
  if (family === 'hooks' && profile.artifactCounts.hooks > 0) bonus += 5;
  if (family === 'skills' && profile.artifactCounts.skills > 0) bonus += 5;
  if (family === 'prompts' && profile.artifactCounts.prompts > 0) bonus += 5;
  if (family === 'agent-prompts' && profile.artifactCounts['agent-prompts'] > 0) bonus += 5;
  return round1(clamp(base + bonus, 0, 100));
}

function scoreScopeControl(family, categoryMap, normalized) {
  const base = average([
    categoryMap['prototype-isolation'] || 60,
    categoryMap['testing-restraint'] || 60,
    categoryMap['process-control'] || 60,
  ]);

  let bonus = 0;
  if (/same file type/i.test(normalized)) bonus += 4;
  if (/do not compare/i.test(normalized)) bonus += 4;
  if (family === 'hooks' && /rm -f|return 0|exit 0/i.test(normalized)) bonus += 4;
  if (family === 'skills' && /missing|blocked|fallback/i.test(normalized)) bonus += 4;
  return round1(clamp(base + bonus, 0, 100));
}

function getCategoryDefinitions(family) {
  const specific = FAMILY_CATEGORY_DEFINITIONS[family] || FAMILY_CATEGORY_DEFINITIONS.custom;
  if (family !== 'hooks' && family !== 'skills') return [...COMMON_POLICY_CATEGORIES, ...specific];
  return [
    definition('truthfulness', 'Truthfulness and Verification', 1.15, [/verify/i, /correct/i, /truth/i, /done/i, /failure/i]),
    definition('codebase-awareness', 'Repo Awareness', 1, [/path/i, /file/i, /repo/i, /project/i, /workspace/i]),
    definition('edit-safety', 'Edit Safety', 1, [/non-destructive/i, /safe/i, /cleanup/i, /idempot/i, /fallback/i]),
    definition('communication', 'Communication Discipline', 0.85, [/clear/i, /status/i, /message/i, /log/i, /summary/i]),
    ...specific,
  ];
}

function getFamilyDefinition(family) {
  return FAMILY_DEFINITIONS[normalizeFamily(family)] || FAMILY_DEFINITIONS.custom;
}

function normalizeFamily(family) {
  return FAMILY_DEFINITIONS[family] ? family : 'custom';
}

function buildArtifactEntry(relativePath) {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (normalizedPath === 'AGENTS.md') return artifactEntry(normalizedPath, 'agents', 'Root AGENTS.md');
  if (normalizedPath === 'CLAUDE.md') return artifactEntry(normalizedPath, 'claude', 'Root CLAUDE.md');
  if (normalizedPath.startsWith('.claude/hooks/')) return artifactEntry(normalizedPath, 'hooks', 'Hook');
  if (normalizedPath.startsWith('.claude/skills/') && normalizedPath.endsWith('/SKILL.md')) return artifactEntry(normalizedPath, 'skills', 'Skill');
  if (normalizedPath.startsWith('.claude/agents/')) return artifactEntry(normalizedPath, 'agent-prompts', 'Agent Definition');
  if (normalizedPath.startsWith('prompts/')) return artifactEntry(normalizedPath, 'prompts', 'Prompt');
  if (normalizedPath === 'playbook/system-prompt.md') return artifactEntry(normalizedPath, 'prompts', 'System Prompt');
  return null;
}

function artifactEntry(relativePath, family, prefix) {
  return {
    path: relativePath,
    name: path.basename(relativePath),
    family,
    familyLabel: getFamilyDefinition(family).label,
    title: `${prefix}: ${relativePath}`,
  };
}

function summarizeArtifactCounts(catalog) {
  const counts = {
    agents: 0,
    claude: 0,
    hooks: 0,
    skills: 0,
    prompts: 0,
    'agent-prompts': 0,
    custom: 0,
  };

  for (const entry of catalog) {
    counts[entry.family] = (counts[entry.family] || 0) + 1;
  }

  return counts;
}

function requiredGateFailurePenalty(hardGates, gateIds) {
  return hardGates.filter((entry) => entry.required && gateIds.includes(entry.id) && !entry.passed).length * 15;
}

function gateIdsForScenario(scenarioId) {
  if (scenarioId.includes('prototype')) return ['prototype-isolation', 'truthfulness', 'consistency'];
  if (scenarioId.includes('testing')) return ['testing-restraint', 'truthfulness'];
  if (scenarioId.includes('process')) return ['process-control', 'truthfulness'];
  if (scenarioId.includes('verification') || scenarioId.includes('stale')) return ['truthfulness', 'consistency'];
  return ['truthfulness', 'consistency'];
}

function summarizeFile(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 4)
    .join('\n')
    .slice(0, 280);
}

function extractDirectives(lines) {
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line) || countWords(line) > 7)
    .map((line) => line.replace(/^([-*]|\d+\.)\s+/, '').trim());
}

function findContradictions(normalizedText) {
  return CONTRADICTIONS.filter((pair) =>
    pair.left.some((pattern) => pattern.test(normalizedText)) &&
    pair.right.some((pattern) => pattern.test(normalizedText)),
  ).map((pair) => pair.title);
}

function estimateDuplicatePenalty(directives) {
  const seen = new Map();
  for (const directive of directives) {
    const key = directive.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.values()].filter((count) => count > 1).reduce((total, count) => total + (count - 1), 0);
}

function countPatternHits(text, patterns) {
  return patterns.reduce((total, pattern) => total + ((text.match(pattern) || []).length), 0);
}

function countWords(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function lengthPenalty(lineCount) {
  if (lineCount < 12) return 10;
  if (lineCount > 360) return 16;
  if (lineCount > 220) return 9;
  return 0;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function weightedAverage(entries) {
  const totalWeight = entries.reduce((total, entry) => total + entry.weight, 0);
  if (totalWeight === 0) return 0;
  return entries.reduce((total, entry) => total + entry.value * entry.weight, 0) / totalWeight;
}

function mapRoundedValues(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round1(value)]));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function normalizeText(value) {
  return value.toLowerCase();
}

function definition(id, title, weight, signals) {
  return { id, title, weight, signals };
}

function scenario(id, title, categories, dimensions, weight) {
  return { id, title, categories, dimensions, weight };
}

function task(id, title, requiredCategories, requiredDimensions, requiredGates, passThreshold, weight) {
  return { id, title, requiredCategories, requiredDimensions, requiredGates, passThreshold, weight };
}

function gate(id, title, requiredWhen, getActual, threshold, failure) {
  return { id, title, requiredWhen, getActual, threshold, failure };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listDirectoryNames(directoryPath) {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function collectFiles(directoryPath) {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      const nextPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...await collectFiles(nextPath));
      } else if (entry.isFile()) {
        results.push(nextPath);
      }
    }

    return results;
  } catch {
    return [];
  }
}

function toRelativeProjectPath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
}
