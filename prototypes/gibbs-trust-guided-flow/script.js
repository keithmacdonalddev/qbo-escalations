const state = {
  view: 'work',
  intakeComplete: false,
  outcome: 'working',
  savedOutcome: false,
};

const titles = {
  work: 'Work now',
  history: 'History',
  cases: 'Cases',
  decisions: 'Decisions',
  known: 'Known issues',
  guidance: 'Teach agents',
};

const els = {
  viewTitle: document.querySelector('#viewTitle'),
  navItems: Array.from(document.querySelectorAll('.nav-item')),
  views: Array.from(document.querySelectorAll('.view')),
  pipelineSteps: Array.from(document.querySelectorAll('.pipeline-step')),
  heroAction: document.querySelector('#heroAction'),
  taskTitle: document.querySelector('#taskTitle'),
  taskSummary: document.querySelector('#taskSummary'),
  intakePanel: document.querySelector('#intakePanel'),
  workbench: document.querySelector('#workbench'),
  agentCards: Array.from(document.querySelectorAll('.agent-card')),
  captureState: document.querySelector('#captureState'),
  evidenceState: document.querySelector('#evidenceState'),
  outcomeState: document.querySelector('#outcomeState'),
  teachState: document.querySelector('#teachState'),
  caseState: document.querySelector('#caseState'),
  choiceCards: Array.from(document.querySelectorAll('.choice-card')),
  outcomeNote: document.querySelector('#outcomeNote'),
  saveOutcome: document.querySelector('#saveOutcome'),
  openEvidence: document.querySelector('#openEvidence'),
  decisionStatus: document.querySelector('#decisionStatus'),
  proofCheck: document.querySelector('#proofCheck'),
  missingList: document.querySelector('#missingList'),
  teachingReadiness: document.querySelector('#teachingReadiness'),
  guidanceTitle: document.querySelector('#guidanceTitle'),
  guidanceTag: document.querySelector('#guidanceTag'),
  guidanceCopy: document.querySelector('#guidanceCopy'),
  guidanceChecks: document.querySelector('#guidanceChecks'),
  teachAction: document.querySelector('#teachAction'),
  caseRowStatus: document.querySelector('#caseRowStatus'),
  caseRowAction: document.querySelector('#caseRowAction'),
  decisionRowTitle: document.querySelector('#decisionRowTitle'),
  decisionRowCopy: document.querySelector('#decisionRowCopy'),
  decisionRowAction: document.querySelector('#decisionRowAction'),
};

let runningTimer = null;

function setView(view) {
  state.view = view;
  els.viewTitle.textContent = titles[view];
  els.navItems.forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  });
  els.views.forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `view-${view}`);
  });
}

function setPipeline(stepName) {
  els.pipelineSteps.forEach((step) => {
    const active = step.dataset.step === stepName;
    step.classList.toggle('is-active', active);
  });
}

function setAgentStatus(card, status, label) {
  card.classList.remove('is-running', 'is-done');
  if (status) card.classList.add(status);
  card.querySelector('b').textContent = label;
}

function finishIntake() {
  state.intakeComplete = true;
  els.intakePanel.classList.add('is-hidden');
  els.workbench.classList.remove('is-hidden');
  els.captureState.textContent = 'Done';
  els.evidenceState.textContent = 'Ready';
  els.outcomeState.textContent = 'Required';
  els.taskTitle.textContent = 'Finish Case 15154531492.';
  els.taskSummary.textContent = 'The case was created from image intake. Source, agent work, and missing proof are visible before you decide the outcome.';
  els.heroAction.textContent = 'Save outcome';
  setPipeline('outcome');
  els.pipelineSteps[0].classList.add('is-done');
  els.pipelineSteps[1].classList.add('is-done');
  updateOutcomeUI();
}

function runSampleIntake() {
  if (state.intakeComplete) {
    els.saveOutcome.focus();
    return;
  }

  els.heroAction.disabled = true;
  els.heroAction.textContent = 'Creating case...';
  setPipeline('capture');
  els.captureState.textContent = 'Running';

  els.agentCards.forEach((card) => setAgentStatus(card, null, 'Waiting'));

  let index = 0;
  function advance() {
    if (index > 0) setAgentStatus(els.agentCards[index - 1], 'is-done', 'Done');
    if (index < els.agentCards.length) {
      setAgentStatus(els.agentCards[index], 'is-running', 'Running');
      index += 1;
      runningTimer = window.setTimeout(advance, 450);
      return;
    }
    els.heroAction.disabled = false;
    finishIntake();
  }

  runningTimer = window.setTimeout(advance, 250);
}

function selectOutcome(outcome) {
  state.outcome = outcome;
  state.savedOutcome = false;
  els.choiceCards.forEach((card) => {
    card.classList.toggle('is-selected', card.dataset.outcome === outcome);
  });

  if (outcome === 'proven') {
    els.outcomeNote.value = 'Proven fix: confirmed all T4 slips were marked ready, employer/remittance details were complete, then regenerated the XML and verified the T4 Summary appeared before filing.';
  } else if (outcome === 'handoff') {
    els.outcomeNote.value = 'No proven fix recorded. Save this as case history only. The deletion/regeneration attempt did not restore the T4 Summary, so agents must not recommend it as a fix.';
  } else {
    els.outcomeNote.value = 'Still working. Need to confirm tax year, all slip readiness, employer/remittance details, and whether regenerated XML includes the T4 Summary.';
  }

  updateOutcomeUI();
}

function saveOutcome() {
  if (!state.intakeComplete) return;
  state.savedOutcome = true;
  updateOutcomeUI();
  if (state.outcome === 'proven') {
    setPipeline('teach');
    setView('guidance');
  }
}

function updateOutcomeUI() {
  const proven = state.outcome === 'proven' && state.savedOutcome;
  const handoff = state.outcome === 'handoff' && state.savedOutcome;
  const working = state.outcome === 'working' && state.savedOutcome;

  els.caseState.textContent = proven ? 'Resolved with proof' : handoff ? 'History only' : working ? 'Still working' : 'Needs outcome';
  els.decisionStatus.textContent = state.savedOutcome ? 'Saved' : 'Required';
  els.outcomeState.textContent = state.savedOutcome ? 'Saved' : 'Required';

  if (proven) {
    els.taskTitle.textContent = 'Case 15154531492 is proven and ready for agent review.';
    els.taskSummary.textContent = 'The outcome is saved. Teaching agents is now optional and still requires reviewed guidance.';
    els.heroAction.textContent = 'Create guidance';
    els.proofCheck.textContent = 'Final fix is proven and recorded.';
    els.proofCheck.classList.add('is-good');
    els.teachingReadiness.textContent = 'Ready to create reviewed agent guidance.';
    els.teachState.textContent = 'Ready';
    els.pipelineSteps[3].classList.remove('is-locked');
    els.pipelineSteps[2].classList.add('is-done');
    els.pipelineSteps[3].classList.add('is-done');
    els.guidanceTitle.textContent = 'Ready to teach agents.';
    els.guidanceTag.textContent = 'Ready';
    els.guidanceTag.className = 'tag good';
    els.guidanceCopy.textContent = 'A human recorded a proven outcome. Now create reviewed guidance so agents can recommend the fix in future similar cases.';
    els.teachAction.disabled = false;
    els.guidanceChecks.querySelectorAll('li').forEach((item) => item.classList.add('is-good'));
    els.caseRowStatus.textContent = 'Resolved';
    els.caseRowStatus.className = 'tag good';
    els.caseRowAction.textContent = 'Teach agents';
    els.decisionRowTitle.textContent = 'Outcome saved for Case 15154531492';
    els.decisionRowCopy.textContent = 'The case can move to reviewed guidance if the fix should be reused.';
    els.decisionRowAction.textContent = 'Teach agents';
  } else {
    if (state.intakeComplete) {
      els.taskTitle.textContent = 'Finish Case 15154531492.';
      els.taskSummary.textContent = 'The case was created from image intake. Source, agent work, and missing proof are visible before you decide the outcome.';
      els.heroAction.textContent = 'Save outcome';
    }
    els.proofCheck.textContent = state.savedOutcome ? 'No proven final fix is recorded.' : 'Final fix is not proven yet.';
    els.proofCheck.classList.remove('is-good');
    els.teachingReadiness.textContent = 'Blocked until a proven outcome exists.';
    els.teachState.textContent = 'Locked';
    els.pipelineSteps[3].classList.add('is-locked');
    els.pipelineSteps[2].classList.toggle('is-done', state.savedOutcome);
    els.pipelineSteps[3].classList.remove('is-done');
    els.guidanceTitle.textContent = 'Not ready for agent guidance.';
    els.guidanceTag.textContent = 'Blocked';
    els.guidanceTag.className = 'tag warning';
    els.guidanceCopy.textContent = 'This case can be searched as history, but agents cannot recommend a fix until a human records what actually worked.';
    els.teachAction.disabled = true;
    const checks = els.guidanceChecks.querySelectorAll('li');
    checks.forEach((item, index) => item.classList.toggle('is-good', index < 2));
    els.caseRowStatus.textContent = state.savedOutcome ? 'History only' : 'Needs outcome';
    els.caseRowStatus.className = state.savedOutcome ? 'tag neutral' : 'tag warning';
    els.caseRowAction.textContent = state.savedOutcome ? 'Review history' : 'Finish case';
    els.decisionRowTitle.textContent = state.savedOutcome ? 'Case saved as history only' : 'Outcome missing for Case 15154531492';
    els.decisionRowCopy.textContent = state.savedOutcome ? 'Agents can search it, but cannot recommend it as a fix.' : 'Agents have evidence, but need the final result.';
    els.decisionRowAction.textContent = state.savedOutcome ? 'View history' : 'Decide now';
  }
}

function jumpToWork() {
  setView('work');
  if (!state.intakeComplete) runSampleIntake();
  window.setTimeout(() => els.saveOutcome.focus(), 100);
}

els.navItems.forEach((item) => {
  item.addEventListener('click', () => setView(item.dataset.view));
});

els.pipelineSteps.forEach((step) => {
  step.addEventListener('click', () => {
    if (step.dataset.step === 'teach') setView('guidance');
    if (step.dataset.step === 'outcome') setView('work');
    if (step.dataset.step === 'evidence') setView('known');
    if (step.dataset.step === 'capture') setView('work');
    setPipeline(step.dataset.step);
  });
});

els.heroAction.addEventListener('click', () => {
  if (state.intakeComplete) saveOutcome();
  else runSampleIntake();
});

els.choiceCards.forEach((card) => {
  card.addEventListener('click', () => selectOutcome(card.dataset.outcome));
});

document.addEventListener('click', (event) => {
  const outcomeCard = event.target.closest('[data-outcome]');
  if (outcomeCard) {
    selectOutcome(outcomeCard.dataset.outcome);
  }
});

els.saveOutcome.addEventListener('click', saveOutcome);
els.openEvidence.addEventListener('click', () => setView('known'));

document.querySelectorAll('[data-jump-work]').forEach((item) => {
  item.addEventListener('click', jumpToWork);
});

window.addEventListener('beforeunload', () => {
  if (runningTimer) window.clearTimeout(runningTimer);
});

setView('work');
setPipeline('capture');
updateOutcomeUI();
