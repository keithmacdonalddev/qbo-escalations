const pipeline = [
  {
    id: "capture",
    label: "Upload image",
    owner: "User",
    summary: "Paste or drop the escalation screenshot.",
    title: "Start with the support screenshot",
    stage: "Capture"
  },
  {
    id: "parser",
    label: "Parser",
    owner: "Escalation Image Parser",
    summary: "Extract the case template and create the working case.",
    title: "Confirm the parsed escalation",
    stage: "Parser"
  },
  {
    id: "inv",
    label: "INV search",
    owner: "INV Search Agent",
    summary: "Find matching known issues and workarounds.",
    title: "Check known issues before guessing",
    stage: "Investigation"
  },
  {
    id: "triage",
    label: "Triage",
    owner: "Triage Agent",
    summary: "Separate facts, failed attempts, risks, and next action.",
    title: "Choose the safest next action",
    stage: "Triage"
  },
  {
    id: "assistant",
    label: "QBO assistant",
    owner: "QBO Assistant",
    summary: "Help the user work the case with the shared evidence.",
    title: "Work the case with the assistant",
    stage: "Assistant"
  },
  {
    id: "workbench",
    label: "Case workbench",
    owner: "User + agents",
    summary: "Keep the case, evidence, and next step in one place.",
    title: "Finish the active escalation",
    stage: "Case workbench"
  },
  {
    id: "outcome",
    label: "Finish outcome",
    owner: "User",
    summary: "Record what fixed it, what failed, or why it moved on.",
    title: "Record the outcome before anything becomes guidance",
    stage: "Outcome"
  },
  {
    id: "teach",
    label: "Teach agents",
    owner: "Human reviewer",
    summary: "Optional: publish only proven lessons for future agents.",
    title: "Optional: decide whether agents can reuse this lesson",
    stage: "Agent learning"
  }
];

const supportViews = {
  focus: {
    title: "What this replaces",
    pill: "Primary mental model",
    html: `
      <article class="support-card">
        <h3>One workflow, not five destinations <span class="status-label good">Reference</span></h3>
        <p>Chat, sessions, cases, attention, knowledge, and investigations stay connected to the active escalation instead of becoming separate places the user must learn first.</p>
      </article>
      <article class="support-card">
        <h3>Current user job <span class="status-label warn">Always visible</span></h3>
        <p id="supportCurrentJob">Upload the screenshot so the parser can create the working case.</p>
      </article>
      <article class="support-card">
        <h3>Why this matters</h3>
        <p>The user should never need to ask where the case went, which page owns the next step, or when knowledge becomes available to agents.</p>
      </article>
    `
  },
  history: {
    title: "Conversation history",
    pill: "Sessions, reframed",
    html: `
      <article class="history-row">
        <h3>Current image intake run <span class="status-label good">Linked</span></h3>
        <p>Session created the case, preserved the screenshot, and links back to the transcript.</p>
      </article>
      <article class="history-row">
        <h3>Previous escalation run <span class="status-label warn">Needs link</span></h3>
        <p>Instead of an abstract sessions table, the user sees whether a saved conversation became a case and what is missing.</p>
      </article>
      <article class="support-card">
        <h3>What the user does here</h3>
        <p>Open a past run only when they need evidence or continuity. The active work still happens in the workbench.</p>
      </article>
    `
  },
  decisions: {
    title: "Decisions needed",
    pill: "Attention, reframed",
    html: `
      <article class="decision-card">
        <h3>Outcome missing <span class="status-label bad">Required</span></h3>
        <p>The case cannot teach agents until the user records what actually fixed it or why it was handed off.</p>
      </article>
      <article class="decision-card">
        <h3>Parser confidence check <span class="status-label good">Handled</span></h3>
        <p>The parser output was accepted as the case starting point. No separate queue visit required.</p>
      </article>
      <article class="support-card">
        <h3>What the user does here</h3>
        <p>Resolve blocked decisions only when they interrupt the active case. The page is a safety tray, not the main workflow.</p>
      </article>
    `
  },
  knownIssues: {
    title: "Known issue evidence",
    pill: "Investigations, reframed",
    html: `
      <article class="issue-row">
        <h3>INV-148433 <span class="status-label warn">Possible match</span></h3>
        <p>Payroll XML exports can omit summary data when employer-level details are incomplete.</p>
      </article>
      <article class="issue-row">
        <h3>INV-148450 <span class="status-label">Weak match</span></h3>
        <p>CPP/EI setup issue. Useful context, but not the same symptom.</p>
      </article>
      <article class="support-card">
        <h3>What the user does here</h3>
        <p>Use known issues as evidence during triage. Do not make the user browse an investigations library before the case asks for it.</p>
      </article>
    `
  },
  teach: {
    title: "Teach agents",
    pill: "Knowledge, reframed",
    html: `
      <article class="support-card">
        <h3>Only after outcome <span class="status-label warn">Optional</span></h3>
        <p>Knowledge is not the next page after chat. It is the optional review step after a proven or useful outcome exists.</p>
      </article>
      <article class="support-card">
        <h3>Agent permission</h3>
        <p>Agents can search case history, but they cannot recommend a fix until a human confirms the fix, scope, and evidence.</p>
      </article>
      <article class="support-card">
        <h3>What the user does here</h3>
        <p>Decide whether this becomes reusable guidance, case history only, or a rejected draft.</p>
      </article>
    `
  }
};

const state = {
  step: 0,
  support: "focus",
  selectedTeachOption: "history"
};

const pipelineSteps = document.getElementById("pipelineSteps");
const taskStage = document.getElementById("taskStage");
const taskTitle = document.getElementById("taskTitle");
const taskBody = document.getElementById("taskBody");
const topbarState = document.getElementById("topbarState");
const pipelineHeadline = document.getElementById("pipelineHeadline");
const supportTitle = document.getElementById("supportTitle");
const supportPill = document.getElementById("supportPill");
const supportBody = document.getElementById("supportBody");
const stagePrimaryAction = document.getElementById("stagePrimaryAction");

const primaryActionLabels = {
  capture: "Use sample screenshot",
  parser: "Continue to INV search",
  inv: "Send evidence to triage",
  triage: "Open QBO assistant",
  assistant: "Open case workbench",
  workbench: "Finish outcome",
  outcome: "Save outcome",
  teach: "Save teaching decision"
};

function setStep(index) {
  state.step = Math.max(0, Math.min(index, pipeline.length - 1));
  render();
}

function setSupport(view) {
  state.support = view;
  renderSupport();
  document.querySelectorAll("[data-support]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.support === view);
  });
}

function renderPipeline() {
  pipelineSteps.innerHTML = pipeline.map((step, index) => {
    const status = index < state.step ? "is-done" : index === state.step ? "is-current" : "is-locked";
    return `
      <li>
        <button class="pipeline-step ${status}" type="button" data-step="${index}" data-index="${index + 1}">
          <strong>${step.label}</strong>
          <span>${step.summary}</span>
        </button>
      </li>
    `;
  }).join("");

  pipelineSteps.querySelectorAll("[data-step]").forEach((button) => {
    button.addEventListener("click", () => setStep(Number(button.dataset.step)));
  });
}

function renderSupport() {
  const view = supportViews[state.support];
  supportTitle.textContent = view.title;
  supportPill.textContent = view.pill;
  supportBody.innerHTML = view.html;
  const currentJob = document.getElementById("supportCurrentJob");
  if (currentJob) currentJob.textContent = pipeline[state.step].summary;
}

function templateFields() {
  return `
    <div class="field-grid">
      <div class="field">
        <label>Case</label>
        <strong>15154531492</strong>
        <small>Created from image intake. Linked to this run.</small>
      </div>
      <div class="field">
        <label>Category</label>
        <strong>Payroll</strong>
        <small>T4 year-end XML export issue.</small>
      </div>
      <div class="field full">
        <label>Customer issue</label>
        <strong>T4 XML downloaded for CRA filing, but the T4 Summary is missing.</strong>
        <small>The parser captured the issue; the user still decides the outcome later.</small>
      </div>
      <div class="field">
        <label>Expected outcome</label>
        <strong>XML includes slips and T4 Summary.</strong>
      </div>
      <div class="field">
        <label>Actual outcome</label>
        <strong>Summary section absent.</strong>
      </div>
    </div>
  `;
}

function renderCapture() {
  return `
    <section class="drop-zone">
      <div class="drop-card">
        <div class="upload-glyph">UP</div>
        <h2>Drop or paste the escalation screenshot</h2>
        <p>This is the one obvious starting action. The parser creates the working case and the rest of the pipeline becomes available in order.</p>
        <div class="button-row center">
          <button class="primary-action" type="button" data-action="next">Use sample screenshot</button>
          <button class="quiet-action" type="button" data-support-trigger="history">View recent runs</button>
        </div>
      </div>
    </section>
  `;
}

function renderParser() {
  return `
    <div class="callout">
      <strong>The parser created the working case.</strong>
      <p>The user does not have to wonder where the escalation went. It is linked to the image run and ready for known-issue search.</p>
    </div>
    ${templateFields()}
    <div class="button-row" style="margin-top: 14px">
      <button class="primary-action" type="button" data-action="next">Continue to INV search</button>
      <button class="secondary-action" type="button" data-support-trigger="history">Open linked history</button>
    </div>
  `;
}

function renderInv() {
  return `
    <div class="split-layout">
      <div>
        <div class="callout">
          <strong>Known issues are brought to the case.</strong>
          <p>The user should not have to browse Investigations first. The INV Search Agent brings likely matches into the active workbench.</p>
        </div>
        <div class="agent-stack">
          <article class="agent-card">
            <div class="agent-badge">INV</div>
            <div>
              <strong>INV-148433: Payroll XML export issue</strong>
              <p>Possible match. Missing employer-level details can affect XML summary generation.</p>
            </div>
            <span class="agent-state waiting">Review</span>
          </article>
          <article class="agent-card">
            <div class="agent-badge">INV</div>
            <div>
              <strong>INV-148450: CPP/EI payroll setup</strong>
              <p>Weak match. Similar product area, different symptom.</p>
            </div>
            <span class="agent-state">Context</span>
          </article>
        </div>
      </div>
      <aside class="evidence-box">
        <h3>Information needed</h3>
        <p>Confirm whether employees are ready to file, employer details are complete, and whether regenerating XML after correction produces the summary.</p>
      </aside>
    </div>
    <div class="button-row" style="margin-top: 14px">
      <button class="primary-action" type="button" data-action="next">Send evidence to triage</button>
      <button class="secondary-action" type="button" data-support-trigger="knownIssues">Open known issues</button>
    </div>
  `;
}

function renderTriage() {
  return `
    <div class="summary-bar">
      <div>
        <p class="eyebrow">Triage decision</p>
        <h2>Do not treat attempted steps as the final fix.</h2>
      </div>
      <span class="status-label warn">Needs proof</span>
    </div>
    <div class="field-grid">
      <div class="field">
        <label>Observed fact</label>
        <strong>T4 slips are present, summary is missing.</strong>
      </div>
      <div class="field">
        <label>Failed attempt</label>
        <strong>Deleting archived T4 and regenerating did not restore summary.</strong>
      </div>
      <div class="field full">
        <label>Recommended next action</label>
        <strong>Verify employer and employee filing readiness before regenerating XML.</strong>
        <small>This is a next action, not proven reusable guidance.</small>
      </div>
    </div>
    <div class="button-row" style="margin-top: 14px">
      <button class="primary-action" type="button" data-action="next">Open QBO assistant</button>
      <button class="secondary-action" type="button" data-support-trigger="decisions">See decisions needed</button>
    </div>
  `;
}

function renderAssistant() {
  return `
    <div class="agent-stack">
      <article class="agent-card">
        <div class="agent-badge">QA</div>
        <div>
          <strong>QBO Assistant is using the same case evidence.</strong>
          <p>It can help investigate and draft responses, but it cannot publish a fix as agent guidance until the outcome is recorded.</p>
        </div>
        <span class="agent-state">Ready</span>
      </article>
      <article class="support-card">
        <h3>Suggested user-facing response</h3>
        <p>Check whether the employer profile and employee T4 records are complete, then regenerate the XML and confirm the summary appears before submitting to CRA.</p>
      </article>
    </div>
    <div class="button-row" style="margin-top: 14px">
      <button class="primary-action" type="button" data-action="next">Open case workbench</button>
      <button class="secondary-action" type="button" data-support-trigger="history">View transcript evidence</button>
    </div>
  `;
}

function renderWorkbench() {
  return `
    <div class="callout">
      <strong>This is where the previous chat lands.</strong>
      <p>The case is not lost when the user starts a new chat. It stays here until the outcome is recorded or the case is handed off.</p>
    </div>
    <div class="field-grid">
      <div class="field">
        <label>Current case</label>
        <strong>15154531492</strong>
        <small>Linked to image intake and assistant run.</small>
      </div>
      <div class="field">
        <label>Current state</label>
        <strong>Working</strong>
        <small>Outcome has not been recorded.</small>
      </div>
      <div class="field full">
        <label>Next human action</label>
        <strong>Record what happened after the investigation.</strong>
        <small>What fixed it, what failed, or why it was handed off.</small>
      </div>
    </div>
    <div class="metric-strip">
      <div class="metric"><strong>1</strong><span>active case</span></div>
      <div class="metric"><strong>2</strong><span>evidence sources</span></div>
      <div class="metric"><strong>1</strong><span>decision open</span></div>
    </div>
    <div class="button-row" style="margin-top: 14px">
      <button class="primary-action" type="button" data-action="next">Finish outcome</button>
      <button class="secondary-action" type="button" data-support-trigger="decisions">Show open decision</button>
    </div>
  `;
}

function renderOutcome() {
  return `
    <div class="callout">
      <strong>Finish the escalation before teaching agents.</strong>
      <p>This is the simple post-chat step: record the result. The user should not be sent to Knowledge, Sessions, or Attention to do this.</p>
    </div>
    <form class="form-stack" id="outcomeForm">
      <div class="field">
        <label for="actualFix">What actually fixed it?</label>
        <textarea id="actualFix" placeholder="Example: Completed employer remittance details, marked all employee T4 records ready to file, regenerated the XML, and confirmed the T4 Summary appeared."></textarea>
      </div>
      <div class="field">
        <label for="failedSteps">What did not work?</label>
        <textarea id="failedSteps">Deleting the archived T4 filing and regenerating did not restore the summary in this case.</textarea>
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="outcomeStatus">Outcome</label>
          <select id="outcomeStatus">
            <option>Resolved with proven fix</option>
            <option>No proven fix yet</option>
            <option>Escalated further</option>
            <option>Still working</option>
          </select>
        </div>
        <div class="field">
          <label for="handoff">Next owner</label>
          <input id="handoff" value="User + QBO Assistant" />
        </div>
      </div>
      <div class="button-row">
        <button class="primary-action" type="submit">Save outcome</button>
        <button class="secondary-action" type="button" data-support-trigger="decisions">Why this is required</button>
      </div>
    </form>
  `;
}

function renderTeach() {
  return `
    <div class="summary-bar">
      <div>
        <p class="eyebrow">Optional after outcome</p>
        <h2>Should this lesson help future agents?</h2>
      </div>
      <span class="status-label warn">Human decides</span>
    </div>
    <div class="decision-grid">
      <button class="decision-option ${state.selectedTeachOption === "history" ? "is-selected" : ""}" type="button" data-teach="history">
        <span class="choice-label">No proven fix</span>
        <strong>Save as case history</strong>
        <span>Agents can retrieve it as evidence, but cannot recommend it as a fix.</span>
      </button>
      <button class="decision-option ${state.selectedTeachOption === "guidance" ? "is-selected" : ""}" type="button" data-teach="guidance">
        <span class="choice-label">Proven fix</span>
        <strong>Create guidance for agents</strong>
        <span>Only use when the fix, scope, exclusions, and source evidence are clear.</span>
      </button>
      <button class="decision-option ${state.selectedTeachOption === "reject" ? "is-selected" : ""}" type="button" data-teach="reject">
        <span class="choice-label">Bad draft</span>
        <strong>Reject lesson</strong>
        <span>Use when the generated lesson is misleading, unsupported, or not useful.</span>
      </button>
    </div>
    <div class="button-row" style="margin-top: 14px">
      <button class="primary-action" type="button">Save teaching decision</button>
      <button class="secondary-action" type="button" data-support-trigger="teach">Open teaching context</button>
    </div>
  `;
}

function renderTaskBody() {
  const step = pipeline[state.step];
  taskStage.textContent = step.stage;
  taskTitle.textContent = step.title;
  topbarState.textContent = step.summary;
  pipelineHeadline.textContent = `${step.owner}: ${step.summary}`;
  stagePrimaryAction.textContent = primaryActionLabels[step.id];

  const renderers = {
    capture: renderCapture,
    parser: renderParser,
    inv: renderInv,
    triage: renderTriage,
    assistant: renderAssistant,
    workbench: renderWorkbench,
    outcome: renderOutcome,
    teach: renderTeach
  };

  taskBody.innerHTML = renderers[step.id]();
  bindTaskEvents();
}

function bindTaskEvents() {
  taskBody.querySelectorAll("[data-action='next']").forEach((button) => {
    button.addEventListener("click", () => setStep(state.step + 1));
  });

  taskBody.querySelectorAll("[data-support-trigger]").forEach((button) => {
    button.addEventListener("click", () => setSupport(button.dataset.supportTrigger));
  });

  taskBody.querySelectorAll("[data-teach]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTeachOption = button.dataset.teach;
      renderTaskBody();
    });
  });

  const outcomeForm = document.getElementById("outcomeForm");
  if (outcomeForm) {
    outcomeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      setStep(7);
      setSupport("teach");
    });
  }
}

function render() {
  renderPipeline();
  renderTaskBody();
  renderSupport();
  document.querySelectorAll("[data-support]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.support === state.support);
  });
}

document.getElementById("resetFlow").addEventListener("click", () => {
  state.step = 0;
  state.support = "focus";
  state.selectedTeachOption = "history";
  render();
});

stagePrimaryAction.addEventListener("click", () => {
  if (pipeline[state.step].id === "teach") return;
  setStep(state.step + 1);
  if (pipeline[state.step].id === "teach") setSupport("teach");
});

document.querySelectorAll("[data-support]").forEach((button) => {
  button.addEventListener("click", () => setSupport(button.dataset.support));
});

render();
