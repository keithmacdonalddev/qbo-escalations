const {
  getSystemPrompt,
  getCoreSystemPrompt,
  searchPlaybookChunks,
} = require('./playbook-loader');

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function estimateInputTokensFromChars(chars) {
  const normalized = Number.isFinite(chars) && chars > 0 ? chars : 0;
  return Math.ceil(normalized / 4);
}

function messageChars(messages) {
  return messages.reduce((sum, msg) => sum + safeString(msg.content, '').length, 0);
}

function truncateText(text, maxChars) {
  const normalized = safeString(text, '');
  if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
  if (normalized.length <= maxChars) return normalized;
  const suffix = '\n\n[truncated for context budget]';
  const sliceLen = Math.max(0, maxChars - suffix.length);
  return normalized.slice(0, sliceLen).trimEnd() + suffix;
}

function countUserTurns(messages) {
  let turns = 0;
  for (const msg of messages) {
    if (msg.role === 'user') turns += 1;
  }
  return turns;
}

function trimMessagesToRecentTurns(messages, maxTurns) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  if (!Number.isFinite(maxTurns) || maxTurns <= 0) return messages.slice(-2);

  let userTurns = 0;
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      userTurns += 1;
      if (userTurns > maxTurns) {
        startIndex = i + 1;
        break;
      }
    }
  }
  return messages.slice(startIndex);
}

function summarizeMessages(messages, maxChars) {
  if (!Array.isArray(messages) || messages.length === 0) return '';

  const lines = [];
  for (const msg of messages) {
    if (!msg || !msg.content) continue;
    const prefix = msg.role === 'assistant' ? 'Assistant' : (msg.role === 'system' ? 'System' : 'User');
    const compact = safeString(msg.content, '').replace(/\s+/g, ' ').trim();
    if (!compact) continue;
    const line = `${prefix}: ${compact.slice(0, 220)}`;
    lines.push(line);
    if (lines.length >= 20) break;
  }
  return truncateText(lines.join('\n'), maxChars);
}

function fitHistoryToBudget(messages, maxChars) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  if (!Number.isFinite(maxChars) || maxChars <= 0) return [messages[messages.length - 1]];

  const out = [...messages];
  while (out.length > 1 && messageChars(out) > maxChars) {
    out.shift();
  }

  if (messageChars(out) > maxChars && out.length > 0) {
    const last = out[out.length - 1];
    out[out.length - 1] = { ...last, content: truncateText(last.content, maxChars) };
  }
  return out;
}

function buildRetrievalQuery(messages) {
  const recentUser = [...messages]
    .reverse()
    .filter((msg) => msg.role === 'user')
    .slice(0, 3)
    .map((msg) => safeString(msg.content, '').trim())
    .filter(Boolean);
  if (recentUser.length > 0) return recentUser.join('\n');
  const recentAny = [...messages]
    .reverse()
    .slice(0, 3)
    .map((msg) => safeString(msg.content, '').trim())
    .filter(Boolean);
  return recentAny.join('\n');
}

function buildRetrievedKnowledgeText(chunks, maxChars) {
  const included = [];
  let usedChars = 0;
  const blocks = [];

  for (const chunk of chunks) {
    const tag = `[${chunk.sourceType.toUpperCase()}: ${chunk.sourceName}${chunk.title ? ` :: ${chunk.title}` : ''}]`;
    const block = `${tag}\n${chunk.text}`.trim();
    if (!block) continue;
    if (usedChars + block.length > maxChars) break;
    blocks.push(block);
    usedChars += block.length;
    included.push({
      id: chunk.id,
      sourceType: chunk.sourceType,
      sourceName: chunk.sourceName,
      title: chunk.title,
      score: chunk.score,
      chars: chunk.chars,
    });
  }

  return {
    text: blocks.join('\n\n'),
    included,
    usedChars,
  };
}

function ensurePercent(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function makeEmptyDebug(settings, maxInputChars) {
  return {
    knowledgeMode: settings.knowledge.mode,
    memoryPolicy: settings.memory.policy,
    budgets: {
      maxInputTokens: settings.context.maxInputTokens,
      maxInputChars,
      systemBudgetPercent: settings.context.systemBudgetPercent,
      historyBudgetPercent: settings.context.historyBudgetPercent,
      retrievalBudgetPercent: settings.context.retrievalBudgetPercent,
      systemCharsBudget: 0,
      historyCharsBudget: 0,
      retrievalCharsBudget: 0,
      systemChars: 0,
      historyChars: 0,
      retrievalChars: 0,
      totalChars: 0,
      estimatedInputTokens: 0,
    },
    history: {
      sourceMessages: 0,
      selectedMessages: 0,
      droppedMessages: 0,
      summarized: false,
      summaryChars: 0,
    },
    retrieval: {
      query: '',
      requestedTopK: settings.knowledge.retrievalTopK,
      returnedTopK: 0,
      includedTopK: 0,
      sources: [],
    },
  };
}

function buildChatModelContext({ normalizedMessages, settings }) {
  const messages = Array.isArray(normalizedMessages) ? normalizedMessages : [];
  const maxInputChars = Math.max(1000, Math.floor(settings.context.maxInputTokens * 4));
  const debug = makeEmptyDebug(settings, maxInputChars);

  const systemBudgetPercent = ensurePercent(settings.context.systemBudgetPercent, 35);
  const historyBudgetPercent = ensurePercent(settings.context.historyBudgetPercent, 40);
  const retrievalBudgetPercent = ensurePercent(settings.context.retrievalBudgetPercent, 25);
  const sum = systemBudgetPercent + historyBudgetPercent + retrievalBudgetPercent || 100;

  const systemCharsBudget = Math.floor(maxInputChars * (systemBudgetPercent / sum));
  const historyCharsBudget = Math.floor(maxInputChars * (historyBudgetPercent / sum));
  const retrievalCharsBudget = Math.max(0, maxInputChars - systemCharsBudget - historyCharsBudget);

  debug.budgets.systemCharsBudget = systemCharsBudget;
  debug.budgets.historyCharsBudget = historyCharsBudget;
  debug.budgets.retrievalCharsBudget = retrievalCharsBudget;
  debug.history.sourceMessages = messages.length;

  const recentTrimmed = trimMessagesToRecentTurns(messages, settings.context.maxHistoryTurns);
  let historyMessages = recentTrimmed;

  if (settings.memory.policy === 'full-history') {
    historyMessages = messages;
  } else if (settings.memory.policy === 'summary-recent') {
    const totalUserTurns = countUserTurns(messages);
    const shouldSummarize = totalUserTurns >= settings.memory.summarizeAfterTurns
      && recentTrimmed.length < messages.length;
    if (shouldSummarize) {
      const omitted = messages.slice(0, messages.length - recentTrimmed.length);
      const summaryText = summarizeMessages(omitted, settings.memory.summaryMaxChars);
      if (summaryText) {
        historyMessages = [
          { role: 'system', content: `Summary of earlier conversation context:\n${summaryText}` },
          ...recentTrimmed,
        ];
        debug.history.summarized = true;
        debug.history.summaryChars = summaryText.length;
      }
    }
  }

  historyMessages = fitHistoryToBudget(historyMessages, historyCharsBudget);
  debug.history.selectedMessages = historyMessages.length;
  debug.history.droppedMessages = Math.max(0, messages.length - historyMessages.length);

  const knowledgeMode = settings.knowledge.mode;
  const retrievalQuery = buildRetrievalQuery(messages);
  let systemPrompt = '';
  let retrievalCharsUsed = 0;
  let retrievalIncluded = [];

  if (knowledgeMode === 'full-playbook') {
    const full = getSystemPrompt();
    systemPrompt = truncateText(full, systemCharsBudget + retrievalCharsBudget);
  } else {
    const basePrompt = knowledgeMode === 'retrieval-only'
      ? [
          'You are the QBO Escalation Assistant.',
          'Use only the retrieved playbook excerpts and conversation context.',
          'If the excerpts are insufficient, say what is missing and ask a targeted follow-up question.',
        ].join('\n')
      : safeString(getCoreSystemPrompt(), '');

    const retrievalChunks = searchPlaybookChunks(retrievalQuery, {
      topK: settings.knowledge.retrievalTopK,
      minScore: settings.knowledge.retrievalMinScore,
      allowedCategories: settings.knowledge.allowedCategories,
      allowedTemplates: settings.knowledge.allowedTemplates,
      allowedTopLevel: settings.knowledge.allowedTopLevel,
    });

    const retrievalBlock = buildRetrievedKnowledgeText(retrievalChunks, retrievalCharsBudget);
    retrievalCharsUsed = retrievalBlock.usedChars;
    retrievalIncluded = retrievalBlock.included;

    const sections = [];
    if (basePrompt.trim()) sections.push(truncateText(basePrompt, systemCharsBudget));
    if (retrievalBlock.text) {
      sections.push('Retrieved Playbook Excerpts:\n' + retrievalBlock.text);
    }
    if (settings.knowledge.includeCitations && retrievalIncluded.length > 0) {
      const sourceList = retrievalIncluded
        .map((s, i) => `[${i + 1}] ${s.sourceType.toUpperCase()}: ${s.sourceName}${s.title ? ' :: ' + s.title : ''}`)
        .join('\n');
      sections.push(
        'Citation instructions:\n'
        + 'When your answer draws from the reference sections above, naturally cite them using superscript numbers like [1], [2] corresponding to the numbered sources below. Only cite sections you actually used. Do not force citations — only include them when you directly reference playbook content.\n\n'
        + 'Available sources:\n' + sourceList
      );
    }
    systemPrompt = sections.join('\n\n').trim();
    if (!systemPrompt) {
      systemPrompt = truncateText(basePrompt, systemCharsBudget);
    }
  }

  // Enforce absolute request budget by dropping oldest history first.
  let historyForModel = [...historyMessages];
  let totalChars = systemPrompt.length + messageChars(historyForModel);
  while (historyForModel.length > 1 && totalChars > maxInputChars) {
    historyForModel.shift();
    totalChars = systemPrompt.length + messageChars(historyForModel);
  }
  if (totalChars > maxInputChars) {
    const remainingForSystem = Math.max(200, maxInputChars - messageChars(historyForModel));
    systemPrompt = truncateText(systemPrompt, remainingForSystem);
    totalChars = systemPrompt.length + messageChars(historyForModel);
  }

  debug.retrieval.query = retrievalQuery;
  debug.retrieval.returnedTopK = retrievalIncluded.length;
  debug.retrieval.includedTopK = retrievalIncluded.length;
  debug.retrieval.sources = retrievalIncluded;

  debug.budgets.systemChars = systemPrompt.length;
  debug.budgets.historyChars = messageChars(historyForModel);
  debug.budgets.retrievalChars = retrievalCharsUsed;
  debug.budgets.totalChars = totalChars;
  debug.budgets.estimatedInputTokens = estimateInputTokensFromChars(totalChars);

  // Build citation metadata when retrieval sources were included and citations are enabled
  const citations = (settings.knowledge.includeCitations && retrievalIncluded.length > 0)
    ? retrievalIncluded.map((s, i) => ({
        index: i + 1,
        sourceType: s.sourceType,
        sourceName: s.sourceName,
        title: s.title || null,
        id: s.id,
      }))
    : [];

  return {
    systemPrompt,
    messagesForModel: historyForModel,
    contextDebug: debug,
    citations,
  };
}

module.exports = {
  buildChatModelContext,
  estimateInputTokensFromChars,
  summarizeMessages,
};

