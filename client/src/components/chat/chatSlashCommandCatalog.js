import { PROVIDER_OPTIONS } from '../../lib/providerCatalog.js';
import { getProviderLabel } from '../../utils/markdown.jsx';

export const PARSE_ESCALATION_PROMPT = 'Parse this escalation image for fast triage.';

export const QUICK_PROMPT_COMMANDS = {
  parse: PARSE_ESCALATION_PROMPT,
  draft: 'Based on our conversation, draft a professional response I can send back to the phone agent. Include specific resolution steps.',
  categorize: 'What QBO category does this issue fall under? Explain your reasoning and list related known issues in that category.',
  troubleshoot: 'Based on the issue described, what troubleshooting steps should the agent try next? List them in order of likelihood to resolve.',
};

const SLASH_COMMAND_CATALOG = [
  {
    id: 'help',
    command: '/help',
    insertValue: '/help',
    description: 'Show the slash-command menu and shortcuts.',
    example: '/help',
    keywords: ['commands', 'menu', 'slash', 'shortcuts'],
  },
  {
    id: 'clear',
    command: '/clear',
    insertValue: '/clear',
    description: 'Start a fresh conversation and clear the draft.',
    example: '/clear',
    keywords: ['new', 'reset', 'empty', 'wipe'],
  },
  {
    id: 'parse',
    command: '/parse',
    insertValue: '/parse',
    description: 'Load the parse-escalation prompt into the input.',
    example: '/parse',
    keywords: ['triage', 'image', 'extract'],
  },
  {
    id: 'draft',
    command: '/draft',
    insertValue: '/draft',
    description: 'Load the draft-response prompt into the input.',
    example: '/draft',
    keywords: ['response', 'reply', 'agent'],
  },
  {
    id: 'categorize',
    command: '/categorize',
    insertValue: '/categorize',
    description: 'Load the issue-categorization prompt into the input.',
    example: '/categorize',
    keywords: ['category', 'classify', 'bucket'],
  },
  {
    id: 'troubleshoot',
    command: '/troubleshoot',
    insertValue: '/troubleshoot',
    description: 'Load the troubleshooting prompt into the input.',
    example: '/troubleshoot',
    keywords: ['steps', 'debug', 'next'],
  },
  {
    id: 'provider',
    command: '/provider',
    insertValue: '/provider ',
    description: ({ provider }) => `Switch models. Current: ${getProviderLabel(provider)}.`,
    example: '/provider claude',
    keywords: ['model', 'claude', 'codex', 'gpt', 'sonnet', 'opus'],
  },
  {
    id: 'mode',
    command: '/mode',
    insertValue: '/mode ',
    description: ({ effectiveMode }) => `Switch response strategy. Current: ${effectiveMode}.`,
    example: '/mode parallel',
    keywords: ['single', 'fallback', 'parallel', 'strategy'],
  },
  {
    id: 'effort',
    command: '/effort',
    insertValue: '/effort ',
    description: ({ reasoningEffort }) => `Set reasoning effort. Current: ${reasoningEffort}.`,
    example: '/effort high',
    keywords: ['reasoning', 'low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'copilot',
    command: '/copilot',
    insertValue: '/copilot',
    description: ({ showCopilot }) => `${showCopilot ? 'Hide' : 'Show'} the inline Co-pilot drawer.`,
    example: '/copilot',
    keywords: ['drawer', 'assistant', 'toggle'],
  },
  {
    id: 'attach',
    command: '/attach',
    insertValue: '/attach',
    description: 'Open the image parser file picker.',
    example: '/attach',
    keywords: ['upload', 'file', 'image', 'screenshot', 'parser'],
  },
  {
    id: 'webcam',
    command: '/webcam',
    insertValue: '/webcam',
    description: 'Open webcam capture for the image parser.',
    example: '/webcam',
    keywords: ['camera', 'photo', 'capture', 'parser'],
  },
];

export function normalizeSlashToken(value) {
  return String(value || '').trim().toLowerCase().replace(/^\/+/, '').replace(/[^a-z0-9]+/g, '');
}

export function createProviderAliasMap(provider, providerOptions = PROVIDER_OPTIONS) {
  const aliasMap = new Map();
  const familyDefaults = new Map();

  for (const option of providerOptions) {
    if (!familyDefaults.has(option.family)) {
      familyDefaults.set(option.family, option.value);
    }

    const aliases = [option.value, option.label, option.shortLabel, option.family];
    for (const alias of aliases) {
      const key = normalizeSlashToken(alias);
      if (key && !aliasMap.has(key)) {
        aliasMap.set(key, option.value);
      }
    }
  }

  for (const [family, providerId] of familyDefaults.entries()) {
    const key = normalizeSlashToken(family);
    if (key) aliasMap.set(key, providerId);
  }

  aliasMap.set('default', providerOptions[0]?.value || provider);
  return aliasMap;
}

export function createSlashCommands({
  provider,
  effectiveMode,
  reasoningEffort,
  showCopilot,
}) {
  const context = {
    provider,
    effectiveMode,
    reasoningEffort,
    showCopilot,
  };

  return SLASH_COMMAND_CATALOG.map((command) => ({
    ...command,
    description: typeof command.description === 'function' ? command.description(context) : command.description,
  }));
}
