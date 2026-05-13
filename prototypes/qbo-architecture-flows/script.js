const NODE_COLORS = {
  actor: '#f472b6',
  client: '#38bdf8',
  api: '#a78bfa',
  agent: '#34d399',
  data: '#f59e0b',
  external: '#94a3b8',
  ops: '#f97316',
};

const NODE_ROWS = {
  'phone-agent': 122,
  user: 238,
  'gmail-user': 574,
  'dev-reviewer': 688,

  'sidebar-router': 82,
  'chat-view': 172,
  'image-parser-popup': 262,
  dashboard: 352,
  'playbook-editor': 442,
  'investigations-view': 532,
  'workspace-shell': 622,
  'rooms-view': 712,
  'agents-view': 802,
  'gmail-calendar-ui': 892,
  'settings-usage-ui': 982,
  'request-waterfall-ui': 1072,

  'chat-api': 142,
  'chat-parse-api': 232,
  'image-parser-api': 322,
  'escalations-api': 412,
  'investigations-api': 502,
  'playbook-api': 592,
  'workspace-api': 682,
  'rooms-api': 772,
  'agents-api': 862,
  'gmail-calendar-api': 952,
  'observability-api': 1042,

  'image-parser-service': 110,
  'parse-orchestrator': 200,
  'chat-request-service': 290,
  'chat-orchestrator': 380,
  'triage-agent': 470,
  'known-issue-agent': 560,
  'inv-matcher': 650,
  'escalation-workflow': 740,
  'workspace-runtime': 830,
  'room-orchestrator': 920,
  'agent-identity-service': 1010,

  'conversation-store': 104,
  'parallel-turn-store': 194,
  'escalation-store': 284,
  'image-parse-store': 374,
  'investigation-store': 464,
  'attention-store': 554,
  'knowledge-store': 644,
  'playbook-files': 734,
  'workspace-stores': 824,
  'room-store': 914,
  'agent-identity-store': 1004,
  'gmail-auth-store': 1094,
  'ai-trace-store': 1184,

  'provider-registry': 132,
  'llm-gateway': 240,
  'lm-studio': 348,
  'cloud-models': 456,
  'google-services': 626,
  'live-call-assist-service': 736,

  'api-fetch': 112,
  'ai-runtime': 234,
  'traces-usage': 356,
  'health-banner': 478,
  'stress-harness': 600,
  'server-error-pipeline': 722,
};

const FLOW_PHASES = {
  'screenshot-to-triage-chat': [
    { label: 'Capture', summary: 'User-facing escalation material enters the app.', start: 0, end: 1 },
    { label: 'Parse', summary: 'Screenshot content is converted into structured escalation text.', start: 2, end: 5 },
    { label: 'Handoff', summary: 'Parsed text moves into the main chat turn.', start: 6, end: 7 },
    { label: 'Enrich and triage', summary: 'Known issues, INV matches, and triage fields are assembled.', start: 8, end: 10 },
    { label: 'Respond and persist', summary: 'The answer streams and durable case records are saved.', start: 11, end: 14 },
  ],
  'main-chat-text-followup': [
    { label: 'Request', summary: 'The user continues an existing conversation.', start: 0, end: 2 },
    { label: 'Answer', summary: 'Provider routing and response streaming happen.', start: 3, end: 5 },
    { label: 'Record', summary: 'Conversation state, traces, and follow-up actions are preserved.', start: 6, end: 8 },
  ],
  'parallel-provider-review': [
    { label: 'Fan out', summary: 'The same turn is sent to multiple model providers.', start: 0, end: 2 },
    { label: 'Compare', summary: 'Candidate responses stay available for review.', start: 3, end: 4 },
    { label: 'Accept', summary: 'The selected answer becomes the canonical turn.', start: 5, end: 5 },
  ],
};

const FAILURE_PATHS = {
  'screenshot-to-triage-chat': [
    {
      title: 'Image parser unavailable',
      impact: 'The screenshot cannot be converted into escalation text, so the user must fall back to manual paste or text-only chat.',
      guardrail: 'Status and key checks should surface provider/key problems before the user relies on the parser.',
      refs: ['server/src/routes/image-parser.js', 'client/src/components/chat/ImageParserPopup.jsx'],
    },
    {
      title: 'Parser succeeds but chat handoff fails',
      impact: 'The parsed result exists, but the main escalation agent never receives the full template as a conversation turn.',
      guardrail: 'Preserve parser output and show a retry path that sends `parsedEscalationText` through `/api/chat`.',
      refs: ['client/src/api/chatApi.js', 'server/src/routes/chat/send.js'],
    },
    {
      title: 'INV lookup unavailable',
      impact: 'The response may still stream, but it loses known-investigation context and confidence boundaries.',
      guardrail: 'Treat INV retrieval as explicit context with degraded-state wording, not silent absence.',
      refs: ['server/src/services/chat-request-service.js', 'server/src/services/known-issue-search-agent.js'],
    },
    {
      title: 'SSE stream dies after save',
      impact: 'The user can see an error even though the server already persisted useful output.',
      guardrail: 'Recover from saved conversation state before showing a hard failure.',
      refs: ['server/src/routes/chat/send.js', 'client/src/api/chatApi.js'],
    },
  ],
  'main-chat-text-followup': [
    {
      title: 'Provider route fails or times out',
      impact: 'The user loses a follow-up answer unless fallback/retry state is visible.',
      guardrail: 'Surface provider status, retry behavior, and any fallback response as part of the turn.',
      refs: ['server/src/routes/chat/send.js', 'server/src/services/chat-request-service.js'],
    },
    {
      title: 'Conversation context is missing',
      impact: 'The answer may ignore prior escalation details or quick-action state.',
      guardrail: 'Reload conversation state before treating a recovered stream as a new failure.',
      refs: ['server/src/models/Conversation.js', 'client/src/api/chatApi.js'],
    },
  ],
  'parallel-provider-review': [
    {
      title: 'Candidate response is not accepted',
      impact: 'The UI may show comparison output that never becomes canonical conversation state.',
      guardrail: 'Keep candidate and accepted-turn persistence visibly separate.',
      refs: ['server/src/models/ParallelCandidateTurn.js', 'server/src/routes/chat/send.js'],
    },
  ],
  'manual-escalation-parse': [
    {
      title: 'Parser confidence is too low',
      impact: 'A saved case can start with missing customer, product, severity, or reproduction fields.',
      guardrail: 'Keep validation warnings visible and require review before treating parsed fields as canonical.',
      refs: ['server/src/services/parse-orchestrator.js', 'server/src/lib/parse-validation.js'],
    },
    {
      title: 'Existing conversation link is wrong',
      impact: 'The escalation record can point to the wrong chat thread and confuse later review.',
      guardrail: 'Show the source conversation and parse source on the saved record.',
      refs: ['server/src/routes/escalations.js', 'server/src/models/Escalation.js'],
    },
  ],
  'resolve-to-knowledge': [
    {
      title: 'Resolution is promoted too early',
      impact: 'A partial or unreviewed fix can become reusable guidance.',
      guardrail: 'Keep knowledge candidates in review state until outcome and evidence are confirmed.',
      refs: ['server/src/models/KnowledgeCandidate.js', 'server/src/routes/escalations.js'],
    },
    {
      title: 'Playbook publish target is stale',
      impact: 'Useful resolution knowledge may not appear where agents actually look.',
      guardrail: 'Separate candidate creation from playbook publishing and show the publish target.',
      refs: ['server/src/lib/knowledge-promotion.js', 'playbook/categories'],
    },
  ],
  'attention-center': [
    {
      title: 'Review item is hidden or stale',
      impact: 'The user misses unresolved duplicate, parse, stale-case, or missing-link work.',
      guardrail: 'Store durable attention items with explicit review state and refresh criteria.',
      refs: ['server/src/models/EscalationAttentionItem.js', 'client/src/api/escalationsApi.js'],
    },
    {
      title: 'Bulk review updates the wrong items',
      impact: 'A queue action can mark unrelated workflow problems as handled.',
      guardrail: 'Keep item IDs, item type, and review state explicit in bulk update paths.',
      refs: ['server/src/routes/escalations.js', 'client/src/api/escalationsApi.js'],
    },
  ],
  'inv-import-match': [
    {
      title: 'INV import data is stale',
      impact: 'Triage may overstate or miss known-investigation context.',
      guardrail: 'Show imported timestamp and keep deterministic match confidence boundaries.',
      refs: ['server/src/models/Investigation.js', 'server/src/services/inv-matcher.js'],
    },
    {
      title: 'Weak match is treated as authoritative',
      impact: 'The response can imply an Intuit investigation applies when evidence is not strong enough.',
      guardrail: 'Use strong-match language only when the matcher reaches confidence threshold.',
      refs: ['server/src/services/inv-matcher.js', 'server/src/services/known-issue-search-agent.js'],
    },
  ],
  'workspace-assistant': [
    {
      title: 'Tool action mutates external data too eagerly',
      impact: 'The assistant can send, archive, label, or edit connected-service data without enough review.',
      guardrail: 'Require explicit tool intent, account scope, and review for write-like actions.',
      refs: ['server/src/services/workspace-tools/execution-state.js', 'server/src/services/workspace-tools/handler-registry.js'],
    },
    {
      title: 'Workspace memory captures the wrong thing',
      impact: 'Future assistant turns can reuse stale or irrelevant context.',
      guardrail: 'Tag memory type/source and show memory saves as explicit assistant actions.',
      refs: ['server/src/services/workspace-memory.js', 'server/src/routes/workspace/ai.js'],
    },
  ],
  'multi-agent-room': [
    {
      title: 'Room agent misses an interrupt',
      impact: 'The conversation can continue from stale instructions while the user expects a redirect.',
      guardrail: 'Keep interrupts and room events explicit in the orchestration runtime.',
      refs: ['server/src/services/room-orchestration-runtime.js', 'server/src/routes/room/send.js'],
    },
    {
      title: 'Agent identity or memory crosses rooms',
      impact: 'A named agent can use the wrong room context.',
      guardrail: 'Scope identity, memory, and tool state to room and agent IDs.',
      refs: ['server/src/models/ChatRoom.js', 'server/src/models/AgentIdentity.js'],
    },
  ],
  'gmail-calendar-connected-services': [
    {
      title: 'Google account is disconnected',
      impact: 'Workspace, Gmail, and Calendar surfaces may look empty while the app is actually unauthenticated.',
      guardrail: 'Surface auth status and account selection before reading or writing connected data.',
      refs: ['server/src/routes/gmail.js', 'server/src/routes/calendar.js'],
    },
    {
      title: 'Wrong account is used for action',
      impact: 'A search, label, draft, or event action can run against the wrong Google account.',
      guardrail: 'Pass account explicitly through Gmail and Calendar tool calls.',
      refs: ['server/src/services/workspace-tools/execution-state.js', 'server/src/services/workspace-tools/handler-registry.js'],
    },
  ],
  'provider-settings-health': [
    {
      title: 'Provider appears configured but is unavailable',
      impact: 'The user expects parser/chat routes to work even though key validation or local gateway health fails.',
      guardrail: 'Separate configured, authenticated, and available provider states.',
      refs: ['server/src/routes/image-parser.js', 'server/src/services/remote-api-providers.js'],
    },
    {
      title: 'Model catalog and runtime defaults drift',
      impact: 'Settings can show a model that route validation or provider pricing does not understand.',
      guardrail: 'Keep catalog, defaults, pricing, and runtime validation aligned.',
      refs: ['shared/ai-provider-catalog.json', 'server/src/services/codex.js'],
    },
  ],
  'observability-debug-loop': [
    {
      title: 'Trace or usage record is missing',
      impact: 'Debugging an AI turn becomes guesswork because provider attempts and costs are not visible.',
      guardrail: 'Persist traces and usage around every significant provider call.',
      refs: ['server/src/routes/traces.js', 'server/src/routes/usage.js'],
    },
    {
      title: 'Harness does not cover the current surface',
      impact: 'A UI or provider regression can ship because only build checks ran.',
      guardrail: 'Keep browser slices and service/provider gates tied to real routes.',
      refs: ['stress-testing/slices', 'server/test/test-runner-routes.test.js'],
    },
  ],
};

const FLOW_METADATA = {
  'screenshot-to-triage-chat': {
    status: 'implemented',
    ownerArea: 'Chat intake + image parser',
    likelyChange: 'client/src/components/chat/ImageParserPopup.jsx, server/src/routes/chat/send.js',
    currentState: 'Screenshot parsing, triage context, INV lookup, streaming answer, and case persistence are wired through the main chat path.',
    desiredState: 'Parser provenance, degraded states, and stream recovery should be visible enough that no screenshot handoff is lost.',
    tests: ['server/test/image-parser-routes.test.js', 'server/test/chat-request-triage-context.test.js', 'server/test/integration-routes.test.js'],
  },
  'main-chat-text-followup': {
    status: 'implemented',
    ownerArea: 'Chat route + orchestration',
    likelyChange: 'server/src/routes/chat/send.js, server/src/services/chat-request-service.js',
    currentState: 'Text follow-up turns preserve conversation context and stream provider-backed answers.',
    desiredState: 'Provider fallback, recovered saves, and quick-action state should be explicit in the user-facing turn.',
    tests: ['server/test/chat-orchestrator.test.js', 'server/test/chat-fallback-integration.test.js', 'server/test/sse-parser.test.js'],
  },
  'parallel-provider-review': {
    status: 'partial',
    ownerArea: 'Parallel provider review',
    likelyChange: 'server/src/models/ParallelCandidateTurn.js, server/src/routes/chat/send.js',
    currentState: 'Candidate responses can be stored separately from the canonical answer.',
    desiredState: 'Candidate lifecycle, acceptance, and discard behavior should be visibly auditable.',
    tests: ['server/test/provider-usage-contract.test.js', 'server/test/chat-orchestrator.test.js'],
  },
  'manual-escalation-parse': {
    status: 'implemented',
    ownerArea: 'Escalation parser + case save',
    likelyChange: 'server/src/services/parse-orchestrator.js, server/src/routes/escalations.js',
    currentState: 'Pasted text, images, or existing conversations can become saved Escalation records.',
    desiredState: 'Parse confidence, source provenance, and review state should be shown before canonical save.',
    tests: ['server/test/escalation-parser.test.js', 'server/test/parse-orchestrator.test.js', 'server/test/parse-validation.test.js'],
  },
  'resolve-to-knowledge': {
    status: 'partial',
    ownerArea: 'Resolution + knowledge promotion',
    likelyChange: 'server/src/lib/knowledge-promotion.js, server/src/models/KnowledgeCandidate.js',
    currentState: 'Resolved escalation data can feed reviewed knowledge candidates and playbook publishing paths.',
    desiredState: 'Promotion should require explicit review, evidence, and target category before reuse.',
    tests: ['server/test/escalations-route-helpers.test.js', 'server/test/case-intake.test.js'],
  },
  'attention-center': {
    status: 'partial',
    ownerArea: 'Workflow attention queue',
    likelyChange: 'server/src/models/EscalationAttentionItem.js, client/src/api/escalationsApi.js',
    currentState: 'Attention items can track workflow issues that need review.',
    desiredState: 'The queue should be the durable notification center for lifecycle and provenance gaps.',
    tests: ['server/test/escalations-route-helpers.test.js', 'server/test/case-intake.test.js'],
  },
  'inv-import-match': {
    status: 'implemented',
    ownerArea: 'Known investigations',
    likelyChange: 'server/src/services/inv-matcher.js, server/src/services/known-issue-search-agent.js',
    currentState: 'INV records can be imported, searched, and matched into triage context.',
    desiredState: 'Imported age, confidence level, and weak-match wording should be impossible to miss.',
    tests: ['server/test/inv-matcher.test.js', 'server/test/known-issue-search-agent.test.js'],
  },
  'workspace-assistant': {
    status: 'partial',
    ownerArea: 'Workspace assistant tools',
    likelyChange: 'server/src/routes/workspace/ai.js, server/src/services/workspace-tools/handler-registry.js',
    currentState: 'Workspace assistant can use context, memory, connected-service state, and tools.',
    desiredState: 'Every write-like action should expose account scope, review state, and resulting side effects.',
    tests: ['server/test/connected-services-harness.test.js', 'server/test/shared-agent-tools.test.js', 'server/test/room-workspace-adapter-utils.test.js'],
  },
  'multi-agent-room': {
    status: 'partial',
    ownerArea: 'Room orchestration',
    likelyChange: 'server/src/services/room-orchestration-runtime.js, server/src/models/ChatRoom.js',
    currentState: 'Named agents can coordinate in shared rooms with messages, actions, memory, and realtime events.',
    desiredState: 'Interrupts, identity scope, and memory capture should be reviewable per room.',
    tests: ['server/test/room-workspace-adapter-utils.test.js', 'server/test/realtime-websocket.test.js', 'server/test/agent-identities-registry.test.js'],
  },
  'gmail-calendar-connected-services': {
    status: 'implemented',
    ownerArea: 'Google connected services',
    likelyChange: 'server/src/routes/gmail.js, server/src/routes/calendar.js',
    currentState: 'Gmail and Calendar routes expose connected-service context to UI and assistant tools.',
    desiredState: 'Auth state, account selection, and mutation effects should be visible before actions run.',
    tests: ['server/test/connected-services-harness.test.js'],
  },
  'provider-settings-health': {
    status: 'implemented',
    ownerArea: 'Provider configuration',
    likelyChange: 'shared/ai-provider-catalog.json, server/src/services/remote-api-providers.js',
    currentState: 'Provider catalog, status checks, pricing, usage extraction, and local/cloud availability are represented.',
    desiredState: 'Configured, authenticated, available, priced, and default states should stay synchronized.',
    tests: ['server/test/remote-api-providers.test.js', 'server/test/lm-studio.test.js', 'server/test/provider-usage-contract.test.js'],
  },
  'observability-debug-loop': {
    status: 'implemented',
    ownerArea: 'Traces, usage, harness',
    likelyChange: 'server/src/routes/traces.js, server/src/routes/usage.js, stress-testing/slices',
    currentState: 'Traces, usage logs, provider attempts, and harness slices support runtime debugging.',
    desiredState: 'Every significant route/provider workflow should have a browser or service harness check.',
    tests: ['server/test/usage-routes.test.js', 'server/test/usage-writer.test.js', 'server/test/test-runner-routes.test.js'],
  },
};

const OWNER_BY_LANE = {
  actors: 'Actor',
  client: 'Client',
  api: 'API route',
  agent: 'Service/agent',
  data: 'Data store',
  external: 'External provider',
  ops: 'Ops',
};

let state = {
  data: null,
  sourceRefStatus: null,
  selectedFlowId: null,
  search: '',
  viewMode: 'story',
  selectedStepIndex: 0,
  mapFilter: 'active',
};

const els = {
  storyView: document.getElementById('storyView'),
  mapView: document.getElementById('mapView'),
  viewButtons: document.querySelectorAll('[data-view-mode]'),
  mapFilterButtons: document.querySelectorAll('[data-map-filter]'),
  flowCounter: document.getElementById('flowCounter'),
  flowList: document.getElementById('flowList'),
  flowTitle: document.getElementById('flowTitle'),
  flowIntent: document.getElementById('flowIntent'),
  stepMetric: document.getElementById('stepMetric'),
  nodeMetric: document.getElementById('nodeMetric'),
  laneMetric: document.getElementById('laneMetric'),
  activePathSummary: document.getElementById('activePathSummary'),
  flowStateGrid: document.getElementById('flowStateGrid'),
  exportMarkdownButton: document.getElementById('exportMarkdownButton'),
  exportMermaidButton: document.getElementById('exportMermaidButton'),
  printButton: document.getElementById('printButton'),
  laneBoard: document.getElementById('laneBoard'),
  journeySummary: document.getElementById('journeySummary'),
  journeyList: document.getElementById('journeyList'),
  architectureStack: document.getElementById('architectureStack'),
  evidenceList: document.getElementById('evidenceList'),
  copyStatus: document.getElementById('copyStatus'),
  sourceWarning: document.getElementById('sourceWarning'),
  testCoverageList: document.getElementById('testCoverageList'),
  failureSummary: document.getElementById('failureSummary'),
  failureList: document.getElementById('failureList'),
  searchInput: document.getElementById('searchInput'),
  resetButton: document.getElementById('resetButton'),
  mapFlowTitle: document.getElementById('mapFlowTitle'),
  mapFlowIntent: document.getElementById('mapFlowIntent'),
  mapStepMetric: document.getElementById('mapStepMetric'),
  mapNodeMetric: document.getElementById('mapNodeMetric'),
  mapLaneMetric: document.getElementById('mapLaneMetric'),
  mapLegend: document.getElementById('mapLegend'),
  systemMap: document.getElementById('systemMap'),
  graphEdgeLayer: document.getElementById('graphEdgeLayer'),
  graphLaneLayer: document.getElementById('graphLaneLayer'),
  graphNodeLayer: document.getElementById('graphNodeLayer'),
  mapStepList: document.getElementById('mapStepList'),
  mapArchitectureStack: document.getElementById('mapArchitectureStack'),
  mapTestCoverageList: document.getElementById('mapTestCoverageList'),
  mapFailureList: document.getElementById('mapFailureList'),
};

function selectedFlow() {
  return state.data.flows.find((flow) => flow.id === state.selectedFlowId) || state.data.flows[0];
}

function clampStepIndex(flow = selectedFlow(), index = state.selectedStepIndex) {
  const max = Math.max(0, (flow.steps || []).length - 1);
  const parsed = Number.parseInt(index, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(max, Math.max(0, parsed));
}

function selectedStep(flow = selectedFlow()) {
  return (flow.steps || [])[clampStepIndex(flow)];
}

function nodeMap() {
  return new Map(state.data.nodes.map((node) => [node.id, node]));
}

function cssNumber(name) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
}

function laneIndex(laneId) {
  return state.data.lanes.findIndex((lane) => lane.id === laneId);
}

function graphNodePosition(node) {
  const laneW = cssNumber('--map-lane-w');
  const nodeW = cssNumber('--map-node-w');
  const mapPad = (laneW - nodeW) / 2;
  const x = laneIndex(node.lane) * laneW + mapPad;
  const y = NODE_ROWS[node.id] || 120;
  return { x, y, w: nodeW, h: cssNumber('--map-node-h') };
}

function activeNodeIds(flow = selectedFlow()) {
  return new Set((flow.steps || []).flatMap((step) => [step.from, step.to]));
}

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function nodeColor(node) {
  return NODE_COLORS[node?.type] || '#94a3b8';
}

function textForFlow(flow) {
  return [
    flow.title,
    flow.intent,
    ...(flow.steps || []).flatMap((step) => [
      step.label,
      step.detail,
      step.from,
      step.to,
      ...(step.sourceRefs || []),
    ]),
  ].join(' ').toLowerCase();
}

function textForStep(step, nodes) {
  const fromNode = nodes.get(step.from);
  const toNode = nodes.get(step.to);
  return [
    step.label,
    step.detail,
    fromNode?.title,
    fromNode?.subtitle,
    toNode?.title,
    toNode?.subtitle,
    ...(step.sourceRefs || []),
  ].join(' ').toLowerCase();
}

function uniqueRefs(items) {
  const seen = new Set();
  const refs = [];
  for (const item of items) {
    for (const ref of item.sourceRefs || []) {
      if (!seen.has(ref)) {
        seen.add(ref);
        refs.push(ref);
      }
    }
  }
  return refs;
}

function activeNodesByLane(flow = selectedFlow()) {
  const nodes = nodeMap();
  const ids = activeNodeIds(flow);
  return state.data.lanes.map((lane) => ({
    lane,
    nodes: state.data.nodes.filter((node) => node.lane === lane.id && ids.has(node.id)),
  }));
}

function phaseForStep(flow, index) {
  const phases = FLOW_PHASES[flow.id] || [{ label: 'Workflow', summary: 'Ordered handoff through the selected app path.', start: 0, end: (flow.steps || []).length - 1 }];
  return phases.find((phase) => index >= phase.start && index <= phase.end) || phases[0];
}

function failurePathsForFlow(flow = selectedFlow()) {
  return FAILURE_PATHS[flow.id] || [];
}

function metadataForFlow(flow = selectedFlow()) {
  return FLOW_METADATA[flow.id] || {
    status: 'needs review',
    ownerArea: 'Unassigned',
    likelyChange: 'Review source references for this flow',
    currentState: 'The flow is represented in the artifact.',
    desiredState: 'The implementation status and review target still need to be confirmed.',
    tests: [],
  };
}

function ownerLabelsForStep(step, nodes = nodeMap()) {
  const labels = new Set();
  const fromLane = nodes.get(step.from)?.lane;
  const toLane = nodes.get(step.to)?.lane;
  if (fromLane && OWNER_BY_LANE[fromLane]) labels.add(OWNER_BY_LANE[fromLane]);
  if (toLane && OWNER_BY_LANE[toLane]) labels.add(OWNER_BY_LANE[toLane]);
  return Array.from(labels);
}

function neighborNodeIds(flow = selectedFlow()) {
  const active = activeNodeIds(flow);
  const neighbors = new Set(active);
  for (const candidate of state.data.flows || []) {
    for (const step of candidate.steps || []) {
      if (active.has(step.from)) neighbors.add(step.to);
      if (active.has(step.to)) neighbors.add(step.from);
    }
  }
  return neighbors;
}

function visibleNodeIdsForMap(flow = selectedFlow()) {
  if (state.mapFilter === 'full') return new Set(state.data.nodes.map((node) => node.id));
  if (state.mapFilter === 'neighbors') return neighborNodeIds(flow);
  return activeNodeIds(flow);
}

function existingSourceRefs() {
  return new Set(state.sourceRefStatus?.existing || []);
}

function auditedMissingRefs() {
  return new Set(state.sourceRefStatus?.missing || []);
}

function refsForFlow(flow = selectedFlow()) {
  const ids = activeNodeIds(flow);
  const failures = failurePathsForFlow(flow);
  const selected = selectedStep(flow);
  const primary = selected?.sourceRefs || [];
  const supporting = uniqueRefs([
    ...state.data.nodes.filter((node) => ids.has(node.id)),
    ...(flow.steps || []),
    ...failures.map((failure) => ({ sourceRefs: failure.refs || [] })),
  ]).filter((ref) => !primary.includes(ref));
  return {
    primary,
    supporting,
    all: uniqueRefs([{ sourceRefs: primary }, { sourceRefs: supporting }]),
  };
}

function missingRefsFor(refs) {
  if (!state.sourceRefStatus) return [];
  const existing = existingSourceRefs();
  const missing = auditedMissingRefs();
  return refs.filter((ref) => missing.has(ref) || !existing.has(ref));
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      // Fall through to the textarea fallback for browser permission edge cases.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function copyReference(ref, button) {
  try {
    await copyText(ref);
    document.querySelectorAll('.source-chip.is-copied, .evidence-item.is-copied, .test-chip.is-copied').forEach((item) => {
      item.classList.remove('is-copied');
    });
    button.classList.add('is-copied');
    if (els.copyStatus) els.copyStatus.textContent = `Copied ${ref}`;
  } catch (err) {
    if (els.copyStatus) els.copyStatus.textContent = `Could not copy ${ref}`;
  }
}

function createRefChip(ref, className = 'source-chip') {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = className;
  chip.textContent = ref;
  chip.title = `Copy ${ref}`;
  chip.dataset.ref = ref;
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    copyReference(ref, chip);
  });
  return chip;
}

function updateUrlState() {
  if (!state.data) return;
  const params = new URLSearchParams();
  params.set('flow', selectedFlow().id);
  params.set('view', state.viewMode);
  params.set('step', String(clampStepIndex() + 1));
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  const flowId = params.get('flow');
  const view = params.get('view');
  const step = params.get('step');

  if (flowId && state.data.flows.some((flow) => flow.id === flowId)) {
    state.selectedFlowId = flowId;
  }

  if (view === 'map' || view === 'story') {
    state.viewMode = view;
  }

  if (step) {
    state.selectedStepIndex = clampStepIndex(selectedFlow(), Number.parseInt(step, 10) - 1);
  }
}

function selectFlow(flowId) {
  state.selectedFlowId = flowId;
  state.selectedStepIndex = 0;
  renderAll();
  updateUrlState();
}

function selectStep(index) {
  state.selectedStepIndex = clampStepIndex(selectedFlow(), index);
  renderAll();
  updateUrlState();
}

function setViewMode(viewMode) {
  state.viewMode = viewMode;
  renderAll();
  updateUrlState();
}

function setMapFilter(filter) {
  state.mapFilter = filter;
  renderAll();
}

function renderFlows() {
  els.flowList.innerHTML = '';
  const search = normalizeSearch(state.search);

  for (const [index, flow] of state.data.flows.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flow-button';
    button.dataset.index = String(index + 1).padStart(2, '0');
    if (flow.id === selectedFlow().id) button.classList.add('is-selected');
    if (search && !textForFlow(flow).includes(search)) button.classList.add('is-hidden');
    button.addEventListener('click', () => {
      selectFlow(flow.id);
    });

    const title = document.createElement('span');
    title.className = 'flow-title';
    title.textContent = flow.title;

    const meta = document.createElement('span');
    meta.className = 'flow-meta';
    meta.textContent = `${flow.steps.length} steps`;

    button.append(title, meta);
    els.flowList.append(button);
  }
}

function renderFlowState() {
  const meta = metadataForFlow();
  els.flowStateGrid.innerHTML = '';

  const entries = [
    ['Status', meta.status],
    ['Owner area', meta.ownerArea],
    ['Likely change point', meta.likelyChange],
    ['Current state', meta.currentState],
    ['Desired state', meta.desiredState],
  ];

  for (const [label, value] of entries) {
    const item = document.createElement('article');
    item.className = 'flow-state-item';
    if (label === 'Status') item.classList.add(`status-${String(value).replace(/\s+/g, '-')}`);
    const strong = document.createElement('strong');
    strong.textContent = label;
    const span = document.createElement('span');
    span.textContent = value;
    item.append(strong, span);
    els.flowStateGrid.append(item);
  }
}

function renderTestCoverage(target = els.testCoverageList) {
  const meta = metadataForFlow();
  target.innerHTML = '';

  if (!meta.tests?.length) {
    const empty = document.createElement('span');
    empty.className = 'evidence-empty';
    empty.textContent = 'No tests mapped yet.';
    target.append(empty);
    return;
  }

  for (const ref of meta.tests) {
    target.append(createRefChip(ref, 'test-chip'));
  }
}

function selectedFlowMarkdown() {
  const flow = selectedFlow();
  const nodes = nodeMap();
  const meta = metadataForFlow(flow);
  const failures = failurePathsForFlow(flow);
  const lines = [
    `# ${flow.title}`,
    '',
    flow.intent,
    '',
    `- Status: ${meta.status}`,
    `- Owner area: ${meta.ownerArea}`,
    `- Likely change point: ${meta.likelyChange}`,
    `- Current state: ${meta.currentState}`,
    `- Desired state: ${meta.desiredState}`,
    '',
    '## Steps',
  ];

  for (const [index, step] of (flow.steps || []).entries()) {
    const from = nodes.get(step.from)?.title || step.from;
    const to = nodes.get(step.to)?.title || step.to;
    const owners = ownerLabelsForStep(step, nodes).join(', ');
    lines.push(`${index + 1}. ${from} -> ${to}: ${step.label}`);
    lines.push(`   - Owner: ${owners || 'Unassigned'}`);
    lines.push(`   - Detail: ${step.detail || ''}`);
    if (step.sourceRefs?.length) lines.push(`   - Refs: ${step.sourceRefs.join(', ')}`);
  }

  lines.push('', '## Failure Paths');
  if (!failures.length) lines.push('- No explicit failure paths modeled.');
  for (const failure of failures) {
    lines.push(`- ${failure.title}: ${failure.impact}`);
    lines.push(`  - Guardrail: ${failure.guardrail}`);
    if (failure.refs?.length) lines.push(`  - Refs: ${failure.refs.join(', ')}`);
  }

  lines.push('', '## Tests');
  if (!meta.tests?.length) lines.push('- No tests mapped.');
  for (const test of meta.tests || []) lines.push(`- ${test}`);

  return lines.join('\n');
}

function selectedFlowMermaid() {
  const flow = selectedFlow();
  const nodes = nodeMap();
  const lines = ['flowchart LR'];
  const safeId = (id) => id.replace(/[^a-zA-Z0-9_]/g, '_');
  for (const id of activeNodeIds(flow)) {
    const node = nodes.get(id);
    lines.push(`  ${safeId(id)}["${(node?.title || id).replace(/"/g, '\\"')}"]`);
  }
  for (const [index, step] of (flow.steps || []).entries()) {
    lines.push(`  ${safeId(step.from)} -->|${index + 1}. ${step.label.replace(/"/g, '\\"')}| ${safeId(step.to)}`);
  }
  return lines.join('\n');
}

function renderSummary() {
  const flow = selectedFlow();
  state.selectedStepIndex = clampStepIndex(flow);
  const activeIds = activeNodeIds(flow);
  const laneCount = activeNodesByLane(flow).filter((group) => group.nodes.length > 0).length;
  els.flowCounter.textContent = `${state.data.flows.length} flows`;
  els.flowTitle.textContent = flow.title;
  els.flowIntent.textContent = flow.intent;
  els.stepMetric.textContent = `${flow.steps.length} steps`;
  els.nodeMetric.textContent = `${activeIds.size} systems`;
  els.laneMetric.textContent = `${laneCount} lanes`;
  els.mapFlowTitle.textContent = flow.title;
  els.mapFlowIntent.textContent = flow.intent;
  els.mapStepMetric.textContent = `${flow.steps.length} steps`;
  els.mapNodeMetric.textContent = `${activeIds.size} systems`;
  els.mapLaneMetric.textContent = `${laneCount} lanes`;
  els.activePathSummary.textContent = `${activeIds.size} active systems across ${laneCount} architecture lanes`;
  els.journeySummary.textContent = `Read top to bottom. Each row shows the handoff, the action, and the code evidence for that step.`;
}

function createLaneNode(node) {
  const item = document.createElement('div');
  item.className = 'lane-node';
  item.style.setProperty('--node-color', nodeColor(node));

  const title = document.createElement('strong');
  title.textContent = node.title;

  const subtitle = document.createElement('span');
  subtitle.textContent = node.subtitle || node.id;

  item.append(title, subtitle);
  return item;
}

function renderLaneBoard() {
  els.laneBoard.innerHTML = '';
  for (const group of activeNodesByLane()) {
    const column = document.createElement('section');
    column.className = 'lane-column';
    if (group.nodes.length === 0) column.classList.add('is-empty');

    const title = document.createElement('h3');
    title.textContent = group.lane.label;
    column.append(title);

    if (group.nodes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lane-node';
      empty.style.setProperty('--node-color', 'rgba(148, 163, 184, 0.5)');
      empty.innerHTML = '<strong>No handoff</strong><span>Not used by this flow</span>';
      column.append(empty);
    } else {
      for (const node of group.nodes) column.append(createLaneNode(node));
    }

    els.laneBoard.append(column);
  }
}

function createSourceChips(refs, max = 3) {
  const list = document.createElement('div');
  list.className = 'source-list';
  const shown = refs.slice(0, max);
  for (const ref of shown) {
    list.append(createRefChip(ref));
  }
  if (refs.length > shown.length) {
    const chip = document.createElement('span');
    chip.className = 'source-chip';
    chip.textContent = `+${refs.length - shown.length} more`;
    chip.title = refs.slice(shown.length).join('\n');
    list.append(chip);
  }
  return list;
}

function createOwnerBadges(labels) {
  const wrap = document.createElement('div');
  wrap.className = 'owner-badges';
  for (const label of labels) {
    const badge = document.createElement('span');
    badge.className = 'owner-badge';
    badge.textContent = label;
    wrap.append(badge);
  }
  return wrap;
}

function renderJourney() {
  els.journeyList.innerHTML = '';
  const flow = selectedFlow();
  const nodes = nodeMap();
  const search = normalizeSearch(state.search);
  let previousPhase = null;

  for (const [index, step] of (flow.steps || []).entries()) {
    const fromNode = nodes.get(step.from);
    const toNode = nodes.get(step.to);
    const phase = phaseForStep(flow, index);

    if (phase.label !== previousPhase) {
      const heading = document.createElement('section');
      heading.className = 'phase-heading';
      const title = document.createElement('h3');
      title.textContent = phase.label;
      const summary = document.createElement('p');
      summary.textContent = phase.summary;
      heading.append(title, summary);
      els.journeyList.append(heading);
      previousPhase = phase.label;
    }

    const article = document.createElement('article');
    article.className = 'journey-step';
    article.tabIndex = 0;
    article.setAttribute('role', 'button');
    article.setAttribute('aria-label', `Select step ${index + 1}: ${step.label}`);
    if (index === state.selectedStepIndex) article.classList.add('is-selected');
    if (search && textForStep(step, nodes).includes(search)) article.classList.add('is-search-hit');
    article.addEventListener('click', () => selectStep(index));
    article.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectStep(index);
      }
    });

    const number = document.createElement('div');
    number.className = 'step-number';
    number.textContent = String(index + 1);

    const from = document.createElement('div');
    from.className = 'step-node';
    from.style.setProperty('--node-color', nodeColor(fromNode));
    from.innerHTML = `<span class="label">From</span><strong>${fromNode?.title || step.from}</strong><p>${fromNode?.subtitle || step.from}</p>`;

    const action = document.createElement('div');
    action.className = 'step-action';
    action.innerHTML = `<span class="label">Action</span><strong>${step.label}</strong>`;

    const to = document.createElement('div');
    to.className = 'step-node';
    to.style.setProperty('--node-color', nodeColor(toNode));
    to.innerHTML = `<span class="label">To</span><strong>${toNode?.title || step.to}</strong><p>${toNode?.subtitle || step.to}</p>`;

    const detail = document.createElement('div');
    detail.className = 'step-detail';
    const detailLabel = document.createElement('span');
    detailLabel.className = 'label';
    detailLabel.textContent = 'Why it matters';
    const detailText = document.createElement('p');
    detailText.textContent = step.detail || '';
    detail.append(detailLabel, createOwnerBadges(ownerLabelsForStep(step, nodes)), detailText, createSourceChips(step.sourceRefs || []));

    article.append(number, from, action, to, detail);
    els.journeyList.append(article);
  }
}

function renderArchitectureStack(target = els.architectureStack) {
  target.innerHTML = '';
  for (const group of activeNodesByLane().filter((item) => item.nodes.length > 0)) {
    const row = document.createElement('div');
    row.className = 'stack-row';

    const title = document.createElement('h3');
    title.textContent = group.lane.label;

    const nodes = document.createElement('div');
    nodes.className = 'stack-nodes';
    for (const node of group.nodes) {
      const chip = document.createElement('span');
      chip.className = 'stack-node';
      chip.style.setProperty('--node-color', nodeColor(node));
      chip.textContent = node.title;
      nodes.append(chip);
    }

    row.append(title, nodes);
    target.append(row);
  }
}

function renderEvidence() {
  els.evidenceList.innerHTML = '';
  const evidence = refsForFlow();
  renderSourceAudit(evidence.all);
  renderEvidenceGroup('Primary step files', evidence.primary, 'primary');
  renderEvidenceGroup('Supporting flow files', evidence.supporting, 'supporting');
}

function renderEvidenceGroup(title, refs, kind) {
  const group = document.createElement('section');
  group.className = 'evidence-group';

  const heading = document.createElement('h3');
  heading.textContent = title;
  group.append(heading);

  const list = document.createElement('div');
  list.className = 'evidence-chip-list';

  if (!refs.length) {
    const empty = document.createElement('span');
    empty.className = 'evidence-empty';
    empty.textContent = 'No refs for this group.';
    list.append(empty);
  } else {
    for (const ref of refs) {
      list.append(createRefChip(ref, `evidence-item evidence-item--${kind}`));
    }
  }

  group.append(list);
  els.evidenceList.append(group);
}

function renderSourceAudit(refs) {
  if (!els.sourceWarning) return;
  const missing = missingRefsFor(refs);
  els.sourceWarning.hidden = false;
  els.sourceWarning.innerHTML = '';
  els.sourceWarning.classList.toggle('is-ok', state.sourceRefStatus && missing.length === 0);
  els.sourceWarning.classList.toggle('is-warning', !state.sourceRefStatus || missing.length > 0);

  const title = document.createElement('strong');
  if (!state.sourceRefStatus) {
    title.textContent = 'Source audit unavailable';
    const detail = document.createElement('span');
    detail.textContent = ' Could not load source-ref-status.json.';
    els.sourceWarning.append(title, detail);
    return;
  }

  if (!missing.length) {
    title.textContent = 'Source audit clean';
    const detail = document.createElement('span');
    detail.textContent = ` ${refs.length} referenced paths are present in the generated audit.`;
    els.sourceWarning.append(title, detail);
    return;
  }

  title.textContent = `${missing.length} source refs need attention`;
  els.sourceWarning.append(title, createSourceChips(missing, 6));
}

function renderFailurePaths(target = els.failureList) {
  const flow = selectedFlow();
  const failures = failurePathsForFlow(flow);
  target.innerHTML = '';

  if (target === els.failureList) {
    els.failureSummary.textContent = failures.length
      ? `${failures.length} modeled risks for this flow`
      : 'No explicit failure paths modeled yet';
  }

  if (!failures.length) {
    const empty = document.createElement('div');
    empty.className = 'failure-empty';
    empty.textContent = 'No explicit failure paths have been modeled for this flow yet.';
    target.append(empty);
    return;
  }

  for (const failure of failures) {
    const card = document.createElement('article');
    card.className = 'failure-card';

    const title = document.createElement('h3');
    title.textContent = failure.title;

    const impact = document.createElement('p');
    impact.textContent = failure.impact;

    const guardrail = document.createElement('p');
    guardrail.className = 'guardrail';
    guardrail.textContent = failure.guardrail;

    card.append(title, impact, guardrail, createSourceChips(failure.refs || [], 2));
    target.append(card);
  }
}

function renderViewMode() {
  const showMap = state.viewMode === 'map';
  els.storyView.hidden = showMap;
  els.mapView.hidden = !showMap;
  for (const button of els.viewButtons) {
    button.classList.toggle('is-selected', button.dataset.viewMode === state.viewMode);
  }
  for (const button of els.mapFilterButtons) {
    button.classList.toggle('is-selected', button.dataset.mapFilter === state.mapFilter);
  }
}

function renderMapLegend() {
  els.mapLegend.innerHTML = '';
  for (const item of state.data.legend) {
    const row = document.createElement('span');
    row.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.color = item.color;
    swatch.style.background = item.color;
    row.append(swatch, document.createTextNode(item.label));
    els.mapLegend.append(row);
  }
}

function adjustMapSize() {
  const maxY = state.data.nodes.reduce((max, node) => {
    const pos = graphNodePosition(node);
    return Math.max(max, pos.y + pos.h + 56);
  }, cssNumber('--map-h'));
  const width = cssNumber('--map-lane-w') * state.data.lanes.length;
  els.systemMap.style.height = `${maxY}px`;
  els.graphEdgeLayer.setAttribute('width', String(width));
  els.graphEdgeLayer.setAttribute('height', String(maxY));
  els.graphEdgeLayer.setAttribute('viewBox', `0 0 ${width} ${maxY}`);
}

function renderGraphLanes() {
  els.graphLaneLayer.innerHTML = '';
  const laneW = cssNumber('--map-lane-w');
  for (const [index, lane] of state.data.lanes.entries()) {
    const label = document.createElement('div');
    label.className = 'graph-lane-label';
    label.style.left = `${index * laneW}px`;
    label.textContent = lane.label;
    els.graphLaneLayer.append(label);
  }
}

function renderGraphNodes() {
  els.graphNodeLayer.innerHTML = '';
  const flow = selectedFlow();
  const activeIds = activeNodeIds(flow);
  const visibleIds = visibleNodeIdsForMap(flow);
  const selected = selectedStep(flow);
  const search = normalizeSearch(state.search);

  for (const node of state.data.nodes) {
    if (!visibleIds.has(node.id)) continue;
    const pos = graphNodePosition(node);
    const div = document.createElement('article');
    div.className = 'graph-node';
    div.dataset.nodeId = node.id;
    div.style.left = `${pos.x}px`;
    div.style.top = `${pos.y}px`;
    div.style.setProperty('--node-color', nodeColor(node));

    if (!activeIds.has(node.id)) div.classList.add('is-context');
    if (activeIds.has(node.id)) div.classList.add('is-active');
    if (selected && (selected.from === node.id || selected.to === node.id)) div.classList.add('is-selected');
    if (search && [
      node.title,
      node.subtitle,
      node.id,
      node.lane,
      node.type,
      ...(node.sourceRefs || []),
    ].join(' ').toLowerCase().includes(search)) div.classList.add('is-search-hit');

    const title = document.createElement('strong');
    title.textContent = node.title;

    const subtitle = document.createElement('span');
    subtitle.textContent = node.subtitle || node.id;

    div.append(title, subtitle);
    els.graphNodeLayer.append(div);
  }
}

function graphPathForEdge(fromNode, toNode, index) {
  const from = graphNodePosition(fromNode);
  const to = graphNodePosition(toNode);
  const startX = from.x + from.w;
  const startY = from.y + from.h / 2;
  const endX = to.x;
  const endY = to.y + to.h / 2;
  const sameOrBack = endX <= startX;
  const offset = ((index % 5) - 2) * 10;
  const c1x = sameOrBack ? startX + 84 : startX + Math.max(88, (endX - startX) * 0.42);
  const c2x = sameOrBack ? endX - 84 : endX - Math.max(88, (endX - startX) * 0.42);
  const c1y = startY + offset;
  const c2y = endY - offset;
  return {
    d: `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`,
    labelX: startX + (endX - startX) * 0.52,
    labelY: startY + (endY - startY) * 0.5 + offset,
  };
}

function renderGraphEdges() {
  els.graphEdgeLayer.innerHTML = '';
  const flow = selectedFlow();
  const nodes = nodeMap();

  for (const [stepIndex, step] of (flow.steps || []).entries()) {
    const fromNode = nodes.get(step.from);
    const toNode = nodes.get(step.to);
    if (!fromNode || !toNode) continue;

    const edgePath = graphPathForEdge(fromNode, toNode, stepIndex);
    const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shadow.setAttribute('d', edgePath.d);
    shadow.classList.add('graph-edge-shadow');
    if (stepIndex === state.selectedStepIndex) shadow.classList.add('is-selected');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', edgePath.d);
    path.classList.add('graph-edge');
    if (stepIndex === state.selectedStepIndex) path.classList.add('is-selected');

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', edgePath.labelX);
    circle.setAttribute('cy', edgePath.labelY);
    circle.setAttribute('r', '12');
    circle.classList.add('graph-edge-label');
    if (stepIndex === state.selectedStepIndex) circle.classList.add('is-selected');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', edgePath.labelX);
    text.setAttribute('y', edgePath.labelY + 4);
    text.setAttribute('text-anchor', 'middle');
    text.classList.add('graph-edge-number');
    text.textContent = String(stepIndex + 1);

    els.graphEdgeLayer.append(shadow, path, circle, text);
  }
}

function renderMapStepList() {
  els.mapStepList.innerHTML = '';
  const flow = selectedFlow();
  const nodes = nodeMap();
  let previousPhase = null;

  for (const [index, step] of (flow.steps || []).entries()) {
    const phase = phaseForStep(flow, index);
    if (phase.label !== previousPhase) {
      const phaseItem = document.createElement('li');
      phaseItem.className = 'map-phase';
      phaseItem.textContent = phase.label;
      els.mapStepList.append(phaseItem);
      previousPhase = phase.label;
    }

    const item = document.createElement('li');
    item.className = 'map-step';
    if (index === state.selectedStepIndex) item.classList.add('is-selected');
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Select step ${index + 1}: ${step.label}`);
    item.addEventListener('click', () => selectStep(index));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectStep(index);
      }
    });
    const fromTitle = nodes.get(step.from)?.title || step.from;
    const toTitle = nodes.get(step.to)?.title || step.to;

    const route = document.createElement('span');
    route.textContent = `${fromTitle} -> ${toTitle}`;

    const label = document.createElement('strong');
    label.textContent = step.label;

    const owners = createOwnerBadges(ownerLabelsForStep(step, nodes));

    const detail = document.createElement('p');
    detail.textContent = step.detail || '';

    item.append(route, label, owners, detail);
    els.mapStepList.append(item);
  }
}

function renderSystemMap() {
  adjustMapSize();
  renderMapLegend();
  renderGraphLanes();
  renderGraphNodes();
  renderGraphEdges();
  renderMapStepList();
  renderArchitectureStack(els.mapArchitectureStack);
}

function renderAll() {
  if (!state.data) return;
  renderViewMode();
  renderSummary();
  renderFlows();
  renderFlowState();
  renderTestCoverage();
  renderLaneBoard();
  renderJourney();
  renderArchitectureStack();
  renderEvidence();
  renderFailurePaths();
  renderSystemMap();
  renderTestCoverage(els.mapTestCoverageList);
  renderFailurePaths(els.mapFailureList);
}

async function loadData() {
  try {
    const [res, sourceStatusRes] = await Promise.all([
      fetch('./architecture-flows.json', { cache: 'no-store' }),
      fetch('./source-ref-status.json', { cache: 'no-store' }).catch(() => null),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    if (sourceStatusRes?.ok) {
      state.sourceRefStatus = await sourceStatusRes.json();
    }
    state.selectedFlowId = state.data.flows.find((flow) => flow.primary)?.id || state.data.flows[0]?.id || null;
    applyUrlState();
    renderAll();
    updateUrlState();
  } catch (err) {
    document.body.innerHTML = `<main class="load-error">Could not load architecture-flows.json: ${err.message}</main>`;
  }
}

els.searchInput.addEventListener('input', (event) => {
  state.search = event.target.value;
  renderAll();
});

els.resetButton.addEventListener('click', () => {
  state.selectedFlowId = state.data?.flows.find((flow) => flow.primary)?.id || state.data?.flows[0]?.id || null;
  state.selectedStepIndex = 0;
  state.search = '';
  els.searchInput.value = '';
  renderAll();
  updateUrlState();
});

for (const button of els.viewButtons) {
  button.addEventListener('click', () => {
    setViewMode(button.dataset.viewMode);
  });
}

for (const button of els.mapFilterButtons) {
  button.addEventListener('click', () => {
    setMapFilter(button.dataset.mapFilter);
  });
}

els.exportMarkdownButton.addEventListener('click', () => {
  copyText(selectedFlowMarkdown()).then(() => {
    els.copyStatus.textContent = `Copied Markdown for ${selectedFlow().title}`;
  }).catch(() => {
    els.copyStatus.textContent = 'Could not copy Markdown export';
  });
});

els.exportMermaidButton.addEventListener('click', () => {
  copyText(selectedFlowMermaid()).then(() => {
    els.copyStatus.textContent = `Copied Mermaid for ${selectedFlow().title}`;
  }).catch(() => {
    els.copyStatus.textContent = 'Could not copy Mermaid export';
  });
});

els.printButton.addEventListener('click', () => {
  window.print();
});

loadData();
