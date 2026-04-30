'use strict';

const fs = require('fs');
const path = require('path');
const { reloadPlaybook } = require('./playbook-loader');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const AGENT_PROMPTS_ROOT = path.join(PROJECT_ROOT, 'prompts', 'agents');
const AGENT_PROMPT_VERSIONS_ROOT = path.join(PROJECT_ROOT, 'prompts', 'versions', 'agents');

const AGENT_PROMPT_DEFINITIONS = Object.freeze([
  {
    id: 'chat-core',
    order: 10,
    name: 'Main Chat / QBO Assistant',
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
    id: 'image-parser',
    order: 30,
    name: 'Image Parser Agent',
    promptType: 'system',
    usedBy: 'Escalation screenshot and INV parsing',
    description: 'Primary parser prompt for screenshots and investigation lists.',
    filePath: path.join(AGENT_PROMPTS_ROOT, 'image-parser.md'),
  },
  {
    id: 'escalation-template-parser',
    order: 20,
    name: 'Escalation Template Parser',
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
    id: 'follow-up-chat-parser',
    order: 22,
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
    usedBy: 'Claude fallback screenshot parser',
    description: 'Structured extraction prompt used by the Claude SDK screenshot parsing path.',
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
  fs.mkdirSync(AGENT_PROMPT_VERSIONS_ROOT, { recursive: true });
}

function getAgentPromptDefinition(id) {
  const definition = promptDefinitionById.get(String(id || '').trim());
  if (!definition) return null;
  return definition;
}

function toPromptMetadata(definition) {
  let size = 0;
  let modified = null;
  try {
    const stats = fs.statSync(definition.filePath);
    size = stats.size;
    modified = stats.mtime;
  } catch {
    size = 0;
    modified = null;
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
  };
}

function listAgentPromptDefinitions(options = {}) {
  ensurePromptDirectories();
  const includeInternal = options && options.includeInternal === true;
  return AGENT_PROMPT_DEFINITIONS
    .filter((definition) => includeInternal || definition.visible !== false)
    .map(toPromptMetadata)
    .sort((a, b) => a.order - b.order);
}

function readAgentPrompt(id) {
  const definition = getAgentPromptDefinition(id);
  if (!definition) {
    const err = new Error('Agent prompt not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return fs.readFileSync(definition.filePath, 'utf-8');
}

function getRenderedAgentPrompt(id) {
  return readAgentPrompt(id);
}

function writeAgentPrompt(id, content) {
  const definition = getAgentPromptDefinition(id);
  if (!definition) {
    const err = new Error('Agent prompt not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  ensurePromptDirectories();
  const normalizedContent = String(content);
  fs.writeFileSync(definition.filePath, normalizedContent, 'utf-8');
  if (typeof definition.afterWrite === 'function') {
    definition.afterWrite();
  }
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

module.exports = {
  AGENT_PROMPT_DEFINITIONS,
  AGENT_PROMPTS_ROOT,
  AGENT_PROMPT_VERSIONS_ROOT,
  getAgentPromptDefinition,
  getAgentPromptVersionsDir,
  getRenderedAgentPrompt,
  listAgentPromptDefinitions,
  readAgentPrompt,
  writeAgentPrompt,
};
