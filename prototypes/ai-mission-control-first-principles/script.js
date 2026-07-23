const agents = {
  parser: {
    name: 'Image Parser', stage: 'Stage 1 · Extraction', purpose: 'Turns QBO screenshots into reliable case facts.', glyph: '⌗', tone: 'blue', health: 'Ready',
    summary: 'Image Parser extracts only what the screenshot shows.', detail: 'It cannot publish knowledge or decide the resolution. If required fields fail validation, the workflow stops before triage.',
    owns: ['Transcribe visible case details', 'Return the required QBO case format', 'Flag missing or unreadable fields'],
    denies: ['Troubleshoot the case', 'Guess hidden identifiers', 'Publish or approve knowledge'],
    provider: 'Gemini API', model: 'Gemini 3.6 Flash', fallback: 'Anthropic API · Claude Sonnet 5', quality: '98%', evidence: 'Images, parsed fields, validation, provider identity'
  },
  inv: {
    name: 'INV Search', stage: 'Stage 2A · Investigation', purpose: 'Checks active investigations before the case is triaged.', glyph: '⌕', tone: 'violet', health: 'Ready',
    summary: 'INV Search checks whether the symptoms match a known issue.', detail: 'It must show why a candidate matched or was rejected. A weak similarity is not treated as confirmation.',
    owns: ['Search active investigations', 'Compare symptoms and scope', 'Explain match or rejection'],
    denies: ['Create an investigation', 'Treat similarity as proof', 'Change the case severity'],
    provider: 'Anthropic API', model: 'Claude Sonnet 5', fallback: 'OpenAI API · GPT-5.6 Terra', quality: '93%', evidence: 'Queries, candidates, rejection reasons, selected match'
  },
  triage: {
    name: 'Triage', stage: 'Stage 2B · Assessment', purpose: 'Sets urgency, category, missing information, and the immediate next step.', glyph: '◇', tone: 'amber', health: 'Ready',
    summary: 'Triage turns case facts into a clear first decision.', detail: 'It separates what is known from what still needs confirmation and avoids writing the final customer response.',
    owns: ['Assign category and urgency', 'Identify missing information', 'Recommend the immediate next step'],
    denies: ['Invent missing evidence', 'Give the final resolution', 'Publish reusable knowledge'],
    provider: 'OpenAI API', model: 'GPT-5.6 Terra', fallback: 'Anthropic API · Claude Sonnet 5', quality: '95%', evidence: 'Case input, triage card, fallback path, human review'
  },
  analyst: {
    name: 'QBO Analyst', stage: 'Stage 3 · Resolution', purpose: 'Builds the evidence-grounded troubleshooting answer.', glyph: '✦', tone: 'teal', health: 'Change pending',
    summary: 'QBO Analyst combines the specialist handoffs into a useful answer.', detail: 'It may inspect trusted knowledge and shared tools, but you remain responsible for validating the real QBO outcome.',
    owns: ['Synthesize specialist findings', 'Use relevant trusted knowledge', 'Recommend the next action'],
    denies: ['Present assumptions as facts', 'Use draft or unsafe knowledge', 'Claim an external action succeeded without a receipt'],
    provider: 'Anthropic API', model: 'Claude Sonnet 5', fallback: 'OpenAI API · GPT-5.6 Terra', quality: '92%', evidence: 'Sources, cited knowledge, answer, usage, provider trace'
  },
  knowledge: {
    name: 'Knowledge Curator', stage: 'After resolution · Learning', purpose: 'Prepares a reviewable lesson from a finished case.', glyph: '▤', tone: 'green', health: 'Ready',
    summary: 'Knowledge Curator proposes what may be reusable after a case is resolved.', detail: 'It creates a draft only. A human must review evidence, scope, safety, and publication.',
    owns: ['Summarize the confirmed outcome', 'Identify reusable scope', 'Flag contradictions and weak evidence'],
    denies: ['Publish without review', 'Promote unresolved guesses', 'Remove source evidence'],
    provider: 'Anthropic API', model: 'Claude Sonnet 5', fallback: 'OpenAI API · GPT-5.6 Terra', quality: '91%', evidence: 'Resolved case, source links, draft changes, reviewer decision'
  }
};

const views = [...document.querySelectorAll('.view')];
const navLinks = [...document.querySelectorAll('[data-view]')];
const sideNav = document.querySelector('.side-nav');
const toast = document.getElementById('toast');
let toastTimer;
let activeAgent = 'parser';
let activeProfileTab = 'mission';

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function switchView(viewId) {
  views.forEach(view => view.classList.toggle('active', view.id === `view-${viewId}`));
  navLinks.forEach(link => link.classList.toggle('active', link.dataset.view === viewId));
  const current = document.getElementById(`view-${viewId}`);
  document.getElementById('currentCrumb').textContent = current?.dataset.title || 'Overview';
  sideNav.classList.remove('open');
  document.querySelector('.mobile-menu').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navLinks.forEach(link => link.addEventListener('click', () => switchView(link.dataset.view)));
document.querySelectorAll('[data-view-target]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.viewTarget)));
document.querySelector('.mobile-menu').addEventListener('click', event => {
  const open = sideNav.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('[data-app-route]').forEach(button => button.addEventListener('click', () => showToast(`${button.textContent.trim()} is outside this prototype.`)));

function chooseWorkflowAgent(id) {
  const agent = agents[id];
  if (!agent) return;
  document.querySelectorAll('.agent-node').forEach(node => node.classList.toggle('selected', node.dataset.agent === id));
  document.getElementById('agentSummary').innerHTML = `
    <span class="agent-glyph ${agent.tone} large">${agent.glyph}</span>
    <div><p class="eyebrow">Selected responsibility</p><h3>${agent.summary}</h3><p>${agent.detail}</p></div>
    <button class="button secondary small" type="button" data-open-agent="${id}">Open profile</button>`;
  document.querySelector('#agentSummary [data-open-agent]').addEventListener('click', () => openAgent(id));
}
document.querySelectorAll('.agent-node').forEach(node => node.addEventListener('click', () => chooseWorkflowAgent(node.dataset.agent)));

function missionMarkup(agent) {
  return `
    <section class="mission-statement"><p class="eyebrow">Mission</p><h3>${agent.summary}</h3><p>${agent.detail}</p></section>
    <div class="profile-two-col">
      <section class="inner-card"><h3>Responsible for</h3><ul class="boundary-list">${agent.owns.map(item => `<li>${item}</li>`).join('')}</ul></section>
      <section class="inner-card"><h3>Not allowed to</h3><ul class="boundary-list deny">${agent.denies.map(item => `<li>${item}</li>`).join('')}</ul></section>
    </div>
    <section class="inner-card" style="margin-top:14px"><h3>Handoff contract</h3><div class="handoff-row"><span><small>Receives</small><strong>Case evidence</strong></span><span><small>Produces</small><strong>Structured handoff</strong></span><span><small>Human validates</small><strong>Truth and risk</strong></span></div></section>`;
}

function runtimeMarkup(agent) {
  return `<section class="inner-card"><div class="panel-head"><div><p class="eyebrow">Live routing</p><h3>Primary and automatic backup</h3></div><button class="button secondary small" type="button" data-edit-runtime>Edit routing</button></div><div class="runtime-route" style="margin-top:14px"><article class="runtime-choice"><span>Primary</span><strong>${agent.provider}</strong><small>${agent.model}</small></article><span class="route-arrow">→</span><article class="runtime-choice"><span>Backup</span><strong>${agent.fallback.split(' · ')[0]}</strong><small>${agent.fallback.split(' · ')[1] || ''}</small></article></div></section><div class="profile-two-col"><section class="inner-card"><h3>Capability fit</h3><ul class="simple-list"><li><span class="check-badge">✓</span><span>Supports the evidence this role receives</span></li><li><span class="check-badge">✓</span><span>Required output format is validated</span></li><li><span class="check-badge">✓</span><span>Backup can complete the same task</span></li></ul></section><section class="inner-card"><h3>Operating limits</h3><ul class="simple-list"><li>Timeout: 180 seconds</li><li>Reasoning effort: High</li><li>Provider fallback: Automatic</li><li>Concurrent runs: 2</li></ul></section></div>`;
}

function toolsMarkup() {
  return `<section class="inner-card"><div class="panel-head"><div><p class="eyebrow">Agent action permissions</p><h3>What this specialist may inspect or change</h3></div><span class="tag success">Least privilege</span></div><div class="permission-table" style="margin-top:12px"><div class="permission-row header"><span>Capability</span><span>Access</span><span>Boundary</span><span>Confirmation</span></div><div class="permission-row"><span>Read current case evidence</span><span class="permission-state">Allowed</span><span>Current conversation only</span><span>Not required</span></div><div class="permission-row"><span>Search trusted knowledge</span><span class="permission-state">Allowed</span><span>Published agent-safe records</span><span>Not required</span></div><div class="permission-row"><span>Update an escalation</span><span class="permission-state ask">Propose only</span><span>Named case fields</span><span>Always ask</span></div><div class="permission-row"><span>Publish knowledge</span><span class="permission-state ask">Blocked</span><span>Human reviewer only</span><span>Not available</span></div></div></section>`;
}

function instructionsMarkup(agent) {
  return `<div class="profile-two-col" style="margin-top:0"><section class="inner-card"><div class="panel-head"><div><p class="eyebrow">Active instructions</p><h3>Role contract · v24</h3></div><button class="button secondary small" type="button">Edit safely</button></div><pre class="instruction-preview">You are the ${agent.name} in a coordinated QBO escalation team.

RESPONSIBILITY
${agent.owns.map(item => `- ${item}`).join('\n')}

BOUNDARIES
${agent.denies.map(item => `- Never ${item.toLowerCase()}`).join('\n')}

Preserve uncertainty. Name the evidence behind important claims. Hand off cleanly.</pre></section><section class="inner-card"><p class="eyebrow">Memory access</p><h3>Evidence this agent may remember</h3><ul class="simple-list"><li><span class="check-badge">✓</span><span>Current case conversation and structured evidence</span></li><li><span class="check-badge">✓</span><span>Published knowledge approved for agent responses</span></li><li><span class="number-badge">—</span><span>No unrestricted access to other customer cases</span></li><li><span class="number-badge">—</span><span>No learning from test or synthetic runs</span></li></ul></section></div>`;
}

function evaluationMarkup(agent) {
  return `<section class="inner-card"><div class="panel-head"><div><p class="eyebrow">Approved real-case replay</p><h3>Quality evidence for this exact configuration</h3></div><button class="button primary small" type="button" id="runEvaluation">Run evaluation</button></div><div class="eval-summary" style="margin-top:14px"><article><span>Quality pass rate</span><strong>${agent.quality}</strong><small>Last 30 reviewed fixtures</small></article><article><span>Evidence complete</span><strong>29/30</strong><small>One older trace expired</small></article><article><span>Fallback verified</span><strong>100%</strong><small>3 controlled failure cases</small></article></div></section><section class="inner-card" style="margin-top:14px"><h3>Release rule</h3><p style="margin:0;font-size:10px">Any prompt, model, tool, or permission change must replay the same approved cases. A human reviews subjective differences before the change becomes live.</p></section>`;
}

function renderProfile() {
  const agent = agents[activeAgent];
  document.getElementById('profileName').textContent = agent.name;
  document.getElementById('profileStage').textContent = agent.stage;
  document.getElementById('profilePurpose').textContent = agent.purpose;
  const glyph = document.getElementById('profileGlyph');
  glyph.textContent = agent.glyph;
  glyph.className = `agent-glyph ${agent.tone} xl`;
  const health = document.getElementById('profileHealth');
  health.className = `health-pill ${agent.health === 'Ready' ? 'good' : 'review'}`;
  health.innerHTML = `<i></i>${agent.health}`;
  document.querySelectorAll('[data-profile-agent]').forEach(item => item.classList.toggle('active', item.dataset.profileAgent === activeAgent));
  document.querySelectorAll('[data-profile-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.profileTab === activeProfileTab));
  const markup = activeProfileTab === 'runtime' ? runtimeMarkup(agent)
    : activeProfileTab === 'tools' ? toolsMarkup(agent)
    : activeProfileTab === 'instructions' ? instructionsMarkup(agent)
    : activeProfileTab === 'evaluation' ? evaluationMarkup(agent)
    : missionMarkup(agent);
  document.getElementById('profileContent').innerHTML = markup;
  document.querySelector('[data-edit-runtime]')?.addEventListener('click', openChangeModal);
  document.getElementById('runEvaluation')?.addEventListener('click', () => showToast(`Evaluation queued for ${agent.name}.`));
}

function openAgent(id) {
  activeAgent = id;
  activeProfileTab = 'mission';
  renderProfile();
  switchView('agents');
}
document.querySelectorAll('[data-open-agent]').forEach(button => button.addEventListener('click', () => openAgent(button.dataset.openAgent)));
document.querySelectorAll('[data-profile-agent]').forEach(button => button.addEventListener('click', () => { activeAgent = button.dataset.profileAgent; activeProfileTab = 'mission'; renderProfile(); }));
document.querySelectorAll('[data-profile-tab]').forEach(button => button.addEventListener('click', () => { activeProfileTab = button.dataset.profileTab; renderProfile(); }));
document.getElementById('testAgentButton').addEventListener('click', () => showToast(`Test started for ${agents[activeAgent].name}. No live configuration changed.`));
document.getElementById('agentSearch').addEventListener('input', event => {
  const query = event.target.value.toLowerCase();
  document.querySelectorAll('[data-profile-agent]').forEach(item => { item.hidden = !item.textContent.toLowerCase().includes(query); });
});
renderProfile();

const changeModal = document.getElementById('changeModal');
function openChangeModal() { changeModal.hidden = false; document.body.style.overflow = 'hidden'; setTimeout(() => document.getElementById('closeModal').focus(), 0); }
function closeChangeModal() { changeModal.hidden = true; document.body.style.overflow = ''; }
document.querySelectorAll('[data-open-change]').forEach(button => button.addEventListener('click', openChangeModal));
document.getElementById('closeModal').addEventListener('click', closeChangeModal);
changeModal.addEventListener('click', event => { if (event.target === changeModal) closeChangeModal(); });
document.querySelectorAll('input[name="caseChoice"]').forEach(radio => radio.addEventListener('change', () => {
  document.getElementById('approveChange').disabled = false;
  document.getElementById('releaseStatus').textContent = radio.value === 'unclear' ? 'The release will stay blocked until instructions are updated.' : 'Your judgment will be saved with the release evidence.';
}));
document.getElementById('approveChange').addEventListener('click', () => { closeChangeModal(); showToast('Release scheduled. Current routing remains live until the release begins.'); });
document.getElementById('rejectChange').addEventListener('click', () => { closeChangeModal(); showToast('Current model kept. The evaluation remains available as evidence.'); });

const commandPalette = document.getElementById('commandPalette');
function openCommandPalette() { commandPalette.hidden = false; document.getElementById('commandInput').focus(); }
function closeCommandPalette() { commandPalette.hidden = true; }
document.getElementById('searchButton').addEventListener('click', openCommandPalette);
commandPalette.addEventListener('click', event => { if (event.target === commandPalette) closeCommandPalette(); });
document.querySelectorAll('[data-command-view]').forEach(button => button.addEventListener('click', () => { closeCommandPalette(); if (button.dataset.commandView === 'agents') openAgent('parser'); else if (button.dataset.commandView === 'releases') { switchView('releases'); openChangeModal(); } else switchView(button.dataset.commandView); }));
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommandPalette(); }
  if (event.key === 'Escape') { if (!changeModal.hidden) closeChangeModal(); else if (!commandPalette.hidden) closeCommandPalette(); else sideNav.classList.remove('open'); }
});

document.getElementById('readinessButton').addEventListener('click', event => {
  const button = event.currentTarget;
  button.disabled = true; button.innerHTML = '<span>↻</span> Checking…';
  document.getElementById('readinessScore').textContent = '—';
  setTimeout(() => {
    button.disabled = false; button.innerHTML = '<span>↻</span> Run readiness check';
    document.getElementById('readinessScore').textContent = '94';
    document.querySelector('.score-progress').style.strokeDashoffset = '19';
    document.getElementById('checkedTime').textContent = 'Just now';
    showToast('Readiness check passed. All required agents and backups are available.');
  }, 850);
});
document.getElementById('testConnections').addEventListener('click', event => {
  event.currentTarget.disabled = true; event.currentTarget.textContent = 'Testing…';
  setTimeout(() => { event.currentTarget.disabled = false; event.currentTarget.textContent = 'Test connections'; showToast('Connection test complete: 7 ready, 1 idle, 0 failed.'); }, 850);
});
document.getElementById('strictToggle').addEventListener('change', event => showToast(event.target.checked ? 'Prototype only: strict approval would be enabled after an agent-impact review.' : 'Prototype only: advisory migration mode selected.'));

document.querySelectorAll('.run-row:not(.header), .provider-card .button, .info').forEach(button => button.addEventListener('click', () => showToast('Prototype detail: this would open the related evidence and configuration.')));
