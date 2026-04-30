const parsedTemplate = `COID/MID: 93414521977444835
CASE: 15154531492
CLIENT/CONTACT: Doug Mckensie
CX IS ATTEMPTING TO: Customer is calling to download the XML for his T4 but the T4 summary did not download.
EXPECTED OUTCOME: Customer wanted to send his T4 to CRA.
ACTUAL OUTCOME: Missing the T4 summary.
KB/TOOLS USED: Help panel, KB articles, Google, screen share.
TRIED TEST ACCOUNT: N/A
TS STEPS: Downloaded the T4 XML, checked archive, deleted and retried summary download, summary did not repopulate.`;

const els = {
  pageTitle: document.querySelector('#pageTitle'),
  workflowLauncher: document.querySelector('#workflowLauncher'),
  workflowButtons: Array.from(document.querySelectorAll('[data-workflow]')),
  workflowActionLabel: document.querySelector('#workflowActionLabel'),
  workflowActionHint: document.querySelector('#workflowActionHint'),
  emptyState: document.querySelector('#emptyState'),
  parseStage: document.querySelector('#parseStage'),
  caseView: document.querySelector('#caseView'),
  dropTarget: document.querySelector('#dropTarget'),
  resetButton: document.querySelector('#resetButton'),
  runState: document.querySelector('#runState'),
  workflowState: document.querySelector('#workflowState'),
  parserState: document.querySelector('#parserState'),
  triageRunState: document.querySelector('#triageRunState'),
  analystRunState: document.querySelector('#analystRunState'),
  templateText: document.querySelector('#templateText'),
  triageBody: document.querySelector('#triageBody'),
  triageThread: document.querySelector('#triageThread'),
  triageForm: document.querySelector('#triageForm'),
  triageInput: document.querySelector('#triageInput'),
  triageSend: document.querySelector('#triageSend'),
  chatStream: document.querySelector('#chatStream'),
  chatForm: document.querySelector('#chatForm'),
  chatInput: document.querySelector('#chatInput'),
  chatSend: document.querySelector('#chatSend'),
};

const timers = new Set();
let isRunning = false;
let selectedWorkflow = 'escalation';

const workflows = {
  escalation: {
    label: 'Escalation',
    action: 'Drop or paste escalation screenshot',
    hint: 'Template parser starts the workflow.',
    enabled: true,
  },
  inv: {
    label: 'INV',
    action: 'INV workflow entry point',
    hint: 'Reserved for INV intake, investigation matching, and dedicated INV agents.',
    enabled: false,
  },
  followup: {
    label: 'Follow-up',
    action: 'Follow-up chat parser entry point',
    hint: 'Reserved for phone-agent chat screenshots after an escalation is open.',
    enabled: false,
  },
  general: {
    label: 'General',
    action: 'General main chat',
    hint: 'Reserved for non-workflow QBO analyst conversations.',
    enabled: false,
  },
};

function wait(ms) {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      resolve();
    }, ms);
    timers.add(timer);
  });
}

function clearTimers() {
  timers.forEach((timer) => window.clearTimeout(timer));
  timers.clear();
}

function showScreen(screen) {
  els.emptyState.classList.toggle('is-hidden', screen !== 'empty');
  els.parseStage.classList.toggle('is-hidden', screen !== 'parse');
  els.caseView.classList.toggle('is-hidden', screen !== 'case');
  els.resetButton.classList.toggle('is-hidden', screen === 'empty');
  els.runState.classList.toggle('is-hidden', screen === 'empty');
  els.workflowLauncher.classList.toggle('is-hidden', screen !== 'empty');
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

function setRunState(el, label, status) {
  el.textContent = label;
  el.classList.remove('is-running', 'is-done');
  if (status) el.classList.add(status);
}

function loadingText(text) {
  return `<span class="spinner"></span><strong>${text}</strong>`;
}

function addMiniMessage(speaker, text) {
  const node = document.createElement('div');
  node.className = 'mini-message';
  node.innerHTML = `<strong>${speaker}:</strong> ${text}`;
  els.triageThread.append(node);
  els.triageThread.scrollTop = els.triageThread.scrollHeight;
}

function addChatMessage(label, html) {
  const node = document.createElement('article');
  node.className = 'chat-message';
  node.innerHTML = `<span class="chat-label">${label}</span><div>${html}</div>`;
  els.chatStream.append(node);
  els.chatStream.scrollTop = els.chatStream.scrollHeight;
}

function resetWorkspace() {
  els.templateText.textContent = '';
  els.triageBody.innerHTML = loadingText('Waiting for parsed template...');
  els.triageThread.innerHTML = '';
  els.chatStream.innerHTML = '';
  els.triageInput.value = '';
  els.chatInput.value = '';
  els.triageInput.disabled = true;
  els.triageSend.disabled = true;
  els.chatInput.disabled = true;
  els.chatSend.disabled = true;
  setRunState(els.workflowState, workflows[selectedWorkflow].label.toLowerCase(), null);
  setRunState(els.parserState, 'parser', null);
  setRunState(els.triageRunState, 'triage', null);
  setRunState(els.analystRunState, 'analyst', null);
}

function selectWorkflow(workflowKey) {
  const config = workflows[workflowKey];
  if (!config || isRunning) return;
  selectedWorkflow = workflowKey;
  els.workflowButtons.forEach((button) => {
    const isActive = button.dataset.workflow === workflowKey;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-current', isActive ? 'true' : 'false');
  });
  els.workflowActionLabel.textContent = config.action;
  els.workflowActionHint.textContent = config.hint;
  els.dropTarget.disabled = !config.enabled;
  resetWorkspace();
}

function showParsedTemplate() {
  els.pageTitle.textContent = 'Main Chat';
  setRunState(els.workflowState, 'escalation active', 'is-done');
  els.templateText.textContent = parsedTemplate;
  setRunState(els.parserState, 'parser done', 'is-done');
  showScreen('case');
}

function startTriage() {
  setRunState(els.triageRunState, 'triage reading', 'is-running');
  els.triageBody.innerHTML = loadingText('Reading parsed template...');
}

function finishTriage() {
  setRunState(els.triageRunState, 'triage ready', 'is-done');
  els.triageBody.innerHTML = `
    <div class="brief-line">
      <span>Category</span>
      <strong>Payroll tax form export</strong>
    </div>
    <div class="brief-line">
      <span>Severity</span>
      <strong>P2 if filing is blocked today</strong>
    </div>
    <div class="brief-line">
      <span>Immediate ask</span>
      <strong>Confirm tax year, whether XML exports without summary, and affected forms/users.</strong>
    </div>
    <div class="brief-line">
      <span>Missing</span>
      <strong>Region, browser, form year, exact artifact missing, screenshot of archive/current form state.</strong>
    </div>
  `;
  addMiniMessage('Triage', 'Fast read is ready. Push back here if the phone context changes or severity feels wrong.');
  els.triageInput.disabled = false;
  els.triageSend.disabled = false;
}

function startAnalyst() {
  setRunState(els.analystRunState, 'analyst researching', 'is-running');
  addChatMessage('System', '<p>Parsed template and triage brief sent to QBO Analyst.</p>');
  addChatMessage(
    'Analyst',
    `<p><strong>Use now:</strong> stop repeated deletion/regeneration attempts, preserve screenshots, and confirm whether the XML itself exports while only the T4 summary is missing.</p>
    <p>Research stream started: payroll tax form behavior, related INV patterns, and safe next-step wording.</p>`
  );
}

function finishAnalyst() {
  setRunState(els.analystRunState, 'analyst live', 'is-done');
  addChatMessage(
    'Analyst',
    `<p><strong>Working answer:</strong> treat this as a tax form summary regeneration/export issue until the phone agent proves the XML export itself is blocked.</p>
    <ul>
      <li>Ask for tax year, region, affected employee/forms, and whether the customer can export XML without the summary.</li>
      <li>Do not have them keep deleting archived forms unless support has captured the before/after state.</li>
      <li>If filing is due today or multiple forms are affected, keep P2 and prepare INV context with affected-user count.</li>
    </ul>`
  );
  els.chatInput.disabled = false;
  els.chatSend.disabled = false;
}

async function startWorkflow() {
  if (isRunning || selectedWorkflow !== 'escalation') return;
  isRunning = true;
  clearTimers();
  resetWorkspace();
  els.pageTitle.textContent = 'Main Chat';
  setRunState(els.workflowState, 'escalation active', 'is-running');
  setRunState(els.parserState, 'parser running', 'is-running');
  showScreen('parse');

  await wait(850);
  if (!isRunning) return;
  showParsedTemplate();
  startTriage();

  await wait(900);
  if (!isRunning) return;
  finishTriage();
  startAnalyst();

  await wait(1250);
  if (!isRunning) return;
  finishAnalyst();
  isRunning = false;
}

function submitTriage(event) {
  event.preventDefault();
  const text = els.triageInput.value.trim() || 'Severity should be lower if XML exports and only the summary is missing.';
  addMiniMessage('You', text);
  els.triageInput.value = '';
  addMiniMessage('Triage', 'Agreed. If XML exports and filing is not blocked, reduce urgency; keep missing-summary details for analyst research.');
}

function submitChat(event) {
  event.preventDefault();
  const text = els.chatInput.value.trim() || 'What should I ask the phone agent next?';
  addChatMessage('You', `<p>${text}</p>`);
  els.chatInput.value = '';
  addChatMessage('Analyst', '<p>Ask for tax year, country/region, whether XML-only export works, and a screenshot showing whether the summary is missing from current forms or archive only.</p>');
}

function reset() {
  isRunning = false;
  clearTimers();
  resetWorkspace();
  els.pageTitle.textContent = 'Main Chat';
  showScreen('empty');
}

els.workflowButtons.forEach((button) => {
  button.addEventListener('click', () => selectWorkflow(button.dataset.workflow));
});
els.dropTarget.addEventListener('click', startWorkflow);
els.resetButton.addEventListener('click', reset);
els.triageForm.addEventListener('submit', submitTriage);
els.chatForm.addEventListener('submit', submitChat);

reset();
selectWorkflow('escalation');
