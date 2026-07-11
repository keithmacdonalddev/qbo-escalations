const levels = ['mvp', 'ready', 'enterprise'];

const levelDetails = {
  mvp: {
    label: 'MVP outcome',
    title: 'A dependable memory for work.',
    description: 'One searchable home replaces scattered chats, files, and sticky notes. Work can be captured, classified, assigned, and found again.',
    boundary: 'It records and organizes work, but it does not yet guarantee follow-through or provide a polished customer experience.',
    metrics: [['1 home', 'for every project'], ['7 types', 'of tracked work'], ['Clear owner', 'for active items'], ['Basic proof', 'for closure']],
  },
  ready: {
    label: 'User-ready outcome',
    title: 'A complete, accountable resolution loop.',
    description: 'Customers, you, and trusted agents can report work easily. Reminders, approvals, evidence, and validation keep accepted work moving to a proven result.',
    boundary: 'Built for your projects and customers—not yet burdened by large-company identity, compliance, and global-scale operations.',
    metrics: [['Easy intake', 'for customers'], ['Stall alerts', 'for accountability'], ['Agent team', 'with approvals'], ['Verified', 'customer outcomes']],
  },
  enterprise: {
    label: 'Enterprise outcome',
    title: 'Governed operational intelligence at scale.',
    description: 'Many organizations safely coordinate human and agent work across projects, regions, and regulated environments—with predictive insight and formal service guarantees.',
    boundary: 'This is a long-term destination. Its controls and operating cost are unnecessary for the initial single-owner product.',
    metrics: [['Multi-org', 'strong isolation'], ['Global', 'resilient operation'], ['Governed AI', 'measured autonomy'], ['Predictive', 'portfolio insight']],
  },
};

const categories = [
  {
    id: 'capture', icon: '↳', title: 'Capture & intake', subtitle: 'Get every important signal into one trusted home',
    features: {
      mvp: ['Manual creation for bugs, features, tasks, maintenance, incidents, ideas, and decisions', 'Quick-capture form with title and plain-language description', 'Project and product-area selection', 'Source link back to the originating chat, note, file, or page', 'Attachments for screenshots, documents, and supporting evidence', 'Friendly ticket number plus permanent unique ID', 'Basic required-field checks before submission'],
      ready: ['Customer Feedback widget with Problem, Feature, and General Feedback choices', 'Automatic page URL, title, project, module, version, time, and timezone capture', 'Signed-in user identity taken securely from the login session', 'Browser, operating system, device, language, and screen context', 'Permission-based diagnostic bundle with a customer preview', 'Email, chat, markdown, and agent-discovery intake channels', 'Draft recovery so an interrupted report is not lost', 'Project-specific intake questions without separate reporting systems'],
      enterprise: ['White-label and embeddable intake experiences for many organizations', 'Omnichannel intake from support, voice, social, app stores, and external portals', 'Regional intake routing and data-residency enforcement', 'Adaptive forms driven by organization policy and report context', 'High-volume automated ingestion with quality and abuse controls'],
    },
  },
  {
    id: 'organization', icon: '⌘', title: 'Organization & discovery', subtitle: 'Turn a pile of reports into an understandable work system',
    features: {
      mvp: ['Shared cross-project inbox', 'Type, project, status, priority, owner, and tag filters', 'Full-text search across items, notes, and decisions', 'Saved views for open, blocked, waiting, and recently changed work', 'Relationships for duplicate, related, blocks, depends on, and fixed by', 'Simple project dashboard with counts by status', 'Archive without deleting history'],
      ready: ['Custom views for each project and agent responsibility', 'Cross-project duplicate suggestions with human confirmation', 'Parent initiatives and smaller linked work items', 'Reusable labels with project-specific extensions', 'Personal queue showing only what needs your attention', 'Natural-language search and plain-English summaries', 'Related customer reports grouped under one confirmed problem', 'Bulk triage and safe batch changes with preview'],
      enterprise: ['Organization-wide portfolio hierarchy and dependency maps', 'Federated search across permitted business systems', 'Semantic clustering of emerging themes at very large scale', 'Custom taxonomies with centrally governed definitions', 'Data warehouse and business-intelligence synchronization', 'Policy-controlled retention tiers and legal holds'],
    },
  },
  {
    id: 'workflow', icon: '→', title: 'Workflow & accountability', subtitle: 'Make the next responsible action impossible to miss',
    features: {
      mvp: ['Simple lifecycle from New through Active to Closed', 'Named human or agent owner', 'Priority and severity tracked separately', 'Next-action field on every active item', 'Target or follow-up date', 'Blocked status with a recorded reason', 'Comments and progress timeline'],
      ready: ['Different lifecycle rules for bugs, features, incidents, ideas, and decisions', 'Automatic reminders for overdue follow-ups', 'Stalled-work detection when no meaningful progress occurs', 'Waiting-on-you and waiting-on-agent queues', 'Handoffs that require the receiving owner to acknowledge responsibility', 'Service targets for response and resolution', 'Escalation rules for important stalled or repeatedly reopened work', 'Recurring review rhythm with daily and weekly briefings'],
      enterprise: ['Visual workflow builder with guarded organization templates', 'Follow-the-sun assignment across regions and support teams', 'Workload-aware routing based on skills, availability, and risk', 'Contract-specific response and resolution commitments', 'Cross-organization dependencies with controlled visibility', 'Process mining to reveal hidden delay and rework patterns'],
    },
  },
  {
    id: 'evidence', icon: '◉', title: 'Evidence & technical context', subtitle: 'Preserve what happened without confusing facts and guesses',
    features: {
      mvp: ['Expected behavior and observed behavior recorded separately', 'Reproduction steps and environment notes', 'Screenshot and file evidence', 'Links to relevant commits, tests, documents, and conversations', 'Evidence author and timestamp', 'Basic resolution summary'],
      ready: ['Request, session, trace, workflow-run, and release identifiers', 'Recent permitted errors and user actions captured with the report', 'Secret removal and sensitive-field masking before upload', 'Evidence labels for observed fact, assumption, hypothesis, and recommendation', 'Immutable decision and status history', 'Incident evidence capsule preserving the failure context', 'Evidence completeness check before closure', 'Side-by-side comparison of original problem and validated result'],
      enterprise: ['Tamper-evident evidence chain and cryptographic verification', 'Forensic export packages for legal, security, and compliance review', 'Configurable legal hold and evidence retention by jurisdiction', 'Automated evidence lineage across connected enterprise systems', 'Advanced privacy classification and loss-prevention scanning', 'Customer-managed encryption keys for protected evidence'],
    },
  },
  {
    id: 'agents', icon: '✦', title: 'Agent teamwork & automation', subtitle: 'Let agents move work forward without losing human control',
    features: {
      mvp: ['API access for agents to create and read permitted items', 'Agent identity recorded on every action', 'Agent-created items clearly labeled', 'Human confirmation before an agent-discovered claim becomes a confirmed bug', 'Basic agent progress notes'],
      ready: ['Specialist intake, evidence, duplicate, triage, product, and validation agents', 'Agent proposals separated from approved decisions', 'Risk-based approval before important status or priority changes', 'Explicit action permissions for each agent', 'Automatic creation of low-risk work by trusted agents', 'Agent handoffs with context, evidence, open questions, and next action', 'Agent performance review based on accepted results—not activity volume', 'Coordinator agent that identifies blocked, abandoned, and decision-ready work'],
      enterprise: ['Governed multi-agent orchestration across organizations', 'Policy simulation before changing agent authority', 'Measured autonomy levels that expand or contract from proven performance', 'Independent agent review for high-risk decisions', 'Model and provider routing based on evidence sensitivity and task risk', 'AI action replay, rollback support, and formal audit export', 'Continuous regression evaluation against approved historical cases'],
    },
  },
  {
    id: 'decisions', icon: '◇', title: 'Ideas, features & decisions', subtitle: 'Preserve why work was accepted, deferred, changed, or rejected',
    features: {
      mvp: ['Idea backlog separate from committed work', 'Feature request with user goal and expected value', 'Decision record with outcome and explanation', 'Accepted, rejected, deferred, and duplicate dispositions', 'Links from decisions to resulting work'],
      ready: ['Alternative options and tradeoffs preserved with each decision', 'Reconsideration date for temporary or uncertain decisions', 'Customer demand grouped without turning votes into automatic priority', 'Feature discovery notes, supporting evidence, and success measure', 'Promotion path from idea to explored concept to accepted feature', 'Release notes connected back to the original request', 'Reporter notification when a decision or result changes'],
      enterprise: ['Decision authority matrix by cost, risk, domain, and organization', 'Portfolio scenario modeling before major investment decisions', 'Market, customer, operational, and financial evidence connected to proposals', 'Decision-quality analysis comparing expected and actual outcomes', 'Formal review boards and regulated approval chains', 'Cross-portfolio capacity and investment optimization'],
    },
  },
  {
    id: 'incidents', icon: '⚑', title: 'Incidents & reliability', subtitle: 'Respond quickly, learn honestly, and prevent repeat failures',
    features: {
      mvp: ['Incident type and impact level', 'Active incident status and named owner', 'Event timeline', 'Links to affected projects and related bugs', 'Resolution and follow-up tasks'],
      ready: ['Dedicated incident command view', 'Automatic stakeholder and customer updates', 'Service-health connection and affected-version detection', 'Evidence-preserving incident capsule', 'Plain-language explanation of what can and cannot be proven', 'Blameless review with contributing factors and prevention actions', 'Follow-up work tracked until independently verified', 'Recurring-incident and shared-cause detection'],
      enterprise: ['Global on-call schedules and automated escalation', 'Multi-region incident coordination and communications', 'Formal reliability targets and error-budget management', 'Automated failover evidence and disaster-recovery exercises', 'Security incident segregation and regulated notification workflows', 'Reliability trend forecasting and systemic-risk modeling'],
    },
  },
  {
    id: 'validation', icon: '✓', title: 'Validation & closure', subtitle: 'Make done mean that the original problem was actually solved',
    features: {
      mvp: ['Resolution category and closing note', 'Required proof link for completed work', 'Reopen with a reason', 'Closed date and closing actor'],
      ready: ['Definition of success recorded before work begins', 'Completion claim checked against named tests or file evidence', 'Separate code-complete, released, and user-validated states', 'Reporter confirmation or documented reason it could not be obtained', 'Independent validation for high-risk changes', 'Automatic reopening when monitored symptoms return', 'Outcome review capturing what worked, failed, and should be reused', 'Knowledge candidate created from a validated reusable lesson'],
      enterprise: ['Policy-driven acceptance gates by risk and regulated domain', 'Statistically reliable rollout and experiment validation', 'Continuous post-release outcome monitoring', 'Formal electronic approvals and separation of duties', 'Customer-specific validation and release certification', 'Automated control testing with audit-ready proof'],
    },
  },
  {
    id: 'communication', icon: '◌', title: 'Communication & customer trust', subtitle: 'Keep people informed without exposing internal noise',
    features: {
      mvp: ['Internal comments and mentions', 'Basic email notification for assignment and status change', 'Reporter contact preference', 'Public-safe summary separate from internal notes'],
      ready: ['Customer ticket page with current status and replies', 'Automatic acknowledgment with friendly ticket number', 'Plain-language progress updates', 'Subscriber and watcher controls', 'Reusable but editable response templates', 'Status page connection for active incidents', 'Customer satisfaction and outcome feedback', 'Accessible and mobile-friendly reporting experience'],
      enterprise: ['Branded customer portals per organization', 'Multilingual reporting, translation, and communication review', 'Approval-controlled mass incident communications', 'Customer-specific visibility and confidentiality agreements', 'Communication analytics across regions and products', 'Contact-center and customer-success platform integrations'],
    },
  },
  {
    id: 'insight', icon: '⌁', title: 'Insight & portfolio intelligence', subtitle: 'Use the work history to improve judgment across every project',
    features: {
      mvp: ['Counts by project, type, status, priority, and owner', 'Open and recently completed work summaries', 'Basic aging view showing how long work has been open', 'Export to a common file format'],
      ready: ['Cross-project health and stalled-work dashboard', 'Trends for incoming, completed, reopened, and overdue work', 'Repeated-symptom and emerging-pattern detection', 'Time-to-first-response and time-to-verified-resolution measures', 'Workload and bottleneck view by owner and project', 'Feature demand connected to customer goals', 'Decision backlog and unresolved-risk overview', 'Weekly agent-prepared operational briefing'],
      enterprise: ['Predictive delivery, incident, and capacity risk models', 'Cross-portfolio investment and opportunity analysis', 'Leading indicators for quality and customer-impact deterioration', 'Causal analysis distinguishing correlation from supported cause', 'Executive and board reporting with drill-down evidence', 'Benchmarking across products, organizations, and operating periods', 'What-if simulation for staffing, release, and priority changes'],
    },
  },
  {
    id: 'integration', icon: '∞', title: 'Integration & developer platform', subtitle: 'Connect every project without rebuilding the tracker inside it',
    features: {
      mvp: ['One central API with a separate project identity', 'Project-scoped credentials', 'Create, read, update, comment, and attach operations', 'Links to repository work and releases', 'Simple reusable JavaScript connector'],
      ready: ['Maintained connectors for web, desktop, and server projects', 'Event notifications for report and status changes', 'Repository, chat, email, monitoring, and deployment integrations', 'Safe retry and offline queue for interrupted submissions', 'Versioned API with clear compatibility rules', 'Integration health view and delivery-failure alerts', 'Import assistant for chats, markdown, text files, and existing trackers'],
      enterprise: ['High-availability regional API gateways', 'Guaranteed integration service levels and version support', 'Enterprise event streaming and bulk data interfaces', 'Integration marketplace with reviewed third-party apps', 'Fine-grained API permissions, usage quotas, and anomaly detection', 'Migration tooling for large external tracker portfolios'],
    },
  },
  {
    id: 'security', icon: '⬡', title: 'Security, governance & operations', subtitle: 'Protect trust as users, agents, and organizations grow',
    features: {
      mvp: ['Signed-in access', 'Project-level read and write permissions', 'Private-by-default internal items', 'Basic backup and restore', 'Action history for status, assignment, and content changes'],
      ready: ['Human and agent roles with explicit permissions', 'Sensitive attachment controls and redaction', 'Session and credential security controls', 'Configurable retention for ordinary and sensitive reports', 'Administrative audit view', 'Automated backups with tested restoration', 'Rate limiting and abuse protection for public reporting', 'Health checks and visible integration diagnostics'],
      enterprise: ['Strongly isolated data for many organizations', 'Corporate single sign-on and automated user provisioning', 'Fine-grained permission policies and delegated administration', 'Compliance programs, audit reports, and control evidence', 'Regional data residency and cross-border transfer controls', 'Customer-managed encryption and key rotation', 'Legal discovery, retention, and deletion workflows', 'Global resilience, disaster recovery, and formal availability commitments', 'Security monitoring center integration and threat response', 'Administrative policy inheritance across large organizations'],
    },
  },
];

const levelLabels = { mvp: 'Foundation', ready: 'User-ready', enterprise: 'Enterprise' };
let activeLevel = 'mvp';

const elements = {
  levelCards: [...document.querySelectorAll('.level-card')],
  storyLabel: document.getElementById('storyLabel'),
  storyTitle: document.getElementById('storyTitle'),
  storyDescription: document.getElementById('storyDescription'),
  storyBoundary: document.getElementById('storyBoundary'),
  storyMetrics: document.getElementById('storyMetrics'),
  search: document.getElementById('featureSearch'),
  category: document.getElementById('categoryFilter'),
  newOnly: document.getElementById('newOnlyToggle'),
  grid: document.getElementById('featureGrid'),
  count: document.getElementById('visibleFeatureCount'),
  empty: document.getElementById('emptyState'),
  clear: document.getElementById('clearFilters'),
};

function cumulativeLevels(level) {
  return levels.slice(0, levels.indexOf(level) + 1);
}

function levelCount(level) {
  return categories.reduce((total, category) => {
    return total + cumulativeLevels(level).reduce((sum, featureLevel) => sum + category.features[featureLevel].length, 0);
  }, 0);
}

function setStory(level) {
  const detail = levelDetails[level];
  elements.storyLabel.textContent = detail.label;
  elements.storyTitle.textContent = detail.title;
  elements.storyDescription.textContent = detail.description;
  elements.storyBoundary.textContent = detail.boundary;
  elements.storyMetrics.innerHTML = detail.metrics
    .map(([value, label]) => `<div class="story-metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join('');
}

function renderFeatures() {
  const query = elements.search.value.trim().toLowerCase();
  const categoryId = elements.category.value;
  const visibleLevels = elements.newOnly.checked ? [activeLevel] : cumulativeLevels(activeLevel);
  let visibleCount = 0;

  const categoryMarkup = categories.map((category, index) => {
    if (categoryId !== 'all' && category.id !== categoryId) return '';

    const matchingFeatures = visibleLevels.flatMap((level) => {
      return category.features[level]
        .filter((feature) => !query || `${feature} ${category.title} ${category.subtitle}`.toLowerCase().includes(query))
        .map((feature) => ({ feature, level }));
    });

    if (!matchingFeatures.length) return '';
    visibleCount += matchingFeatures.length;

    const features = matchingFeatures.map(({ feature, level }) => `
      <li class="feature-item" data-level="${level}">
        <i aria-hidden="true"></i>
        <span>${feature}</span>
        <span class="feature-badge">${levelLabels[level]}</span>
      </li>`).join('');

    return `
      <article class="feature-category" style="animation-delay:${Math.min(index * 35, 280)}ms">
        <header class="category-header">
          <span class="category-icon" aria-hidden="true">${category.icon}</span>
          <div class="category-title"><strong>${category.title}</strong><span>${category.subtitle}</span></div>
          <span class="category-count">${matchingFeatures.length} shown</span>
        </header>
        <ul class="feature-list">${features}</ul>
      </article>`;
  }).join('');

  elements.grid.innerHTML = categoryMarkup;
  elements.count.textContent = visibleCount;
  elements.empty.hidden = visibleCount !== 0;
  elements.grid.hidden = visibleCount === 0;
}

function selectLevel(level) {
  activeLevel = level;
  elements.levelCards.forEach((card) => {
    const selected = card.dataset.level === level;
    card.classList.toggle('is-active', selected);
    card.setAttribute('aria-selected', String(selected));
  });
  setStory(level);
  renderFeatures();
}

categories.forEach((category) => {
  const option = document.createElement('option');
  option.value = category.id;
  option.textContent = category.title;
  elements.category.append(option);
});

levels.forEach((level) => {
  document.querySelector(`[data-count="${level}"]`).textContent = levelCount(level);
});

elements.levelCards.forEach((card) => card.addEventListener('click', () => selectLevel(card.dataset.level)));
elements.search.addEventListener('input', renderFeatures);
elements.category.addEventListener('change', renderFeatures);
elements.newOnly.addEventListener('change', renderFeatures);
elements.clear.addEventListener('click', () => {
  elements.search.value = '';
  elements.category.value = 'all';
  elements.newOnly.checked = false;
  renderFeatures();
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== elements.search) {
    event.preventDefault();
    elements.search.focus();
  }
  if (event.key === 'Escape' && document.activeElement === elements.search) {
    elements.search.value = '';
    elements.search.blur();
    renderFeatures();
  }
});

document.querySelectorAll('.report-options button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.report-options button').forEach((item) => item.removeAttribute('aria-pressed'));
    button.setAttribute('aria-pressed', 'true');
  });
});

setStory(activeLevel);
renderFeatures();
