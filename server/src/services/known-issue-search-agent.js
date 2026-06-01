'use strict';

const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');
const { runAgentToolLoop } = require('./agent-tool-loop');
const { getProviderModelId } = require('./providers/catalog');
const { createThinkingCoalescer } = require('../lib/thinking-coalescer');

const KNOWN_ISSUE_AGENT_ID = 'known-issue-search-agent';
const KNOWN_ISSUE_AGENT_NAME = 'INV Search Agent';
const KNOWN_ISSUE_ALLOWED_TOOLS = Object.freeze([
  'db.searchInvestigations',
  'db.getInvestigation',
]);

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function cleanText(value, max = 500) {
  const clean = safeString(value, '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length <= max ? clean : `${clean.slice(0, max - 3).trimEnd()}...`;
}

function cleanArray(value) {
  if (!Array.isArray(value)) {
    const text = cleanText(value, 300);
    return text ? [text] : [];
  }
  return value.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 8);
}

function normalizeStatus(value) {
  const normalized = safeString(value, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'match') return 'match';
  if (normalized === 'no_reasonable_match' || normalized === 'no_match' || normalized === 'none') return 'no_reasonable_match';
  if (normalized === 'needs_more_info' || normalized === 'need_more_info' || normalized === 'insufficient_info') return 'needs_more_info';
  return 'needs_more_info';
}

function normalizeConfidence(value) {
  const normalized = safeString(value, '').trim().toLowerCase();
  if (normalized === 'high' || normalized === 'exact') return 'high';
  if (normalized === 'medium' || normalized === 'likely') return 'medium';
  if (normalized === 'low' || normalized === 'possible') return 'low';
  return 'low';
}

function extractQueryTerms(parseFields = {}) {
  const text = [
    parseFields.category,
    parseFields.attemptingTo,
    parseFields.actualOutcome,
    parseFields.expectedOutcome,
    parseFields.kbToolsUsed,
    parseFields.tsSteps,
  ].map((value) => safeString(value, '')).join(' ').toLowerCase();
  return text
    .replace(/[^a-z0-9&\s/-]+/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .filter((term) => !new Set([
      'the', 'and', 'for', 'with', 'from', 'that', 'this', 'when', 'then', 'into',
      'customer', 'client', 'trying', 'attempting', 'issue', 'error', 'showing',
      'actual', 'expected', 'outcome', 'server', 'used',
    ]).has(term))
    .slice(0, 16);
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const clean = cleanText(value, 120);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function buildKnownIssueSearchQueries(parseFields = {}) {
  const category = cleanText(parseFields.category, 80);
  const attemptingTo = cleanText(parseFields.attemptingTo, 180);
  const actualOutcome = cleanText(parseFields.actualOutcome, 180);
  const expectedOutcome = cleanText(parseFields.expectedOutcome, 140);
  const tools = cleanText(parseFields.kbToolsUsed, 120);
  const tsSteps = cleanText(parseFields.tsSteps, 180);
  const terms = extractQueryTerms(parseFields);

  const importantTerms = terms.filter((term) => !['payroll', 'quickbooks', 'qbo'].includes(term)).slice(0, 6);
  const queries = [
    [category, ...importantTerms.slice(0, 4)].filter(Boolean).join(' '),
    [category, actualOutcome].filter(Boolean).join(' '),
    [attemptingTo, actualOutcome].filter(Boolean).join(' '),
    [tools, actualOutcome].filter(Boolean).join(' '),
    [expectedOutcome, actualOutcome].filter(Boolean).join(' '),
    tsSteps,
  ];
  return uniq(queries).slice(0, 6);
}

function buildKnownIssueSearchPromptInput({ parserText, parseFields }) {
  const fields = parseFields && typeof parseFields === 'object' ? parseFields : {};
  const searchQueries = buildKnownIssueSearchQueries(fields);
  const caseFacts = {
    coid: cleanText(fields.coid, 80),
    caseNumber: cleanText(fields.caseNumber, 80),
    category: cleanText(fields.category, 80),
    attemptingTo: cleanText(fields.attemptingTo, 500),
    expectedOutcome: cleanText(fields.expectedOutcome, 500),
    actualOutcome: cleanText(fields.actualOutcome, 500),
    kbToolsUsed: cleanText(fields.kbToolsUsed, 240),
    triedTestAccount: cleanText(fields.triedTestAccount, 120),
    tsSteps: cleanText(fields.tsSteps, 700),
  };

  return [
    'Search for a known issue match for this parsed QBO escalation.',
    '',
    'Use only the allowed investigation tools. Run targeted searches, fetch plausible full investigation records, then return the required JSON object.',
    '',
    'Case facts JSON:',
    JSON.stringify(caseFacts, null, 2),
    '',
    'Suggested query variants:',
    JSON.stringify(searchQueries, null, 2),
    '',
    'Raw parsed template:',
    cleanText(parserText, 3000),
  ].join('\n');
}

function extractJsonObject(text) {
  const raw = safeString(text, '').trim();
  if (!raw) return null;
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeSearches(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    query: cleanText(entry?.query, 180),
    category: cleanText(entry?.category, 80),
    status: cleanText(entry?.status, 80),
    resultCount: Number.isFinite(Number(entry?.resultCount)) ? Number(entry.resultCount) : 0,
  })).filter((entry) => entry.query || entry.category || entry.status).slice(0, 12);
}

function normalizeMatches(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    invNumber: cleanText(entry?.invNumber, 80),
    confidence: normalizeConfidence(entry?.confidence),
    subject: cleanText(entry?.subject, 260),
    evidenceFor: cleanArray(entry?.evidenceFor),
    evidenceAgainst: cleanArray(entry?.evidenceAgainst),
    missingConfirmations: cleanArray(entry?.missingConfirmations),
    recommendedAction: cleanText(entry?.recommendedAction, 500),
  })).filter((entry) => entry.invNumber).slice(0, 5);
}

function normalizeRejectedCandidates(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    invNumber: cleanText(entry?.invNumber, 80),
    reason: cleanText(entry?.reason, 400),
  })).filter((entry) => entry.invNumber || entry.reason).slice(0, 10);
}

function collectToolSearches(actionResults = []) {
  const searches = [];
  for (const result of actionResults || []) {
    if (result?.tool !== 'db.searchInvestigations') continue;
    const params = result.params || {};
    const payload = result.result || {};
    searches.push({
      query: cleanText(params.query, 180),
      category: cleanText(params.category, 80),
      status: cleanText(params.status || params.statuses, 80),
      resultCount: Number(payload.count ?? payload.results?.length ?? 0) || 0,
    });
  }
  return searches;
}

function collectFetchedInvestigations(actionResults = []) {
  const byInvNumber = new Map();
  for (const result of actionResults || []) {
    if (result?.tool !== 'db.getInvestigation') continue;
    const investigation = result.result?.investigation;
    if (!investigation?.invNumber) continue;
    byInvNumber.set(String(investigation.invNumber).toLowerCase(), investigation);
  }
  return byInvNumber;
}

function mergeSearches(modelSearches, toolSearches) {
  const merged = [];
  const seen = new Set();
  for (const search of [...toolSearches, ...modelSearches]) {
    const key = [search.query, search.category, search.status].map((value) => safeString(value, '').toLowerCase()).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(search);
  }
  return merged.slice(0, 12);
}

function validateKnownIssueSearchResult(result, actionResults = []) {
  const issues = [];
  const toolSearches = collectToolSearches(actionResults);
  const uniqueSearches = new Set(toolSearches.map((search) => search.query.toLowerCase()).filter(Boolean));
  const fetchedByInv = collectFetchedInvestigations(actionResults);

  if (!result.status) issues.push('missing_status');
  if (actionResults.length > 0 && toolSearches.length === 0) issues.push('missing_investigation_search_tool');

  if (result.status === 'match') {
    if (result.matches.length === 0) issues.push('match_status_without_matches');
    for (const match of result.matches) {
      if (match.confidence === 'high' && match.evidenceFor.length < 2) {
        issues.push(`high_confidence_without_evidence:${match.invNumber}`);
      }
      if (!fetchedByInv.has(match.invNumber.toLowerCase())) {
        issues.push(`match_without_full_record_fetch:${match.invNumber}`);
      }
    }
  }

  if (result.status === 'no_reasonable_match') {
    if (uniqueSearches.size < 2) issues.push('no_match_without_multiple_searches');
    if (!result.noMatchReason) issues.push('no_match_without_reason');
  }

  if (result.status === 'needs_more_info' && result.needsMoreInfo.length === 0) {
    issues.push('needs_more_info_without_fields');
  }

  return {
    passed: issues.length === 0,
    issues,
    toolSearchCount: toolSearches.length,
    fetchedInvestigationCount: fetchedByInv.size,
  };
}

function parseKnownIssueAgentOutput(output, actionResults = []) {
  const raw = extractJsonObject(output);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const result = buildUnavailableResult('INV Search Agent did not return a JSON object.', {
      validationIssues: ['invalid_json'],
    });
    result.rawOutput = safeString(output, '');
    return result;
  }

  const toolSearches = collectToolSearches(actionResults);
  const normalized = {
    ok: true,
    source: KNOWN_ISSUE_AGENT_ID,
    agentId: KNOWN_ISSUE_AGENT_ID,
    agentName: KNOWN_ISSUE_AGENT_NAME,
    status: normalizeStatus(raw.status),
    summary: cleanText(raw.summary, 400),
    searches: mergeSearches(normalizeSearches(raw.searches), toolSearches),
    matches: normalizeMatches(raw.matches),
    rejectedCandidates: normalizeRejectedCandidates(raw.rejectedCandidates),
    noMatchReason: cleanText(raw.noMatchReason, 600),
    needsMoreInfo: cleanArray(raw.needsMoreInfo),
    rawOutput: safeString(output, ''),
  };

  const validation = validateKnownIssueSearchResult(normalized, actionResults);
  normalized.validation = validation;
  normalized.ok = validation.passed;
  if (!normalized.summary) {
    if (normalized.status === 'match') normalized.summary = `${normalized.matches.length} known issue candidate${normalized.matches.length === 1 ? '' : 's'} found.`;
    if (normalized.status === 'no_reasonable_match') normalized.summary = normalized.noMatchReason || 'No reasonable known issue match found.';
    if (normalized.status === 'needs_more_info') normalized.summary = 'More information is needed before known issue matching is reliable.';
  }
  return normalized;
}

function buildUnavailableResult(reason, options = {}) {
  return {
    ok: false,
    source: KNOWN_ISSUE_AGENT_ID,
    agentId: KNOWN_ISSUE_AGENT_ID,
    agentName: KNOWN_ISSUE_AGENT_NAME,
    status: 'needs_more_info',
    summary: reason,
    searches: [],
    matches: [],
    rejectedCandidates: [],
    noMatchReason: '',
    needsMoreInfo: [reason],
    validation: {
      passed: false,
      issues: options.validationIssues || ['known_issue_search_unavailable'],
      toolSearchCount: 0,
      fetchedInvestigationCount: 0,
    },
    error: options.error || null,
    rawOutput: options.rawOutput || '',
    meta: options.meta || null,
  };
}

function buildKnownIssueSearchAgentMeta({ policy, result, startedAt, actionResults }) {
  const providerUsed = safeString(result?.providerUsed, policy?.primaryProvider);
  const model = safeString(result?.modelUsed, '') || getProviderModelId(providerUsed) || '';
  return {
    mode: result?.mode || policy?.mode || 'single',
    providerUsed,
    winner: providerUsed,
    fallbackUsed: Boolean(result?.fallbackUsed),
    fallbackFrom: result?.fallbackFrom || null,
    attempts: Array.isArray(result?.attempts) ? result.attempts : [],
    usage: result?.usage || null,
    model,
    latencyMs: Date.now() - startedAt,
    actions: Array.isArray(actionResults) ? actionResults : [],
    iterations: Number(result?.iterations) || 0,
    runtimeConfigured: Boolean(policy?.runtimeConfigured),
    usedDefaultRuntime: Boolean(policy?.usedDefaultRuntime),
    runtimeSource: policy?.runtimeSource || '',
  };
}

async function runKnownIssueSearchAgent({
  parserText,
  parseFields,
  policy,
  timeoutMs,
  emitStatus,
  eventBus,
}) {
  const startedAt = Date.now();
  if (!parseFields || typeof parseFields !== 'object' || Object.keys(parseFields).length === 0) {
    return buildUnavailableResult('No validated parsed escalation fields were available for known issue search.');
  }

  let streamingEmitted = false;
  const thinkingCoalescer = createThinkingCoalescer((delta) => {
    eventBus?.emit('llm.thinking', {
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
      delta,
    });
  });

  try {
    await emitStatus?.({
      message: `Running ${KNOWN_ISSUE_AGENT_NAME} with ${policy.primaryProvider}.`,
      code: 'KNOWN_ISSUE_SEARCH_STARTED',
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
    });
    eventBus?.emit('llm.request', {
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
      reasoningEffort: policy.reasoningEffort || 'high',
      serviceTier: policy.serviceTier || '',
      allowedTools: KNOWN_ISSUE_ALLOWED_TOOLS,
    });

    const actionResults = [];
    const result = await runAgentToolLoop({
      agent: {
        id: KNOWN_ISSUE_AGENT_ID,
        preferredProvider: policy.primaryProvider,
      },
      systemPrompt: getRenderedAgentPrompt(KNOWN_ISSUE_AGENT_ID),
      messagesForModel: [{
        role: 'user',
        content: buildKnownIssueSearchPromptInput({ parserText, parseFields }),
      }],
      timeoutMs,
      runtimePolicy: {
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        primaryModel: policy.primaryModel,
        fallbackProvider: policy.fallbackProvider,
        fallbackModel: policy.fallbackModel,
        reasoningEffort: policy.reasoningEffort || 'high',
        serviceTier: policy.serviceTier || '',
      },
      allowedToolNames: KNOWN_ISSUE_ALLOWED_TOOLS,
      includeActionParamsInResults: true,
      onActions: ({ results }) => {
        if (Array.isArray(results)) {
          actionResults.push(...results);
          eventBus?.emit('tool.actions', {
            count: results.length,
            tools: results.map((r) => r?.tool).filter(Boolean).slice(0, 8),
          });
        }
      },
      onStatus: emitStatus,
      onChunk: () => {
        if (!streamingEmitted) {
          streamingEmitted = true;
          eventBus?.emit('llm.streaming', { provider: policy.primaryProvider });
        }
      },
      onThinkingChunk: ({ thinking } = {}) => {
        thinkingCoalescer.push(typeof thinking === 'string' ? thinking : '');
      },
      isCancelled: () => false,
    });
    thinkingCoalescer.flush();
    eventBus?.emit('llm.response', {
      latencyMs: Date.now() - startedAt,
      provider: result?.providerUsed || policy.primaryProvider,
      model: result?.modelUsed || getProviderModelId(result?.providerUsed || policy.primaryProvider) || '',
      usage: result?.usage ? {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      } : null,
      iterations: result?.iterations || 0,
      actionCount: actionResults.length,
    });

    const parsed = parseKnownIssueAgentOutput(result.fullResponse, result.actions || actionResults);
    parsed.meta = buildKnownIssueSearchAgentMeta({
      policy,
      result,
      startedAt,
      actionResults: result.actions || actionResults,
    });
    if (!parsed.ok) {
      await emitStatus?.({
        level: 'warning',
        message: `Known issue search result did not pass validation: ${parsed.validation.issues.join(', ')}.`,
        code: 'KNOWN_ISSUE_SEARCH_VALIDATION_FAILED',
        provider: parsed.meta.providerUsed,
        model: parsed.meta.model,
      });
    }
    return parsed;
  } catch (err) {
    thinkingCoalescer.flush();
    const error = {
      code: err?.code || 'KNOWN_ISSUE_SEARCH_FAILED',
      message: err?.message || 'INV Search Agent failed.',
      detail: err?.detail || '',
    };
    eventBus?.emit('error', {
      code: error.code,
      message: error.message,
    });
    await emitStatus?.({
      level: 'warning',
      message: `${error.message} Continuing without a validated known-issue match.`,
      code: error.code,
    });
    return buildUnavailableResult('INV Search Agent failed before returning a validated result.', {
      validationIssues: [error.code],
      error,
      meta: {
        mode: policy?.mode || 'single',
        providerUsed: policy?.primaryProvider || '',
        model: policy?.primaryModel || '',
        latencyMs: Date.now() - startedAt,
        actions: [],
      },
    });
  }
}

function findFetchedInvestigation(searchResult, invNumber) {
  const actions = searchResult?.meta?.actions || [];
  const fetched = collectFetchedInvestigations(actions);
  return fetched.get(String(invNumber || '').toLowerCase()) || null;
}

function toLegacyConfidence(confidence) {
  if (confidence === 'high') return 'high';
  if (confidence === 'medium') return 'likely';
  return 'possible';
}

function knownIssueSearchToInvMatchResult(searchResult) {
  if (!searchResult || searchResult.status !== 'match' || !Array.isArray(searchResult.matches)) {
    return { matches: [], ssePayload: [] };
  }

  const matches = searchResult.matches
    .filter((match) => match.confidence === 'high' || match.confidence === 'medium')
    .slice(0, 3)
    .map((match) => {
      const investigation = findFetchedInvestigation(searchResult, match.invNumber) || {};
      return {
        confidence: toLegacyConfidence(match.confidence),
        score: match.confidence === 'high' ? 45 : 32,
        source: KNOWN_ISSUE_AGENT_ID,
        evidenceFor: match.evidenceFor,
        evidenceAgainst: match.evidenceAgainst,
        missingConfirmations: match.missingConfirmations,
        recommendedAction: match.recommendedAction,
        investigation: {
          ...investigation,
          invNumber: investigation.invNumber || match.invNumber,
          subject: investigation.subject || match.subject,
        },
      };
    });

  const ssePayload = matches.map((match) => {
    const investigation = match.investigation || {};
    return {
      _id: investigation._id ? investigation._id.toString() : undefined,
      invNumber: investigation.invNumber,
      subject: investigation.subject,
      workaround: investigation.workaround || '',
      notes: investigation.notes || '',
      category: investigation.category || '',
      status: investigation.status || '',
      affectedCount: investigation.affectedCount || 0,
      confidence: match.confidence || 'possible',
      score: match.score || 0,
      evidenceFor: match.evidenceFor || [],
      evidenceAgainst: match.evidenceAgainst || [],
      missingConfirmations: match.missingConfirmations || [],
      recommendedAction: match.recommendedAction || '',
      source: KNOWN_ISSUE_AGENT_ID,
    };
  });

  return { matches, ssePayload };
}

function buildKnownIssueRetrievalPack(searchResult) {
  if (!searchResult || typeof searchResult !== 'object') return null;
  return {
    agent: KNOWN_ISSUE_AGENT_NAME,
    status: searchResult.status || 'needs_more_info',
    summary: searchResult.summary || '',
    searches: Array.isArray(searchResult.searches) ? searchResult.searches : [],
    matches: Array.isArray(searchResult.matches) ? searchResult.matches : [],
    rejectedCandidates: Array.isArray(searchResult.rejectedCandidates) ? searchResult.rejectedCandidates : [],
    noMatchReason: searchResult.noMatchReason || '',
    needsMoreInfo: Array.isArray(searchResult.needsMoreInfo) ? searchResult.needsMoreInfo : [],
    validation: searchResult.validation || null,
  };
}

module.exports = {
  KNOWN_ISSUE_AGENT_ID,
  KNOWN_ISSUE_AGENT_NAME,
  KNOWN_ISSUE_ALLOWED_TOOLS,
  buildKnownIssueRetrievalPack,
  buildKnownIssueSearchPromptInput,
  buildKnownIssueSearchQueries,
  knownIssueSearchToInvMatchResult,
  parseKnownIssueAgentOutput,
  runKnownIssueSearchAgent,
  validateKnownIssueSearchResult,
};
