import { useCallback, useEffect, useMemo } from 'react';
import { PROVIDER_FAMILY, getReasoningEffortOptions } from '../../lib/providerCatalog.js';
import { useToast } from '../../hooks/useToast.jsx';
import { getProviderLabel } from '../../utils/markdown.jsx';
import {
  PARSE_ESCALATION_PROMPT,
  QUICK_PROMPT_COMMANDS,
  createProviderAliasMap,
  createSlashCommands,
  normalizeSlashToken,
} from './chatSlashCommandCatalog.js';

export { PARSE_ESCALATION_PROMPT };

export default function useChatSlashCommands({
  provider,
  effectiveMode,
  reasoningEffort,
  isStreaming,
  input,
  setInput,
  setSlashMenuIndex,
  startFreshConversation,
  focusComposerWithValue,
  handleAttachClick,
  setShowWebcam,
  setProvider,
  setMode,
  setReasoningEffort,
}) {
  const toast = useToast();

  const providerAliasMap = useMemo(() => createProviderAliasMap(provider), [provider]);

  const slashCommands = useMemo(() => createSlashCommands({
    provider,
    effectiveMode,
    reasoningEffort,
  }), [effectiveMode, provider, reasoningEffort]);

  const trimmedInput = input.trimStart();
  const slashMenuOpen = !isStreaming && trimmedInput.startsWith('/');
  const slashQuery = slashMenuOpen ? trimmedInput.slice(1) : '';

  const filteredSlashCommands = useMemo(() => {
    if (!slashMenuOpen) return [];
    const normalizedQuery = normalizeSlashToken(slashQuery);
    if (!normalizedQuery) return slashCommands;
    return slashCommands.filter((item) => {
      const haystack = [
        item.command,
        item.description,
        item.example,
        ...(item.keywords || []),
      ].map(normalizeSlashToken);
      return haystack.some((entry) => entry.includes(normalizedQuery));
    });
  }, [slashCommands, slashMenuOpen, slashQuery]);

  useEffect(() => {
    setSlashMenuIndex(0);
  }, [setSlashMenuIndex, slashMenuOpen, slashQuery]);

  const insertSlashCommand = useCallback((command) => {
    focusComposerWithValue(command.insertValue || command.command);
  }, [focusComposerWithValue]);

  const executeSlashCommand = useCallback((rawValue) => {
    const trimmed = String(rawValue || '').trim();
    if (!trimmed.startsWith('/')) return false;

    if (trimmed.startsWith('//')) {
      focusComposerWithValue(trimmed.slice(1));
      toast.info('Leading slash escaped. Press Enter again to send it as text.');
      return true;
    }

    const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
    const commandName = normalizeSlashToken(parts[0]);
    const argRaw = parts.slice(1).join(' ').trim();
    const argToken = normalizeSlashToken(argRaw);

    switch (commandName) {
      case '':
      case 'help':
        focusComposerWithValue('/');
        toast.info('Slash commands are listed below the input.');
        return true;
      case 'clear':
      case 'new':
      case 'reset':
        startFreshConversation();
        toast.success('Started a fresh conversation.');
        return true;
      case 'parse':
      case 'triage':
        focusComposerWithValue(QUICK_PROMPT_COMMANDS.parse);
        toast.info('Parse prompt loaded into the composer.');
        return true;
      case 'draft':
      case 'reply':
        focusComposerWithValue(QUICK_PROMPT_COMMANDS.draft);
        toast.info('Draft-response prompt loaded into the composer.');
        return true;
      case 'categorize':
      case 'category':
      case 'classify':
        focusComposerWithValue(QUICK_PROMPT_COMMANDS.categorize);
        toast.info('Categorization prompt loaded into the composer.');
        return true;
      case 'troubleshoot':
      case 'steps':
        focusComposerWithValue(QUICK_PROMPT_COMMANDS.troubleshoot);
        toast.info('Troubleshooting prompt loaded into the composer.');
        return true;
      case 'provider': {
        if (!argToken) {
          focusComposerWithValue('/provider ');
          toast.info('Try /provider claude, /provider codex, /provider sonnet, or /provider opus.');
          return true;
        }
        const resolvedProvider = providerAliasMap.get(argToken);
        if (!resolvedProvider) {
          toast.warning(`Unknown provider "${argRaw}".`);
          return true;
        }
        setProvider(resolvedProvider);
        setInput('');
        toast.success(`Provider set to ${getProviderLabel(resolvedProvider)}.`);
        return true;
      }
      case 'mode': {
        const modeAliases = new Map([
          ['single', 'single'],
          ['fallback', 'fallback'],
          ['parallel', 'parallel'],
        ]);
        if (!argToken || !modeAliases.has(argToken)) {
          focusComposerWithValue('/mode ');
          toast.info('Try /mode single, /mode fallback, or /mode parallel.');
          return true;
        }
        const nextMode = modeAliases.get(argToken);
        setMode(nextMode);
        setInput('');
        toast.success(`Mode set to ${nextMode}.`);
        return true;
      }
      case 'effort':
      case 'reasoning': {
        const effortAliases = new Map([
          ['low', 'low'],
          ['medium', 'medium'],
          ['high', 'high'],
          ['xhigh', 'xhigh'],
          ['extrahigh', 'xhigh'],
        ]);
        const currentFamily = PROVIDER_FAMILY[provider] || 'claude';
        const allowedEfforts = getReasoningEffortOptions(currentFamily);
        if (!argToken || !effortAliases.has(argToken)) {
          const names = allowedEfforts.map((o) => o.value).join(', ');
          focusComposerWithValue('/effort ');
          toast.info(`Try /effort ${names}.`);
          return true;
        }
        const nextEffort = effortAliases.get(argToken);
        if (!allowedEfforts.some((o) => o.value === nextEffort)) {
          toast.warning(`"${nextEffort}" is not supported by ${getProviderLabel(provider)}. Use: ${allowedEfforts.map((o) => o.value).join(', ')}.`);
          return true;
        }
        setReasoningEffort(nextEffort);
        setInput('');
        toast.success(`Reasoning effort set to ${nextEffort}.`);
        return true;
      }
      case 'attach':
      case 'upload':
        setInput('');
        handleAttachClick();
        toast.info('Choose an image to load into the parser.');
        return true;
      case 'webcam':
      case 'camera':
        setInput('');
        setShowWebcam(true);
        toast.info('Webcam capture opened for the image parser.');
        return true;
      default:
        toast.warning(`Unknown slash command "${trimmed}". Type /help to see commands.`);
        return true;
    }
  }, [
    focusComposerWithValue,
    handleAttachClick,
    provider,
    providerAliasMap,
    setInput,
    setMode,
    setProvider,
    setReasoningEffort,
    setShowWebcam,
    startFreshConversation,
    toast,
  ]);

  const activateSlashCommand = useCallback((command) => {
    if (!command) return;
    const commandValue = command.insertValue || command.command || '';
    if (/\s$/.test(commandValue)) {
      insertSlashCommand(command);
      return;
    }
    executeSlashCommand(command.command || commandValue);
  }, [executeSlashCommand, insertSlashCommand]);

  return {
    slashCommands,
    filteredSlashCommands,
    slashMenuOpen,
    insertSlashCommand,
    executeSlashCommand,
    activateSlashCommand,
  };
}
