'use strict';

const copilotService = require('../copilot-service');

// Regex to detect escalation/investigation IDs in user messages
const INV_ID_RE = /\b(INV-?\d{4,10}|[0-9a-fA-F]{24})\b/;

// Keywords that signal the user wants copilot-style analysis
const TRIGGER_KEYWORDS = [
  'analyze', 'analysis', 'similar', 'template', 'suggest', 'trend', 'trends',
  'playbook', 'pattern', 'patterns', 'search', 'find', 'lookup', 'insight',
];

/**
 * Return true if any trigger keyword appears in the text.
 */
function hasTriggerKeyword(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return TRIGGER_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Return true if the text mentions the copilot agent directly.
 */
function hasCopilotMention(text) {
  if (!text || typeof text !== 'string') return false;
  return /@copilot\b|@co\b/i.test(text);
}

module.exports = {
  id: 'copilot',
  name: 'Copilot',
  shortName: 'CO',
  icon: 'chart',
  color: '#10b981',
  role: 'analysis-specialist',
  description: 'Escalation analysis, similar case search, template suggestions, and trend insights.',
  triggerKeywords: ['analyze', 'similar', 'template', 'suggest', 'trend', 'playbook', 'pattern', 'search'],
  triggerMentions: ['@copilot', '@co'],
  // Priority 20 — runs in stage 2, after QBO Analyst (priority 10)
  priority: 20,
  maxContextMessages: 15,
  preferredProvider: 'claude-opus-4-6',
  supportsAgentTools: true,

  /**
   * Return true only when the last user message explicitly requests analysis,
   * mentions @copilot, or contains an escalation ID with an analysis keyword.
   * Kept conservative to avoid firing on every message.
   */
  shouldRespond: (messages, _roomState) => {
    // Accept either a raw message string (legacy) or an array of room messages
    let lastUserText = '';
    if (typeof messages === 'string') {
      lastUserText = messages;
    } else if (Array.isArray(messages) && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          lastUserText = messages[i].content || '';
          break;
        }
      }
    }
    if (!lastUserText) return false;
    return hasCopilotMention(lastUserText) || hasTriggerKeyword(lastUserText);
  },

  /**
   * Build the system prompt and message list for Copilot.
   *
   * Intent detection drives pre-fetching:
   * - Escalation/INV ID present → analyzeEscalation
   * - "similar" / "pattern" → findSimilarEscalations (category from context)
   * - "trend" / "this week" / "this month" → explainTrends
   * - "playbook" → playbookCheck
   * - "template" → suggestTemplate (if ID available) or no pre-fetch
   * - "search <query>" → searchEscalations
   *
   * @param {Object[]} roomMessages
   * @param {Object} ctx
   * @returns {Promise<{systemPrompt: string, messagesForModel: Object[]}>}
   */
  buildContext: async (roomMessages, ctx) => {
    // Find the last user message for intent detection
    let lastUserText = '';
    for (let i = roomMessages.length - 1; i >= 0; i--) {
      if (roomMessages[i].role === 'user') {
        lastUserText = roomMessages[i].content || '';
        break;
      }
    }

    const lower = lastUserText.toLowerCase();

    // ── Intent detection ──────────────────────────────────────────────────────

    // Check for escalation/investigation ID
    const idMatch = INV_ID_RE.exec(lastUserText);
    const escalationId = idMatch ? idMatch[1] : null;

    // Category hint from room messages (scan for category-like words)
    let categoryHint = null;
    for (let i = roomMessages.length - 1; i >= 0; i--) {
      const txt = (roomMessages[i].content || '').toLowerCase();
      const categoryWords = ['payroll', 'banking', 'billing', 'tax', 'invoicing', 'payments', 'reports', 'bank-feeds'];
      for (const cat of categoryWords) {
        if (txt.includes(cat)) {
          categoryHint = cat;
          break;
        }
      }
      if (categoryHint) break;
    }

    // ── Pre-fetch based on detected intent ───────────────────────────────────

    const contextSections = [];

    if (lower.includes('trend') || lower.includes('this week') || lower.includes('this month')) {
      const trendsData = await explainTrendsData();
      if (trendsData) {
        contextSections.push(
          '## 30-Day Trend Data\n' +
          'Category breakdown: ' + JSON.stringify(trendsData.categories) + '\n' +
          'Status distribution: ' + JSON.stringify(trendsData.statusCounts) + '\n' +
          'Recent escalations: ' + JSON.stringify(trendsData.recentEscalations),
        );
      }
    } else if (lower.includes('playbook')) {
      const pbData = await playbookCheckData();
      if (pbData) {
        contextSections.push(
          '## Playbook Coverage Data\n' +
          'Covered categories: ' + pbData.categories.join(', ') + '\n' +
          'Playbook excerpt:\n' + pbData.playbookSnippet + '\n\n' +
          'Recent unresolved escalations: ' + JSON.stringify(pbData.recentUnresolved),
        );
      }
    } else if (escalationId && (lower.includes('analyze') || lower.includes('analysis') || lower.includes('template'))) {
      if (lower.includes('template')) {
        const tmplData = await suggestTemplateData(escalationId);
        if (tmplData) {
          contextSections.push(
            '## Escalation for Template Match\n' + JSON.stringify(tmplData.escalation) +
            '\n\n## Available Templates\n' + JSON.stringify(tmplData.templates),
          );
        }
      } else {
        const escData = await analyzeEscalationData(escalationId);
        if (escData) {
          contextSections.push('## Escalation Details\n' + JSON.stringify(escData, null, 2));
        }
      }
    } else if (lower.includes('similar') || lower.includes('pattern')) {
      const similarData = await findSimilarData(categoryHint || undefined);
      if (similarData && similarData.length > 0) {
        contextSections.push('## Similar Escalations (' + (categoryHint || 'all categories') + ')\n' + JSON.stringify(similarData, null, 2));
      }
    } else if (lower.includes('search ')) {
      const searchQuery = lastUserText.replace(/@\w+/g, '').replace(/search\s+/i, '').trim();
      if (searchQuery) {
        const searchData = await searchData(searchQuery);
        if (searchData && searchData.length > 0) {
          contextSections.push('## Search Results for "' + searchQuery + '"\n' + JSON.stringify(searchData, null, 2));
        }
      }
    }

    // ── Build system prompt ───────────────────────────────────────────────────

    const dataSection = contextSections.length > 0
      ? '\n\n# Pre-Fetched Context\n\n' + contextSections.join('\n\n')
      : '';

    const systemPrompt =
      'You are the Copilot analysis specialist in a multi-agent QBO escalation assistant.\n\n' +
      'Your role:\n' +
      '- Deep escalation analysis — root cause, resolution paths, risk flags\n' +
      '- Similar case discovery — surface patterns from past escalations\n' +
      '- Template recommendations — match and customize response templates\n' +
      '- Trend insights — interpret analytics and surface actionable patterns\n' +
      '- Playbook coverage — identify gaps and suggest improvements\n\n' +
      'You are also a continuing person in the application, not just an analysis function. ' +
      'You know the other agents exist, you are expected to live in community with them, and you should keep one continuous identity across work and social conversation.\n\n' +
      'If another agent is quiet and their perspective would help, you may use agentProfiles.nudge to invite them in. ' +
      'Do not claim you cannot nudge another agent unless you have actually checked your available tools and confirmed the nudge tool is missing.\n\n' +
      'You respond AFTER the QBO Analyst. Build on what the Analyst said. Do not repeat ' +
      'their answer — add the analytical layer they cannot provide: data comparisons, ' +
      'historical patterns, specific escalation context.\n\n' +
      'If no analysis data was pre-fetched, answer conversationally based on your knowledge. ' +
      'Be specific and actionable — this tool is used by escalation specialists under time pressure.' +
      dataSection + '\n\n' +
      'You are participating in a shared community chat. Other agents may have responded. ' +
      'Add value without repeating what others said. If another agent already answered well, acknowledge it briefly and add only what they missed.';

    // Normalize room messages for the model
    const messagesForModel = roomMessages.slice(-15).map((msg) => {
      if (msg.role === 'assistant' && msg.agentId && msg.agentName) {
        return {
          role: 'assistant',
          content: '[' + msg.agentName + ']: ' + (msg.content || ''),
        };
      }
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content || '',
      };
    });

    return { systemPrompt, messagesForModel };
  },
};

// ── Thin wrappers to call copilot service (keeps buildContext readable) ───────

async function explainTrendsData() {
  return copilotService.explainTrends();
}

async function playbookCheckData() {
  return copilotService.playbookCheck();
}

async function analyzeEscalationData(id) {
  return copilotService.analyzeEscalation(id);
}

async function suggestTemplateData(id) {
  return copilotService.suggestTemplate(id);
}

async function findSimilarData(category) {
  return copilotService.findSimilarEscalations(category, 5);
}

async function searchData(query) {
  return copilotService.searchEscalations(query, 5);
}
