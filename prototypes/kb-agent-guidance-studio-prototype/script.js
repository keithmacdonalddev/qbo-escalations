const records = [
  {
    id: "uf-payout-mismatch",
    title: "Undeposited Funds after payout mismatch",
    source: "Case QBO-7841",
    sourceType: "Support case and reconciled ledger screenshots",
    state: "blocked",
    safety: "Needs bounded exclusions",
    decision: "trusted",
    guidanceTitle: "Clear Undeposited Funds when a payout was recorded twice",
    summary:
      "Use this when a merchant payout appears both as a bank deposit and as an Undeposited Funds balance after review of the linked sales receipts.",
    rootCause:
      "The customer recorded the payout from the banking feed and also batched the same receipts through Bank Deposit, leaving receipts still represented in Undeposited Funds.",
    fix:
      "Confirm the bank deposit that matches the payout, open the duplicate Bank Deposit entry, remove the already matched receipts, and verify Undeposited Funds returns to zero for the payout date.",
    scope:
      "QBO merchant-service payouts where the payout amount, date, and receipt set all match.",
    exclusions: "",
    notes:
      "Ask for transaction detail if the payout includes fees, partial settlements, chargebacks, or mixed payment processors.",
    permissions: {
      finalAnswer: false,
      triage: true,
      similarity: true,
      draftFix: true,
    },
    evidence: [
      {
        label: "Resolved case",
        strength: "Strong",
        text: "Customer confirmed Undeposited Funds cleared after duplicate deposit receipts were removed.",
      },
      {
        label: "Ledger screenshot",
        strength: "Strong",
        text: "Shows matching payout amount in bank feed and Bank Deposit on the same date.",
      },
      {
        label: "Agent proposal",
        strength: "Needs review",
        text: "Proposed final-answer use before fee and chargeback exclusions were written.",
      },
    ],
    audit: [
      {
        title: "Draft created",
        text: "Knowledge draft generated from closed support case and evidence bundle.",
      },
      {
        title: "Reviewer note",
        text: "Marked as reusable only after exclusions explain fee, partial payout, and chargeback limits.",
      },
    ],
  },
  {
    id: "sales-tax-remap",
    title: "Sales tax agency remap after migration",
    source: "Investigation INV-219",
    sourceType: "Investigation notes, audit log, customer confirmation",
    state: "ready",
    safety: "Ready for trusted guidance",
    decision: "trusted",
    guidanceTitle: "Remap sales tax agency after company migration",
    summary:
      "Use this when sales tax liabilities moved to the wrong agency after migration and the audit log shows the agency mapping was changed during import.",
    rootCause:
      "The migration created a new tax agency record and assigned historical tax rates to it instead of preserving the original agency mapping.",
    fix:
      "Confirm the agency mismatch in Taxes, export the affected liability report, remap rates to the correct agency, and rerun the liability report for the migration period.",
    scope:
      "Migrated QBO company files with audit-log evidence of agency remapping during import.",
    exclusions:
      "Do not use for payroll taxes, manually journaled tax liability corrections, or jurisdictions with active filing locks.",
    notes:
      "Final answer must ask the user to preserve the pre-change liability report before remapping.",
    permissions: {
      finalAnswer: true,
      triage: true,
      similarity: true,
      draftFix: true,
    },
    evidence: [
      {
        label: "Audit log",
        strength: "Strong",
        text: "Shows agency mapping changed during migration import.",
      },
      {
        label: "Before and after report",
        strength: "Strong",
        text: "Liability report changed after rates were remapped to the original agency.",
      },
      {
        label: "Customer confirmation",
        strength: "Strong",
        text: "Customer confirmed liability report matched expected agency after correction.",
      },
    ],
    audit: [
      {
        title: "Evidence checked",
        text: "Reviewer matched audit log, report delta, and customer confirmation.",
      },
      {
        title: "Ready for publish",
        text: "All required fields and final-answer boundaries are complete.",
      },
    ],
  },
  {
    id: "bank-feed-duplicates",
    title: "Bank feed duplicate match pattern",
    source: "Conversation C-4418",
    sourceType: "Chat transcript and partial bank-feed screenshots",
    state: "blocked",
    safety: "Weak signal",
    decision: "case-history",
    guidanceTitle: "Investigate duplicate bank feed matches before recommending exclusions",
    summary:
      "This appears useful for triage, but the source case lacks enough evidence to recommend a fix in final answers.",
    rootCause:
      "The feed may have imported the same transactions twice, but the screenshots do not show whether the bank connection, rule, or manual upload caused the duplicates.",
    fix:
      "Compare bank register entries, feed import dates, and banking rules before suggesting exclusion or merge steps.",
    scope:
      "Similarity search and investigation prompts for duplicate bank-feed symptoms.",
    exclusions:
      "Do not use as final guidance. Do not tell agents to exclude transactions until source and register evidence are verified.",
    notes:
      "Keep as case history until a resolved case confirms the actual cause.",
    permissions: {
      finalAnswer: false,
      triage: true,
      similarity: true,
      draftFix: false,
    },
    evidence: [
      {
        label: "Chat transcript",
        strength: "Weak",
        text: "Customer described duplicates but did not provide full register evidence.",
      },
      {
        label: "Partial screenshot",
        strength: "Weak",
        text: "Shows duplicate-looking feed rows without import source detail.",
      },
      {
        label: "Missing proof",
        strength: "Blocker",
        text: "No resolved outcome or user confirmation is attached.",
      },
    ],
    audit: [
      {
        title: "Draft held",
        text: "Reviewer kept this out of final-answer guidance because source evidence is incomplete.",
      },
    ],
  },
];

const permissionCopy = {
  finalAnswer: {
    title: "Final answers",
    description: "Specialist agents may cite this guidance in recommendations.",
  },
  triage: {
    title: "Triage help",
    description: "Agents may use it to ask better first questions.",
  },
  similarity: {
    title: "Find similar cases",
    description: "Agents may match new cases against this pattern.",
  },
  draftFix: {
    title: "Draft a fix",
    description: "Agents may propose steps for a human to review.",
  },
};

const state = {
  selectedId: records[0].id,
  filter: "all",
  search: "",
  drawerMode: "evidence",
};

const els = {
  visibleCount: document.querySelector("#visibleCount"),
  recordList: document.querySelector("#recordList"),
  search: document.querySelector("#knowledgeSearch"),
  filterButtons: document.querySelectorAll(".filter-chip"),
  sourceLabel: document.querySelector("#sourceLabel"),
  recordTitle: document.querySelector("#recordTitle"),
  safetyPill: document.querySelector("#safetyPill"),
  selectedAgentCount: document.querySelector("#selectedAgentCount"),
  decisionText: document.querySelector("#decisionPlainText"),
  decisionOptions: document.querySelectorAll(".decision-option"),
  titleInput: document.querySelector("#titleInput"),
  scopeInput: document.querySelector("#scopeInput"),
  summaryInput: document.querySelector("#summaryInput"),
  rootCauseInput: document.querySelector("#rootCauseInput"),
  fixInput: document.querySelector("#fixInput"),
  exclusionsInput: document.querySelector("#exclusionsInput"),
  notesInput: document.querySelector("#notesInput"),
  permissionGrid: document.querySelector("#permissionGrid"),
  permissionSummary: document.querySelector("#permissionSummary"),
  agentPreview: document.querySelector("#agentPreview"),
  readinessTitle: document.querySelector("#readinessTitle"),
  readinessScore: document.querySelector("#readinessScore"),
  blockerList: document.querySelector("#blockerList"),
  publishButton: document.querySelector("#publishButton"),
  nextActionText: document.querySelector("#nextActionText"),
  consequenceText: document.querySelector("#consequenceText"),
  evidenceButton: document.querySelector("#evidenceButton"),
  auditButton: document.querySelector("#auditButton"),
  blockerHelpButton: document.querySelector("#blockerHelpButton"),
  copyPreviewButton: document.querySelector("#copyPreviewButton"),
  drawer: document.querySelector("#evidenceDrawer"),
  drawerKicker: document.querySelector("#drawerKicker"),
  drawerTitle: document.querySelector("#drawerTitle"),
  drawerBody: document.querySelector("#drawerBody"),
  toast: document.querySelector("#toast"),
};

function selectedRecord() {
  return records.find((record) => record.id === state.selectedId) || records[0];
}

function textReady(value, minLength = 10) {
  return value.trim().length >= minLength;
}

function evidenceStrength(record) {
  const hasStrongEvidence = record.evidence.some((item) => item.strength === "Strong");
  const hasBlocker = record.evidence.some((item) => item.strength === "Blocker");
  if (hasBlocker) return "blocked";
  if (hasStrongEvidence) return "strong";
  return "weak";
}

function getReadiness(record) {
  const checks = [
    {
      id: "summary",
      label: "Reusable summary is specific enough for agents.",
      complete: textReady(record.summary, 24),
      fieldId: "summaryInput",
    },
    {
      id: "rootCause",
      label: "Root cause explains why this worked.",
      complete: textReady(record.rootCause, 24),
      fieldId: "rootCauseInput",
    },
    {
      id: "fix",
      label: "Exact fix is clear enough for a reviewer to verify.",
      complete: textReady(record.fix, 24),
      fieldId: "fixInput",
    },
    {
      id: "scope",
      label: "Scope says when this guidance applies.",
      complete: textReady(record.scope, 16),
      fieldId: "scopeInput",
    },
    {
      id: "exclusions",
      label: "Exclusions keep agents from overusing the guidance.",
      complete: textReady(record.exclusions, 16) || record.decision !== "trusted",
      fieldId: "exclusionsInput",
    },
    {
      id: "evidence",
      label: "Strong source evidence supports the guidance.",
      complete: evidenceStrength(record) === "strong",
      warning: evidenceStrength(record) === "weak",
    },
    {
      id: "decision",
      label: "Decision matches allowed agent use.",
      complete:
        record.decision === "trusted" ||
        (!record.permissions.finalAnswer && record.decision !== "deprecated") ||
        record.state === "published",
    },
  ];

  const blockerCount = checks.filter((check) => !check.complete).length;
  return {
    checks,
    blockerCount,
    completeCount: checks.length - blockerCount,
    isReady: blockerCount === 0 && record.decision === "trusted",
  };
}

function allowedPermissionLabels(record) {
  return Object.entries(record.permissions)
    .filter(([, enabled]) => enabled)
    .map(([key]) => permissionCopy[key].title);
}

function getFilteredRecords() {
  const query = state.search.trim().toLowerCase();
  return records.filter((record) => {
    const searchable = [
      record.title,
      record.source,
      record.sourceType,
      record.guidanceTitle,
      record.summary,
      record.scope,
    ]
      .join(" ")
      .toLowerCase();
    const matchesQuery = !query || searchable.includes(query);
    const readiness = getReadiness(record);
    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "decision" && record.state !== "published") ||
      (state.filter === "ready" && readiness.isReady) ||
      (state.filter === "blocked" && !readiness.isReady);
    return matchesQuery && matchesFilter;
  });
}

function ensureSelectedVisible() {
  const filtered = getFilteredRecords();
  if (filtered.length === 0 || filtered.some((record) => record.id === state.selectedId)) {
    return;
  }
  state.selectedId = filtered[0].id;
}

function updateRecordFromInputs() {
  const record = selectedRecord();
  record.guidanceTitle = els.titleInput.value;
  record.scope = els.scopeInput.value;
  record.summary = els.summaryInput.value;
  record.rootCause = els.rootCauseInput.value;
  record.fix = els.fixInput.value;
  record.exclusions = els.exclusionsInput.value;
  record.notes = els.notesInput.value;
}

function renderRecordList() {
  const filtered = getFilteredRecords();
  els.visibleCount.textContent = String(filtered.length);
  els.recordList.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No knowledge matches this view. Clear search or switch filters.";
    els.recordList.append(empty);
    return;
  }

  filtered.forEach((record) => {
    const readiness = getReadiness(record);
    const button = document.createElement("button");
    button.className = `record-card${record.id === state.selectedId ? " active" : ""}`;
    button.type = "button";
    button.dataset.id = record.id;

    const statusBadge = readiness.isReady
      ? '<span class="badge ready">Ready</span>'
      : record.safety.toLowerCase().includes("weak")
        ? '<span class="badge weak">Weak signal</span>'
        : '<span class="badge blocked">Blocked</span>';
    const agentCount = allowedPermissionLabels(record).length;
    const publishedBadge =
      record.state === "published" ? '<span class="badge ready">Published</span>' : "";

    button.innerHTML = `
      <div class="record-meta">
        <span>${record.source}</span>
        <span>${readiness.completeCount}/${readiness.checks.length}</span>
      </div>
      <h3>${escapeHtml(record.title)}</h3>
      <div class="badge-row">
        ${statusBadge}
        ${publishedBadge}
        <span class="badge agent">${agentCount} agent uses</span>
      </div>
    `;
    button.addEventListener("click", () => {
      state.selectedId = record.id;
      render();
    });
    els.recordList.append(button);
  });
}

function renderEditor() {
  const record = selectedRecord();
  const readiness = getReadiness(record);
  const allowedLabels = allowedPermissionLabels(record);

  els.sourceLabel.textContent = `${record.source} source`;
  els.recordTitle.textContent = record.title;
  els.safetyPill.textContent = record.state === "published" ? "Published" : record.safety;
  els.safetyPill.className = "status-pill";
  if (record.state === "published" || readiness.isReady) els.safetyPill.classList.add("ready");
  if (record.safety.toLowerCase().includes("weak")) els.safetyPill.classList.add("blocked");
  els.selectedAgentCount.textContent = allowedLabels.length
    ? `${allowedLabels.length} allowed agent use${allowedLabels.length === 1 ? "" : "s"}`
    : "No agent permissions";

  els.titleInput.value = record.guidanceTitle;
  els.scopeInput.value = record.scope;
  els.summaryInput.value = record.summary;
  els.rootCauseInput.value = record.rootCause;
  els.fixInput.value = record.fix;
  els.exclusionsInput.value = record.exclusions;
  els.notesInput.value = record.notes;

  els.decisionOptions.forEach((button) => {
    const active = button.dataset.decision === record.decision;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });

  updateDecisionText(record);
  renderFieldAttention(readiness);
  renderPermissions(record);
}

function updateDecisionText(record) {
  const copy = {
    trusted: "Publish as guidance only after scope, exclusions, and evidence are complete.",
    "case-history": "Keep this available for similarity and investigation, but out of final recommendations.",
    rejected: "Keep provenance, but prevent agents from using the proposed guidance.",
    deprecated: "Keep older guidance visible for history while steering agents to newer guidance.",
  };
  els.decisionText.textContent = copy[record.decision];
}

function renderFieldAttention(readiness) {
  document.querySelectorAll(".field").forEach((field) => field.classList.remove("needs-attention"));
  readiness.checks.forEach((check) => {
    if (check.complete || !check.fieldId) return;
    const input = document.querySelector(`#${check.fieldId}`);
    input?.closest(".field")?.classList.add("needs-attention");
  });
}

function renderPermissions(record) {
  els.permissionGrid.innerHTML = "";
  Object.entries(permissionCopy).forEach(([key, copy]) => {
    const button = document.createElement("button");
    const enabled = record.permissions[key];
    button.className = `permission-toggle${enabled ? " active" : ""}`;
    button.type = "button";
    button.setAttribute("aria-pressed", String(enabled));
    button.innerHTML = `
      <span class="toggle-visual" aria-hidden="true"></span>
      <span class="toggle-copy">
        <strong>${copy.title}</strong>
        <span>${copy.description}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      record.permissions[key] = !record.permissions[key];
      if (key === "finalAnswer" && record.permissions.finalAnswer) {
        record.decision = "trusted";
      }
      if (record.decision === "rejected") {
        record.permissions[key] = false;
      }
      render();
    });
    els.permissionGrid.append(button);
  });

  const labels = allowedPermissionLabels(record);
  els.permissionSummary.textContent = labels.length
    ? `Enabled: ${labels.join(", ")}.`
    : "No agents may reuse this yet.";
}

function renderReadiness() {
  const record = selectedRecord();
  const readiness = getReadiness(record);
  els.readinessTitle.textContent = readiness.isReady
    ? "Ready to publish"
    : `${readiness.blockerCount} blocker${readiness.blockerCount === 1 ? "" : "s"}`;
  els.readinessScore.textContent = `${readiness.completeCount}/${readiness.checks.length}`;
  els.blockerList.innerHTML = "";

  readiness.checks.forEach((check) => {
    const row = document.createElement("div");
    row.className = `blocker-item${check.complete ? " complete" : ""}${check.warning ? " warning" : ""}`;
    row.innerHTML = `
      <span class="blocker-dot">${check.complete ? "OK" : "!"}</span>
      <span>${check.label}</span>
    `;
    els.blockerList.append(row);
  });

  els.publishButton.disabled = !readiness.isReady;
  els.nextActionText.textContent = readiness.isReady
    ? "Publish trusted guidance so specialist agents can reuse it with boundaries."
    : `Resolve ${readiness.blockerCount} publish blocker${readiness.blockerCount === 1 ? "" : "s"} before final-answer agents can use this.`;
}

function renderPreview() {
  const record = selectedRecord();
  const allowedLabels = allowedPermissionLabels(record);
  const readiness = getReadiness(record);
  const useText = allowedLabels.length ? allowedLabels.join(", ") : "No agent reuse allowed";
  const finalUse = record.permissions.finalAnswer && readiness.isReady ? "Allowed after publish" : "Not allowed";
  els.agentPreview.innerHTML = `
    <div class="preview-block">
      <span>Guidance</span>
      <strong>${escapeHtml(record.guidanceTitle || "Untitled guidance")}</strong>
      <p>${escapeHtml(record.summary || "No reusable summary yet.")}</p>
    </div>
    <div class="preview-block">
      <span>Allowed use</span>
      <p>${escapeHtml(useText)}. Final-answer use: ${finalUse}.</p>
    </div>
    <div class="preview-block">
      <span>Scope</span>
      <p>${escapeHtml(record.scope || "Scope required before publishing.")}</p>
    </div>
    <div class="preview-block">
      <span>Must not use for</span>
      <p>${escapeHtml(record.exclusions || "Exclusions required before trusted publication.")}</p>
    </div>
    <div class="preview-block">
      <span>Evidence</span>
      <p>${escapeHtml(record.source)}. Evidence strength: ${evidenceStrengthLabel(record)}.</p>
    </div>
  `;

  els.consequenceText.textContent = consequenceFor(record, readiness);
}

function evidenceStrengthLabel(record) {
  const strength = evidenceStrength(record);
  if (strength === "strong") return "strong enough for guided reuse";
  if (strength === "weak") return "weak, investigation only";
  return "blocked by missing or contradicted proof";
}

function consequenceFor(record, readiness) {
  if (record.decision === "rejected") {
    return "After rejection, agents keep the provenance but cannot reuse the proposed guidance.";
  }
  if (record.decision === "case-history") {
    return "After approval as case history, agents may use this to compare cases but not to make final recommendations.";
  }
  if (record.decision === "deprecated") {
    return "After deprecation, agents see this only as replaced guidance and should prefer newer records.";
  }
  if (readiness.isReady) {
    return "After publish, specialist agents receive the guidance, allowed uses, scope, exclusions, and evidence summary.";
  }
  return "Agents cannot use this in final recommendations until the missing boundaries and evidence are resolved.";
}

function renderDrawer() {
  const record = selectedRecord();
  const isAudit = state.drawerMode === "audit";
  els.drawerKicker.textContent = isAudit ? "Audit Trail" : "Evidence";
  els.drawerTitle.textContent = isAudit ? "What changed and why" : "Source and proof";
  const items = isAudit ? record.audit : record.evidence;

  els.drawerBody.innerHTML = `
    <div class="drawer-content">
      <div>
        <p class="eyebrow">${escapeHtml(record.source)}</p>
        <h3>${escapeHtml(record.sourceType)}</h3>
      </div>
      <div>
        ${items
          .map((item) => {
            const badgeClass =
              item.strength === "Strong"
                ? "ready"
                : item.strength === "Weak"
                  ? "weak"
                  : item.strength === "Blocker"
                    ? "blocked"
                    : "agent";
            return `
              <article class="${isAudit ? "audit-item" : "evidence-item"}">
                <div class="drawer-meta">
                  <span class="badge ${badgeClass}">${escapeHtml(item.strength || "Review")}</span>
                </div>
                <h3>${escapeHtml(item.label || item.title)}</h3>
                <p>${escapeHtml(item.text)}</p>
              </article>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function render() {
  ensureSelectedVisible();
  renderRecordList();
  renderEditor();
  renderReadiness();
  renderPreview();
  renderDrawer();
}

function openDrawer(mode) {
  state.drawerMode = mode;
  renderDrawer();
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
}

function inspectBlockers() {
  const record = selectedRecord();
  const readiness = getReadiness(record);
  const firstBlocker = readiness.checks.find((check) => !check.complete && check.fieldId);
  if (firstBlocker) {
    const input = document.querySelector(`#${firstBlocker.fieldId}`);
    input?.focus();
    showToast("Focused the first missing publish requirement.");
    return;
  }
  if (!readiness.isReady) {
    openDrawer("evidence");
    showToast("Evidence is the remaining blocker.");
    return;
  }
  showToast("This guidance is ready to publish.");
}

function publishSelected() {
  const record = selectedRecord();
  const readiness = getReadiness(record);
  if (!readiness.isReady) {
    inspectBlockers();
    return;
  }
  record.state = "published";
  record.safety = "Published trusted guidance";
  record.audit.push({
    title: "Published",
    text: "Reviewer published this as bounded agent guidance in the prototype.",
  });
  showToast("Guidance published. Agents now receive the bounded preview shown on the right.");
  render();
}

function copyPreview() {
  const record = selectedRecord();
  const labels = allowedPermissionLabels(record).join(", ") || "No agent reuse allowed";
  const text = [
    `Guidance: ${record.guidanceTitle}`,
    `Summary: ${record.summary}`,
    `Allowed use: ${labels}`,
    `Scope: ${record.scope}`,
    `Exclusions: ${record.exclusions || "Required before trusted publication"}`,
  ].join("\n");

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => undefined);
  }
  showToast("Agent preview prepared for copy.");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("visible");
  }, 3200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindEvents() {
  const inputs = [
    els.titleInput,
    els.scopeInput,
    els.summaryInput,
    els.rootCauseInput,
    els.fixInput,
    els.exclusionsInput,
    els.notesInput,
  ];
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      updateRecordFromInputs();
      renderRecordList();
      renderReadiness();
      renderPreview();
      renderFieldAttention(getReadiness(selectedRecord()));
    });
  });

  els.search.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  els.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      els.filterButtons.forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  els.decisionOptions.forEach((button) => {
    button.addEventListener("click", () => {
      const record = selectedRecord();
      record.decision = button.dataset.decision;
      if (record.decision === "rejected" || record.decision === "deprecated") {
        Object.keys(record.permissions).forEach((key) => {
          record.permissions[key] = false;
        });
      }
      if (record.decision === "case-history") {
        record.permissions.finalAnswer = false;
        record.permissions.draftFix = false;
        record.permissions.triage = true;
        record.permissions.similarity = true;
      }
      render();
    });
  });

  els.evidenceButton.addEventListener("click", () => openDrawer("evidence"));
  els.auditButton.addEventListener("click", () => openDrawer("audit"));
  els.blockerHelpButton.addEventListener("click", inspectBlockers);
  els.publishButton.addEventListener("click", publishSelected);
  els.copyPreviewButton.addEventListener("click", copyPreview);

  document.querySelectorAll("[data-close-drawer]").forEach((element) => {
    element.addEventListener("click", closeDrawer);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
}

bindEvents();
render();
