const agents = [
  {
    id: 'qbo-analyst',
    name: 'QBO Analyst',
    initials: 'QA',
    role: 'Escalation Lead',
    team: 'Customer Experience',
    owner: 'Jordan Lee',
    status: 'Active',
    health: 'Healthy',
    model: 'Codex CLI GPT-5.5',
    prompt: 'chat-core',
    trust: 4.8,
    review: 96,
    fit: 9,
    impact: '8.7K',
    actions: 8700,
    tools: ['Search KB', 'Policy Checker', 'Case Memory', 'Customer Timeline'],
    workflows: ['Escalation Intake', 'Tier 2 Handoff', 'Customer Reply Draft', 'Closeout Summary'],
    domains: ['Billing', 'Account Access', 'Technical Support'],
    updated: '2m ago',
    version: 'v2.4.1',
    created: 'Jan 18, 2025',
    risk: 'Low',
    attention: null,
    color: 'blue',
    headline: 'Seasoned escalation lead with a steady bedside manner.',
    description: 'Reads messy QBO support context, identifies risk, and turns scattered notes into a clear escalation path.',
    tone: 'Grounded, warm, fast-moving, quietly protective of the room.',
    goal: 'Resolve or route customer escalations with enough context that the next human can act immediately.',
    guardrails: 'No unsupported tax advice, no promises about refunds, escalate legal or payroll ambiguity.',
    promptSummary: 'Understand the customer issue, separate facts from assumptions, identify missing evidence, and propose the next best support action.',
    memory: [
      'Prefers preserving original customer wording when urgency or sentiment matters.',
      'Learns which workflow handoffs reduce repeat questions from Tier 2.',
      'Treats missing screenshots as a first-class blocker, not a footnote.'
    ],
    relationships: [
      ['Template Parser', 'Receives normalized case fields'],
      ['Policy Checker', 'Requests refund and account-access validation'],
      ['Follow-Up Chat Parser', 'Uses transcript summaries for context']
    ],
    metrics: { resolution: 91.7, firstResponse: 88.6, escalation: 8.2, hallucination: 0.16, csat: 4.7, latency: '1.42s', timeout: '0.03%', saturation: '37%' },
    trend: [58, 66, 72, 88, 82, 79, 81, 74, 83, 89, 76, 67, 75, 84, 91, 82],
    activity: [
      ['12:41 PM', 'Resolved inquiry #INC-784512', 'via Web Chat'],
      ['12:37 PM', 'Escalated to Tier 2 Agent', 'Technical issue'],
      ['12:33 PM', 'Used tool: Policy Checker', 'Eligible for Refund'],
      ['12:29 PM', 'Updated knowledge reference', 'Billing cycles']
    ],
    versions: [
      ['v2.4.1', 'Current', 'May 12, 2025', 'Updated escalation rules'],
      ['v2.4.0', 'Stable', 'Apr 28, 2025', 'Added language detection'],
      ['v2.3.1', 'Archived', 'Apr 14, 2025', 'Refined tone guidelines']
    ]
  },
  {
    id: 'template-parser',
    name: 'Template Parser',
    initials: 'TP',
    role: 'Canonical OCR Specialist',
    team: 'Escalation Intake',
    owner: 'Priya N.',
    status: 'Active',
    health: 'Healthy',
    model: 'Claude Opus 4.8',
    prompt: 'parse-fields',
    trust: 4.7,
    review: 94,
    fit: 9,
    impact: '6.3K',
    actions: 6300,
    tools: ['Image OCR', 'Field Normalizer', 'Case Schema', 'Validation Rules'],
    workflows: ['Image Intake', 'Escalation Intake', 'Evidence Review'],
    domains: ['Images', 'Forms', 'OCR'],
    updated: '6m ago',
    version: 'v1.9.0',
    created: 'Feb 2, 2025',
    risk: 'Medium',
    attention: null,
    color: 'violet',
    headline: 'Turns screenshots and pasted templates into clean case fields.',
    description: 'Extracts names, dates, issue types, account signals, and evidence gaps without overwriting uncertain source text.',
    tone: 'Precise, skeptical, compact.',
    goal: 'Produce reliable structured data from noisy case inputs.',
    guardrails: 'Mark low-confidence fields, preserve source fragments, never invent unavailable fields.',
    promptSummary: 'Parse the user input into canonical escalation fields and label uncertain or missing evidence.',
    memory: ['Learns common screenshot crops from internal support-owned test companies.', 'Flags mismatch between account type and product wording.'],
    relationships: [['QBO Analyst', 'Sends parsed fields'], ['Image Analyst', 'Requests visual evidence review']],
    metrics: { resolution: 89.5, firstResponse: 92.1, escalation: 5.4, hallucination: 0.09, csat: 4.6, latency: '1.18s', timeout: '0.02%', saturation: '31%' },
    trend: [42, 48, 57, 62, 70, 66, 73, 71, 80, 77, 83, 89, 85, 91, 88, 94],
    activity: [['12:35 PM', 'Parsed image intake #IMG-2291', '11 fields'], ['12:11 PM', 'Low confidence field marked', 'Company ID']],
    versions: [['v1.9.0', 'Current', 'May 8, 2025', 'Added field confidence']]
  },
  {
    id: 'triage-agent',
    name: 'Triage Agent',
    initials: 'TA',
    role: 'Fast Escalation Triage',
    team: 'Frontline Support',
    owner: 'Olivia Chen',
    status: 'Active',
    health: 'Healthy',
    model: 'Codex CLI GPT-5.4',
    prompt: 'triage-fast',
    trust: 4.6,
    review: 91,
    fit: 8,
    impact: '4.9K',
    actions: 4900,
    tools: ['Case Classifier', 'Priority Rules', 'Zendesk Search'],
    workflows: ['Ticket Intake', 'Live Chat', 'Mobile App Support'],
    domains: ['Routing', 'Urgency', 'Queues'],
    updated: '9m ago',
    version: 'v2.1.0',
    created: 'Jan 29, 2025',
    risk: 'Low',
    attention: null,
    color: 'green',
    headline: 'Routes incoming cases before the queue loses context.',
    description: 'Classifies issue type, urgency, policy risk, and likely next owner.',
    tone: 'Direct, quick, operational.',
    goal: 'Get every case to the right workflow quickly.',
    guardrails: 'Escalate high-risk payroll, account compromise, and compliance signals.',
    promptSummary: 'Classify the case, assign urgency, and recommend the next queue with supporting evidence.',
    memory: ['Weekend queue routing needs extra confidence before direct assignment.'],
    relationships: [['QBO Analyst', 'Hands off high-risk escalations'], ['Scheduler', 'Requests follow-up windows']],
    metrics: { resolution: 87.3, firstResponse: 90.4, escalation: 11.8, hallucination: 0.18, csat: 4.5, latency: '0.94s', timeout: '0.01%', saturation: '42%' },
    trend: [38, 46, 52, 60, 57, 68, 72, 75, 69, 82, 78, 85, 81, 88, 92, 96],
    activity: [['12:50 PM', 'Routed urgent case', 'Payroll lockout'], ['12:44 PM', 'Re-ranked queue item', 'Billing']]
  },
  {
    id: 'follow-up-parser',
    name: 'Follow-Up Chat Parser',
    initials: 'FP',
    role: 'Phone-Agent Transcript Parser',
    team: 'Customer Success',
    owner: 'Maya Patel',
    status: 'Active',
    health: 'Healthy',
    model: 'Claude Sonnet 4.6',
    prompt: 'followup-transcript',
    trust: 4.5,
    review: 88,
    fit: 8,
    impact: '3.6K',
    actions: 3600,
    tools: ['Transcript Splitter', 'Speaker Labels', 'Action Extractor'],
    workflows: ['Live Call Assist', 'Follow-Up Draft', 'Case Notes'],
    domains: ['Calls', 'Summaries', 'Next Steps'],
    updated: '11m ago',
    version: 'v1.6.3',
    created: 'Mar 3, 2025',
    risk: 'Medium',
    attention: 'Review diarization confidence after recent transcript drift.',
    color: 'pink',
    headline: 'Converts call transcripts into crisp support handoff notes.',
    description: 'Finds commitments, unresolved questions, sentiment, and follow-up work from long support conversations.',
    tone: 'Concise, empathetic, evidence-first.',
    goal: 'Summarize customer conversations into next actions and handoff context.',
    guardrails: 'Do not infer speaker identity without evidence, preserve unresolved questions.',
    promptSummary: 'Summarize the transcript, extract follow-ups, and highlight risks or missing commitments.',
    memory: ['Often collaborates with QBO Analyst after live-call assist sessions.'],
    relationships: [['QBO Analyst', 'Supplies call context'], ['Scheduler', 'Requests callback windows']],
    metrics: { resolution: 84.1, firstResponse: 86.3, escalation: 9.7, hallucination: 0.22, csat: 4.4, latency: '1.71s', timeout: '0.05%', saturation: '45%' },
    trend: [55, 51, 62, 60, 68, 73, 72, 70, 76, 79, 82, 80, 78, 84, 83, 88],
    activity: [['12:28 PM', 'Transcript summarized', 'Live call assist'], ['12:16 PM', 'Action item extracted', 'Callback']]
  },
  {
    id: 'workspace-agent',
    name: 'Workspace Agent',
    initials: 'WA',
    role: 'Operations Partner',
    team: 'Workspace',
    owner: 'Jordan Lee',
    status: 'Active',
    health: 'Healthy',
    model: 'Codex CLI GPT-5.5',
    prompt: 'workspace-agent',
    trust: 4.6,
    review: 93,
    fit: 8,
    impact: '3.3K',
    actions: 3300,
    tools: ['Workspace Monitor', 'Shipment Tracker', 'Calendar Tools'],
    workflows: ['Workspace Overview', 'Shipment Tracking', 'Room Collaboration'],
    domains: ['Workspace', 'Monitoring', 'Follow-ups'],
    updated: '14m ago',
    version: 'v2.0.2',
    created: 'Feb 18, 2025',
    risk: 'Medium',
    attention: null,
    color: 'cyan',
    headline: 'Keeps workspace context, shipments, rooms, and follow-ups synchronized.',
    description: 'Monitors workspace changes and helps agents coordinate across surfaces.',
    tone: 'Practical, observant, low-drama.',
    goal: 'Keep operational context synchronized across workspace surfaces.',
    guardrails: 'Avoid calendar actions without explicit time sanity checks.',
    promptSummary: 'Observe workspace state, summarize changes, and prepare coordinated follow-up actions.',
    memory: ['Knows shipment cleanup must be verified after browser canaries.'],
    relationships: [['QBO Analyst', 'Shares workspace state'], ['Copilot', 'Feeds strategic context']],
    metrics: { resolution: 86.9, firstResponse: 87.1, escalation: 7.1, hallucination: 0.14, csat: 4.5, latency: '1.36s', timeout: '0.04%', saturation: '39%' },
    trend: [35, 44, 48, 52, 61, 60, 64, 72, 69, 75, 82, 78, 85, 88, 86, 91],
    activity: [['12:22 PM', 'Workspace shipment updated', 'Tracking'], ['12:08 PM', 'Room turn summarized', 'Two-agent room']]
  },
  {
    id: 'copilot',
    name: 'Copilot',
    initials: 'CP',
    role: 'Strategy Partner',
    team: 'Platform Ops',
    owner: 'Ava Chen',
    status: 'Idle',
    health: 'Healthy',
    model: 'Claude Opus 4.8',
    prompt: 'copilot-strategy',
    trust: 4.4,
    review: 89,
    fit: 7,
    impact: '2.9K',
    actions: 2900,
    tools: ['Plan Builder', 'Repo Context', 'Decision Log'],
    workflows: ['Planning', 'Review', 'Implementation Handoff'],
    domains: ['Strategy', 'Architecture', 'Planning'],
    updated: '21m ago',
    version: 'v1.8.8',
    created: 'Mar 14, 2025',
    risk: 'Low',
    attention: null,
    color: 'violet',
    headline: 'Turns ambiguity into implementation-ready project direction.',
    description: 'Reviews product intent, identifies tradeoffs, and frames durable next steps.',
    tone: 'Plain-spoken, rigorous, practical.',
    goal: 'Convert broad requests into buildable, repo-fit plans.',
    guardrails: 'Avoid generic advice when live code context is available.',
    promptSummary: 'Clarify the desired outcome, inspect repo context, and recommend concrete next moves.',
    memory: ['User prefers plain-English visible outcomes over jargon.'],
    relationships: [['QBO Analyst', 'Shares support-domain judgment'], ['Workspace Agent', 'Receives operational context']],
    metrics: { resolution: 82.5, firstResponse: 84.6, escalation: 6.5, hallucination: 0.19, csat: 4.5, latency: '1.64s', timeout: '0.03%', saturation: '29%' },
    trend: [30, 42, 38, 50, 54, 58, 61, 67, 65, 70, 72, 77, 74, 81, 79, 86],
    activity: [['11:55 AM', 'Generated implementation plan', 'Agent UI']]
  },
  {
    id: 'image-analyst',
    name: 'Image Analyst',
    initials: 'IA',
    role: 'Visual Investigator',
    team: 'Evidence Review',
    owner: 'Priya N.',
    status: 'Active',
    health: 'Healthy',
    model: 'Gemini API',
    prompt: 'image-investigator',
    trust: 4.3,
    review: 86,
    fit: 7,
    impact: '2.6K',
    actions: 2600,
    tools: ['Image Parser', 'OCR Crosscheck', 'Visual Diff'],
    workflows: ['Image Intake', 'Evidence Review', 'Parser Assist'],
    domains: ['Images', 'Receipts', 'Screenshots'],
    updated: '28m ago',
    version: 'v1.4.2',
    created: 'Mar 21, 2025',
    risk: 'Medium',
    attention: 'Provider validation should be rechecked before production usage.',
    color: 'blue',
    headline: 'Examines uploaded evidence and explains what the image actually supports.',
    description: 'Compares visual content against parsed fields and flags missing or inconsistent evidence.',
    tone: 'Careful, literal, source-bound.',
    goal: 'Make image-based evidence review reliable and auditable.',
    guardrails: 'Do not infer facts outside the visible image.',
    promptSummary: 'Inspect the image, identify visible fields, and compare them to the expected escalation schema.',
    memory: ['Gemini validation must distinguish configured from truly available.'],
    relationships: [['Template Parser', 'Crosschecks extracted fields'], ['QBO Analyst', 'Provides image evidence summary']],
    metrics: { resolution: 80.9, firstResponse: 83.4, escalation: 10.2, hallucination: 0.24, csat: 4.2, latency: '2.08s', timeout: '0.08%', saturation: '51%' },
    trend: [28, 36, 45, 43, 52, 55, 61, 59, 66, 64, 69, 72, 70, 74, 81, 79],
    activity: [['11:49 AM', 'Evidence inconsistency flagged', 'Company name'], ['11:34 AM', 'Image parse assisted', 'Receipt']]
  },
  {
    id: 'policy-checker',
    name: 'Policy Checker',
    initials: 'PC',
    role: 'Rules and Refund Review',
    team: 'Governance',
    owner: 'Nina Brooks',
    status: 'Active',
    health: 'Degraded',
    model: 'Claude Sonnet 4.6',
    prompt: 'policy-checker',
    trust: 3.9,
    review: 78,
    fit: 6,
    impact: '2.4K',
    actions: 2400,
    tools: ['Policy DB', 'Refund Matrix', 'Compliance Tags'],
    workflows: ['Policy Review', 'Refund Eligibility', 'Governance'],
    domains: ['Policy', 'Refunds', 'Compliance'],
    updated: '36m ago',
    version: 'v1.2.7',
    created: 'Apr 4, 2025',
    risk: 'High',
    attention: 'Review overdue and degraded policy connector detected.',
    color: 'amber',
    headline: 'Checks support recommendations against policy and refund rules.',
    description: 'Reviews proposed actions for compliance, refund eligibility, and escalation requirements.',
    tone: 'Strict, terse, conservative.',
    goal: 'Prevent unsupported policy claims before they reach customers.',
    guardrails: 'Escalate ambiguous policy interpretation for human review.',
    promptSummary: 'Compare the proposed support action to policy references and return a clear pass, warning, or escalation.',
    memory: ['Policy DB connector was degraded in the last health sweep.'],
    relationships: [['QBO Analyst', 'Validates customer response'], ['Governance Review', 'Logs policy decisions']],
    metrics: { resolution: 76.2, firstResponse: 79.8, escalation: 14.4, hallucination: 0.31, csat: 4.0, latency: '2.44s', timeout: '0.18%', saturation: '67%' },
    trend: [64, 58, 60, 52, 49, 47, 45, 50, 44, 43, 42, 46, 41, 40, 39, 38],
    activity: [['11:27 AM', 'Connector degradation reported', 'Policy DB'], ['11:14 AM', 'Review overdue', 'Human review']]
  },
  {
    id: 'scheduler',
    name: 'Scheduler',
    initials: 'SC',
    role: 'Follow-Up Coordinator',
    team: 'Operations',
    owner: 'Olivia Chen',
    status: 'Active',
    health: 'Healthy',
    model: 'OpenAI API GPT-5.5',
    prompt: 'calendar-actions',
    trust: 4.1,
    review: 83,
    fit: 7,
    impact: '2.1K',
    actions: 2100,
    tools: ['Calendar', 'Availability', 'Reminder Draft'],
    workflows: ['Follow-Up Scheduling', 'Callback Coordination'],
    domains: ['Calendar', 'Follow-up', 'Reminders'],
    updated: '45m ago',
    version: 'v1.1.4',
    created: 'Apr 9, 2025',
    risk: 'Medium',
    attention: 'Time sanity guardrail needs coverage for lunch and break windows.',
    color: 'green',
    headline: 'Finds sane follow-up windows and prepares calendar actions.',
    description: 'Coordinates callbacks, reminders, and meeting holds after escalation review.',
    tone: 'Clear, careful, time-zone aware.',
    goal: 'Schedule follow-ups at times that are useful and contextually sane.',
    guardrails: 'Never create a calendar event without explicit date, time, and timezone confidence.',
    promptSummary: 'Convert follow-up intent into calendar-ready actions with conflict and sanity checks.',
    memory: ['12:45 AM lunch scheduling bug must not recur.'],
    relationships: [['Triage Agent', 'Receives follow-up requests'], ['Follow-Up Chat Parser', 'Uses extracted commitments']],
    metrics: { resolution: 79.1, firstResponse: 81.2, escalation: 6.4, hallucination: 0.21, csat: 4.1, latency: '1.22s', timeout: '0.04%', saturation: '34%' },
    trend: [32, 35, 39, 44, 48, 46, 55, 52, 61, 58, 64, 67, 69, 72, 74, 79],
    activity: [['11:08 AM', 'Follow-up window proposed', 'Callback'], ['10:55 AM', 'Conflict detected', 'Team calendar']]
  },
  {
    id: 'knowledge-librarian',
    name: 'Knowledge Librarian',
    initials: 'KL',
    role: 'Knowledge Ops',
    team: 'Knowledge',
    owner: 'Nina Brooks',
    status: 'Active',
    health: 'Healthy',
    model: 'Claude Sonnet 4.6',
    prompt: 'knowledge-librarian',
    trust: 4.5,
    review: 90,
    fit: 8,
    impact: '1.9K',
    actions: 1900,
    tools: ['Vector DB', 'Confluence', 'Article Tagger'],
    workflows: ['Knowledge Update', 'Article Review', 'Case Closeout'],
    domains: ['Knowledge', 'Search', 'Curation'],
    updated: '51m ago',
    version: 'v1.3.5',
    created: 'Mar 30, 2025',
    risk: 'Low',
    attention: null,
    color: 'cyan',
    headline: 'Keeps support knowledge findable and attached to the right workflows.',
    description: 'Curates references, tags recurring issues, and proposes article updates.',
    tone: 'Organized, neutral, precise.',
    goal: 'Improve retrieval quality by keeping support knowledge current.',
    guardrails: 'Do not publish article changes without review.',
    promptSummary: 'Identify useful knowledge references and propose concise updates with citations.',
    memory: ['Billing cycle article frequently resolves repeat escalations.'],
    relationships: [['QBO Analyst', 'Supplies references'], ['Policy Checker', 'Coordinates policy citations']],
    metrics: { resolution: 83.5, firstResponse: 85.2, escalation: 4.2, hallucination: 0.12, csat: 4.4, latency: '1.02s', timeout: '0.02%', saturation: '26%' },
    trend: [22, 30, 36, 42, 40, 44, 51, 58, 54, 61, 66, 63, 70, 74, 72, 78],
    activity: [['10:42 AM', 'Article reference updated', 'Billing cycles']]
  },
  {
    id: 'analytics-narrator',
    name: 'Analytics Narrator',
    initials: 'AN',
    role: 'Data and Insights',
    team: 'Analytics',
    owner: 'Ava Chen',
    status: 'Idle',
    health: 'Healthy',
    model: 'OpenAI API GPT-5.4',
    prompt: 'analytics-narrator',
    trust: 4.2,
    review: 84,
    fit: 7,
    impact: '1.8K',
    actions: 1800,
    tools: ['Usage Metrics', 'Chart Summarizer', 'Incident Digest'],
    workflows: ['Weekly Report', 'Usage Review', 'Incident Analysis'],
    domains: ['Analytics', 'Reporting', 'Narratives'],
    updated: '1h ago',
    version: 'v1.0.8',
    created: 'Apr 12, 2025',
    risk: 'Low',
    attention: null,
    color: 'violet',
    headline: 'Turns metrics and traces into plain-English operational readouts.',
    description: 'Explains trends, outliers, and likely causes for usage and support operations.',
    tone: 'Brief, specific, evidence-backed.',
    goal: 'Make operational metrics easy to act on.',
    guardrails: 'Label inference clearly and avoid overstating trends.',
    promptSummary: 'Summarize charts and traces into actionable operational findings.',
    memory: ['User prefers findings first when reviewing quality.'],
    relationships: [['Copilot', 'Feeds decision context'], ['Workspace Agent', 'Receives runtime metrics']],
    metrics: { resolution: 78.8, firstResponse: 82.7, escalation: 3.9, hallucination: 0.17, csat: 4.2, latency: '1.28s', timeout: '0.03%', saturation: '23%' },
    trend: [18, 25, 28, 35, 39, 44, 47, 50, 55, 57, 61, 66, 64, 68, 74, 76],
    activity: [['10:31 AM', 'Usage report summarized', 'Workspace tokens']]
  },
  {
    id: 'review-bot',
    name: 'Code Review Bot',
    initials: 'CR',
    role: 'Implementation Reviewer',
    team: 'Engineering',
    owner: 'Jordan Lee',
    status: 'Active',
    health: 'Healthy',
    model: 'Codex CLI GPT-5.5',
    prompt: 'strict-reviewer',
    trust: 4.6,
    review: 92,
    fit: 8,
    impact: '1.7K',
    actions: 1700,
    tools: ['Repo Search', 'Test Runner', 'Review Writer'],
    workflows: ['Phase Review', 'Bug Fix', 'Verification'],
    domains: ['Code Review', 'Tests', 'Risk'],
    updated: '1h ago',
    version: 'v1.5.0',
    created: 'Mar 18, 2025',
    risk: 'Low',
    attention: null,
    color: 'green',
    headline: 'Finds blockers, missing tests, and implementation drift.',
    description: 'Compares implementation against contracts and produces severity-ranked findings.',
    tone: 'Strict, concise, evidence-first.',
    goal: 'Protect implementation quality without inventing scope.',
    guardrails: 'Re-check disk state before factual code-state claims.',
    promptSummary: 'Inspect current disk state, compare against the requested contract, and report concrete risks first.',
    memory: ['A stale debug-log finding was previously reported after a file changed.'],
    relationships: [['Copilot', 'Reviews plans'], ['Workspace Agent', 'Uses canary output']],
    metrics: { resolution: 85.9, firstResponse: 86.6, escalation: 5.1, hallucination: 0.11, csat: 4.5, latency: '1.57s', timeout: '0.02%', saturation: '33%' },
    trend: [20, 31, 40, 42, 48, 52, 59, 62, 69, 66, 72, 76, 80, 84, 88, 90],
    activity: [['10:14 AM', 'Review artifact produced', 'Agent UI']]
  }
];

const state = {
  mode: 'grid',
  search: '',
  role: 'all',
  model: 'all',
  status: 'all',
  currentAgentId: 'qbo-analyst',
  currentTab: 'overview',
  pausedAgents: new Set()
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  hydrateFilters();
  bindEvents();
  renderFleet();
  renderProfile();
  initNetworkCanvas();
  refreshIcons();
});

function cacheElements() {
  [
    'fleetView', 'profileView', 'topbarContext', 'statsGrid', 'topAgents', 'coverageDonut',
    'coverageLegend', 'agentResults', 'attentionList', 'fleetActivity', 'resultTitle',
    'resultSubtitle', 'agentSearch', 'globalSearch', 'roleFilter', 'modelFilter',
    'statusFilter', 'clearFilters', 'backToFleet', 'profileHero', 'profilePanels',
    'featuredAgentCard'
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  [els.agentSearch, els.globalSearch].forEach((input) => {
    input.addEventListener('input', (event) => {
      state.search = event.target.value.trim().toLowerCase();
      els.agentSearch.value = event.target.value;
      els.globalSearch.value = event.target.value;
      renderFleet();
    });
  });

  els.roleFilter.addEventListener('change', (event) => {
    state.role = event.target.value;
    renderFleet();
  });

  els.modelFilter.addEventListener('change', (event) => {
    state.model = event.target.value;
    renderFleet();
  });

  els.statusFilter.addEventListener('change', (event) => {
    state.status = event.target.value;
    renderFleet();
  });

  els.clearFilters.addEventListener('click', () => {
    state.search = '';
    state.role = 'all';
    state.model = 'all';
    state.status = 'all';
    els.agentSearch.value = '';
    els.globalSearch.value = '';
    els.roleFilter.value = 'all';
    els.modelFilter.value = 'all';
    els.statusFilter.value = 'all';
    renderFleet();
  });

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('is-active', item === button));
      renderFleet();
    });
  });

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentTab = button.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('is-active', item === button));
      renderProfile();
    });
  });

  els.backToFleet.addEventListener('click', () => showFleet());
}

function hydrateFilters() {
  appendOptions(els.roleFilter, unique(agents.map((agent) => agent.role)));
  appendOptions(els.modelFilter, unique(agents.map((agent) => agent.model)));
  appendOptions(els.statusFilter, unique(agents.map((agent) => effectiveStatus(agent))));
}

function appendOptions(select, values) {
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function renderFleet() {
  const filtered = getFilteredAgents();
  if (els.fleetView.classList.contains('is-active')) {
    els.topbarContext.textContent = 'Agent Mission Control';
  }
  renderFeaturedAgent();
  renderStats(filtered);
  renderTopAgents();
  renderCoverage();
  renderAttention();
  renderFleetActivity();
  els.resultSubtitle.textContent = `${filtered.length} of ${agents.length} agents shown`;
  els.agentResults.className = state.mode === 'grid' ? 'agent-grid' : '';

  if (!filtered.length) {
    els.agentResults.innerHTML = '<div class="empty-state">No agents match the current filters.</div>';
  } else if (state.mode === 'grid') {
    els.agentResults.innerHTML = filtered.map(renderAgentCard).join('');
  } else if (state.mode === 'list') {
    els.agentResults.innerHTML = renderListTable(filtered);
  } else {
    els.agentResults.innerHTML = renderMap(filtered);
  }

  bindAgentOpeners();
  refreshIcons();
}

function renderFeaturedAgent() {
  const agent = agents.find((item) => item.id === 'qbo-analyst') || agents[0];
  const statusClass = effectiveStatus(agent) === 'Degraded' ? 'warn' : effectiveStatus(agent) === 'Idle' ? 'idle' : '';
  els.featuredAgentCard.innerHTML = `
    <div class="featured-card-frame" style="--agent-accent:${colorFor(agent.color)}">
      <div class="featured-topline">
        <span class="featured-kicker">Featured Agent</span>
        <span class="status-badge ${statusClass}">${effectiveStatus(agent)}</span>
      </div>
      <div class="featured-main">
        <div class="featured-emblem">
          ${avatar(agent)}
          <span class="featured-signal" aria-hidden="true"></span>
        </div>
        <div class="featured-copy">
          <span>${agent.role}</span>
          <h2>${agent.name}</h2>
          <p>${agent.description}</p>
        </div>
      </div>
      <div class="featured-system">
        <span><i data-lucide="route"></i>${agent.workflows.length} workflows</span>
        <span><i data-lucide="shield-check"></i>${agent.review}% reviewed</span>
        <span><i data-lucide="timer"></i>${agent.metrics.latency} p95</span>
      </div>
      <div class="featured-divider"></div>
      <div class="featured-stats">
        <div><span>Resolution Accuracy</span><strong>${agent.metrics.resolution}%</strong></div>
        <div><span>Trust Score</span><strong>${agent.trust.toFixed(1)} / 5</strong></div>
        <div><span>Actions This Week</span><strong>${agent.actions.toLocaleString()}</strong></div>
      </div>
      <button class="featured-link" type="button" data-agent="${agent.id}">
        <span>View operational profile</span>
        <i data-lucide="arrow-right"></i>
      </button>
    </div>
  `;
}

function renderStats(filtered) {
  const active = agents.filter((agent) => effectiveStatus(agent) === 'Active').length;
  const reviewed = Math.round(avg(agents.map((agent) => agent.review)));
  const attention = agents.filter((agent) => agent.attention).length;
  const trust = avg(agents.map((agent) => agent.trust)).toFixed(1);
  const cards = [
    ['Total Agents', agents.length, '+6 this month', 'bot', [38, 42, 44, 51, 55, 58, 63, 68]],
    ['Active in Workflows', active, `${Math.round((active / agents.length) * 100)}% of total`, 'workflow', [28, 34, 36, 41, 47, 50, 57, 62]],
    ['Human Reviewed', `${reviewed}%`, '+8% last 7 days', 'shield-check', [62, 64, 68, 71, 76, 82, 89, 91]],
    ['Needs Attention', attention, `${Math.round((attention / agents.length) * 100)}% of fleet`, 'triangle-alert', [8, 7, 6, 6, 5, 6, 5, 5]],
    ['Avg. Trust Score', `${trust} / 5`, '+0.2 last 30 days', 'star', [74, 76, 79, 80, 84, 86, 88, 91]]
  ];

  els.statsGrid.innerHTML = cards.map(([label, value, note, icon, trend]) => `
    <article class="metric-card">
      <div class="metric-top">
        <span class="metric-label">${label}</span>
        <span class="metric-icon"><i data-lucide="${icon}"></i></span>
      </div>
      <strong>${value}</strong>
      <small>${note}</small>
      <div class="metric-trend">${trend.map((point) => `<span style="height:${Math.max(point, 12)}%"></span>`).join('')}</div>
    </article>
  `).join('');

  els.resultTitle.textContent = state.mode === 'map' ? 'Dependency Map' : state.mode === 'list' ? 'Agent Directory' : 'Agent Fleet';
}

function renderTopAgents() {
  const top = [...agents].sort((a, b) => b.actions - a.actions).slice(0, 8);
  els.topAgents.innerHTML = top.map((agent, index) => `
    <button class="rank-row" type="button" data-agent="${agent.id}">
      <span class="rank-index">${index + 1}</span>
      <span>
        <strong>${agent.name}</strong>
        <span>${agent.role}</span>
      </span>
      <span class="impact">${agent.impact}</span>
    </button>
  `).join('');
}

function renderCoverage() {
  const rows = [
    ['Excellent', 12, 'green'],
    ['Good', 9, 'blue'],
    ['Fair', 4, 'amber'],
    ['Low', 3, 'red']
  ];

  els.coverageDonut.innerHTML = '<div><strong>28</strong><span>Active</span></div>';
  els.coverageLegend.innerHTML = rows.map(([label, value, color]) => `
    <div class="legend-row">
      <span class="legend-key"><span class="legend-dot" style="background:var(--${color})"></span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join('');
}

function renderAttention() {
  const items = agents.filter((agent) => agent.attention);
  els.attentionList.innerHTML = items.map((agent) => `
    <button class="attention-item" type="button" data-agent="${agent.id}">
      <span class="attention-reason">
        <strong>${agent.name}</strong>
        <span>${agent.attention}</span>
      </span>
      <span class="attention-severity">${agent.risk}</span>
    </button>
  `).join('');
}

function renderFleetActivity() {
  const entries = agents.flatMap((agent) => agent.activity.map((entry) => ({ agent, entry }))).slice(0, 8);
  els.fleetActivity.innerHTML = entries.map(({ agent, entry }) => `
    <div class="activity-item">
      <span class="event-dot" style="background:${colorFor(agent.color)}"></span>
      <span>
        <strong>${entry[1]}</strong>
        <span>${agent.name} - ${entry[0]} - ${entry[2]}</span>
      </span>
    </div>
  `).join('');
}

function renderAgentCard(agent, index = 0) {
  const statusClass = effectiveStatus(agent) === 'Degraded' ? 'warn' : effectiveStatus(agent) === 'Idle' ? 'idle' : '';
  const primaryWorkflows = agent.workflows.slice(0, 3);
  return `
    <article class="agent-card premium-agent-card" style="--agent-accent:${colorFor(agent.color)}" data-agent="${agent.id}" tabindex="0" role="button" aria-label="Open ${agent.name}">
      <span class="agent-card-index">${String(index + 1).padStart(2, '0')}</span>
      <div class="agent-card-head">
        <div class="agent-title">
          ${avatar(agent)}
          <div>
            <h3>${agent.name}</h3>
            <span>${agent.role}</span>
          </div>
        </div>
        <span class="status-badge ${statusClass}">${effectiveStatus(agent)}</span>
      </div>
      <p>${agent.description}</p>
      <div class="agent-telemetry">
        <span><small>Trust</small><strong>${agent.trust.toFixed(1)} / 5</strong></span>
        <span><small>Review</small><strong>${agent.review}%</strong></span>
        <span><small>Impact</small><strong>${agent.impact}</strong></span>
      </div>
      <div class="score-line">
        <span>${agent.model}</span>
        ${trustDots(agent.trust)}
      </div>
      <div class="workflow-fit">
        <span>Workflow fit</span>
        ${fitTrack(agent.fit)}
        <strong>${fitLabel(agent.fit)}</strong>
      </div>
      <div class="agent-path">
        ${primaryWorkflows.map((workflow) => `<span>${workflow}</span>`).join('')}
      </div>
      <div class="mini-spark">${agent.trend.slice(-10).map((point) => `<span style="height:${point}%"></span>`).join('')}</div>
    </article>
  `;
}

function renderListTable(items) {
  return `
    <div class="agent-list-table">
      <div class="list-row">
        <span>Agent</span><span>Status</span><span>Model</span><span>Trust</span><span>Impact</span><span>Review</span>
      </div>
      ${items.map((agent) => `
        <div class="list-row" data-agent="${agent.id}" role="button" tabindex="0">
          <span class="list-name">${avatar(agent)}<span><strong>${agent.name}</strong><span>${agent.role}</span></span></span>
          <span class="status-badge ${effectiveStatus(agent) === 'Degraded' ? 'warn' : effectiveStatus(agent) === 'Idle' ? 'idle' : ''}">${effectiveStatus(agent)}</span>
          <span>${agent.model}</span>
          <strong>${agent.trust.toFixed(1)} / 5</strong>
          <span>${agent.impact}</span>
          <span>${agent.review}%</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMap(items) {
  const positions = [
    [42, 245], [275, 90], [276, 245], [276, 400], [530, 70], [535, 245],
    [532, 420], [790, 100], [792, 245], [790, 390], [1010, 190], [1010, 340]
  ];
  const lines = positions.slice(1).map(([x, y], index) => {
    const [x1, y1] = positions[0];
    const dx = x - x1 + 88;
    const dy = y - y1 + 41;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    return `<span class="map-line" style="left:${x1 + 88}px;top:${y1 + 41}px;width:${len}px;transform:rotate(${angle}deg)"></span>`;
  }).join('');

  return `
    <div class="map-stage">
      ${lines}
      ${items.slice(0, 12).map((agent, index) => {
        const [x, y] = positions[index] || [42 + (index * 150) % 860, 180 + (index * 90) % 340];
        return `
          <button class="map-node" type="button" data-agent="${agent.id}" style="left:${x}px;top:${y}px">
            <strong>${agent.name}</strong>
            <span>${agent.role}</span>
            <span>${effectiveStatus(agent)} - Trust ${agent.trust.toFixed(1)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderProfile() {
  const agent = currentAgent();
  if (els.profileView.classList.contains('is-active')) {
    els.topbarContext.textContent = agent.name;
  }
  els.profileHero.innerHTML = renderProfileHero(agent);
  els.profilePanels.innerHTML = renderTab(agent, state.currentTab);
  bindProfileActions(agent);
  refreshIcons();
}

function renderProfileHero(agent) {
  const statusClass = effectiveStatus(agent) === 'Degraded' ? 'warn' : effectiveStatus(agent) === 'Idle' ? 'idle' : '';
  return `
    <div class="profile-hero-stage" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
    <div class="profile-copy">
      <div class="profile-emblem">
        ${avatar(agent)}
        <span class="profile-emblem-ring"></span>
      </div>
      <div>
        <span class="status-badge ${statusClass}">${effectiveStatus(agent)}</span>
        <h1 id="profileTitle">${agent.name}</h1>
        <p>${agent.headline}</p>
        <div class="profile-meta">
          <span><i data-lucide="briefcase"></i>${agent.role}</span>
          <span><i data-lucide="users"></i>${agent.team}</span>
          <span><i data-lucide="user-circle"></i>${agent.owner}</span>
          <span><i data-lucide="git-commit"></i>${agent.version}</span>
          <span><i data-lucide="calendar"></i>${agent.created}</span>
        </div>
      </div>
    </div>
    <div class="profile-side">
      <div class="profile-scoreplate" style="--score:${agent.trust}">
        <span>Trust Score</span>
        <strong>${agent.trust.toFixed(1)} / 5</strong>
        <div class="scoreplate-track"><span></span></div>
      </div>
      <div class="profile-command-metrics">
        <span><small>Review</small><strong>${agent.review}%</strong></span>
        <span><small>Workflow Fit</small><strong>${fitLabel(agent.fit)}</strong></span>
        <span><small>Risk</small><strong>${agent.risk}</strong></span>
      </div>
      <div class="profile-actions">
        <button class="secondary-action compact" type="button"><i data-lucide="pencil"></i><span>Edit</span></button>
        <button class="secondary-action compact" type="button"><i data-lucide="copy"></i><span>Duplicate</span></button>
        <button id="pauseAgent" class="secondary-action compact danger-action" type="button">
          <i data-lucide="${state.pausedAgents.has(agent.id) ? 'play' : 'pause'}"></i>
          <span>${state.pausedAgents.has(agent.id) ? 'Resume Agent' : 'Pause Agent'}</span>
        </button>
        <button class="primary-action compact" type="button"><i data-lucide="external-link"></i><span>Open in Workflow</span></button>
      </div>
    </div>
  `;
}

function renderTab(agent, tab) {
  if (tab === 'runtime') return renderRuntime(agent);
  if (tab === 'prompt') return renderPrompt(agent);
  if (tab === 'tools') return renderTools(agent);
  if (tab === 'memory') return renderMemory(agent);
  if (tab === 'governance') return renderGovernance(agent);
  if (tab === 'admin') return renderAdmin(agent);
  return renderOverview(agent);
}

function renderOverview(agent) {
  return `
    <div class="profile-grid">
      <section class="profile-panel">
        <h2>Overview</h2>
        <div class="definition-grid">
          ${definition('Primary Goal', agent.goal)}
          ${definition('Tone', agent.tone)}
          ${definition('Domains', agent.domains.join(', '))}
          ${definition('Risk Level', agent.risk)}
          ${definition('Model', agent.model)}
          ${definition('Prompt', agent.prompt)}
        </div>
      </section>
      <section class="profile-panel">
        <h2>Quality and Performance</h2>
        ${qualityGrid(agent)}
      </section>
      <section class="profile-panel">
        <h2>Workflow Footprint</h2>
        ${workflowFootprint(agent)}
      </section>
      <section class="profile-panel">
        <h2>Actions Over Time</h2>
        ${trendChart(agent)}
      </section>
      <section class="profile-panel">
        <h2>Recent Activity</h2>
        <div class="activity-stream">${agent.activity.map((entry) => activityItem(agent, entry)).join('')}</div>
      </section>
      <section class="profile-panel">
        <h2>Version History</h2>
        <div class="version-list">${agent.versions.map((version) => versionRow(version)).join('')}</div>
      </section>
    </div>
  `;
}

function renderRuntime(agent) {
  return `
    <div class="runtime-grid">
      <section class="profile-panel">
        <h2>Runtime Configuration</h2>
        <div class="settings-form">
          <label>Primary Provider<select><option>${providerFromModel(agent.model)}</option><option>Claude CLI</option><option>OpenAI API</option><option>Gemini API</option></select></label>
          <label>Primary Model<input value="${agent.model}" /></label>
          <label>Reasoning Effort<select><option>Extra High</option><option>High</option><option>Medium</option><option>Low</option></select></label>
          <label>Mode<select><option>Fallback enabled</option><option>Single model</option></select></label>
          <label>Fallback Model<input value="Claude Sonnet 4.6" /></label>
          <label>Timeout<input value="120000 ms" /></label>
        </div>
        <div class="admin-actions" style="margin-top:14px">
          <button class="secondary-action" type="button"><span>Discard</span></button>
          <button class="primary-action" type="button"><span>Save Runtime</span></button>
        </div>
      </section>
      <section class="profile-panel">
        <h2>Runtime Health</h2>
        <div class="runtime-summary">
          ${runtimeTile('Latency p95', agent.metrics.latency)}
          ${runtimeTile('Timeout Rate', agent.metrics.timeout)}
          ${runtimeTile('Saturation', agent.metrics.saturation)}
          ${runtimeTile('Last Updated', agent.updated)}
        </div>
      </section>
    </div>
  `;
}

function renderPrompt(agent) {
  const prompt = `You are ${agent.name}, the ${agent.role}.\n\nPrimary goal:\n${agent.goal}\n\nOperating style:\n${agent.tone}\n\nGuardrails:\n${agent.guardrails}\n\nWhen responding:\n- State the current case status.\n- Separate confirmed facts from assumptions.\n- Identify missing evidence.\n- Recommend the next best workflow action.\n- Keep handoff notes concise and usable by a human support owner.`;
  return `
    <div class="prompt-grid">
      <section class="profile-panel">
        <div class="prompt-toolbar">
          <h2>System Prompt</h2>
          <button class="primary-action compact" type="button"><i data-lucide="save"></i><span>Save Prompt</span></button>
        </div>
        <label class="prompt-label">Revision Note<input value="Tighten escalation evidence handling" /></label>
        <textarea class="prompt-editor">${prompt}</textarea>
      </section>
      <section class="profile-panel">
        <h2>Prompt Summary</h2>
        <div class="prompt-preview">${agent.promptSummary}</div>
        <h2 style="margin-top:16px">Versions</h2>
        <div class="version-list">${agent.versions.map((version) => versionRow(version)).join('')}</div>
      </section>
    </div>
  `;
}

function renderTools(agent) {
  return `
    <div class="tools-grid">
      <section class="profile-panel">
        <h2>Tools and Harness</h2>
        <div class="workflow-list">
          ${agent.tools.map((tool, index) => `
            <div class="tool-row">
              <span><strong>${tool}</strong><span>${['Knowledge Retrieval', 'Business Rules', 'Automation', 'Data Access'][index % 4]}</span></span>
              <span class="mini-status">${agent.health === 'Degraded' && index === 0 ? 'Degraded' : 'Healthy'}</span>
            </div>
          `).join('')}
        </div>
      </section>
      <section class="profile-panel">
        <h2>Connected Workflows</h2>
        <div class="workflow-list">
          ${agent.workflows.map((workflow, index) => `
            <div class="workflow-row">
              <span><strong>${workflow}</strong><span>${index === 0 ? 'Primary' : 'Connected'}</span></span>
              <span class="mini-status">${index + 2}m ago</span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderMemory(agent) {
  return `
    <div class="memory-grid">
      <section class="profile-panel">
        <h2>Continuity Notes</h2>
        <div class="workflow-list">
          ${agent.memory.map((note, index) => `
            <article class="memory-note">
              <strong>Memory ${index + 1}</strong>
              <p>${note}</p>
            </article>
          `).join('')}
        </div>
      </section>
      <section class="profile-panel">
        <h2>Agent Relationships</h2>
        <div class="workflow-list">
          ${agent.relationships.map(([name, detail]) => `
            <div class="workflow-row">
              <span><strong>${name}</strong><span>${detail}</span></span>
              <span class="mini-status">Mapped</span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderGovernance(agent) {
  const rows = [
    ['Human Review', `${agent.review}%`, '7d sample'],
    ['Automated Eval', `${Math.min(agent.review + 3, 99)}%`, '7d sample'],
    ['Guardrails', agent.risk === 'High' ? '3 Active' : '2 Active', agent.guardrails],
    ['Data Handling', agent.domains.includes('Images') ? 'Image Evidence' : 'PII Redacted', 'Applied'],
    ['Audit Log', 'Clean', 'Last checked 2m ago']
  ];
  return `
    <div class="governance-grid">
      <section class="profile-panel">
        <h2>Review Status</h2>
        <div class="review-bars">
          <div><span>Human Review</span><strong>${agent.review}%</strong><meter min="0" max="100" value="${agent.review}"></meter></div>
          <div><span>Automated Eval</span><strong>${Math.min(agent.review + 3, 99)}%</strong><meter min="0" max="100" value="${Math.min(agent.review + 3, 99)}"></meter></div>
          <div><span>Prompt Drift</span><strong>${100 - agent.review}%</strong><meter min="0" max="100" value="${100 - agent.review}"></meter></div>
        </div>
      </section>
      <section class="profile-panel">
        <h2>Governance</h2>
        <div class="governance-list">
          ${rows.map(([label, value, note]) => `
            <div class="governance-row">
              <span><strong>${label}</strong><span>${note}</span></span>
              <span class="mini-status">${value}</span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderAdmin(agent) {
  return `
    <div class="admin-grid">
      <section class="profile-panel">
        <h2>Edit Profile</h2>
        <div class="settings-form">
          <label>Display Name<input value="${agent.name}" /></label>
          <label>Role<input value="${agent.role}" /></label>
          <label>Owner<input value="${agent.owner}" /></label>
          <label>Risk Level<select><option>${agent.risk}</option><option>Low</option><option>Medium</option><option>High</option></select></label>
          <label style="grid-column:1 / -1">Headline<textarea>${agent.headline}</textarea></label>
          <label style="grid-column:1 / -1">Guardrails<textarea>${agent.guardrails}</textarea></label>
        </div>
        <div class="admin-actions" style="margin-top:14px">
          <button class="secondary-action" type="button"><span>Discard</span></button>
          <button class="primary-action" type="button"><span>Save Profile</span></button>
        </div>
      </section>
      <section class="profile-panel">
        <h2>Administrative State</h2>
        <div class="runtime-summary">
          ${runtimeTile('Agent ID', agent.id)}
          ${runtimeTile('Prompt ID', agent.prompt)}
          ${runtimeTile('Version', agent.version)}
          ${runtimeTile('Last Updated', agent.updated)}
        </div>
      </section>
    </div>
  `;
}

function bindAgentOpeners() {
  document.querySelectorAll('[data-agent]').forEach((element) => {
    element.addEventListener('click', () => openAgent(element.dataset.agent));
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openAgent(element.dataset.agent);
      }
    });
  });
}

function bindProfileActions(agent) {
  const pause = document.getElementById('pauseAgent');
  if (!pause) return;
  pause.addEventListener('click', () => {
    if (state.pausedAgents.has(agent.id)) state.pausedAgents.delete(agent.id);
    else state.pausedAgents.add(agent.id);
    renderProfile();
    renderFleet();
  });
}

function openAgent(agentId) {
  state.currentAgentId = agentId;
  state.currentTab = 'overview';
  document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('is-active', item.dataset.tab === 'overview'));
  els.fleetView.classList.remove('is-active');
  els.profileView.classList.add('is-active');
  renderProfile();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showFleet() {
  els.profileView.classList.remove('is-active');
  els.fleetView.classList.add('is-active');
  els.topbarContext.textContent = 'Agent Mission Control';
  renderFleet();
}

function getFilteredAgents() {
  return agents.filter((agent) => {
    const text = [agent.name, agent.role, agent.team, agent.model, agent.prompt, agent.tools.join(' '), agent.workflows.join(' ')].join(' ').toLowerCase();
    if (state.search && !text.includes(state.search)) return false;
    if (state.role !== 'all' && agent.role !== state.role) return false;
    if (state.model !== 'all' && agent.model !== state.model) return false;
    if (state.status !== 'all' && effectiveStatus(agent) !== state.status) return false;
    return true;
  });
}

function currentAgent() {
  return agents.find((agent) => agent.id === state.currentAgentId) || agents[0];
}

function effectiveStatus(agent) {
  if (state.pausedAgents.has(agent.id)) return 'Idle';
  if (agent.health === 'Degraded') return 'Degraded';
  return agent.status;
}

function avatar(agent) {
  return `<span class="agent-avatar" style="background:${gradientFor(agent.color)}"><i data-lucide="activity"></i><span class="avatar-fallback">${agent.initials}</span></span>`;
}

function trustDots(value) {
  const full = Math.round(value);
  return `<span class="trust-dots" aria-label="Trust ${value}">${Array.from({ length: 5 }, (_, index) => `<span class="${index < full ? 'on' : ''}"></span>`).join('')}</span>`;
}

function fitTrack(value) {
  return `<span class="fit-track">${Array.from({ length: 10 }, (_, index) => `<span class="${index < value ? 'on' : ''}"></span>`).join('')}</span>`;
}

function fitLabel(value) {
  if (value >= 9) return 'Excellent';
  if (value >= 7) return 'Good';
  if (value >= 5) return 'Fair';
  return 'Low';
}

function definition(label, value) {
  return `<div class="definition"><span>${label}</span><strong>${value}</strong></div>`;
}

function qualityGrid(agent) {
  const cards = [
    ['Resolution Accuracy', `${agent.metrics.resolution}%`, '+4.3%'],
    ['First Response Accuracy', `${agent.metrics.firstResponse}%`, '+3.1%'],
    ['Escalation Rate', `${agent.metrics.escalation}%`, '-1.3%'],
    ['Customer CSAT', `${agent.metrics.csat} / 5`, '+0.2']
  ];
  return `<div class="quality-grid">${cards.map(([label, value, trend]) => `
    <div class="quality-card"><span>${label}</span><strong>${value}</strong><small>${trend}</small></div>
  `).join('')}</div>`;
}

function workflowFootprint(agent) {
  const left = agent.workflows.slice(0, 3);
  const right = agent.tools.slice(0, 3);
  return `
    <div class="workflow-footprint">
      <div class="flow-column">${left.map((item) => `<div class="flow-node"><span>${item}</span><i data-lucide="arrow-right"></i></div>`).join('')}</div>
      <div class="flow-center">${avatar(agent)}<strong>${agent.name}</strong></div>
      <div class="flow-column">${right.map((item) => `<div class="flow-node"><i data-lucide="arrow-right"></i><span>${item}</span></div>`).join('')}</div>
    </div>
  `;
}

function trendChart(agent) {
  return `<div class="trend-chart">${agent.trend.map((point, index) => `
    <div class="trend-stack">
      <span class="trend-bar" style="height:${point}%;background:${index % 3 === 0 ? 'var(--green)' : index % 3 === 1 ? 'var(--blue)' : 'var(--violet)'}"></span>
    </div>
  `).join('')}</div>`;
}

function activityItem(agent, entry) {
  return `
    <div class="activity-item">
      <span class="event-dot" style="background:${colorFor(agent.color)}"></span>
      <span><strong>${entry[1]}</strong><span>${entry[0]} - ${entry[2]}</span></span>
    </div>
  `;
}

function versionRow(version) {
  return `
    <div class="version-row">
      <span><strong>${version[0]} <span class="tag">${version[1]}</span></strong><span>${version[2]} - ${version[3]}</span></span>
      <span class="mini-status">View</span>
    </div>
  `;
}

function runtimeTile(label, value) {
  return `<div class="runtime-tile"><span>${label}</span><strong>${value}</strong></div>`;
}

function providerFromModel(model) {
  if (model.includes('Claude')) return 'Claude CLI';
  if (model.includes('OpenAI')) return 'OpenAI API';
  if (model.includes('Gemini')) return 'Gemini API';
  return 'Codex CLI';
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function avg(values) {
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(values.length, 1);
}

function gradientFor(color) {
  const gradients = {
    blue: 'linear-gradient(145deg, #2f8cff, #25d0ff)',
    violet: 'linear-gradient(145deg, #7c5cff, #a66cff)',
    green: 'linear-gradient(145deg, #16a86d, #2fe27d)',
    pink: 'linear-gradient(145deg, #f062b6, #a66cff)',
    cyan: 'linear-gradient(145deg, #18b6d9, #2f8cff)',
    amber: 'linear-gradient(145deg, #ff9d2f, #ff5d5d)'
  };
  return gradients[color] || gradients.blue;
}

function colorFor(color) {
  const colors = {
    blue: 'var(--blue)',
    violet: 'var(--violet)',
    green: 'var(--green)',
    pink: 'var(--pink)',
    cyan: 'var(--cyan)',
    amber: 'var(--amber)'
  };
  return colors[color] || 'var(--blue)';
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
  }
}

function initNetworkCanvas() {
  const canvas = document.getElementById('networkCanvas');
  const ctx = canvas.getContext('2d');
  const points = Array.from({ length: 52 }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0008,
    vy: (Math.random() - 0.5) * 0.0008,
    r: 1 + Math.random() * 1.7
  }));

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function tick() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    points.forEach((point) => {
      point.x += point.vx;
      point.y += point.vy;
      if (point.x < 0 || point.x > 1) point.vx *= -1;
      if (point.y < 0 || point.y > 1) point.vy *= -1;
    });

    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        const ax = a.x * width;
        const ay = a.y * height;
        const bx = b.x * width;
        const by = b.y * height;
        const distance = Math.hypot(ax - bx, ay - by);
        if (distance < 170) {
          ctx.strokeStyle = `rgba(47, 140, 255, ${0.22 * (1 - distance / 170)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
    }

    points.forEach((point, index) => {
      ctx.fillStyle = index % 9 === 0 ? 'rgba(166, 108, 255, 0.9)' : 'rgba(37, 208, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, point.r, 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  resize();
  tick();
}
