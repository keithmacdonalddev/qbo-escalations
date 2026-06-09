const stages = [
  {
    id: "intake",
    label: "Intake",
    agent: "Image Parser",
    title: "Capture the issue",
    subtitle: "The work starts with the screenshot, not a dashboard.",
    status: "Ready for intake",
    caseTitle: "No case captured yet",
    caseSummary: "Start by uploading or pasting the escalation screenshot.",
    events: ["No screenshot captured", "No case record yet", "Agents waiting for source evidence"],
    missing: ["Escalation screenshot", "Parsed template", "Case number or COID if visible"],
    nowTitle: "Upload or paste the screenshot.",
    nowText: "The parser cannot create case evidence until the image is captured.",
    whyTitle: "The screenshot is the source of truth.",
    whyText: "Agents should reason from the same captured facts the user saw.",
    nextTitle: "Parser extracts the template.",
    nextText: "The case becomes structured enough for INV search and triage.",
    card: "drop",
  },
  {
    id: "investigate",
    label: "Investigate",
    agent: "INV Search Agent",
    title: "Find known issue evidence",
    subtitle: "Investigations appear here as supporting evidence for the active case.",
    status: "Investigating known issues",
    caseTitle: "Case 15154531492",
    caseSummary: "T4 XML export is missing the T4 Summary while slips are present.",
    events: ["Screenshot parsed", "Escalation case created", "INV search running against payroll year-end issues"],
    missing: ["Confirm whether an active INV matches", "Capture customer scope", "Check for current workaround"],
    nowTitle: "Review the best matching known issues.",
    nowText: "Only inspect investigations that explain this case or change the next action.",
    whyTitle: "Known issues prevent repeated guesswork.",
    whyText: "The agent team can use INV matches as evidence, not as a separate page to decode.",
    nextTitle: "Triage uses the evidence.",
    nextText: "Matched issues, prior cases, and source facts become the triage brief.",
    card: "artifacts",
  },
  {
    id: "triage",
    label: "Triage",
    agent: "Triage Agent",
    title: "Decide what this escalation needs",
    subtitle: "The triage result is a decision aid, not another report.",
    status: "Triage ready",
    caseTitle: "Case 15154531492",
    caseSummary: "Payroll T4 XML missing the summary section for CRA filing.",
    events: ["INV candidates checked", "Similar prior case found", "Triage brief prepared"],
    missing: ["Is this current product behavior or stale data?", "Was employer-level info verified?", "Who owns next contact?"],
    nowTitle: "Choose the next support action.",
    nowText: "The user should see the recommended next step and the evidence behind it.",
    whyTitle: "Triage turns evidence into direction.",
    whyText: "Without a decision, the user is stuck browsing pages instead of working the case.",
    nextTitle: "Resolve or keep working.",
    nextText: "The case moves to closeout only when the next action is clear.",
    card: "triage",
  },
  {
    id: "resolve",
    label: "Resolve",
    agent: "QBO Assistant",
    title: "Finish the escalation record",
    subtitle: "The immediate post-chat task is simple: record the outcome.",
    status: "Outcome needed",
    caseTitle: "Case 15154531492",
    caseSummary: "Outcome is not final until the user records what happened.",
    events: ["Assistant gave support path", "User must record outcome", "Knowledge teaching remains locked"],
    missing: ["What actually fixed it, if anything", "What did not work", "Whether this was handed off or resolved"],
    nowTitle: "Pick one outcome and write the evidence.",
    nowText: "Still working, proven fix found, or no proven fix / handed off.",
    whyTitle: "The outcome controls everything later.",
    whyText: "Agents cannot safely learn from a case until the final result is clear.",
    nextTitle: "Optional agent teaching.",
    nextText: "Only proven, reviewed outcomes can become reusable guidance.",
    card: "resolve",
  },
  {
    id: "teach",
    label: "Teach Agents",
    agent: "Knowledge Review",
    title: "Decide whether agents can reuse the lesson",
    subtitle: "Knowledge is a later safety decision, not the default next step after chat.",
    status: "Teaching locked until proven",
    caseTitle: "Case 15154531492",
    caseSummary: "The current source has attempted steps, but no proven final fix.",
    events: ["Case outcome reviewed", "Draft lesson blocked from agent guidance", "Evidence remains searchable as case history"],
    missing: ["Proven final fix", "Root cause", "Reusable scope", "Human approval"],
    nowTitle: "Keep this as case history unless the fix is proven.",
    nowText: "The safest action is not to publish guidance from attempted steps.",
    whyTitle: "Agent guidance must be trustworthy.",
    whyText: "The agent team should learn from verified outcomes, not unresolved or failed attempts.",
    nextTitle: "Publish only after review.",
    nextText: "Once proven and approved, the lesson becomes trusted guidance for future cases.",
    card: "teach",
  },
];

const supportSurfaces = {
  history: {
    label: "History",
    title: "Sessions become case history",
    cards: [
      ["Linked conversation", "The chat that created this case stays attached here. The user does not need to open a Sessions table to find it.", "Source linked"],
      ["Parser run", "Upload image, parser output, and downstream agent handoffs are visible as an audit trail.", "Pipeline event"],
      ["Previous chat", "New chat does not erase the work. The prior escalation remains in the active case history.", "Saved"],
    ],
  },
  decisions: {
    label: "Decisions",
    title: "Attention is only shown when it blocks progress",
    cards: [
      ["Missing outcome", "The case cannot be done until the user records what happened.", "Needs decision"],
      ["Unproven fix", "Attempted steps are preserved, but blocked from agent recommendation.", "Blocked"],
      ["Case link quality", "If a chat is unlinked, the action is shown here as Link to case, not as a separate table chore.", "Fix link"],
    ],
  },
  issues: {
    label: "Known Issues",
    title: "Investigations support the active case",
    cards: [
      ["INV-148433", "Payroll export issue with year-end filing flow. Possible match, but not enough to declare root cause.", "Possible match"],
      ["INV-148450", "CPP/EI setup fields unavailable during payroll setup. Similar category, weak symptom match.", "Weak match"],
      ["Workaround status", "No current workaround is confirmed for this T4 Summary symptom.", "Missing"],
    ],
  },
  teaching: {
    label: "Teach Agents",
    title: "Knowledge is governed memory",
    cards: [
      ["Case history only", "This case can remain searchable evidence even if agents cannot recommend it as a fix.", "Safe default"],
      ["Publish blockers", "Final working fix, root cause, scope, and approval are required before agent reuse.", "4 missing"],
      ["Future guidance", "When proven, the lesson becomes trusted guidance for parser, triage, and QBO assistant.", "Later"],
    ],
  },
};

let activeStageIndex = 0;
let activeSupport = "history";

const pipelineEl = document.querySelector("#pipeline");
const supportTabsEl = document.querySelector("#supportTabs");
const supportDetailEl = document.querySelector("#supportDetail");
const primaryCardEl = document.querySelector("#primaryCard");
const jumpNextEl = document.querySelector("#jumpNext");

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

function renderPipeline() {
  pipelineEl.innerHTML = stages
    .map((stage, index) => {
      const stateClass =
        index === activeStageIndex ? "is-active" : index < activeStageIndex ? "is-done" : "";
      return `
        <button class="stage-button ${stateClass}" type="button" data-stage="${index}" aria-current="${index === activeStageIndex}">
          <span class="stage-topline">
            <span class="stage-index">${index + 1}</span>
            <span class="stage-agent">${stage.agent}</span>
          </span>
          <strong>${stage.label}</strong>
          <small>${shortStageHint(stage.id)}</small>
        </button>
      `;
    })
    .join("");

  pipelineEl.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      activeStageIndex = Number(button.dataset.stage);
      chooseDefaultSupport();
      render();
    });
  });
}

function shortStageHint(id) {
  const hints = {
    intake: "Capture source evidence.",
    investigate: "Bring in INV and history.",
    triage: "Turn evidence into direction.",
    resolve: "Record the outcome.",
    teach: "Publish only proven lessons.",
  };
  return hints[id];
}

function renderStage() {
  const stage = stages[activeStageIndex];
  setText("caseStatusLabel", stage.status);
  setText("pipelineTitle", activeStageIndex === 0 ? "Turn a screenshot into a finished escalation." : "Work one escalation from evidence to outcome.");
  setText("caseTitle", stage.caseTitle);
  setText("caseSummary", stage.caseSummary);
  setText("stageNumber", String(activeStageIndex + 1));
  setText("stageLabel", stage.label);
  setText("stageTitle", stage.title);
  setText("stageSubtitle", stage.subtitle);
  setText("nowTitle", stage.nowTitle);
  setText("nowText", stage.nowText);
  setText("whyTitle", stage.whyTitle);
  setText("whyText", stage.whyText);
  setText("nextTitle", stage.nextTitle);
  setText("nextText", stage.nextText);

  document.querySelector("#eventList").innerHTML = stage.events.map((item) => `<li>${item}</li>`).join("");
  document.querySelector("#missingList").innerHTML = stage.missing.map((item) => `<li class="is-missing">${item}</li>`).join("");
  jumpNextEl.textContent = activeStageIndex === stages.length - 1 ? "Back to intake" : "Next stage";
  primaryCardEl.innerHTML = renderPrimaryCard(stage);
  bindPrimaryActions();
}

function renderPrimaryCard(stage) {
  if (stage.card === "drop") {
    return `
      <div class="drop-zone">
        <div>
          <span class="drop-icon" aria-hidden="true"></span>
          <h3>Drop image here</h3>
          <p>Paste or upload the escalation screenshot. The agent pipeline stays visible so the user always knows what happens next.</p>
          <button class="primary-action" type="button" data-action="sample">Use sample screenshot</button>
        </div>
      </div>
    `;
  }

  if (stage.card === "artifacts") {
    return `
      <div class="artifact-grid">
        ${artifact("Parsed case", "Case 15154531492", "Payroll / Resolved marker / T4 XML missing summary", "is-green")}
        ${artifact("INV Search", "2 possible matches", "No exact active investigation confirmed yet.", "is-yellow")}
        ${artifact("Similar cases", "1 strong history match", "Same symptom, but no proven fix recorded.", "is-yellow")}
        ${artifact("What changed", "Investigations are evidence here", "The user does not browse an INV library first.", "is-green")}
      </div>
    `;
  }

  if (stage.card === "triage") {
    return `
      <div class="artifact-grid">
        ${artifact("Likely category", "Payroll year-end filing", "Issue is in the T4 XML export flow.", "is-green")}
        ${artifact("Key signal", "T4 slips present, summary absent", "Strong symptom signal for triage.", "is-green")}
        ${artifact("Risk", "No proven fix in source case", "Do not tell agents this is solved guidance.", "is-yellow")}
        ${artifact("Recommended next action", "Verify employer and filing readiness data", "Then regenerate XML and record outcome.", "")}
      </div>
    `;
  }

  if (stage.card === "resolve") {
    return `
      <div class="choice-grid">
        <article class="choice">
          <span class="tag">Still working</span>
          <h3>Save blocker and next step</h3>
          <p>Use when the case is active and needs more investigation.</p>
          <button class="ghost-action" type="button">Save working state</button>
        </article>
        <article class="choice is-primary">
          <span class="tag is-green">Proven fix found</span>
          <h3>Write what actually fixed it</h3>
          <p>This is the only path that can later teach agents.</p>
          <button class="primary-action" type="button" data-action="teach">Record fix</button>
        </article>
        <article class="choice is-warning">
          <span class="tag is-yellow">No proven fix</span>
          <h3>Save as handoff or case history</h3>
          <p>Preserve evidence without pretending it is reusable guidance.</p>
          <button class="ghost-action" type="button">Save handoff</button>
        </article>
      </div>
    `;
  }

  return `
    <div class="choice-grid">
      <article class="choice is-warning">
        <span class="tag is-yellow">Recommended</span>
        <h3>Keep as case history</h3>
        <p>The source has attempted steps, but no proven final fix.</p>
        <button class="primary-action" type="button">Save as case history</button>
      </article>
      <article class="choice">
        <span class="tag">Correct lesson</span>
        <h3>Add the proven fix</h3>
        <p>Only choose this if a human can prove the actual working fix.</p>
        <button class="ghost-action" type="button">Add fix</button>
      </article>
      <article class="choice is-danger">
        <span class="tag is-red">Reject</span>
        <h3>Reject generated draft</h3>
        <p>Use when the extracted lesson is misleading or unsupported.</p>
        <button class="ghost-action" type="button">Reject draft</button>
      </article>
    </div>
  `;
}

function artifact(label, title, text, tagClass) {
  return `
    <article class="artifact">
      <span class="tag ${tagClass}">${label}</span>
      <h3>${title}</h3>
      <p>${text}</p>
    </article>
  `;
}

function bindPrimaryActions() {
  primaryCardEl.querySelectorAll("[data-action='sample']").forEach((button) => {
    button.addEventListener("click", () => {
      activeStageIndex = 1;
      activeSupport = "issues";
      render();
    });
  });

  primaryCardEl.querySelectorAll("[data-action='teach']").forEach((button) => {
    button.addEventListener("click", () => {
      activeStageIndex = 4;
      activeSupport = "teaching";
      render();
    });
  });
}

function chooseDefaultSupport() {
  const stageId = stages[activeStageIndex].id;
  const map = {
    intake: "history",
    investigate: "issues",
    triage: "decisions",
    resolve: "decisions",
    teach: "teaching",
  };
  activeSupport = map[stageId];
}

function renderSupportTabs() {
  supportTabsEl.innerHTML = Object.entries(supportSurfaces)
    .map(([id, surface]) => {
      return `<button class="tab-button ${id === activeSupport ? "is-active" : ""}" type="button" data-support="${id}" role="tab" aria-selected="${id === activeSupport}">${surface.label}</button>`;
    })
    .join("");

  supportTabsEl.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      activeSupport = button.dataset.support;
      renderSupport();
      renderSupportTabs();
    });
  });
}

function renderSupport() {
  const surface = supportSurfaces[activeSupport];
  supportDetailEl.innerHTML = `
    <div class="support-card">
      <p class="eyebrow">Why this exists</p>
      <h3>${surface.title}</h3>
      <p>${surfaceIntro(activeSupport)}</p>
    </div>
    ${surface.cards
      .map(([title, text, tag]) => {
        return `
          <article class="support-card">
            <span class="tag">${tag}</span>
            <h3>${title}</h3>
            <p>${text}</p>
          </article>
        `;
      })
      .join("")}
  `;
}

function surfaceIntro(id) {
  const copy = {
    history: "Sessions are useful, but only as evidence attached to the case.",
    decisions: "Attention is not a destination. It is the list of choices blocking progress.",
    issues: "Investigations help the active case when they provide relevant known-issue evidence.",
    teaching: "Knowledge is governed memory for agents after a case has a proven outcome.",
  };
  return copy[id];
}

function render() {
  renderPipeline();
  renderStage();
  renderSupportTabs();
  renderSupport();
}

jumpNextEl.addEventListener("click", () => {
  activeStageIndex = activeStageIndex === stages.length - 1 ? 0 : activeStageIndex + 1;
  chooseDefaultSupport();
  render();
});

render();
