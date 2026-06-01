'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { reloadPlaybook } = require('./playbook-loader');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const AGENT_PROMPTS_ROOT = path.join(PROJECT_ROOT, 'prompts', 'agents');
const CUSTOM_AGENT_PROMPTS_ROOT = path.join(AGENT_PROMPTS_ROOT, 'custom');
const AGENT_PROMPT_VERSIONS_ROOT = path.join(PROJECT_ROOT, 'prompts', 'versions', 'agents');
const CUSTOM_AGENT_PROMPT_PREFIX = 'custom-';
const AGENT_PROMPT_VERSION_META_EXT = '.meta.json';
const promptWatchers = [];
const promptWatchDebounce = new Map();
let promptWatchStarted = false;

const AGENT_PROMPT_DEFINITIONS = Object.freeze([
  {
    id: 'chat-core',
    order: 10,
    name: 'QBO Assistant',
    promptType: 'system',
    usedBy: 'Primary escalation assistant',
    description: 'Core system instructions for the main chat agent.',
    filePath: path.join(PROJECT_ROOT, 'playbook', 'system-prompt.md'),
    afterWrite: reloadPlaybook,
  },
  {
    id: 'workspace-action',
    order: 50,
    name: 'Workspace Agent',
    promptType: 'system',
    usedBy: 'Inbox, calendar, and workspace execution',
    description: 'Primary workspace prompt for email, calendar, and background coordination.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'workspace-action.md'),
  },
  {
    id: 'workspace-chat-only',
    order: 51,
    name: 'Workspace Agent (Chat-Only)',
    promptType: 'system',
    usedBy: 'Workspace direct-response mode',
    description: 'Workspace fallback prompt used when the assistant should answer without emitting actions.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'workspace-chat-only.md'),
    visible: false,
  },
  {
    id: 'gmail-assistant',
    order: 52,
    name: 'Gmail Assistant',
    promptType: 'system',
    usedBy: 'Inbox message reader and reply helper',
    description: 'Focused Gmail helper prompt for summaries, drafting, and inbox Q&A.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'gmail-assistant.md'),
    visible: false,
  },
  {
    id: 'escalation-template-parser',
    order: 20,
    name: 'Image Parser',
    promptType: 'system',
    usedBy: 'Strict escalation template screenshot parsing',
    description: 'Canonical parser prompt for one QBO escalation template format.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'escalation-template-parser.md'),
  },
  {
    id: 'triage-agent',
    order: 21,
    name: 'Triage Agent',
    promptType: 'system',
    usedBy: 'Fast first-pass escalation triage',
    description: 'Structured triage prompt for category, severity, immediate next step, and missing info.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'triage-agent.md'),
  },
  {
    id: 'known-issue-search-agent',
    order: 22,
    name: 'INV Search Agent',
    promptType: 'system',
    usedBy: 'INV investigation search before escalation triage',
    description: 'Tool-using prompt for known-issue lookup, candidate rejection, and no-match confirmation.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'known-issue-search-agent.md'),
  },
  {
    id: 'follow-up-chat-parser',
    order: 23,
    name: 'Follow-Up Chat Parser',
    promptType: 'system',
    usedBy: 'Phone-agent follow-up screenshot transcript parsing',
    description: 'Verbatim transcript and dedupe prompt for follow-up chat screenshots.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'follow-up-chat-parser.md'),
  },
  {
    id: 'copilot-agent',
    order: 40,
    name: 'Copilot Agent',
    promptType: 'system',
    usedBy: 'Search, template, analysis, and playbook review',
    description: 'Dedicated copilot instructions layered on top of the shared playbook prompt.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'copilot-agent.md'),
  },
  {
    id: 'sdk-image-parse',
    order: 31,
    name: 'Claude Screenshot Parse',
    promptType: 'default',
    usedBy: 'Claude SDK screenshot parser',
    description: 'Hidden compatibility alias for the canonical escalation template parser prompt.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'sdk-image-parse.md'),
    visible: false,
  },
  {
    id: 'escalation-enrichment',
    order: 50,
    name: 'Knowledge Enrichment',
    promptType: 'system',
    usedBy: 'Resolved-case knowledge extraction',
    description: 'Prompt for extracting reusable knowledge from resolved escalations.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'escalation-enrichment.md'),
    visible: false,
  },
  {
    id: 'workspace-proactive',
    order: 60,
    name: 'Workspace Proactive',
    promptType: 'system',
    usedBy: 'Background workspace advisories',
    description: 'Short advisory prompt used when the workspace monitor raises notable alerts.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'workspace-proactive.md'),
    visible: false,
  },
]);

const promptDefinitionById = new Map(
  AGENT_PROMPT_DEFINITIONS.map((definition) => [definition.id, definition])
);

function ensurePromptDirectories() {
  fs.mkdirSync(AGENT_PROMPTS_ROOT, { recursive: true });
  fs.mkdirSync(CUSTOM_AGENT_PROMPTS_ROOT, { recursive: true });
  fs.mkdirSync(AGENT_PROMPT_VERSIONS_ROOT, { recursive: true });
}

function normalizeCustomAgentId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}

function getCustomPromptId(agentId) {
  const normalizedAgentId = normalizeCustomAgentId(agentId);
  return normalizedAgentId ? `${CUSTOM_AGENT_PROMPT_PREFIX}${normalizedAgentId}` : '';
}

function isCustomPromptId(id) {
  return String(id || '').startsWith(CUSTOM_AGENT_PROMPT_PREFIX);
}

function getAgentIdForCustomPromptId(id) {
  if (!isCustomPromptId(id)) return null;
  return normalizeCustomAgentId(String(id).slice(CUSTOM_AGENT_PROMPT_PREFIX.length)) || null;
}

function getCustomPromptFilePath(id) {
  const agentId = getAgentIdForCustomPromptId(id);
  if (!agentId) return null;
  return path.join(CUSTOM_AGENT_PROMPTS_ROOT, `${agentId}.md`);
}

function buildCustomPromptDefinition(id) {
  const agentId = getAgentIdForCustomPromptId(id);
  const filePath = getCustomPromptFilePath(id);
  if (!agentId || !filePath || !fs.existsSync(filePath)) return null;
  return {
    id,
    order: 500,
    name: agentId
      .split('-')
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' '),
    promptType: 'system',
    usedBy: `Custom agent ${agentId}`,
    description: 'Custom agent prompt registered from Agent Mission Control.',
    filePath,
    custom: true,
  };
}

function listCustomPromptDefinitions() {
  ensurePromptDirectories();
  if (!fs.existsSync(CUSTOM_AGENT_PROMPTS_ROOT)) return [];
  return fs.readdirSync(CUSTOM_AGENT_PROMPTS_ROOT)
    .filter((fileName) => /^[a-z0-9][a-z0-9-]*\.md$/.test(fileName))
    .map((fileName) => buildCustomPromptDefinition(getCustomPromptId(fileName.replace(/\.md$/, ''))))
    .filter(Boolean);
}

function listAllPromptDefinitions() {
  return [
    ...AGENT_PROMPT_DEFINITIONS,
    ...listCustomPromptDefinitions(),
  ];
}

function getAgentPromptDefinition(id) {
  const promptId = String(id || '').trim();
  const definition = promptDefinitionById.get(promptId) || buildCustomPromptDefinition(promptId);
  if (!definition) return null;
  return definition;
}

function findAgentPromptDefinitionByFilePath(filePath) {
  const targetPath = path.resolve(String(filePath || ''));
  return listAllPromptDefinitions().find((definition) => path.resolve(definition.filePath) === targetPath) || null;
}

function getPromptVersionFromText(content) {
  const match = String(content || '').match(/^\s*PROMPT_VERSION:\s*([^\r\n]+)/im);
  return match ? match[1].trim() : '';
}

function getPromptSha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function safeSnapshotTs(ts) {
  return /^\d+$/.test(String(ts || '')) ? String(ts) : null;
}

function readPromptFile(definition) {
  return fs.readFileSync(definition.filePath, 'utf-8');
}

function readPromptVersionMeta(versionsDir, ts) {
  const metaPath = path.join(versionsDir, `${ts}${AGENT_PROMPT_VERSION_META_EXT}`);
  if (!fs.existsSync(metaPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readPromptVersionLabel(versionsDir, ts) {
  const labelPath = path.join(versionsDir, `${ts}.label`);
  if (!fs.existsSync(labelPath)) return '';
  try {
    return fs.readFileSync(labelPath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function getPromptVersionEntries(definition) {
  const versionsDir = getAgentPromptVersionsDir(definition.id);
  if (!fs.existsSync(versionsDir)) return [];

  return fs.readdirSync(versionsDir)
    .filter((fileName) => /^\d+\.md$/.test(fileName))
    .map((fileName) => {
      const ts = parseInt(fileName, 10);
      const snapshotPath = path.join(versionsDir, fileName);
      const stats = fs.statSync(snapshotPath);
      const content = fs.readFileSync(snapshotPath, 'utf-8');
      const meta = readPromptVersionMeta(versionsDir, ts);
      const label = readPromptVersionLabel(versionsDir, ts) || String(meta.label || '').trim();
      const sha256 = String(meta.sha256 || '').trim() || getPromptSha256(content);
      return {
        ts,
        size: stats.size,
        label: label || null,
        promptVersion: String(meta.promptVersion || '').trim() || getPromptVersionFromText(content),
        sha256,
        source: String(meta.source || '').trim(),
        createdAt: meta.createdAt || new Date(ts).toISOString(),
        fileModified: meta.fileModified || null,
      };
    })
    .sort((a, b) => b.ts - a.ts);
}

function nextPromptSnapshotTs(versionsDir) {
  let ts = Date.now();
  while (fs.existsSync(path.join(versionsDir, `${ts}.md`))) {
    ts += 1;
  }
  return ts;
}

function captureAgentPromptVersion(idOrDefinition, options = {}) {
  const definition = typeof idOrDefinition === 'string'
    ? getAgentPromptDefinition(idOrDefinition)
    : idOrDefinition;
  if (!definition || !fs.existsSync(definition.filePath)) {
    return null;
  }

  ensurePromptDirectories();
  const content = typeof options.content === 'string'
    ? options.content
    : readPromptFile(definition);
  const sha256 = getPromptSha256(content);
  const versionsDir = getAgentPromptVersionsDir(definition.id);
  fs.mkdirSync(versionsDir, { recursive: true });

  const existing = getPromptVersionEntries(definition).find((entry) => entry.sha256 === sha256);
  if (existing) {
    return { ...existing, created: false };
  }

  const ts = nextPromptSnapshotTs(versionsDir);
  const snapshotPath = path.join(versionsDir, `${ts}.md`);
  const label = String(options.label || '').trim();
  const source = String(options.source || 'observed').trim() || 'observed';
  let fileModified = null;
  try {
    fileModified = fs.statSync(definition.filePath).mtime.toISOString();
  } catch {
    fileModified = null;
  }

  fs.writeFileSync(snapshotPath, content, 'utf-8');
  if (label) {
    fs.writeFileSync(path.join(versionsDir, `${ts}.label`), label, 'utf-8');
  }
  fs.writeFileSync(
    path.join(versionsDir, `${ts}${AGENT_PROMPT_VERSION_META_EXT}`),
    `${JSON.stringify({
      ts,
      promptId: definition.id,
      promptVersion: getPromptVersionFromText(content),
      sha256,
      size: Buffer.byteLength(content, 'utf8'),
      source,
      label: label || null,
      createdAt: new Date(ts).toISOString(),
      fileModified,
    }, null, 2)}\n`,
    'utf-8'
  );

  return {
    ts,
    size: Buffer.byteLength(content, 'utf8'),
    label: label || null,
    promptVersion: getPromptVersionFromText(content),
    sha256,
    source,
    createdAt: new Date(ts).toISOString(),
    fileModified,
    created: true,
  };
}

function listAgentPromptVersions(id, options = {}) {
  const definition = getAgentPromptDefinition(id);
  if (!definition) {
    const err = new Error('Agent prompt not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (options.captureCurrent !== false) {
    captureAgentPromptVersion(definition, {
      source: options.source || 'list-current',
    });
  }
  return getPromptVersionEntries(definition);
}

function readAgentPromptVersion(id, ts) {
  const definition = getAgentPromptDefinition(id);
  if (!definition) {
    const err = new Error('Agent prompt not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const safeTs = safeSnapshotTs(ts);
  if (!safeTs) {
    const err = new Error('Invalid timestamp');
    err.code = 'INVALID_TS';
    throw err;
  }

  const snapshotPath = path.join(getAgentPromptVersionsDir(definition.id), `${safeTs}.md`);
  if (!fs.existsSync(snapshotPath)) {
    const err = new Error('Version not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  return fs.readFileSync(snapshotPath, 'utf-8');
}

function toPromptMetadata(definition) {
  let size = 0;
  let modified = null;
  let content = '';
  try {
    const stats = fs.statSync(definition.filePath);
    size = stats.size;
    modified = stats.mtime;
    content = readPromptFile(definition);
  } catch {
    size = 0;
    modified = null;
    content = '';
  }

  return {
    id: definition.id,
    order: definition.order,
    name: definition.name,
    promptType: definition.promptType,
    usedBy: definition.usedBy,
    description: definition.description,
    size,
    modified,
    promptVersion: getPromptVersionFromText(content),
    promptSha256: content ? getPromptSha256(content) : '',
    custom: Boolean(definition.custom),
  };
}

function listAgentPromptDefinitions(options = {}) {
  ensurePromptDirectories();
  const includeInternal = options && options.includeInternal === true;
  return listAllPromptDefinitions()
    .filter((definition) => includeInternal || definition.visible !== false)
    .map(toPromptMetadata)
    .sort((a, b) => a.order - b.order);
}

function captureAllAgentPromptVersions(source = 'startup-scan') {
  return listAllPromptDefinitions()
    .map((definition) => captureAgentPromptVersion(definition, { source }))
    .filter(Boolean);
}

function schedulePromptFileCapture(filePath, source) {
  const cleanPath = path.resolve(String(filePath || ''));
  if (!cleanPath.toLowerCase().endsWith('.md')) return;
  const existingTimer = promptWatchDebounce.get(cleanPath);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    promptWatchDebounce.delete(cleanPath);
    const definition = findAgentPromptDefinitionByFilePath(cleanPath);
    if (!definition || !fs.existsSync(definition.filePath)) return;
    captureAgentPromptVersion(definition, { source });
  }, 250);
  if (typeof timer.unref === 'function') timer.unref();
  promptWatchDebounce.set(cleanPath, timer);
}

function watchAgentPromptVersions() {
  if (promptWatchStarted || process.env.DISABLE_AGENT_PROMPT_VERSION_WATCH === '1') {
    return promptWatchers;
  }
  promptWatchStarted = true;
  captureAllAgentPromptVersions('startup-scan');

  const watchDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    const watcher = fs.watch(dirPath, { persistent: false }, (_eventType, fileName) => {
      if (!fileName) return;
      schedulePromptFileCapture(path.join(dirPath, String(fileName)), 'file-watch');
    });
    promptWatchers.push(watcher);
  };

  watchDir(AGENT_PROMPTS_ROOT);
  watchDir(CUSTOM_AGENT_PROMPTS_ROOT);
  return promptWatchers;
}

function readAgentPrompt(id, options = {}) {
  const definition = getAgentPromptDefinition(id);
  if (!definition) {
    const err = new Error('Agent prompt not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const content = readPromptFile(definition);
  if (options.capture !== false) {
    captureAgentPromptVersion(definition, {
      content,
      source: options.source || 'read',
    });
  }
  return content;
}

function getRenderedAgentPrompt(id) {
  return readAgentPrompt(id, { source: 'runtime-read' });
}

function writeAgentPrompt(id, content, options = {}) {
  const definition = getAgentPromptDefinition(id);
  if (!definition) {
    const err = new Error('Agent prompt not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  ensurePromptDirectories();
  const normalizedContent = String(content);
  let previousContent = null;
  try {
    previousContent = readPromptFile(definition);
  } catch {
    previousContent = null;
  }

  const source = String(options.source || 'write').trim() || 'write';
  const label = String(options.label || '').trim();
  if (previousContent !== null && getPromptSha256(previousContent) !== getPromptSha256(normalizedContent)) {
    captureAgentPromptVersion(definition, {
      content: previousContent,
      source: `${source}:before`,
      label: label ? `Before ${label}` : 'Before prompt write',
    });
  }

  fs.writeFileSync(definition.filePath, normalizedContent, 'utf-8');
  if (typeof definition.afterWrite === 'function') {
    definition.afterWrite();
  }
  captureAgentPromptVersion(definition, {
    content: normalizedContent,
    source: `${source}:after`,
    label: label || 'Prompt write',
  });
  return toPromptMetadata(definition);
}

function getAgentPromptVersionsDir(id) {
  const definition = getAgentPromptDefinition(id);
  if (!definition) {
    const err = new Error('Agent prompt not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  ensurePromptDirectories();
  return path.join(AGENT_PROMPT_VERSIONS_ROOT, definition.id);
}

function createDefaultCustomAgentPrompt({ agentId, displayName, roleTitle, headline, tone, boundaries }) {
  const label = roleTitle || displayName || agentId;
  return [
    `# ${label}`,
    '',
    `You are ${displayName || label}, a custom agent registered in Agent Mission Control.`,
    '',
    '## Mission',
    headline || 'Support the assigned escalation workflow with evidence-backed, reviewable guidance.',
    '',
    '## Operating Style',
    tone || 'Clear, practical, and explicit about uncertainty.',
    '',
    '## Guardrails',
    boundaries || 'Do not take irreversible action without human review. Surface assumptions, missing evidence, and handoff needs.',
    '',
    '## Output',
    'Return concise operator-facing guidance, include evidence when available, and call out when a human review is required.',
    '',
  ].join('\n');
}

function ensureCustomAgentPrompt(agentId, options = {}) {
  const promptId = getCustomPromptId(agentId);
  if (!promptId) {
    const err = new Error('Custom agent prompt requires a stable agentId');
    err.code = 'INVALID_AGENT_ID';
    throw err;
  }

  ensurePromptDirectories();
  const filePath = getCustomPromptFilePath(promptId);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      typeof options.content === 'string'
        ? options.content
        : createDefaultCustomAgentPrompt({ agentId, ...(options.profile || {}) }),
      'utf-8'
    );
  }
  return getAgentPromptDefinition(promptId);
}

module.exports = {
  AGENT_PROMPT_DEFINITIONS,
  AGENT_PROMPTS_ROOT,
  AGENT_PROMPT_VERSIONS_ROOT,
  CUSTOM_AGENT_PROMPTS_ROOT,
  CUSTOM_AGENT_PROMPT_PREFIX,
  ensureCustomAgentPrompt,
  captureAllAgentPromptVersions,
  captureAgentPromptVersion,
  getAgentIdForCustomPromptId,
  getAgentPromptDefinition,
  getAgentPromptVersionsDir,
  getPromptSha256,
  getPromptVersionFromText,
  getRenderedAgentPrompt,
  listAgentPromptVersions,
  listAgentPromptDefinitions,
  readAgentPrompt,
  readAgentPromptVersion,
  watchAgentPromptVersions,
  writeAgentPrompt,
};
