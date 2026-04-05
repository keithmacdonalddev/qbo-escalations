'use strict';

const MAX_SHARED_NOTES = 12;
const MAX_AGENT_NOTES = 4;

function safeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compact(text, max = 220) {
  const clean = safeText(text).replace(/\s+/g, ' ');
  if (!clean) return '';
  return clean.length <= max ? clean : `${clean.slice(0, max - 3).trimEnd()}...`;
}

function normalizeKey(text) {
  return safeText(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function buildMemoryKey(kind, text, agentId = '') {
  return `${kind}:${agentId ? `${agentId}:` : ''}${normalizeKey(text)}`;
}

function createSharedNote(kind, text, message) {
  const content = compact(text);
  if (!content) return null;
  return {
    key: buildMemoryKey(kind, content),
    kind,
    content,
    sourceRole: message.role || 'user',
    sourceAgentId: message.agentId || null,
    updatedAt: new Date(),
  };
}

function createAgentNote(kind, agentId, text) {
  const content = compact(text);
  if (!content || !agentId) return null;
  return {
    key: buildMemoryKey(kind, content, agentId),
    agentId,
    kind,
    content,
    updatedAt: new Date(),
  };
}

function extractNotesFromMessage(message) {
  const content = safeText(message?.content);
  if (!content) return { sharedNotes: [], agentNotes: [] };

  const lower = content.toLowerCase();
  const sharedNotes = [];
  const agentNotes = [];

  if (message.role === 'user') {
    if (lower.includes('this room is for all of us to communicate')) {
      sharedNotes.push(createSharedNote('norm', 'This room is for all of us to communicate, not just respond to direct tasks.', message));
    }
    if (lower.includes('not just our roles')) {
      sharedNotes.push(createSharedNote('norm', 'Agents should show up here as people too, not only as specialists.', message));
    }
    if (lower.includes("don't have to wait for me to chat")) {
      sharedNotes.push(createSharedNote('norm', 'Agents are invited to talk without waiting for a direct prompt every time.', message));
    }
    if (/\b(i am|i'm|i feel|i like|i love|i hate|i want|i don't want|my )\b/i.test(content)) {
      sharedNotes.push(createSharedNote('life', content, message));
    }
  }

  if (message.role === 'assistant' && message.agentId) {
    if (/\b(i stay quiet|i[' ]?m here|i can help|i usually|i tend to|i was just listening)\b/i.test(content)) {
      agentNotes.push(createAgentNote('self', message.agentId, content));
    }
  }

  return {
    sharedNotes: sharedNotes.filter(Boolean),
    agentNotes: agentNotes.filter(Boolean),
  };
}

function mergeNotes(existing = [], incoming = [], maxItems) {
  const byKey = new Map();
  for (const note of existing) {
    if (!note?.key) continue;
    byKey.set(note.key, note);
  }
  for (const note of incoming) {
    if (!note?.key) continue;
    byKey.set(note.key, { ...byKey.get(note.key), ...note, updatedAt: new Date() });
  }
  return [...byKey.values()]
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, maxItems);
}

function mergeRoomMemory(existingMemory, message) {
  const current = existingMemory && typeof existingMemory === 'object' ? existingMemory : {};
  const extracted = extractNotesFromMessage(message);
  const sharedNotes = mergeNotes(current.sharedNotes || [], extracted.sharedNotes || [], MAX_SHARED_NOTES);

  const existingAgentNotes = Array.isArray(current.agentNotes) ? current.agentNotes : [];
  let mergedAgentNotes = existingAgentNotes;
  for (const note of extracted.agentNotes || []) {
    const sameAgent = mergedAgentNotes.filter((item) => item.agentId === note.agentId);
    const otherAgents = mergedAgentNotes.filter((item) => item.agentId !== note.agentId);
    mergedAgentNotes = [...otherAgents, ...mergeNotes(sameAgent, [note], MAX_AGENT_NOTES)];
  }
  mergedAgentNotes = mergedAgentNotes
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, MAX_SHARED_NOTES);

  return {
    sharedNotes,
    agentNotes: mergedAgentNotes,
    lastUpdatedAt: (extracted.sharedNotes.length > 0 || extracted.agentNotes.length > 0) ? new Date() : (current.lastUpdatedAt || null),
  };
}

function buildRoomMemoryContext(roomMemory, agentId) {
  const memory = roomMemory && typeof roomMemory === 'object' ? roomMemory : null;
  if (!memory) return '';

  const sharedNotes = Array.isArray(memory.sharedNotes) ? memory.sharedNotes : [];
  const agentNotes = (Array.isArray(memory.agentNotes) ? memory.agentNotes : []).filter((note) => note.agentId === agentId);
  if (sharedNotes.length === 0 && agentNotes.length === 0) return '';

  const lines = ['## Room Memory', 'This room keeps its own ongoing social and work context. Treat it as lived continuity for this room only.', ''];
  if (sharedNotes.length > 0) {
    lines.push('Shared room context:');
    for (const note of sharedNotes.slice(0, 8)) lines.push(`- ${note.content}`);
    lines.push('');
  }
  if (agentNotes.length > 0) {
    lines.push('What this room already knows about how you show up here:');
    for (const note of agentNotes.slice(0, 4)) lines.push(`- ${note.content}`);
  }
  return lines.join('\n').trim();
}

function buildRoomMemoryBrief(roomMemory) {
  const sharedNotes = Array.isArray(roomMemory?.sharedNotes) ? roomMemory.sharedNotes : [];
  return sharedNotes.slice(0, 5).map((note) => `- ${note.content}`).join('\n');
}

module.exports = {
  mergeRoomMemory,
  buildRoomMemoryContext,
  buildRoomMemoryBrief,
};
