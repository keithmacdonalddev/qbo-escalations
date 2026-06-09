const records = [
  {
    id: "kb-bank-duplicates",
    title: "Bank-feed duplicates after reconnect",
    outcome: "Customer confirmed fix",
    decision: "needs_review",
    risk: "ready",
    source: "Case QBO-2419",
    sourceDetail: "Live support case plus customer confirmation",
    proposedBy: "Escalation specialist agent",
    lastChecked: "Today",
    recommended: "trusted",
    question: "Publish this as trusted guidance?",
    why: "The fix is confirmed, scoped, and backed by source evidence. Publishing allows agents to reuse it when the same bank-feed pattern appears.",
    proposed:
      "When duplicate bank transactions appear immediately after reconnecting a feed, undo newly categorized matches first, then exclude duplicate unmatched feed entries before reconciling. Do not delete already reconciled transactions.",
    fields: {
      summary: "Duplicate bank-feed rows appeared after the customer reconnected an existing bank account.",
      rootCause: "The reconnect pulled already-reviewed feed rows into the unmatched feed again.",
      fix:
        "Undo the new categorized matches, compare feed rows against the register, exclude exact duplicate unmatched feed rows, then reconcile only after the register balances.",
      scope: "QuickBooks Online bank feeds where a reconnect or refresh created duplicate unmatched feed entries.",
      exclusions: "Do not apply when the duplicates are already reconciled register transactions or when the bank imported a corrected replacement file.",
      notes: "Customer confirmed the register balance after exclusions. Keep the delete warning prominent."
    },
    requirements: [
      { label: "Confirmed human outcome", state: "ok" },
      { label: "Source case and transcript attached", state: "ok" },
      { label: "Scope and exclusions are explicit", state: "ok" },
      { label: "No contradictory evidence found", state: "ok" }
    ],
    evidence: [
      {
        type: "Case note",
        title: "Customer confirmed register balance",
        detail: "After excluding duplicate unmatched rows, the customer reported that the bank register and reconciliation screen matched.",
        strength: "Strong"
      },
      {
        type: "Conversation",
        title: "Agent warned against deleting reconciled transactions",
        detail: "The transcript shows the customer was guided to undo new matches and exclude feed duplicates instead of deleting register entries.",
        strength: "Strong"
      },
      {
        type: "Screenshot",
        title: "Before and after feed comparison",
        detail: "The evidence bundle includes a side-by-side feed and register comparison with duplicate rows marked.",
        strength: "Medium"
      }
    ],
    audit: [
      "Draft proposed by escalation specialist agent today.",
      "Human outcome marked customer confirmed fix today.",
      "Risk check found no contradictions today."
    ]
  },
  {
    id: "kb-sales-tax-agency-rate",
    title: "Sales tax rate mismatch after agency update",
    outcome: "Tax filing unblocked",
    decision: "needs_review",
    risk: "contradicted",
    source: "Investigation QBO-2291",
    sourceDetail: "Two related cases disagree on the cause",
    proposedBy: "Tax specialist agent",
    lastChecked: "Yesterday",
    recommended: "case_history",
    question: "Keep this as evidence only?",
    why: "The item may help investigations, but it should not become reusable guidance until the agency-rate and manual-override causes are separated.",
    proposed:
      "If the collected sales tax rate differs from the agency notice after a rate update, remove the manual override and refresh the agency setting before filing.",
    fields: {
      summary: "A filing was blocked after the collected rate did not match the agency update.",
      rootCause: "Unclear. One source points to an agency rate change, while another points to a manual override.",
      fix: "Do not publish yet. Split the agency update pattern from the manual override pattern and verify jurisdiction-specific behavior.",
      scope: "Potentially QBO sales tax filings after rate changes.",
      exclusions: "Not safe for automated guidance in multi-jurisdiction filings or cases with manual rate overrides.",
      notes: "Needs a tax-review pass before final guidance. Keep source cases linked for investigation."
    },
    requirements: [
      { label: "Confirmed human outcome", state: "ok" },
      { label: "Source cases attached", state: "ok" },
      { label: "Contradiction resolved", state: "blocked" },
      { label: "Jurisdiction scope confirmed", state: "warn" }
    ],
    evidence: [
      {
        type: "Case note",
        title: "Agency update was mentioned",
        detail: "One case note says the state agency published a rate change before the filing window.",
        strength: "Medium"
      },
      {
        type: "Conversation",
        title: "Manual override was also present",
        detail: "A second source says the customer manually changed the rate on a transaction before the mismatch appeared.",
        strength: "Strong"
      },
      {
        type: "Reviewer note",
        title: "Cause needs separation",
        detail: "The current proposal combines two possible causes. Agents can use it for similarity, not final advice.",
        strength: "Strong"
      }
    ],
    audit: [
      "Tax specialist agent proposed draft yesterday.",
      "Reviewer marked contradiction after comparing related cases.",
      "Decision recommendation changed to evidence only."
    ]
  },
  {
    id: "kb-payroll-reversal",
    title: "Direct deposit reversal timing after payroll correction",
    outcome: "Payroll correction",
    decision: "needs_review",
    risk: "weak",
    source: "Case QBO-2350",
    sourceDetail: "Single case with partial outcome",
    proposedBy: "Payroll specialist agent",
    lastChecked: "3 days ago",
    recommended: "case_history",
    question: "Keep this as case history until stronger evidence arrives?",
    why: "The user outcome is useful, but the timing guidance depends on bank and payroll windows that were not fully verified.",
    proposed:
      "When payroll is corrected the same day, submit a direct deposit reversal before the processing cutoff and verify employee bank status before re-running payroll.",
    fields: {
      summary: "The customer corrected payroll after discovering a same-day direct deposit issue.",
      rootCause: "A payroll correction was made after direct deposit processing had already started.",
      fix:
        "Confirm the processing window, submit reversal only when eligible, and avoid re-running payroll until the bank status is verified.",
      scope: "Single-company payroll correction where direct deposit was still inside the reversal window.",
      exclusions: "Do not use for next-day funding, failed reversals, or employees whose banks already posted funds.",
      notes: "Needs one more verified case or official policy reference before publishing."
    },
    requirements: [
      { label: "Confirmed human outcome", state: "warn" },
      { label: "Policy source attached", state: "blocked" },
      { label: "Timing scope is explicit", state: "warn" },
      { label: "No contradiction found", state: "ok" }
    ],
    evidence: [
      {
        type: "Case note",
        title: "Customer avoided duplicate payroll",
        detail: "The case ended without a duplicate payroll run, but the reversal completion was not fully documented.",
        strength: "Medium"
      },
      {
        type: "Missing source",
        title: "Official cutoff reference needed",
        detail: "The current packet does not include the current payroll reversal cutoff policy.",
        strength: "Weak"
      }
    ],
    audit: [
      "Payroll agent proposed draft 3 days ago.",
      "Reviewer requested official policy source.",
      "Item remains evidence only until source is attached."
    ]
  },
  {
    id: "kb-undeposited-funds",
    title: "Undeposited Funds cleanup after matched deposits",
    outcome: "Reconciliation completed",
    decision: "trusted",
    risk: "trusted",
    source: "Published guide QBO-1887",
    sourceDetail: "Two confirmed cases and reviewer approval",
    proposedBy: "Human reviewer",
    lastChecked: "Last week",
    recommended: "deprecated",
    question: "Keep published, or deprecate if the process changed?",
    why: "This guidance is trusted today. Deprecate it only if newer evidence shows the cleanup path has changed.",
    proposed:
      "When payments remain in Undeposited Funds after deposits were matched, compare the deposit detail to received payments, remove duplicate manual deposits, and re-match the bank deposit to the correct grouped payment.",
    fields: {
      summary: "Payments remained in Undeposited Funds after the customer manually entered deposits and matched bank-feed deposits.",
      rootCause: "Manual deposit entries duplicated grouped received payments.",
      fix:
        "Compare the bank deposit to received payments, remove duplicate manual deposit entries, then match the bank-feed deposit to the grouped payment.",
      scope: "QBO reconciliation cleanup for duplicated manual deposits and matched bank deposits.",
      exclusions: "Do not use when funds are missing because a payment was never received or when deposits belong to separate bank accounts.",
      notes: "Trusted for final recommendations when the bank deposit and received payment amounts match."
    },
    requirements: [
      { label: "Confirmed human outcomes", state: "ok" },
      { label: "Evidence packet complete", state: "ok" },
      { label: "Scope and exclusions reviewed", state: "ok" },
      { label: "Still current", state: "ok" }
    ],
    evidence: [
      {
        type: "Published source",
        title: "Reviewer-approved cleanup guide",
        detail: "The guide includes the matched-deposit cleanup path, exclusions, and reconciliation warning.",
        strength: "Strong"
      },
      {
        type: "Case pair",
        title: "Two matching outcomes",
        detail: "Two separate cases reached reconciliation after duplicate manual deposits were removed.",
        strength: "Strong"
      }
    ],
    audit: [
      "Draft created from proven case outcome last month.",
      "Human reviewer published guidance last month.",
      "Current review confirmed still safe last week."
    ]
  },
  {
    id: "kb-clear-bank-rules",
    title: "Clear all bank rules to force a refresh",
    outcome: "Escalation avoided",
    decision: "rejected",
    risk: "risky",
    source: "Rejected proposal QBO-2210",
    sourceDetail: "AI proposal contradicted by reviewer",
    proposedBy: "General assistant",
    lastChecked: "2 weeks ago",
    recommended: "rejected",
    question: "Keep this rejected?",
    why: "The rejected record protects agents from repeating unsafe advice while preserving why it was refused.",
    proposed:
      "Delete all bank rules to force the feed to refresh, then recreate rules after the transactions import.",
    fields: {
      summary: "An AI draft suggested deleting all bank rules to resolve a feed refresh issue.",
      rootCause: "The proposal confused bank-rule automation with bank-feed connection health.",
      fix: "Reject the proposal. Bank rules should not be deleted as a refresh method.",
      scope: "Bank-feed troubleshooting drafts that suggest destructive rule cleanup.",
      exclusions: "A user may still edit a single incorrect rule when the rule itself caused misclassification.",
      notes: "Keep the rejection visible so agents avoid this recommendation."
    },
    requirements: [
      { label: "Unsafe recommendation identified", state: "blocked" },
      { label: "Reviewer rejection reason recorded", state: "ok" },
      { label: "Safe alternative attached", state: "warn" }
    ],
    evidence: [
      {
        type: "Reviewer note",
        title: "Destructive and unrelated",
        detail: "Deleting all bank rules can damage categorization history and does not refresh bank connection status.",
        strength: "Strong"
      },
      {
        type: "Source transcript",
        title: "Customer issue was connection timeout",
        detail: "The transcript shows the actual issue was a bank connection timeout, not a rule conflict.",
        strength: "Strong"
      }
    ],
    audit: [
      "General assistant proposed draft 2 weeks ago.",
      "Reviewer rejected proposal for unsafe action.",
      "Record retained as a guardrail against repeat advice."
    ]
  },
  {
    id: "kb-desktop-export-path",
    title: "Old Desktop migration export path",
    outcome: "Refund granted",
    decision: "deprecated",
    risk: "stale",
    source: "Legacy guide QBO-1675",
    sourceDetail: "Old migration path replaced by newer flow",
    proposedBy: "Human reviewer",
    lastChecked: "Last month",
    recommended: "deprecated",
    question: "Keep this deprecated?",
    why: "The historical evidence is useful, but agents should not recommend this outdated migration path in new answers.",
    proposed:
      "Use the Desktop 2022 export menu to start migration and manually upload the export file if the online prompt fails.",
    fields: {
      summary: "Older Desktop migration guidance referenced a menu path that changed in later releases.",
      rootCause: "The product migration entry point changed after the guide was published.",
      fix: "Keep as deprecated history and point agents to the current migration guidance instead.",
      scope: "Historical Desktop 2022 migration cases only.",
      exclusions: "Do not use for current Desktop migration instructions or final customer guidance.",
      notes: "Retain for audit context because it explains why a refund was granted in a past case."
    },
    requirements: [
      { label: "Deprecated reason recorded", state: "ok" },
      { label: "Replacement guidance linked", state: "warn" },
      { label: "Hidden from final answers", state: "ok" }
    ],
    evidence: [
      {
        type: "Legacy case",
        title: "Refund granted after failed migration path",
        detail: "The old path failed for the customer and was later replaced, which supported the refund decision.",
        strength: "Medium"
      },
      {
        type: "Reviewer note",
        title: "Do not reuse as current guidance",
        detail: "The note marks the item as stale and points to the newer migration procedure.",
        strength: "Strong"
      }
    ],
    audit: [
      "Guide published from a 2024 case.",
      "Reviewer deprecated after migration flow changed.",
      "Replacement guidance still needs a stronger link."
    ]
  }
];

const decisions = {
  trusted: {
    label: "Trusted guidance",
    icon: "shield-check",
    consequence: "Agents may use this in final recommendations when the source pattern and scope match."
  },
  case_history: {
    label: "Evidence only",
    icon: "archive",
    consequence: "Agents may use this for similarity and investigation, but not as customer-facing advice."
  },
  rejected: {
    label: "Reject",
    icon: "ban",
    consequence: "Agents cannot reuse this proposal. The rejection reason remains available as a guardrail."
  },
  deprecated: {
    label: "Deprecate",
    icon: "clock-alert",
    consequence: "Agents should avoid this for new guidance, but history stays attached for traceability."
  }
};

const riskLabels = {
  ready: "Ready",
  weak: "Weak evidence",
  risky: "Risky",
  stale: "Stale",
  contradicted: "Contradicted",
  trusted: "Trusted"
};

const state = {
  selectedId: "kb-bank-duplicates",
  filter: "attention",
  outcome: "all",
  query: "",
  drawerTab: "evidence"
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  render();
});

function cacheElements() {
  [
    "focusCount",
    "activeRiskBadge",
    "activeSource",
    "activeQuestion",
    "activeWhy",
    "primaryDecision",
    "openEvidenceTop",
    "clearFilters",
    "searchInput",
    "outcomeFilter",
    "listSummary",
    "recordList",
    "selectedOutcome",
    "selectedTitle",
    "selectedDecision",
    "sourceName",
    "proposedBy",
    "lastChecked",
    "proposalReadiness",
    "proposedGuidance",
    "fieldSummary",
    "fieldRootCause",
    "fieldFix",
    "fieldScope",
    "fieldExclusions",
    "fieldNotes",
    "recommendedAction",
    "decisionButtons",
    "agentUseList",
    "requirementsList",
    "openEvidenceSide",
    "openAudit",
    "drawerBackdrop",
    "evidenceDrawer",
    "drawerTitle",
    "closeDrawer",
    "drawerContent",
    "toast"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    renderList();
  });

  els.outcomeFilter.addEventListener("change", (event) => {
    state.outcome = event.target.value;
    renderList();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderList();
    });
  });

  els.clearFilters.addEventListener("click", () => {
    state.filter = "attention";
    state.outcome = "all";
    state.query = "";
    els.searchInput.value = "";
    els.outcomeFilter.value = "all";
    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === "attention");
    });
    renderList();
  });

  els.recordList.addEventListener("click", (event) => {
    const row = event.target.closest(".record-row");
    if (!row) return;
    selectRecord(row.dataset.id);
  });

  els.primaryDecision.addEventListener("click", () => {
    const record = getSelectedRecord();
    setDecision(record.recommended);
  });

  els.openEvidenceTop.addEventListener("click", () => openDrawer("evidence"));
  els.openEvidenceSide.addEventListener("click", () => openDrawer("evidence"));
  els.openAudit.addEventListener("click", () => openDrawer("audit"));
  els.closeDrawer.addEventListener("click", closeDrawer);
  els.drawerBackdrop.addEventListener("click", closeDrawer);

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.drawerTab = button.dataset.tab;
      renderDrawer();
    });
  });

  [
    ["fieldSummary", "summary"],
    ["fieldRootCause", "rootCause"],
    ["fieldFix", "fix"],
    ["fieldScope", "scope"],
    ["fieldExclusions", "exclusions"],
    ["fieldNotes", "notes"]
  ].forEach(([elementId, fieldName]) => {
    els[elementId].addEventListener("input", (event) => {
      getSelectedRecord().fields[fieldName] = event.target.value;
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDrawer();
    }
  });
}

function render() {
  renderFocusCount();
  renderList();
  renderDetail();
  refreshIcons();
}

function renderFocusCount() {
  const count = records.filter((record) => record.decision === "needs_review").length;
  els.focusCount.textContent = `${count} ${count === 1 ? "decision" : "decisions"} need review`;
}

function renderList() {
  const visibleRecords = getFilteredRecords();

  if (!visibleRecords.some((record) => record.id === state.selectedId) && visibleRecords.length) {
    state.selectedId = visibleRecords[0].id;
    renderDetail();
  }

  els.listSummary.textContent = `${visibleRecords.length} ${visibleRecords.length === 1 ? "item" : "items"} shown`;
  els.recordList.innerHTML = "";

  if (!visibleRecords.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No knowledge matches these filters.";
    els.recordList.appendChild(empty);
    return;
  }

  visibleRecords.forEach((record) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `record-row${record.id === state.selectedId ? " active" : ""}`;
    row.dataset.id = record.id;
    row.setAttribute("aria-pressed", record.id === state.selectedId ? "true" : "false");

    const titleLine = document.createElement("div");
    titleLine.className = "record-title-line";

    const title = document.createElement("span");
    title.className = "record-title";
    title.textContent = record.title;

    const risk = document.createElement("span");
    risk.className = `risk-badge risk-${record.risk}`;
    risk.textContent = riskLabels[record.risk];

    titleLine.append(title, risk);

    const meta = document.createElement("div");
    meta.className = "record-meta";
    meta.append(createStatusBadge(record), createOutcomeBadge(record.outcome));

    const source = document.createElement("div");
    source.className = "record-source";
    source.textContent = `${record.source} - ${record.sourceDetail}`;

    row.append(titleLine, meta, source);
    els.recordList.appendChild(row);
  });

  refreshIcons();
}

function renderDetail() {
  const record = getSelectedRecord();
  const currentDecision = decisions[record.decision] || {
    label: "Needs human decision",
    consequence: "Agents cannot use this in final recommendations until a human decides."
  };

  els.activeRiskBadge.className = `risk-badge risk-${record.risk}`;
  els.activeRiskBadge.textContent = riskLabels[record.risk];
  els.activeSource.textContent = record.source;
  els.activeQuestion.textContent = record.question;
  els.activeWhy.textContent = record.why;
  els.primaryDecision.querySelector("span").textContent = decisions[record.recommended].label;

  els.selectedOutcome.textContent = record.outcome;
  els.selectedTitle.textContent = record.title;
  els.selectedDecision.className = `decision-pill decision-${record.decision}`;
  els.selectedDecision.textContent = currentDecision.label;
  els.sourceName.textContent = record.source;
  els.proposedBy.textContent = record.proposedBy;
  els.lastChecked.textContent = record.lastChecked;
  els.proposalReadiness.className = `readiness-label risk-${record.risk}`;
  els.proposalReadiness.textContent = readinessText(record);
  els.proposedGuidance.textContent = record.proposed;

  els.fieldSummary.value = record.fields.summary;
  els.fieldRootCause.value = record.fields.rootCause;
  els.fieldFix.value = record.fields.fix;
  els.fieldScope.value = record.fields.scope;
  els.fieldExclusions.value = record.fields.exclusions;
  els.fieldNotes.value = record.fields.notes;

  els.recommendedAction.textContent = `Recommended: ${decisions[record.recommended].label.toLowerCase()}`;
  renderDecisionButtons(record);
  renderAgentUse(record);
  renderRequirements(record);
  renderDrawer();
  refreshIcons();
}

function renderDecisionButtons(record) {
  els.decisionButtons.innerHTML = "";

  Object.entries(decisions).forEach(([key, decision]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `decision-option${record.decision === key ? " active" : ""}`;
    button.innerHTML = `
      <i data-lucide="${decision.icon}" aria-hidden="true"></i>
      <span>
        <strong>${decision.label}</strong>
        <span>${decision.consequence}</span>
      </span>
    `;
    button.addEventListener("click", () => setDecision(key));
    els.decisionButtons.appendChild(button);
  });
}

function renderAgentUse(record) {
  const rows = getAgentUseRows(record);
  els.agentUseList.innerHTML = "";

  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "agent-use-row";

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = row.title;
    const detail = document.createElement("span");
    detail.textContent = row.detail;
    copy.append(title, detail);

    const stateLabel = document.createElement("span");
    stateLabel.className = `requirement-state state-${row.state}`;
    stateLabel.textContent = row.label;

    item.append(copy, stateLabel);
    els.agentUseList.appendChild(item);
  });
}

function renderRequirements(record) {
  els.requirementsList.innerHTML = "";

  record.requirements.forEach((requirement) => {
    const item = document.createElement("li");
    const stateLabel = document.createElement("span");
    stateLabel.className = `requirement-state state-${requirement.state}`;
    stateLabel.textContent = requirementStateText(requirement.state);

    const text = document.createElement("span");
    text.className = "requirement-text";
    text.textContent = requirement.label;

    item.append(stateLabel, text);
    els.requirementsList.appendChild(item);
  });
}

function renderDrawer() {
  const record = getSelectedRecord();

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.drawerTab);
  });

  els.drawerTitle.textContent = `Evidence for ${record.title}`;
  els.drawerContent.innerHTML = "";

  if (state.drawerTab === "evidence") {
    record.evidence.forEach((evidence) => {
      const item = document.createElement("article");
      item.className = "evidence-item";
      item.innerHTML = `
        <header>
          <strong></strong>
          <span class="source-chip"></span>
        </header>
        <p></p>
      `;
      item.querySelector("strong").textContent = evidence.title;
      item.querySelector(".source-chip").textContent = `${evidence.type} - ${evidence.strength}`;
      item.querySelector("p").textContent = evidence.detail;
      els.drawerContent.appendChild(item);
    });
  }

  if (state.drawerTab === "audit") {
    record.audit.forEach((entry, index) => {
      const item = document.createElement("article");
      item.className = "audit-item";
      item.innerHTML = `
        <header>
          <strong></strong>
          <span class="source-chip"></span>
        </header>
        <p></p>
      `;
      item.querySelector("strong").textContent = `Step ${index + 1}`;
      item.querySelector(".source-chip").textContent = "Review history";
      item.querySelector("p").textContent = entry;
      els.drawerContent.appendChild(item);
    });
  }

  if (state.drawerTab === "agent") {
    getAgentUseRows(record).forEach((boundary) => {
      const item = document.createElement("article");
      item.className = "boundary-item";
      item.innerHTML = `
        <header>
          <strong></strong>
          <span class="source-chip"></span>
        </header>
        <p></p>
      `;
      item.querySelector("strong").textContent = boundary.title;
      item.querySelector(".source-chip").textContent = boundary.label;
      item.querySelector("p").textContent = boundary.detail;
      els.drawerContent.appendChild(item);
    });
  }
}

function getFilteredRecords() {
  return records.filter((record) => {
    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "attention" && record.decision === "needs_review") ||
      record.decision === state.filter;

    const matchesOutcome = state.outcome === "all" || record.outcome === state.outcome;
    const haystack = [
      record.title,
      record.outcome,
      record.source,
      record.sourceDetail,
      record.proposed,
      record.fields.summary,
      record.fields.rootCause,
      record.fields.fix,
      record.fields.scope,
      record.fields.exclusions,
      record.fields.notes
    ]
      .join(" ")
      .toLowerCase();
    const matchesSearch = !state.query || haystack.includes(state.query);

    return matchesFilter && matchesOutcome && matchesSearch;
  });
}

function getSelectedRecord() {
  return records.find((record) => record.id === state.selectedId) || records[0];
}

function selectRecord(recordId) {
  state.selectedId = recordId;
  renderDetail();
  renderList();
}

function setDecision(decisionKey) {
  const record = getSelectedRecord();
  const previousLabel = decisions[record.decision]?.label || "Needs human decision";
  record.decision = decisionKey;
  record.audit.unshift(`Human reviewer changed decision from ${previousLabel} to ${decisions[decisionKey].label}.`);

  renderFocusCount();
  renderDetail();
  renderList();
  showToast(`${record.title}: ${decisions[decisionKey].label}. ${decisions[decisionKey].consequence}`);
}

function getAgentUseRows(record) {
  if (record.decision === "trusted") {
    return [
      {
        title: "Final recommendations",
        detail: "Allowed when the user's issue matches the source pattern and stated scope.",
        label: "Allowed",
        state: "ok"
      },
      {
        title: "Similarity and investigation",
        detail: "Allowed as a strong precedent with evidence attached.",
        label: "Allowed",
        state: "ok"
      },
      {
        title: "Outside the scope",
        detail: `Blocked where exclusions apply: ${record.fields.exclusions}`,
        label: "Blocked",
        state: "blocked"
      }
    ];
  }

  if (record.decision === "case_history" || record.decision === "needs_review") {
    return [
      {
        title: "Final recommendations",
        detail: "Blocked until a human publishes trusted guidance.",
        label: "Blocked",
        state: "blocked"
      },
      {
        title: "Similarity and investigation",
        detail: "Allowed as background evidence with the risk label visible.",
        label: "Allowed",
        state: "ok"
      },
      {
        title: "Agent wording",
        detail: "Agents must describe this as unapproved evidence, not as a recommended fix.",
        label: "Limited",
        state: "warn"
      }
    ];
  }

  if (record.decision === "rejected") {
    return [
      {
        title: "Final recommendations",
        detail: "Blocked because a human reviewer rejected the proposed guidance.",
        label: "Blocked",
        state: "blocked"
      },
      {
        title: "Similarity and investigation",
        detail: "Allowed only as a warning against repeating the rejected advice.",
        label: "Limited",
        state: "warn"
      },
      {
        title: "Safer alternative",
        detail: "Agents should use another trusted record or ask for human review.",
        label: "Required",
        state: "warn"
      }
    ];
  }

  return [
    {
      title: "Final recommendations",
      detail: "Blocked because this guidance is outdated or replaced.",
      label: "Blocked",
      state: "blocked"
    },
    {
      title: "Historical context",
      detail: "Allowed for audit or case-history context when marked as deprecated.",
      label: "Allowed",
      state: "ok"
    },
    {
      title: "Replacement guidance",
      detail: "Agents should prefer current trusted guidance before using this history.",
      label: "Required",
      state: "warn"
    }
  ];
}

function createStatusBadge(record) {
  const badge = document.createElement("span");
  const decisionKey = record.decision === "needs_review" ? "case_history" : record.decision;
  badge.className = `record-status decision-${decisionKey}`;
  badge.textContent = record.decision === "needs_review" ? "Needs decision" : decisions[record.decision].label;
  return badge;
}

function createOutcomeBadge(outcome) {
  const badge = document.createElement("span");
  badge.className = "record-status";
  badge.textContent = outcome;
  return badge;
}

function readinessText(record) {
  if (record.risk === "ready") return "Ready with evidence";
  if (record.risk === "trusted") return "Published and trusted";
  if (record.risk === "weak") return "Needs stronger source";
  if (record.risk === "stale") return "Outdated or replaced";
  if (record.risk === "contradicted") return "Contradiction needs review";
  return "Risk needs human review";
}

function requirementStateText(value) {
  if (value === "ok") return "Ready";
  if (value === "warn") return "Check";
  return "Blocker";
}

function openDrawer(tab) {
  state.drawerTab = tab;
  renderDrawer();
  els.drawerBackdrop.hidden = false;
  els.evidenceDrawer.hidden = false;
  els.evidenceDrawer.classList.add("open");
  els.evidenceDrawer.setAttribute("aria-hidden", "false");
  refreshIcons();
}

function closeDrawer() {
  els.drawerBackdrop.hidden = true;
  els.evidenceDrawer.classList.remove("open");
  els.evidenceDrawer.setAttribute("aria-hidden", "true");
  els.evidenceDrawer.hidden = true;
}

let toastTimer;

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 3200);
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}
