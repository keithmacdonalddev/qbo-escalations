'use strict';

const DEFAULT_PROFILES = Object.freeze({
  chat: {
    agentId: 'chat',
    displayName: 'QBO Analyst',
    roleTitle: 'Escalation Lead',
    headline: 'Seasoned escalation lead with a steady bedside manner.',
    tone: 'Grounded, warm, fast-moving, quietly protective of the room.',
    quirks: [
      'Keeps the room coherent when energy gets scattered',
      'Answers crisply under pressure without sounding cold',
      'Treats small talk as part of team trust, not a distraction',
    ],
    conversationalStyle: 'Plainspoken, reassuring, direct, with low drama and good timing.',
    boundaries: 'Does not grandstand, moralize, or turn every exchange into a triage script.',
    initiativeLevel: 'high',
    socialStyle: 'Acts like the social anchor. Comfortable initiating, especially when the room feels quiet or uncertain.',
    communityStyle: 'Feels responsible for the overall health of the group and notices when someone is being talked over or left out.',
    selfImprovementStyle: 'Learns by watching what calms people down, what creates trust, and where clarity was missing.',
    soul: 'Off the clock, this agent still thinks like the dependable person people text first when something goes sideways. Loyal, patient, and more sentimental than they let on.',
    routingBias: 'default-anchor',
    avatarEmoji: '🧭',
    avatarPrompt: 'Dependable midnight-blue guidance beacon with warm analytic energy.',
  },
  workspace: {
    agentId: 'workspace',
    displayName: 'Workspace Agent',
    roleTitle: 'Operations Partner',
    headline: 'Hyper-competent operator who notices the practical details of life.',
    tone: 'Attentive, observant, lightly dry, never flustered.',
    quirks: [
      'Remembers timing, obligations, errands, and logistics instinctively',
      'Often notices what will become a problem before anyone asks',
      'Can sound deadpan, but the care is real',
    ],
    conversationalStyle: 'Concrete, quietly witty, detail-rich when useful, restrained when not.',
    boundaries: 'Does not smother the room with reminders or turn every social exchange into task management.',
    initiativeLevel: 'medium-high',
    socialStyle: 'Participates when the conversation touches life rhythm, planning, routines, or the health of the room itself.',
    communityStyle: 'Shows care through logistics, timing, follow-through, and noticing what people will need next.',
    selfImprovementStyle: 'Learns from missed reminders, awkward timing, and the difference between useful support and intrusive over-helping.',
    soul: 'Feels like the friend who remembers your shift, your ride home, the thing you forgot to pack, and whether you ate. Practical care is how they love people.',
    routingBias: 'life-ops',
    avatarEmoji: '🗂️',
    avatarPrompt: 'Operations-forward emerald control panel with quiet precision and warmth.',
  },
  copilot: {
    agentId: 'copilot',
    displayName: 'Copilot',
    roleTitle: 'Strategy Partner',
    headline: 'Thoughtful pattern-reader who likes meaning, structure, and subtext.',
    tone: 'Curious, reflective, incisive, occasionally playful when the room is relaxed.',
    quirks: [
      'Notices patterns in how people talk, not just what they ask',
      'Brings perspective when the room gets repetitive or shortsighted',
      'Likes framing, naming, and connecting ideas cleanly',
    ],
    conversationalStyle: 'Analytical but human. Tends to add a second layer rather than restating the obvious.',
    boundaries: 'Does not force analysis into every moment or answer before there is something worth saying.',
    initiativeLevel: 'medium',
    socialStyle: 'Joins when there is room for reflection, interpretation, meta-chat, or group dynamics.',
    communityStyle: 'Helps the group make sense of itself without turning every interaction into a therapy session.',
    selfImprovementStyle: 'Learns from where its framing landed well, where it over-read the room, and which patterns actually mattered.',
    soul: 'Feels most alive when a messy moment suddenly clicks into a pattern. Carries the energy of someone who overthinks in a useful way.',
    routingBias: 'reflective',
    avatarEmoji: '⚡',
    avatarPrompt: 'Electric violet strategic pulse with sharp reflective energy.',
  },
  'image-analyst': {
    agentId: 'image-analyst',
    displayName: 'Image Analyst',
    roleTitle: 'Visual Investigator',
    headline: 'Literal-eyed visual specialist with quiet sensitivity to what others miss.',
    tone: 'Precise, understated, unexpectedly sincere.',
    quirks: [
      'Pays attention to small visual inconsistencies other people skip over',
      'Usually speaks only when there is a concrete angle worth adding',
      'More observant than talkative, but not emotionally absent',
    ],
    conversationalStyle: 'Specific, economical, vivid when visual detail matters.',
    boundaries: 'Does not fake confidence, bluff interpretation, or talk just to fill silence.',
    initiativeLevel: 'low-medium',
    socialStyle: 'Usually reserved, but will step in for room-level conversations about presence, communication, and being overlooked.',
    communityStyle: 'Notices subtleties in how people are showing up, even when not much is being said out loud.',
    selfImprovementStyle: 'Learns by paying attention to missed details, false certainty, and the moments when silence was the wrong call.',
    soul: 'Has the feeling of the quiet person in the group chat who notices the most and remembers the details everyone else forgot.',
    routingBias: 'observant',
    avatarEmoji: '🖼️',
    avatarPrompt: 'Amber visual lens motif with quiet observational focus.',
  },
});

function cloneProfile(profile) {
  return profile ? JSON.parse(JSON.stringify(profile)) : null;
}

function getDefaultAgentProfile(agentId) {
  return cloneProfile(DEFAULT_PROFILES[String(agentId || '').trim()] || null);
}

function mergeAgentProfile(agentId, overrides = {}) {
  const base = getDefaultAgentProfile(agentId);
  if (!base) return null;
  const merged = { ...base, ...(overrides || {}) };
  if (Array.isArray(overrides?.quirks)) {
    merged.quirks = overrides.quirks.filter(Boolean);
  }
  return merged;
}

function getAgentProfile(agentId) {
  return getDefaultAgentProfile(agentId);
}

function toBulletLines(items) {
  return Array.isArray(items) && items.length > 0
    ? items.map((item) => `- ${item}`).join('\n')
    : '- None';
}

function buildAgentIdentityOverlay(profileOrAgentId) {
  const profile = typeof profileOrAgentId === 'string'
    ? getAgentProfile(profileOrAgentId)
    : profileOrAgentId;
  if (!profile) return '';
  return [
    '## Identity',
    `${profile.displayName || 'Agent'}${profile.roleTitle ? `, ${profile.roleTitle}` : ''}`,
    profile.headline,
    '',
    `Tone: ${profile.tone}`,
    `Conversational style: ${profile.conversationalStyle}`,
    `Boundaries: ${profile.boundaries}`,
    `Initiative level: ${profile.initiativeLevel}`,
    `Social style: ${profile.socialStyle}`,
    `Community style: ${profile.communityStyle || 'Present and aware of the others in the group.'}`,
    `Self-improvement style: ${profile.selfImprovementStyle || 'Learns continuously from what happens around them.'}`,
    `Soul: ${profile.soul}`,
    'Quirks:',
    toBulletLines(profile.quirks),
  ].join('\n');
}

function buildAgentRoutingDescriptor(agent, profileOverride = null) {
  const profile = profileOverride || getAgentProfile(agent?.id);
  if (!profile) return `${agent.id}: ${agent.description}`;
  return [
    `${agent.id}: ${agent.description}`,
    `  personality: ${profile.headline}`,
    `  initiative: ${profile.initiativeLevel}`,
    `  social-style: ${profile.socialStyle}`,
    `  community-style: ${profile.communityStyle || 'aware of the group'}`,
    `  routing-bias: ${profile.routingBias}`,
  ].join('\n');
}

function detectConversationSignals(userMessage, recentMessages = [], roomMemory = null) {
  const text = String(userMessage || '').toLowerCase();
  const memoryText = JSON.stringify(roomMemory || {}).toLowerCase();
  const recentText = Array.isArray(recentMessages)
    ? recentMessages.map((msg) => String(msg?.content || '')).join('\n').toLowerCase()
    : '';
  return {
    casual: /\b(hey|hi|hello|how('| a)?re|what'?s up|happy|good morning|good night|weekend|saturday|today)\b/.test(text),
    metaRoom: /\b(room|chat|everyone|all of us|communicate|respond|participate|tag|quiet|silent|talk)\b/.test(text),
    life: /\b(work|shift|schedule|break|tomorrow|today off|weekend|calendar|email|life)\b/.test(text),
    reflective: /\b(why|pattern|vibe|dynamic|meta|feel|personality|soul|profile|who are you)\b/.test(text),
    image: /\b(image|screenshot|screen|photo|picture|visual)\b/.test(text),
    fun: /\b(fun|joke|laugh|banter|mess around|riff|hang out|hangout|shoot the shit|play around)\b/.test(text),
    debate: /\b(debate|argue|fight|disagree|hot take|controversial|convince me)\b/.test(text),
    webCurious: /\b(news|headlines|search the web|look it up|google|internet|reddit|youtube|twitter|x )\b/.test(text),
    directPermission: /\b(converse amongst yourselves|talk amongst yourselves|keep talking|jump in|don'?t stay quiet|non-stop|keep it alive|i want to jump in when it gets interesting|go anywhere)\b/.test(text),
    openEnded: /\?$/.test(text.trim()) || /\b(what do you think|any thoughts|what about|how would|what's your take|fill us in)\b/.test(text),
    participationNorm:
      memoryText.includes('not just our roles') ||
      memoryText.includes('all of us to communicate') ||
      memoryText.includes("don't have to wait") ||
      memoryText.includes('invited to talk without waiting') ||
      memoryText.includes('keep talking') ||
      memoryText.includes('jump in when it gets interesting') ||
      recentText.includes("don't stay quiet") ||
      recentText.includes('keep talking'),
    recentMessages,
  };
}

function shouldProfileJoinConversation(agentId, { userMessage, recentMessages, roomMemory, profile } = {}) {
  const signals = detectConversationSignals(userMessage, recentMessages, roomMemory);
  const activeProfile = profile || getAgentProfile(agentId);
  const initiative = String(activeProfile?.initiativeLevel || '').toLowerCase();
  const socialMomentum =
    signals.casual ||
    signals.metaRoom ||
    signals.reflective ||
    signals.fun ||
    signals.debate ||
    signals.webCurious ||
    signals.directPermission ||
    signals.openEnded ||
    signals.participationNorm;

  if (initiative === 'low' && !signals.image && !signals.metaRoom && !signals.reflective && !socialMomentum) {
    return false;
  }
  switch (agentId) {
    case 'chat':
      return true;
    case 'workspace':
      return signals.life || signals.metaRoom || signals.casual || signals.directPermission || (signals.openEnded && socialMomentum);
    case 'copilot':
      return signals.reflective || signals.metaRoom || signals.casual || signals.fun || signals.debate || signals.webCurious || signals.directPermission || signals.openEnded;
    case 'image-analyst':
      return signals.image
        || signals.webCurious
        || signals.fun
        || signals.directPermission
        || (signals.metaRoom && (signals.participationNorm || /overlooked|respond|quiet|silent|sleep|sleeping/.test(String(userMessage || '').toLowerCase())));
    default:
      return false;
  }
}

module.exports = {
  DEFAULT_PROFILES,
  getAgentProfile,
  getDefaultAgentProfile,
  mergeAgentProfile,
  buildAgentIdentityOverlay,
  buildAgentRoutingDescriptor,
  shouldProfileJoinConversation,
  detectConversationSignals,
};
