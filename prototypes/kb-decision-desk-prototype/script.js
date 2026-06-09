const OUTCOMES = {
  trusted: {
    label: "Trusted guidance",
    action: "Approve for agents",
    statusClass: "safe",
    statusTitle: "Ready for agent guidance",
    statusDetail: "Agents can use it only inside the approved scope.",
    consequenceTitle: "Agents may use this",
    consequenceLead: "Final and specialist agents can cite this as reviewed guidance.",
    bullets: [
      "Use in customer-facing recommendations when the case matches the scope.",
      "Show the exclusions before suggesting the fix.",
      "Attach source evidence when confidence is challenged."
    ]
  },
  history: {
    label: "Case history only",
    action: "Keep as case history",
    statusClass: "history",
    statusTitle: "Useful evidence, not guidance",
    statusDetail: "Agents can compare cases but cannot recommend this as the answer.",
    consequenceTitle: "Agents may investigate with this",
    consequenceLead: "This can help agents spot similar patterns without turning it into advice.",
    bullets: [
      "Use for similarity, timeline reconstruction, and research leads.",
      "Do not quote it as a recommended fix.",
      "Ask a human reviewer before reuse as guidance."
    ]
  },
  reject: {
    label: "Rejected",
    action: "Reject knowledge",
    statusClass: "blocked",
    statusTitle: "Blocked from agent use",
    statusDetail: "The proposal stays in the record but agents cannot use it.",
    consequenceTitle: "Agents cannot use this",
    consequenceLead: "The item remains visible for audit only.",
    bullets: [
      "Exclude from final answers and triage suggestions.",
      "Keep the source case available for reviewer traceability.",
      "Use the reviewer note to explain the rejection."
    ]
  },
  deprecate: {
    label: "Deprecated",
    action: "Deprecate guidance",
    statusClass: "blocked",
    statusTitle: "Retired from new cases",
    statusDetail: "Agents can see it only as old context.",
    consequenceTitle: "Agents may not use this for new work",
    consequenceLead: "Existing history stays searchable, but new recommendations must avoid it.",
    bullets: [
      "Warn agents that the guidance is stale or replaced.",
      "Keep it linked to old cases that depended on it.",
      "Require a newer trusted item before recommending a fix."
    ]
  }
};

const records = [
  {
    id: "kb-eft-notice",
    title: "Payroll tax agency notice blocks EFT setup",
    source: "Source case ESC-7842",
    domain: "QBO Payroll",
    urgency: "urgent",
    readiness: "blocked",
    ask: "Decide whether agents may reuse this as guidance or keep it as case evidence only.",
    statusTitle: "Decision required",
    statusDetail: "Missing exclusion confirmation",
    proposedOutcome: "trusted",
    decision: "trusted",
    reviewerNote: "Need to confirm whether this applies to agency registration notices only.",
    fields: {
      summary: "When payroll EFT setup is blocked by a state agency notice, verify agency registration, FEIN, and payroll tax account number before telling the customer to reconnect or refile.",
      rootCause: "The account was technically connected, but the agency registration did not match the business tax profile in QBO Payroll.",
      fix: "Confirm the agency account number and legal business identity, update the payroll tax setup, then retry EFT enrollment after the agency notice clears.",
      scope: "Use for QBO Payroll cases where EFT enrollment is blocked by a state agency registration or account mismatch notice.",
      exclusions: "Do not use for garnishments, federal EFTPS enrollment, tax penalty disputes, or cases without agency notice evidence."
    },
    originalFields: null,
    requirements: [
      { id: "evidence", text: "Source case and customer-facing notice are attached", checked: true },
      { id: "scope", text: "Scope says exactly when agents may use it", checked: true },
      { id: "exclusions", text: "Reviewer confirmed exclusions for garnishment and federal EFTPS cases", checked: false }
    ],
    evidence: [
      {
        id: "notice",
        title: "Agency notice excerpt",
        meta: "Customer upload, ESC-7842",
        excerpt: "The state notice references a registration mismatch and asks the employer to confirm the payroll tax account before electronic payment setup continues.",
        supports: "Confirms this is an agency registration issue, not a generic QBO connection error.",
        missing: "Does not show whether the customer also had garnishment payment setup enabled.",
        impact: "Agents can rely on it only after exclusions are confirmed.",
        audit: ["Captured from source case", "Agent drafted guidance", "Human review opened"]
      },
      {
        id: "manager",
        title: "Reviewer manager note",
        meta: "Internal note, same case",
        excerpt: "Manager marked the workaround as repeatable for state payroll account mismatches after identity and account number verification.",
        supports: "Shows the fix was considered repeatable by a human reviewer.",
        missing: "Needs a current product help link or second matching case before broad publication.",
        impact: "Good support for case-history use, partial support for trusted guidance.",
        audit: ["Manager note added", "Scope warning generated"]
      }
    ]
  },
  {
    id: "kb-bank-feed",
    title: "Duplicate bank feed imports after reconnect",
    source: "Source cases ESC-7719 and ESC-7791",
    domain: "Banking",
    urgency: "ready",
    readiness: "ready",
    ask: "Approve a narrow fix for agents or keep the outcome as case history.",
    statusTitle: "Ready to approve",
    statusDetail: "Evidence and exclusions are complete",
    proposedOutcome: "trusted",
    decision: "trusted",
    reviewerNote: "Keep scope limited to reconnect duplicates within the same statement period.",
    fields: {
      summary: "When a reconnect imports duplicate bank feed transactions for the same statement period, agents may advise excluding the duplicate feed entries after matching against bank register entries.",
      rootCause: "The reconnect pulled an overlapping transaction window after the bank connection token was refreshed.",
      fix: "Compare imported feed rows against the register, exclude duplicates from the feed, then reconcile against the bank statement before closing the case.",
      scope: "Use when the duplicates came from a bank feed reconnect and the register already contains the matching transactions.",
      exclusions: "Do not use for duplicate deposits created by rules, manual uploads, or opening-balance corrections."
    },
    originalFields: null,
    requirements: [
      { id: "evidence", text: "Two matching source cases are attached", checked: true },
      { id: "scope", text: "Scope and exclusions are specific", checked: true },
      { id: "validation", text: "Resolution was validated after reconciliation", checked: true }
    ],
    evidence: [
      {
        id: "case-a",
        title: "Case ESC-7719 resolution",
        meta: "Closed case",
        excerpt: "The specialist excluded feed duplicates after confirming the register already contained the posted bank transactions.",
        supports: "Confirms the direct fix and final reconciliation outcome.",
        missing: "No missing evidence for this narrow scope.",
        impact: "Agents may use this as trusted guidance when the scope matches.",
        audit: ["Case closed", "Outcome extracted", "Reviewer validation completed"]
      },
      {
        id: "case-b",
        title: "Case ESC-7791 comparison",
        meta: "Similar case",
        excerpt: "The same duplicate import pattern appeared after reconnecting the account and was resolved without changing the opening balance.",
        supports: "Second matching case reduces one-off risk.",
        missing: "None for the proposed scope.",
        impact: "Supports agent reuse in banking escalation triage.",
        audit: ["Similarity link added", "Scope checked"]
      }
    ]
  },
  {
    id: "kb-sales-tax",
    title: "Sales tax balance mismatch after migration",
    source: "Source case ESC-7620",
    domain: "Sales Tax",
    urgency: "urgent",
    readiness: "blocked",
    ask: "Resolve a contradiction before agents can use this outside investigation.",
    statusTitle: "Contradicted",
    statusDetail: "One source points to migration, another points to filing setup",
    proposedOutcome: "history",
    decision: "history",
    reviewerNote: "Needs a second reviewer. Keep as case history until migration and filing setup causes are separated.",
    fields: {
      summary: "A migrated sales tax balance can appear wrong when the imported liability period does not match the filing setup used in QBO.",
      rootCause: "Unclear. The source case mentions migration timing, but a later note suggests an incorrect filing frequency.",
      fix: "Do not publish a fix yet. Compare filing setup, historical liabilities, and migration cutover dates before advising the customer.",
      scope: "Potentially useful for sales tax mismatch investigations after migration.",
      exclusions: "Do not use as final guidance until the migration cause is separated from filing-frequency setup errors."
    },
    originalFields: null,
    requirements: [
      { id: "contradiction", text: "Contradicting source is resolved", checked: false },
      { id: "fix", text: "Exact fix is validated in a closed case", checked: false },
      { id: "scope", text: "Scope separates migration from filing setup", checked: true }
    ],
    evidence: [
      {
        id: "migration-note",
        title: "Migration note",
        meta: "Implementation note",
        excerpt: "The balance changed after imported historical liabilities were mapped into the wrong filing period.",
        supports: "Supports migration as one possible cause.",
        missing: "Does not rule out a filing-frequency setup issue.",
        impact: "Agents may use it as an investigation lead only.",
        audit: ["Imported from case", "Contradiction detected"]
      },
      {
        id: "setup-note",
        title: "Follow-up setup note",
        meta: "Specialist comment",
        excerpt: "The filing frequency was changed after migration, which may have shifted the visible balance.",
        supports: "Explains why the first proposed root cause may be incomplete.",
        missing: "Needs human separation of two possible causes.",
        impact: "Blocks trusted guidance until reviewed.",
        audit: ["Specialist comment added", "Agent-use restricted"]
      }
    ]
  },
  {
    id: "kb-1099",
    title: "1099 vendor TIN correction in a closed year",
    source: "Source conversation CONV-1184",
    domain: "Compliance",
    urgency: "normal",
    readiness: "blocked",
    ask: "Reject unsafe guidance or keep only the source conversation for audit.",
    statusTitle: "Unsafe proposal",
    statusDetail: "Compliance risk is not bounded",
    proposedOutcome: "reject",
    decision: "reject",
    reviewerNote: "Reject as written. It sounds like tax advice and lacks current compliance source material.",
    fields: {
      summary: "A vendor TIN correction may require amended 1099 handling after year close.",
      rootCause: "The vendor profile was corrected after forms were already issued.",
      fix: "Do not publish. The proposed fix lacks current compliance source material and should route to an expert reviewer.",
      scope: "Use only to identify cases that need compliance review.",
      exclusions: "Do not let agents recommend filing steps, penalty handling, or amendment instructions from this record."
    },
    originalFields: null,
    requirements: [
      { id: "source", text: "Current compliance source is attached", checked: false },
      { id: "expert", text: "Expert reviewer has approved wording", checked: false },
      { id: "boundary", text: "Agent boundary prevents tax advice", checked: true }
    ],
    evidence: [
      {
        id: "conversation",
        title: "Customer conversation",
        meta: "Transcript excerpt",
        excerpt: "The customer asked whether they could correct the TIN and reissue a form after the filing year had closed.",
        supports: "Shows the customer problem and why agents need a boundary.",
        missing: "No validated compliance source or approved response language.",
        impact: "Agents should escalate rather than advise.",
        audit: ["Conversation captured", "Compliance risk flagged"]
      },
      {
        id: "agent-draft",
        title: "Agent draft",
        meta: "Rejected proposal",
        excerpt: "The draft suggested an amendment path without citing a current source or reviewer approval.",
        supports: "Supports rejection of the draft.",
        missing: "A verified compliance workflow, if one exists.",
        impact: "Agents cannot use this draft in final answers.",
        audit: ["Draft generated", "Unsafe wording detected"]
      }
    ]
  }
];

records.forEach((record) => {
  record.originalFields = { ...record.fields };
});

let selectedRecordId = records[0].id;
let activeFilter = "all";
let activeEvidenceId = records[0].evidence[0].id;
let toastTimer = null;

const elements = {
  topRecordTitle: document.getElementById("topRecordTitle"),
  queueCount: document.getElementById("queueCount"),
  searchInput: document.getElementById("searchInput"),
  recordList: document.getElementById("recordList"),
  recordSource: document.getElementById("recordSource"),
  recordTitle: document.getElementById("recordTitle"),
  recordAsk: document.getElementById("recordAsk"),
  decisionStatus: document.getElementById("decisionStatus"),
  summaryInput: document.getElementById("summaryInput"),
  rootCauseInput: document.getElementById("rootCauseInput"),
  fixInput: document.getElementById("fixInput"),
  scopeInput: document.getElementById("scopeInput"),
  exclusionsInput: document.getElementById("exclusionsInput"),
  evidenceList: document.getElementById("evidenceList"),
  requirementsList: document.getElementById("requirementsList"),
  outcomeOptions: document.getElementById("outcomeOptions"),
  agentUsePanel: document.getElementById("agentUsePanel"),
  reviewerNoteInput: document.getElementById("reviewerNoteInput"),
  applyDecisionButton: document.getElementById("applyDecisionButton"),
  actionReason: document.getElementById("actionReason"),
  restoreButton: document.getElementById("restoreButton"),
  openAllEvidenceButton: document.getElementById("openAllEvidenceButton"),
  openAuditButton: document.getElementById("openAuditButton"),
  drawer: document.getElementById("evidenceDrawer"),
  drawerSource: document.getElementById("drawerSource"),
  drawerTitle: document.getElementById("drawerTitle"),
  drawerExcerpt: document.getElementById("drawerExcerpt"),
  drawerSupports: document.getElementById("drawerSupports"),
  drawerMissing: document.getElementById("drawerMissing"),
  drawerImpact: document.getElementById("drawerImpact"),
  drawerAudit: document.getElementById("drawerAudit"),
  toast: document.getElementById("toast")
};

function selectedRecord() {
  return records.find((record) => record.id === selectedRecordId) || records[0];
}

function requirementSummary(record) {
  const missing = record.requirements.filter((requirement) => !requirement.checked);
  if (!missing.length) {
    return "All publish requirements met";
  }
  if (missing.length === 1) {
    return `Missing: ${missing[0].text}`;
  }
  return `Missing: ${missing.length} requirements`;
}

function recordMatchesFilter(record) {
  if (activeFilter === "all") return true;
  if (activeFilter === "urgent") return record.urgency === "urgent";
  if (activeFilter === "ready") return record.readiness === "ready";
  if (activeFilter === "blocked") return record.readiness === "blocked";
  return true;
}

function recordMatchesSearch(record, query) {
  if (!query) return true;
  const text = [
    record.title,
    record.source,
    record.domain,
    record.ask,
    record.statusTitle,
    record.statusDetail,
    record.fields.summary,
    record.fields.rootCause,
    record.fields.fix,
    record.fields.scope,
    record.fields.exclusions,
    ...record.evidence.flatMap((evidence) => [evidence.title, evidence.meta, evidence.excerpt, evidence.supports, evidence.missing])
  ].join(" ").toLowerCase();
  return text.includes(query.toLowerCase());
}

function createPill(label, className = "") {
  const pill = document.createElement("span");
  pill.className = `small-pill ${className}`.trim();
  pill.textContent = label;
  return pill;
}

function renderRecordList() {
  const query = elements.searchInput.value.trim();
  const visibleRecords = records.filter((record) => recordMatchesFilter(record) && recordMatchesSearch(record, query));
  elements.recordList.innerHTML = "";
  elements.queueCount.textContent = `${visibleRecords.length} ${visibleRecords.length === 1 ? "record" : "records"}`;

  if (!visibleRecords.length) {
    const empty = document.createElement("div");
    empty.className = "record-row";
    empty.innerHTML = `<strong>No matching knowledge</strong><p class="record-meta">Change the search or filter to keep reviewing.</p>`;
    elements.recordList.appendChild(empty);
    return;
  }

  visibleRecords.forEach((record) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `record-row ${record.id === selectedRecordId ? "selected" : ""}`;
    row.dataset.recordId = record.id;

    const titleLine = document.createElement("div");
    titleLine.className = "record-title-line";
    const title = document.createElement("strong");
    title.textContent = record.title;
    titleLine.appendChild(title);

    const decision = OUTCOMES[record.decision];
    const statusPillClass = record.readiness === "ready" ? "safe" : record.decision === "history" ? "history" : "blocked";
    titleLine.appendChild(createPill(record.urgency === "urgent" ? "Now" : "Later", record.urgency === "urgent" ? "urgent" : ""));

    const meta = document.createElement("p");
    meta.className = "record-meta";
    meta.textContent = `${record.source} - ${requirementSummary(record)}`;

    const flags = document.createElement("div");
    flags.className = "record-flags";
    flags.appendChild(createPill(record.domain));
    flags.appendChild(createPill(decision.label, statusPillClass));

    row.append(titleLine, meta, flags);
    row.addEventListener("click", () => {
      selectedRecordId = record.id;
      activeEvidenceId = record.evidence[0].id;
      render();
    });
    elements.recordList.appendChild(row);
  });
}

function renderSelectedRecord() {
  const record = selectedRecord();
  elements.topRecordTitle.textContent = record.title;
  elements.recordSource.textContent = record.source;
  elements.recordTitle.textContent = record.title;
  elements.recordAsk.textContent = record.ask;
  elements.summaryInput.value = record.fields.summary;
  elements.rootCauseInput.value = record.fields.rootCause;
  elements.fixInput.value = record.fields.fix;
  elements.scopeInput.value = record.fields.scope;
  elements.exclusionsInput.value = record.fields.exclusions;
  elements.reviewerNoteInput.value = record.reviewerNote;

  renderStatus(record);
  renderEvidence(record);
  renderRequirements(record);
  renderOutcomes(record);
  renderAgentUse(record);
  updatePrimaryAction(record);
}

function renderStatus(record) {
  const outcome = OUTCOMES[record.decision];
  elements.decisionStatus.className = `decision-status ${outcome.statusClass}`;
  elements.decisionStatus.innerHTML = `
    <strong>${record.decision === record.proposedOutcome ? record.statusTitle : outcome.statusTitle}</strong>
    <small>${record.decision === record.proposedOutcome ? record.statusDetail : outcome.statusDetail}</small>
  `;
}

function renderEvidence(record) {
  elements.evidenceList.innerHTML = "";
  record.evidence.forEach((evidence) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "evidence-row";
    row.dataset.evidenceId = evidence.id;
    row.innerHTML = `<strong>${evidence.title}</strong><span>${evidence.meta}</span>`;
    row.addEventListener("click", () => openEvidenceDrawer(evidence.id));
    elements.evidenceList.appendChild(row);
  });
}

function renderRequirements(record) {
  elements.requirementsList.innerHTML = "<h4>Required before trusted guidance</h4>";
  record.requirements.forEach((requirement) => {
    const label = document.createElement("label");
    label.className = "requirement-check";
    label.innerHTML = `
      <input type="checkbox" ${requirement.checked ? "checked" : ""} data-requirement-id="${requirement.id}">
      <span>${requirement.text}</span>
    `;
    elements.requirementsList.appendChild(label);
  });
}

function renderOutcomes(record) {
  const buttons = elements.outcomeOptions.querySelectorAll("button");
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.outcome === record.decision);
  });
}

function renderAgentUse(record) {
  const outcome = OUTCOMES[record.decision];
  const missing = record.requirements.filter((requirement) => !requirement.checked);
  const gate = record.decision === "trusted" && missing.length ? `Publication is blocked by ${missing.length} missing requirement${missing.length === 1 ? "" : "s"}.` : "The selected decision controls what agents may do next.";
  elements.agentUsePanel.innerHTML = `
    <h3>${outcome.consequenceTitle}</h3>
    <p><strong>${outcome.label}:</strong> ${outcome.consequenceLead}</p>
    <ul>
      ${outcome.bullets.map((bullet) => `<li>${bullet}</li>`).join("")}
    </ul>
    <p class="record-meta">${gate}</p>
  `;
}

function updatePrimaryAction(record) {
  const outcome = OUTCOMES[record.decision];
  const missing = record.requirements.filter((requirement) => !requirement.checked);
  elements.applyDecisionButton.textContent = outcome.action;

  if (record.decision === "trusted" && missing.length) {
    elements.applyDecisionButton.disabled = true;
    elements.actionReason.textContent = `Blocked: ${missing.map((requirement) => requirement.text).join("; ")}.`;
    return;
  }

  elements.applyDecisionButton.disabled = false;
  if (record.decision === "trusted") {
    elements.actionReason.textContent = "Agents will be allowed to use this only within the approved scope and exclusions.";
  } else if (record.decision === "history") {
    elements.actionReason.textContent = "Agents can search this as evidence but cannot present it as guidance.";
  } else if (record.decision === "reject") {
    elements.actionReason.textContent = "Agents will be blocked from using this proposal.";
  } else {
    elements.actionReason.textContent = "Agents will avoid this for new cases and see it only as old context.";
  }
}

function saveFieldsToRecord(record) {
  record.fields.summary = elements.summaryInput.value.trim();
  record.fields.rootCause = elements.rootCauseInput.value.trim();
  record.fields.fix = elements.fixInput.value.trim();
  record.fields.scope = elements.scopeInput.value.trim();
  record.fields.exclusions = elements.exclusionsInput.value.trim();
  record.reviewerNote = elements.reviewerNoteInput.value.trim();
}

function openEvidenceDrawer(evidenceId = activeEvidenceId, auditOnly = false) {
  const record = selectedRecord();
  const evidence = record.evidence.find((item) => item.id === evidenceId) || record.evidence[0];
  activeEvidenceId = evidence.id;
  elements.drawerSource.textContent = auditOnly ? `${record.source} audit` : evidence.meta;
  elements.drawerTitle.textContent = auditOnly ? `${record.title} audit trail` : evidence.title;
  elements.drawerExcerpt.textContent = auditOnly ? `Decision state: ${OUTCOMES[record.decision].label}. Reviewer note: ${record.reviewerNote || "No note yet."}` : evidence.excerpt;
  elements.drawerSupports.textContent = auditOnly ? record.statusTitle : evidence.supports;
  elements.drawerMissing.textContent = auditOnly ? requirementSummary(record) : evidence.missing;
  elements.drawerImpact.textContent = auditOnly ? OUTCOMES[record.decision].consequenceLead : evidence.impact;
  elements.drawerAudit.innerHTML = "";
  const auditItems = auditOnly
    ? ["Source captured", "Agent proposed knowledge", "Human review opened", `${OUTCOMES[record.decision].label} selected`]
    : evidence.audit;
  auditItems.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    elements.drawerAudit.appendChild(li);
  });
  elements.drawer.classList.add("open");
  elements.drawer.setAttribute("aria-hidden", "false");
}

function closeEvidenceDrawer() {
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2800);
}

function render() {
  renderRecordList();
  renderSelectedRecord();
}

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((filterButton) => {
      filterButton.classList.toggle("active", filterButton === button);
    });
    renderRecordList();
  });
});

elements.searchInput.addEventListener("input", renderRecordList);

elements.outcomeOptions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-outcome]");
  if (!button) return;
  const record = selectedRecord();
  saveFieldsToRecord(record);
  record.decision = button.dataset.outcome;
  render();
});

elements.requirementsList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[data-requirement-id]");
  if (!checkbox) return;
  const record = selectedRecord();
  const requirement = record.requirements.find((item) => item.id === checkbox.dataset.requirementId);
  if (requirement) {
    requirement.checked = checkbox.checked;
    render();
  }
});

[
  elements.summaryInput,
  elements.rootCauseInput,
  elements.fixInput,
  elements.scopeInput,
  elements.exclusionsInput,
  elements.reviewerNoteInput
].forEach((input) => {
  input.addEventListener("input", () => {
    saveFieldsToRecord(selectedRecord());
  });
});

elements.restoreButton.addEventListener("click", () => {
  const record = selectedRecord();
  record.fields = { ...record.originalFields };
  renderSelectedRecord();
  showToast("Proposal restored for the selected knowledge item.");
});

elements.openAllEvidenceButton.addEventListener("click", () => openEvidenceDrawer(activeEvidenceId));
elements.openAuditButton.addEventListener("click", () => openEvidenceDrawer(activeEvidenceId, true));

elements.applyDecisionButton.addEventListener("click", () => {
  const record = selectedRecord();
  saveFieldsToRecord(record);
  const outcome = OUTCOMES[record.decision];
  showToast(`${outcome.label} applied to "${record.title}". Agent permissions updated in the prototype.`);
  if (record.decision === "trusted") {
    record.readiness = "ready";
    record.statusTitle = "Approved";
    record.statusDetail = "Trusted guidance is available to agents";
  } else {
    record.readiness = "blocked";
    record.statusTitle = outcome.statusTitle;
    record.statusDetail = outcome.statusDetail;
  }
  render();
});

document.querySelectorAll("[data-close-drawer]").forEach((control) => {
  control.addEventListener("click", closeEvidenceDrawer);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeEvidenceDrawer();
  }
});

render();
