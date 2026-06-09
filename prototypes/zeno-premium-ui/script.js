const state = {
  currentView: 'workflow',
  outcome: 'history',
  savedOutcome: null,
  provenFix: false,
};

const viewButtons = document.querySelectorAll('[data-view-target]');
const navLinks = document.querySelectorAll('.nav-link');
const views = document.querySelectorAll('.view');
const spineSteps = document.querySelectorAll('.spine-step');
const outcomeButtons = document.querySelectorAll('[data-outcome]');
const fixInput = document.getElementById('fixInput');
const blockerInput = document.getElementById('blockerInput');
const saveOutcomeBtn = document.getElementById('saveOutcomeBtn');
const outcomeGuide = document.getElementById('outcomeGuide');
const actionReason = document.getElementById('actionReason');
const actionDetail = document.getElementById('actionDetail');
const globalStatus = document.getElementById('globalStatus');
const toast = document.getElementById('toast');
const knowledgeState = document.getElementById('knowledgeState');
const knowledgePrimary = document.getElementById('knowledgePrimary');
const publishGate = document.getElementById('publishGate');
const sampleImageBtn = document.getElementById('sampleImageBtn');

const outcomeCopy = {
  history: {
    guide: 'The source shows failed attempted steps, not the final working fix. Save this as case history unless you can prove the actual fix.',
    reason: 'Recommended: preserve the case, but do not teach agents yet.',
    detail: 'This keeps the evidence available without letting future agents recommend an unproven fix.',
    action: 'Save as case history',
  },
  resolved: {
    guide: 'Use this only when the actual fix is known and can be written clearly. Once saved, the case can be reviewed for future agent guidance.',
    reason: 'Required: write the actual fix before marking resolved.',
    detail: 'Agents can only learn from this later if the final fix, scope, and evidence are clear.',
    action: 'Mark resolved',
  },
  handoff: {
    guide: 'If the case is still blocked or handed off, record the current blocker and what the next person should check.',
    reason: 'Recommended: preserve the current state and next step.',
    detail: 'This prevents the next person or agent from repeating failed work.',
    action: 'Save handoff',
  },
};

function showView(viewName) {
  state.currentView = viewName;

  views.forEach((view) => {
    view.classList.toggle('active', view.id === `view-${viewName}`);
  });

  navLinks.forEach((button) => {
    button.classList.toggle('active', button.dataset.viewTarget === viewName);
  });

  spineSteps.forEach((button) => {
    button.classList.toggle('active', button.dataset.viewTarget === viewName);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

function updateOutcomeUI() {
  const copy = outcomeCopy[state.outcome];
  const hasFix = fixInput.value.trim().length > 0;
  const hasBlocker = blockerInput.value.trim().length > 0;

  outcomeGuide.textContent = copy.guide;
  actionReason.textContent = copy.reason;
  actionDetail.textContent = copy.detail;
  saveOutcomeBtn.textContent = copy.action;

  if (state.outcome === 'resolved') {
    saveOutcomeBtn.disabled = !hasFix;
  } else if (state.outcome === 'handoff') {
    saveOutcomeBtn.disabled = !hasBlocker;
  } else {
    saveOutcomeBtn.disabled = false;
  }

  outcomeButtons.forEach((button) => {
    button.classList.toggle('selected', button.dataset.outcome === state.outcome);
  });
}

function updateKnowledgeUI() {
  if (state.provenFix) {
    knowledgeState.innerHTML = `
      <span class="status-pill success">Review ready</span>
      <div>
        <h3>A proven fix was saved.</h3>
        <p>Human review can now decide whether this becomes trusted agent guidance.</p>
      </div>
    `;
    publishGate.innerHTML = `
      <li><span class="dot success"></span> Source linked</li>
      <li><span class="dot success"></span> Proven fix recorded</li>
      <li><span class="dot warning"></span> Reusable scope needs review</li>
      <li><span class="dot warning"></span> Root cause needs review</li>
    `;
    knowledgePrimary.textContent = 'Create review draft';
  } else {
    knowledgeState.innerHTML = `
      <span class="status-pill danger">Blocked</span>
      <div>
        <h3>Agents cannot recommend this yet.</h3>
        <p>The source proves the symptom and failed attempt, but not the final working fix.</p>
      </div>
    `;
    publishGate.innerHTML = `
      <li><span class="dot success"></span> Source linked</li>
      <li><span class="dot warning"></span> Reusable scope unclear</li>
      <li><span class="dot danger"></span> Proven fix missing</li>
      <li><span class="dot danger"></span> Root cause missing</li>
    `;
    knowledgePrimary.textContent = 'Save as case history only';
  }
}

function saveOutcome() {
  state.savedOutcome = state.outcome;

  if (state.outcome === 'resolved') {
    state.provenFix = true;
    globalStatus.textContent = 'Resolved - review ready';
    globalStatus.className = 'status-pill success';
    updateKnowledgeUI();
    showToast('Outcome saved. Agent guidance review is now available later.');
    showView('knowledge');
    return;
  }

  if (state.outcome === 'handoff') {
    state.provenFix = false;
    globalStatus.textContent = 'Handoff saved';
    globalStatus.className = 'status-pill';
    updateKnowledgeUI();
    showToast('Handoff saved. The next person sees the blocker first.');
    return;
  }

  state.provenFix = false;
  globalStatus.textContent = 'Case history saved';
  globalStatus.className = 'status-pill';
  updateKnowledgeUI();
  showToast('Saved as case history. Agents can search it but cannot recommend it.');
}

viewButtons.forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.viewTarget));
});

outcomeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.outcome = button.dataset.outcome;
    updateOutcomeUI();
  });
});

document.addEventListener('click', (event) => {
  const viewTarget = event.target.closest('[data-view-target]');
  if (viewTarget) {
    showView(viewTarget.dataset.viewTarget);
  }

  const outcomeTarget = event.target.closest('[data-outcome]');
  if (outcomeTarget) {
    state.outcome = outcomeTarget.dataset.outcome;
    updateOutcomeUI();
  }
});

fixInput.addEventListener('input', updateOutcomeUI);
blockerInput.addEventListener('input', updateOutcomeUI);
saveOutcomeBtn.addEventListener('click', saveOutcome);

knowledgePrimary.addEventListener('click', () => {
  if (state.provenFix) {
    showToast('Review draft created in prototype state.');
  } else {
    showToast('Saved as case history only. Agent recommendations remain blocked.');
  }
});

sampleImageBtn.addEventListener('click', () => {
  showToast('Image parsed. Case 15154531492 is ready to finish.');
  showView('workflow');
});

updateOutcomeUI();
updateKnowledgeUI();
