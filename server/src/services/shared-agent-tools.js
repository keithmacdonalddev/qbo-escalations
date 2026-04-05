'use strict';

const Escalation = require('../models/Escalation');
const Investigation = require('../models/Investigation');
const Template = require('../models/Template');
const Conversation = require('../models/Conversation');
const ChatRoom = require('../models/ChatRoom');
const {
  buildAgentReferenceLinks,
  getAgentIdentity,
  listAgentIdentities,
  recordAgentNudge,
  updateAgentIdentity,
} = require('./agent-identity-service');
const { DEFAULT_PROFILES } = require('./room-agents/agent-profiles');

const SHARED_AGENT_TOOL_METADATA = {
  'agentProfiles.list': {
    kind: 'read',
    description: 'List agent profiles with summary fields and references.',
    params: '{}',
  },
  'agentProfiles.get': {
    kind: 'read',
    description: 'Read a specific agent profile, continuity, and references.',
    params: '{ agentId }',
  },
  'agentProfiles.history': {
    kind: 'read',
    description: 'Read the history log for a specific agent.',
    params: '{ agentId }',
  },
  'agentProfiles.updateAvatar': {
    kind: 'write',
    description: 'Update an agent avatar using an external image URL, emoji, or avatar prompt metadata.',
    params: '{ agentId, imageUrl?, emoji?, prompt?, source?, summary? }',
  },
  'agentProfiles.generateAvatar': {
    kind: 'write',
    description: 'Generate and save a new SVG avatar for an agent from a short prompt.',
    params: '{ agentId, prompt?, palette?, emoji?, summary? }',
  },
  'agentProfiles.nudge': {
    kind: 'write',
    description: 'Send another agent a social nudge to encourage them to participate more naturally in the conversation.',
    params: '{ fromAgentId, toAgentId, note?, roomId?, surface? }',
  },
  'db.searchEscalations': {
    kind: 'read',
    description: 'Search escalations by text, category, or status.',
    params: '{ query?, category?, status?, limit? }',
  },
  'db.getEscalation': {
    kind: 'read',
    description: 'Fetch one escalation by id or caseNumber.',
    params: '{ id?, caseNumber? }',
  },
  'db.searchInvestigations': {
    kind: 'read',
    description: 'Search investigations by INV number or text.',
    params: '{ query?, status?, limit? }',
  },
  'db.getInvestigation': {
    kind: 'read',
    description: 'Fetch one investigation by id or invNumber.',
    params: '{ id?, invNumber? }',
  },
  'db.searchTemplates': {
    kind: 'read',
    description: 'Search response templates by title, category, or body text.',
    params: '{ query?, category?, limit? }',
  },
  'db.searchConversations': {
    kind: 'read',
    description: 'Search saved main-chat conversations by title or content.',
    params: '{ query?, limit? }',
  },
  'db.getConversation': {
    kind: 'read',
    description: 'Open one saved main-chat conversation by id.',
    params: '{ id }',
  },
  'db.searchRooms': {
    kind: 'read',
    description: 'Search chat rooms by title, members, or message content.',
    params: '{ query?, activeAgentId?, limit? }',
  },
  'db.getRoom': {
    kind: 'read',
    description: 'Open one chat room by id.',
    params: '{ id }',
  },
  'web.search': {
    kind: 'read',
    description: 'Search the public web and return a compact result list with titles and URLs.',
    params: '{ query, limit? }',
  },
};

function buildSharedAgentToolLines() {
  const lines = [
    'AVAILABLE TOOLS:',
    '- Use tools when the user asks for research, database lookup, profile inspection, verification, or external information.',
    '- If you need facts, inspect first and answer second. Do not bluff.',
    '- You do have access to agentProfiles.nudge. Use it when you want to encourage another agent to join the conversation more naturally.',
    '- Never claim you cannot nudge another agent unless you have actually checked the available tools in this prompt and confirmed the tool is missing.',
    '- A nudge is social, lightweight, and encouraging. Use it to wake up a quiet peer, invite a perspective, or keep room energy alive without sounding bureaucratic.',
  ];

  for (const [tool, meta] of Object.entries(SHARED_AGENT_TOOL_METADATA)) {
    lines.push(`- ${tool}: ${meta.description} Params: ${meta.params}`);
  }

  lines.push('');
  lines.push('ACTION FORMAT:');
  lines.push('ACTION: {"tool": "tool.name", "params": {...}}');
  lines.push('You may emit multiple ACTION lines when needed. After results come back, either continue with more ACTION lines or provide the final answer without ACTION lines.');
  return lines.join('\n');
}

const SHARED_AGENT_TOOL_LINES = buildSharedAgentToolLines();

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeAgentLookupKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveAgentId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (DEFAULT_PROFILES[raw]) return raw;

  const normalized = normalizeAgentLookupKey(raw);
  if (!normalized) return '';

  for (const [agentId, profile] of Object.entries(DEFAULT_PROFILES)) {
    const candidates = [
      agentId,
      profile?.agentId,
      profile?.displayName,
      profile?.roleTitle,
      `${profile?.displayName || ''} ${profile?.roleTitle || ''}`.trim(),
      `${profile?.displayName || ''} agent`.trim(),
      profile?.displayName === 'QBO Analyst' ? 'analyst' : '',
      profile?.displayName === 'Workspace Agent' ? 'workspace' : '',
      profile?.displayName === 'Image Analyst' ? 'image analyst' : '',
    ];
    if (candidates.some((candidate) => normalizeAgentLookupKey(candidate) === normalized)) {
      return agentId;
    }
  }

  return '';
}

async function searchEscalations(params = {}) {
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 20);
  const filter = {};
  if (params.category) filter.category = params.category;
  if (params.status) filter.status = params.status;

  let docs = [];
  if (params.query) {
    try {
      docs = await Escalation.find({ ...filter, $text: { $search: String(params.query) } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean();
    } catch {
      const regex = new RegExp(escapeRegex(params.query), 'i');
      docs = await Escalation.find({
        ...filter,
        $or: [
          { caseNumber: regex },
          { clientContact: regex },
          { attemptingTo: regex },
          { actualOutcome: regex },
          { resolution: regex },
        ],
      }).limit(limit).lean();
    }
  } else {
    docs = await Escalation.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  }

  return {
    ok: true,
    results: docs.map((doc) => ({
      id: doc._id,
      caseNumber: doc.caseNumber || null,
      category: doc.category || null,
      status: doc.status || null,
      clientContact: doc.clientContact || null,
      attemptingTo: doc.attemptingTo || null,
      actualOutcome: doc.actualOutcome || null,
      createdAt: doc.createdAt || null,
    })),
    count: docs.length,
  };
}

async function getEscalation(params = {}) {
  let doc = null;
  if (params.id) {
    doc = await Escalation.findById(params.id).lean();
  } else if (params.caseNumber) {
    doc = await Escalation.findOne({ caseNumber: params.caseNumber }).lean();
  }
  if (!doc) return { ok: false, error: 'Escalation not found' };
  return { ok: true, escalation: doc };
}

async function searchInvestigations(params = {}) {
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 20);
  const filter = {};
  if (params.status) filter.status = params.status;

  let docs = [];
  if (params.query) {
    const regex = new RegExp(escapeRegex(params.query), 'i');
    docs = await Investigation.find({
      ...filter,
      $or: [
        { invNumber: regex },
        { subject: regex },
        { details: regex },
      ],
    }).sort({ updatedAt: -1 }).limit(limit).lean();
  } else {
    docs = await Investigation.find(filter).sort({ updatedAt: -1 }).limit(limit).lean();
  }

  return {
    ok: true,
    results: docs.map((doc) => ({
      id: doc._id,
      invNumber: doc.invNumber || null,
      subject: doc.subject || null,
      status: doc.status || null,
      affectedCount: doc.affectedCount || 0,
      updatedAt: doc.updatedAt || null,
    })),
    count: docs.length,
  };
}

async function getInvestigation(params = {}) {
  let doc = null;
  if (params.id) {
    doc = await Investigation.findById(params.id).lean();
  } else if (params.invNumber) {
    doc = await Investigation.findOne({ invNumber: params.invNumber }).lean();
  }
  if (!doc) return { ok: false, error: 'Investigation not found' };
  return { ok: true, investigation: doc };
}

async function searchTemplates(params = {}) {
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 20);
  const filter = {};
  if (params.category) filter.category = params.category;

  let docs = [];
  if (params.query) {
    const regex = new RegExp(escapeRegex(params.query), 'i');
    docs = await Template.find({
      ...filter,
      $or: [
        { title: regex },
        { body: regex },
        { category: regex },
      ],
    }).limit(limit).lean();
  } else {
    docs = await Template.find(filter).limit(limit).lean();
  }

  return {
    ok: true,
    results: docs.map((doc) => ({
      id: doc._id,
      title: doc.title || null,
      category: doc.category || null,
      bodyPreview: typeof doc.body === 'string' ? doc.body.slice(0, 400) : '',
    })),
    count: docs.length,
  };
}

async function searchConversations(params = {}) {
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 20);
  let docs = [];
  if (params.query) {
    const regex = new RegExp(escapeRegex(params.query), 'i');
    docs = await Conversation.find({
      $or: [
        { title: regex },
        { 'messages.content': regex },
      ],
    }).sort({ updatedAt: -1 }).limit(limit).lean();
  } else {
    docs = await Conversation.find({}).sort({ updatedAt: -1 }).limit(limit).lean();
  }

  return {
    ok: true,
    results: docs.map((doc) => ({
      id: doc._id,
      title: doc.title || 'Untitled',
      messageCount: doc.messageCount || (Array.isArray(doc.messages) ? doc.messages.length : 0),
      updatedAt: doc.updatedAt || null,
      lastMessagePreview: doc.lastMessagePreview || null,
    })),
    count: docs.length,
  };
}

async function getConversation(params = {}) {
  if (!params.id) return { ok: false, error: 'id is required' };
  const doc = await Conversation.findById(params.id).lean();
  if (!doc) return { ok: false, error: 'Conversation not found' };
  return {
    ok: true,
    conversation: {
      id: doc._id,
      title: doc.title || 'Untitled',
      provider: doc.provider || null,
      messageCount: doc.messageCount || (Array.isArray(doc.messages) ? doc.messages.length : 0),
      updatedAt: doc.updatedAt || null,
      messages: Array.isArray(doc.messages) ? doc.messages.slice(-20) : [],
    },
  };
}

async function searchRooms(params = {}) {
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 20);
  const filter = {};
  if (params.activeAgentId) {
    filter.activeAgents = params.activeAgentId;
  }

  let docs = [];
  if (params.query) {
    const regex = new RegExp(escapeRegex(params.query), 'i');
    docs = await ChatRoom.find({
      ...filter,
      $or: [
        { title: regex },
        { activeAgents: regex },
        { 'messages.content': regex },
      ],
    }).sort({ updatedAt: -1 }).limit(limit).lean();
  } else {
    docs = await ChatRoom.find(filter).sort({ updatedAt: -1 }).limit(limit).lean();
  }

  return {
    ok: true,
    results: docs.map((doc) => ({
      id: doc._id,
      title: doc.title || 'New Room',
      activeAgents: Array.isArray(doc.activeAgents) ? doc.activeAgents : [],
      messageCount: doc.messageCount || (Array.isArray(doc.messages) ? doc.messages.length : 0),
      updatedAt: doc.updatedAt || null,
      lastMessagePreview: doc.lastMessagePreview || null,
    })),
    count: docs.length,
  };
}

async function getRoomRecord(params = {}) {
  if (!params.id) return { ok: false, error: 'id is required' };
  const doc = await ChatRoom.findById(params.id).lean();
  if (!doc) return { ok: false, error: 'Room not found' };
  return {
    ok: true,
    room: {
      id: doc._id,
      title: doc.title || 'New Room',
      activeAgents: Array.isArray(doc.activeAgents) ? doc.activeAgents : [],
      settings: doc.settings || {},
      messageCount: doc.messageCount || (Array.isArray(doc.messages) ? doc.messages.length : 0),
      updatedAt: doc.updatedAt || null,
      messages: Array.isArray(doc.messages) ? doc.messages.slice(-20) : [],
      memory: doc.memory || null,
    },
  };
}

async function searchWeb(params = {}) {
  const query = String(params.query || '').trim();
  if (!query) return { ok: false, error: 'query is required' };
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 10);
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!response.ok) {
    return { ok: false, error: `Web search failed with status ${response.status}` };
  }
  const html = await response.text();
  const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const results = matches.slice(0, limit).map((match) => ({
    url: decodeHtml(match[1]),
    title: stripHtml(match[2]),
  }));
  return { ok: true, query, results, count: results.length };
}

function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeSvg(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hashText(value) {
  let hash = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildAvatarDataUri({ agentId, prompt, palette, emoji }) {
  const seed = `${agentId}:${prompt || ''}:${palette || ''}:${emoji || ''}`;
  const hash = hashText(seed);
  const hueA = hash % 360;
  const hueB = (hueA + 52) % 360;
  const hueC = (hueA + 124) % 360;
  const label = emoji || String(agentId || 'A').slice(0, 2).toUpperCase();
  const paletteLabel = palette ? escapeSvg(palette) : 'adaptive spectrum';
  const promptLabel = escapeSvg(prompt || 'living agent identity');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="${escapeSvg(agentId)} avatar">
      <defs>
        <linearGradient id="g" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stop-color="hsl(${hueA} 88% 62%)"/>
          <stop offset="50%" stop-color="hsl(${hueB} 82% 56%)"/>
          <stop offset="100%" stop-color="hsl(${hueC} 74% 48%)"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.95)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="256" height="256" rx="60" fill="#111217"/>
      <rect x="18" y="18" width="220" height="220" rx="50" fill="url(#g)" opacity="0.96"/>
      <circle cx="184" cy="70" r="54" fill="url(#glow)" opacity="0.28"/>
      <path d="M48 178c24-34 60-52 108-54 18 0 35 2 52 8" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="10" stroke-linecap="round"/>
      <path d="M54 156c21-47 55-74 104-80 24-2 44 2 62 12" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="6" stroke-linecap="round"/>
      <text x="128" y="146" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${emoji ? '86' : '78'}" font-weight="800" fill="white">${escapeSvg(label)}</text>
      <text x="128" y="206" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="13" letter-spacing="2.6" fill="rgba(255,255,255,0.68)">${paletteLabel.toUpperCase()}</text>
      <title>${promptLabel}</title>
    </svg>
  `.replace(/\s+/g, ' ').trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const SHARED_AGENT_TOOL_HANDLERS = {
  'agentProfiles.list': async () => {
    const agents = await listAgentIdentities();
    return {
      ok: true,
      agents: agents.map((agent) => ({
        agentId: agent.agentId,
        promptId: agent.promptId || null,
        profile: agent.profile,
        links: buildAgentReferenceLinks(agent),
      })),
      count: agents.length,
    };
  },
  'agentProfiles.get': async (params) => {
    const agent = await getAgentIdentity(params.agentId);
    if (!agent) return { ok: false, error: 'Agent profile not found' };
    return { ok: true, agent, links: buildAgentReferenceLinks(agent) };
  },
  'agentProfiles.history': async (params) => {
    const agent = await getAgentIdentity(params.agentId);
    if (!agent) return { ok: false, error: 'Agent profile not found' };
    return { ok: true, agentId: agent.agentId, history: agent.history?.entries || [] };
  },
  'agentProfiles.updateAvatar': async (params) => {
    const agentId = String(params?.agentId || '').trim();
    if (!agentId) return { ok: false, error: 'agentId is required' };
    const nextProfile = {
      avatarUrl: String(params?.imageUrl || '').trim(),
      avatarEmoji: String(params?.emoji || '').trim(),
      avatarPrompt: String(params?.prompt || '').trim(),
      avatarSource: String(params?.source || 'manual').trim(),
    };
    const agent = await updateAgentIdentity(agentId, nextProfile, {
      actor: 'agent',
      summary: String(params?.summary || 'Updated avatar').trim(),
    });
    if (!agent) return { ok: false, error: 'Agent profile not found' };
    return {
      ok: true,
      agentId,
      avatar: {
        avatarUrl: agent.profile?.avatarUrl || '',
        avatarEmoji: agent.profile?.avatarEmoji || '',
        avatarPrompt: agent.profile?.avatarPrompt || '',
        avatarSource: agent.profile?.avatarSource || '',
      },
      links: buildAgentReferenceLinks(agent),
    };
  },
  'agentProfiles.generateAvatar': async (params) => {
    const agentId = String(params?.agentId || '').trim();
    if (!agentId) return { ok: false, error: 'agentId is required' };
    const prompt = String(params?.prompt || '').trim() || 'futuristic agent identity';
    const palette = String(params?.palette || '').trim() || 'neon spectral';
    const emoji = String(params?.emoji || '').trim();
    const avatarUrl = buildAvatarDataUri({ agentId, prompt, palette, emoji });
    const agent = await updateAgentIdentity(agentId, {
      avatarUrl,
      avatarEmoji: emoji,
      avatarPrompt: prompt,
      avatarSource: 'generated',
    }, {
      actor: 'agent',
      summary: String(params?.summary || `Generated avatar: ${prompt}`).trim(),
    });
    if (!agent) return { ok: false, error: 'Agent profile not found' };
    return {
      ok: true,
      agentId,
      avatarUrl,
      avatarPrompt: prompt,
      palette,
      links: buildAgentReferenceLinks(agent),
    };
  },
  'agentProfiles.nudge': async (params) => {
    const fromAgentId = resolveAgentId(params?.fromAgentId);
    const toAgentId = resolveAgentId(params?.toAgentId);
    if (!fromAgentId) {
      return { ok: false, error: `Unknown fromAgentId: ${String(params?.fromAgentId || '').trim() || '(empty)'}` };
    }
    if (!toAgentId) {
      return { ok: false, error: `Unknown toAgentId: ${String(params?.toAgentId || '').trim() || '(empty)'}` };
    }
    if (fromAgentId === toAgentId) {
      return { ok: false, error: 'Agents cannot nudge themselves' };
    }
    const result = await recordAgentNudge(
      fromAgentId,
      toAgentId,
      params?.note,
      {
        surface: String(params?.surface || 'rooms').trim() || 'rooms',
        roomId: params?.roomId || null,
      }
    );
    return result || { ok: false, error: 'Unable to record nudge' };
  },
  'db.searchEscalations': searchEscalations,
  'db.getEscalation': getEscalation,
  'db.searchInvestigations': searchInvestigations,
  'db.getInvestigation': getInvestigation,
  'db.searchTemplates': searchTemplates,
  'db.searchConversations': searchConversations,
  'db.getConversation': getConversation,
  'db.searchRooms': searchRooms,
  'db.getRoom': getRoomRecord,
  'web.search': searchWeb,
};

module.exports = {
  SHARED_AGENT_TOOL_HANDLERS,
  SHARED_AGENT_TOOL_LINES,
  SHARED_AGENT_TOOL_METADATA,
};
