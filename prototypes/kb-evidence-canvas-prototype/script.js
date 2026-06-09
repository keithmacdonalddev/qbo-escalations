const records = [
  {
    id: "payroll-rejected-payment",
    title: "Payroll liability still shows paid after rejected e-payment",
    sourceType: "Escalation case",
    sourceName: "QBO-4187, payroll support handoff",
    scopeLine: "Scope: QBO Payroll, electronic tax payment rejected by bank before agency acceptance.",
    status: "Needs source match",
    strength: 72,
    readiness: "attention",
    decisionNeed: "Can this become reusable agent guidance, or only case history?",
    decisionQuestion:
      "Decision: may agents tell a support rep to void and recreate a rejected payroll tax payment?",
    artifactLines: [
      {
        number: "L12",
        text: "Customer reports the bank rejected the e-payment, but QBO Payroll still marks the liability as paid.",
        highlight: "bank rejected the e-payment"
      },
      {
        number: "L18",
        text: "Supervisor confirmed no agency confirmation number exists. The payment should not be treated as accepted.",
        highlight: "no agency confirmation number exists"
      },
      {
        number: "L24",
        text: "Resolution was to void the rejected e-payment, confirm the liability period, then recreate the payment.",
        highlight: "void the rejected e-payment"
      },
      {
        number: "L29",
        text: "Do not use a journal entry workaround because payroll tax reports can become inaccurate.",
        highlight: "Do not use a journal entry"
      }
    ],
    evidence: [
      {
        id: "ev-payroll-1",
        label: "Bank rejection establishes the source problem",
        quote: "The payment was rejected before acceptance, while QBO still showed the liability as paid.",
        support: "strong",
        detail: "Supports the root cause and explains why normal payment history is misleading."
      },
      {
        id: "ev-payroll-2",
        label: "Supervisor confirms the exact fix",
        quote: "Void the rejected e-payment, confirm the liability period, then recreate the payment.",
        support: "strong",
        detail: "This is the strongest source-backed candidate for reusable guidance."
      },
      {
        id: "ev-payroll-3",
        label: "Journal entry workaround is contradicted",
        quote: "Do not use a journal entry workaround because payroll tax reports can become inaccurate.",
        support: "contradicted",
        detail: "The draft must explicitly exclude journal entries before agents can use it."
      }
    ],
    claims: [
      {
        part: "Summary",
        status: "strong",
        statusLabel: "Source-backed",
        text: "Rejected bank payment can leave QBO Payroll showing a liability as paid."
      },
      {
        part: "Exact fix",
        status: "partial",
        statusLabel: "Needs exact wording",
        text: "Void and recreate is supported, but only after confirming no agency acceptance exists."
      },
      {
        part: "Exclusion",
        status: "contradicted",
        statusLabel: "Contradiction",
        text: "Any guidance suggesting journal entries conflicts with the supervisor note."
      },
      {
        part: "Scope",
        status: "scope",
        statusLabel: "Bounded scope",
        text: "Applies to rejected e-payments, not accepted payments or agency-side corrections."
      }
    ],
    gaps: [
      {
        kind: "Missing proof",
        detail: "Bank rejection code is not attached. Keep the record out of trusted guidance until source wording is clear."
      },
      {
        kind: "Scope risk",
        detail: "Payroll subscription variant is not named. Agents need this boundary before recommending the fix."
      }
    ],
    issues: {
      contradictions: 1,
      gaps: 2,
      scope: "Rejected e-payment before agency acceptance",
      unsafeIf: "Used for accepted agency payments or as permission to create payroll journal entries"
    },
    guidance: {
      summary:
        "When QBO Payroll shows a tax liability as paid after the bank rejected the e-payment, the payment record may need to be voided and recreated.",
      rootCause:
        "QBO still reflects the rejected electronic payment as paid even though the bank rejection prevented agency acceptance.",
      fix:
        "Confirm there is no agency confirmation number, void the rejected e-payment, verify the liability period, then recreate the payment.",
      scope:
        "Use only for QBO Payroll e-payments rejected by the bank before agency acceptance.",
      exclusions:
        "Do not use for accepted agency payments. Do not recommend journal entries as the fix.",
      notes:
        "Ask for the bank rejection proof and payroll subscription variant before allowing agents to quote this as final guidance."
    },
    sourceWording:
      "Confirm no agency confirmation number exists, void the rejected e-payment, confirm the liability period, then recreate the payment.",
    decision: "caseHistory",
    requirements: [
      {
        id: "source-match",
        label: "Exact fix matches the source",
        helper: "The guidance must mention no agency confirmation, void, liability period, and recreate.",
        met: false
      },
      {
        id: "scope-bound",
        label: "Scope and exclusions are clear",
        helper: "Agents need to know this is rejected e-payment only, not accepted payments.",
        met: true
      },
      {
        id: "contradiction-resolved",
        label: "Contradiction is resolved",
        helper: "Journal entry workaround must be excluded.",
        met: true
      },
      {
        id: "missing-proof",
        label: "Missing proof is handled",
        helper: "Attach bank rejection proof or keep as case history.",
        met: false
      }
    ],
    audit: [
      {
        who: "Payroll specialist",
        when: "Today, 9:14 AM",
        what: "Marked journal-entry workaround as unsafe for this issue."
      },
      {
        who: "Reviewer",
        when: "Yesterday, 4:38 PM",
        what: "Added source excerpt from supervisor note L24."
      },
      {
        who: "Knowledge intake",
        when: "Yesterday, 4:05 PM",
        what: "Drafted candidate guidance from resolved escalation QBO-4187."
      }
    ],
    feedback: ""
  },
  {
    id: "sales-tax-frequency",
    title: "Sales tax filing frequency changed mid-quarter",
    sourceType: "Resolved case",
    sourceName: "QBO-3862, agency notice attached",
    scopeLine: "Scope: QuickBooks sales tax center, agency notice changes monthly filing to quarterly filing.",
    status: "Ready after note",
    strength: 88,
    readiness: "ready",
    decisionNeed: "Confirm whether agents may reuse this as trusted guidance.",
    decisionQuestion:
      "Decision: may agents tell a reviewer how to handle a filing-frequency change when the agency notice is attached?",
    artifactLines: [
      {
        number: "L08",
        text: "Agency notice changed the taxpayer from monthly filing to quarterly filing effective April 1.",
        highlight: "effective April 1"
      },
      {
        number: "L15",
        text: "The reviewer updated filing frequency in the sales tax settings before preparing the next return.",
        highlight: "updated filing frequency"
      },
      {
        number: "L22",
        text: "Prior monthly filings were not amended because the notice applied prospectively.",
        highlight: "not amended"
      }
    ],
    evidence: [
      {
        id: "ev-tax-1",
        label: "Agency notice is attached",
        quote: "The filing-frequency change is supported by a dated agency notice.",
        support: "strong",
        detail: "Makes this safer than a generic user-reported change."
      },
      {
        id: "ev-tax-2",
        label: "Future-period scope is explicit",
        quote: "Prior monthly filings were not amended because the notice applied prospectively.",
        support: "scope",
        detail: "Prevents agents from recommending changes to prior filed returns."
      }
    ],
    claims: [
      {
        part: "Summary",
        status: "strong",
        statusLabel: "Source-backed",
        text: "Agency notice changed the filing cadence."
      },
      {
        part: "Exact fix",
        status: "strong",
        statusLabel: "Source-backed",
        text: "Update sales tax settings before preparing the next return."
      },
      {
        part: "Scope",
        status: "scope",
        statusLabel: "Bounded scope",
        text: "Only applies when the agency notice is attached and prospective."
      }
    ],
    gaps: [
      {
        kind: "Reviewer note",
        detail: "Add a short note that this does not amend prior filed returns unless the agency notice says so."
      }
    ],
    issues: {
      contradictions: 0,
      gaps: 1,
      scope: "Prospective filing frequency changes with agency notice",
      unsafeIf: "Used without an agency notice or used to amend past filings automatically"
    },
    guidance: {
      summary:
        "When an agency notice changes a customer's sales tax filing frequency, update the QBO sales tax setting before preparing the next return.",
      rootCause:
        "The agency changed the filing cadence prospectively, so QBO must match the new filing schedule.",
      fix:
        "Verify the agency notice and effective date, update the filing frequency in sales tax settings, then prepare the next return using the new cadence.",
      scope:
        "Use only when a dated agency notice is attached and the notice applies prospectively.",
      exclusions:
        "Do not amend prior returns unless the agency notice specifically requires it.",
      notes:
        "This is suitable for trusted guidance once the reviewer confirms the note about prior returns."
    },
    sourceWording:
      "Verify the agency notice and effective date, update the filing frequency in sales tax settings, then prepare the next return.",
    decision: "trusted",
    requirements: [
      {
        id: "source-match",
        label: "Exact fix matches the source",
        helper: "The setting update and effective date are reflected in the source.",
        met: true
      },
      {
        id: "scope-bound",
        label: "Scope and exclusions are clear",
        helper: "The record names the agency notice and prospective-only boundary.",
        met: true
      },
      {
        id: "contradiction-resolved",
        label: "Contradiction is resolved",
        helper: "No source contradiction remains.",
        met: true
      },
      {
        id: "missing-proof",
        label: "Missing proof is handled",
        helper: "Agency notice is attached.",
        met: true
      }
    ],
    audit: [
      {
        who: "Sales tax specialist",
        when: "Today, 10:02 AM",
        what: "Confirmed notice was prospective and attached."
      },
      {
        who: "Reviewer",
        when: "Today, 9:44 AM",
        what: "Added exclusion for prior filed returns."
      }
    ],
    feedback: ""
  },
  {
    id: "duplicate-bank-feed",
    title: "Undo reconciliation after duplicate bank-feed import",
    sourceType: "Conversation extract",
    sourceName: "QBO-3921, bank feed troubleshooting",
    scopeLine: "Scope: Bank feed duplicate import, reconciliation already completed.",
    status: "Contradicted",
    strength: 46,
    readiness: "contradicted",
    decisionNeed: "Decide whether to reject the proposed guidance or keep it as cautionary history.",
    decisionQuestion:
      "Decision: should agents ever recommend undoing reconciliation from this source?",
    artifactLines: [
      {
        number: "L05",
        text: "Customer imported a duplicate feed and reconciled before noticing the duplicate transactions.",
        highlight: "duplicate feed"
      },
      {
        number: "L16",
        text: "Support mentioned undo reconciliation, but later said only accountant tools can do this safely.",
        highlight: "only accountant tools"
      },
      {
        number: "L23",
        text: "Final answer was to review duplicates with the accountant and avoid deleting reconciled transactions directly.",
        highlight: "avoid deleting reconciled transactions"
      }
    ],
    evidence: [
      {
        id: "ev-bank-1",
        label: "Source includes a risky draft suggestion",
        quote: "Undo reconciliation was mentioned before the support rep corrected course.",
        support: "contradicted",
        detail: "A later source line narrows the safe action to accountant review."
      },
      {
        id: "ev-bank-2",
        label: "Final source instruction is cautionary",
        quote: "Avoid deleting reconciled transactions directly.",
        support: "strong",
        detail: "Supports rejecting the broad proposed guidance."
      }
    ],
    claims: [
      {
        part: "Summary",
        status: "partial",
        statusLabel: "Weak signal",
        text: "Duplicate feed after reconciliation is a valid case pattern."
      },
      {
        part: "Exact fix",
        status: "contradicted",
        statusLabel: "Contradiction",
        text: "The draft says undo reconciliation, but the source later restricts that action."
      },
      {
        part: "Scope",
        status: "gap",
        statusLabel: "Missing boundary",
        text: "The draft does not separate accountant-only tools from normal user steps."
      }
    ],
    gaps: [
      {
        kind: "Safety boundary",
        detail: "No boundary explains who can undo reconciliation and when it is appropriate."
      },
      {
        kind: "Contradiction",
        detail: "The draft copies an early support suggestion instead of the final corrected answer."
      }
    ],
    issues: {
      contradictions: 1,
      gaps: 2,
      scope: "Duplicate imported feed after completed reconciliation",
      unsafeIf: "Agents tell a non-accountant user to undo reconciliation or delete reconciled entries"
    },
    guidance: {
      summary:
        "Duplicate bank-feed imports after reconciliation require careful review before changing reconciled transactions.",
      rootCause:
        "The source does not prove that undo reconciliation is safe for the customer role.",
      fix:
        "Do not recommend undo reconciliation from this record. Treat it as case history and direct the reviewer to accountant-led cleanup.",
      scope:
        "Use as cautionary case history for duplicate bank-feed imports after reconciliation.",
      exclusions:
        "Not trusted guidance for undoing reconciliation, deleting reconciled transactions, or non-accountant cleanup.",
      notes:
        "Reject as guidance unless a separate accountant-reviewed source defines the safe workflow."
    },
    sourceWording:
      "Review duplicates with the accountant and avoid deleting reconciled transactions directly.",
    decision: "rejected",
    requirements: [
      {
        id: "source-match",
        label: "Exact fix matches the source",
        helper: "Current proposed guidance follows the final source answer, not the early suggestion.",
        met: false
      },
      {
        id: "scope-bound",
        label: "Scope and exclusions are clear",
        helper: "Accountant-only boundaries are not strong enough for trusted guidance.",
        met: false
      },
      {
        id: "contradiction-resolved",
        label: "Contradiction is resolved",
        helper: "The early undo-reconciliation suggestion conflicts with the final answer.",
        met: false
      },
      {
        id: "missing-proof",
        label: "Missing proof is handled",
        helper: "No accountant-approved cleanup steps are attached.",
        met: false
      }
    ],
    audit: [
      {
        who: "Reviewer",
        when: "Today, 8:51 AM",
        what: "Flagged source contradiction between early support suggestion and final answer."
      },
      {
        who: "Knowledge intake",
        when: "Today, 8:22 AM",
        what: "Captured draft from conversation extract QBO-3921."
      }
    ],
    feedback: ""
  }
];

const decisionCopy = {
  trusted: {
    label: "Trusted guidance",
    action: "Approve as trusted guidance",
    blockedAction: "Resolve requirements first",
    tone: "trusted",
    consequenceTitle: "Agents may use this in answers",
    consequences: [
      "They can recommend the exact fix inside the stated scope.",
      "They must show the exclusions before giving the advice.",
      "They should cite this source as reviewed guidance."
    ]
  },
  caseHistory: {
    label: "Case history only",
    action: "Keep as case history",
    tone: "case",
    consequenceTitle: "Agents may use this for comparison only",
    consequences: [
      "They can find similar cases and ask better follow-up questions.",
      "They cannot present the fix as approved guidance.",
      "A future reviewer can promote it after missing proof is handled."
    ]
  },
  rejected: {
    label: "Rejected knowledge",
    action: "Reject guidance",
    tone: "danger",
    consequenceTitle: "Agents must not use this as a recommendation",
    consequences: [
      "They can treat it as a warning about unsafe advice.",
      "They cannot quote the proposed fix in user-facing answers.",
      "A reviewer must create a new source-backed record if the pattern matters."
    ]
  },
  deprecated: {
    label: "Deprecated knowledge",
    action: "Mark deprecated",
    tone: "case",
    consequenceTitle: "Agents should avoid this and look for newer guidance",
    consequences: [
      "They can see why the older guidance changed.",
      "They cannot use this as the current answer.",
      "The audit trail keeps the historical decision visible."
    ]
  }
};

let selectedId = records[0].id;
let activeFilter = "all";
let searchQuery = "";
let activeTab = "evidence";
let selectedEvidenceId = records[0].evidence[1].id;
let compareMode = false;
let auditOpen = false;

const els = {
  topReadiness: document.getElementById("topReadiness"),
  topAction: document.getElementById("topAction"),
  itemCount: document.getElementById("itemCount"),
  search: document.getElementById("kbSearch"),
  recordList: document.getElementById("recordList"),
  recordTitle: document.getElementById("recordTitle"),
  recordSource: document.getElementById("recordSource"),
  strengthLabel: document.getElementById("strengthLabel"),
  strengthFill: document.getElementById("strengthFill"),
  decisionQuestion: document.getElementById("decisionQuestion"),
  artifactType: document.getElementById("artifactType"),
  artifactName: document.getElementById("artifactName"),
  artifactPreview: document.getElementById("artifactPreview"),
  evidencePanel: document.getElementById("evidencePanel"),
  compareButton: document.getElementById("compareButton"),
  applySourceButton: document.getElementById("applySourceButton"),
  summaryField: document.getElementById("summaryField"),
  rootCauseField: document.getElementById("rootCauseField"),
  fixField: document.getElementById("fixField"),
  scopeField: document.getElementById("scopeField"),
  exclusionsField: document.getElementById("exclusionsField"),
  notesField: document.getElementById("notesField"),
  decisionNeed: document.getElementById("decisionNeed"),
  consequenceBox: document.getElementById("consequenceBox"),
  requirementsList: document.getElementById("requirementsList"),
  issueSummary: document.getElementById("issueSummary"),
  primaryAction: document.getElementById("primaryAction"),
  auditToggle: document.getElementById("auditToggle"),
  auditPanel: document.getElementById("auditPanel"),
  auditList: document.getElementById("auditList"),
  actionFeedback: document.getElementById("actionFeedback")
};

function selectedRecord() {
  return records.find((record) => record.id === selectedId) || records[0];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function filteredRecords() {
  const query = searchQuery.trim().toLowerCase();

  return records.filter((record) => {
    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "attention" && record.readiness === "attention") ||
      (activeFilter === "contradicted" && record.readiness === "contradicted") ||
      (activeFilter === "ready" && record.readiness === "ready");

    const searchable = [
      record.title,
      record.sourceName,
      record.sourceType,
      record.scopeLine,
      record.guidance.summary,
      record.guidance.scope,
      record.guidance.exclusions
    ]
      .join(" ")
      .toLowerCase();

    return matchesFilter && (!query || searchable.includes(query));
  });
}

function strengthTone(record) {
  if (record.readiness === "contradicted") return "is-red";
  if (record.strength >= 82) return "is-green";
  return "is-amber";
}

function renderRecordList() {
  const visible = filteredRecords();
  els.itemCount.textContent = `${visible.length} item${visible.length === 1 ? "" : "s"}`;

  if (!visible.length) {
    els.recordList.innerHTML = `<div class="empty-state">No knowledge records match this search.</div>`;
    return;
  }

  els.recordList.innerHTML = visible
    .map((record) => {
      const issueText =
        record.issues.contradictions > 0
          ? `${record.issues.contradictions} contradiction`
          : `${record.issues.gaps} gap${record.issues.gaps === 1 ? "" : "s"}`;

      return `
        <button class="record-button ${record.id === selectedId ? "is-selected" : ""}" type="button" data-record-id="${escapeHtml(record.id)}">
          <strong>${escapeHtml(record.title)}</strong>
          <span>${escapeHtml(record.sourceName)}</span>
          <span class="record-meta">
            <span class="meta-chip ${strengthTone(record)}">${escapeHtml(record.status)}</span>
            <span class="meta-chip">${record.strength}% evidence</span>
            <span class="meta-chip">${escapeHtml(issueText)}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderArtifact(record) {
  const selectedEvidence = record.evidence.find((item) => item.id === selectedEvidenceId);
  const selectedWords = selectedEvidence ? selectedEvidence.quote.toLowerCase() : "";

  els.artifactType.textContent = record.sourceType;
  els.artifactName.textContent = record.sourceName;
  els.artifactPreview.innerHTML = record.artifactLines
    .map((line) => {
      const isSelected =
        selectedWords.includes(line.highlight.toLowerCase()) ||
        selectedWords.includes(line.text.toLowerCase().slice(0, 22));
      const safeText = escapeHtml(line.text).replace(
        escapeHtml(line.highlight),
        `<mark>${escapeHtml(line.highlight)}</mark>`
      );
      return `
        <div class="source-line ${isSelected ? "is-selected" : ""}">
          <span class="line-number">${escapeHtml(line.number)}</span>
          <span>${safeText}</span>
        </div>
      `;
    })
    .join("");
}

function renderTabPanel(record) {
  if (activeTab === "claims" || compareMode) {
    els.evidencePanel.innerHTML = `
      <div class="claim-list">
        ${record.claims
          .map(
            (claim) => `
              <div class="claim-row">
                <div>
                  <span class="support-label ${escapeHtml(claim.status)}">${escapeHtml(claim.statusLabel)}</span>
                  <strong>${escapeHtml(claim.part)}</strong>
                </div>
                <span>${escapeHtml(claim.text)}</span>
              </div>
            `
          )
          .join("")}
      </div>
    `;
    return;
  }

  if (activeTab === "gaps") {
    els.evidencePanel.innerHTML = `
      <div class="gap-list">
        ${record.gaps
          .map(
            (gap) => `
              <div class="gap-row">
                <span class="support-label gap">${escapeHtml(gap.kind)}</span>
                <strong>${escapeHtml(gap.kind)}</strong>
                <span>${escapeHtml(gap.detail)}</span>
              </div>
            `
          )
          .join("")}
      </div>
    `;
    return;
  }

  els.evidencePanel.innerHTML = `
    <div class="evidence-list">
      ${record.evidence
        .map(
          (evidence) => `
            <button class="evidence-button ${evidence.id === selectedEvidenceId ? "is-selected" : ""}" type="button" data-evidence-id="${escapeHtml(evidence.id)}">
              <span class="support-label ${escapeHtml(evidence.support)}">${escapeHtml(evidence.support)}</span>
              <strong>${escapeHtml(evidence.label)}</strong>
              <span>${escapeHtml(evidence.quote)}</span>
              <span>${escapeHtml(evidence.detail)}</span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderGuidanceFields(record) {
  els.summaryField.value = record.guidance.summary;
  els.rootCauseField.value = record.guidance.rootCause;
  els.fixField.value = record.guidance.fix;
  els.scopeField.value = record.guidance.scope;
  els.exclusionsField.value = record.guidance.exclusions;
  els.notesField.value = record.guidance.notes;
}

function allRequirementsMet(record) {
  return record.requirements.every((requirement) => requirement.met);
}

function blockedTrusted(record) {
  return record.decision === "trusted" && !allRequirementsMet(record);
}

function renderDecision(record) {
  document.querySelectorAll(".decision-option").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.decision === record.decision);
    button.setAttribute("aria-checked", button.dataset.decision === record.decision ? "true" : "false");
  });

  const copy = decisionCopy[record.decision];
  const blocked = blockedTrusted(record);
  const actionText = blocked ? copy.blockedAction : copy.action;

  els.decisionNeed.textContent = record.decisionNeed;
  els.topAction.textContent = actionText;
  els.primaryAction.textContent = actionText;
  els.primaryAction.classList.toggle("is-blocked", blocked);
  els.topAction.classList.toggle("is-blocked", blocked);
  els.primaryAction.classList.toggle("is-danger", record.decision === "rejected");
  els.topAction.classList.toggle("is-danger", record.decision === "rejected");

  els.consequenceBox.innerHTML = `
    <strong>${escapeHtml(copy.consequenceTitle)}</strong>
    <ul>
      ${copy.consequences.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;

  els.requirementsList.innerHTML = record.requirements
    .map(
      (requirement) => `
        <label class="requirement-row">
          <input type="checkbox" data-requirement-id="${escapeHtml(requirement.id)}" ${requirement.met ? "checked" : ""} />
          <span>
            <strong>${escapeHtml(requirement.label)}</strong>
            <span>${escapeHtml(requirement.helper)}</span>
          </span>
        </label>
      `
    )
    .join("");

  els.issueSummary.innerHTML = `
    <strong>Why this needs a human call</strong>
    <ul>
      <li>Scope: ${escapeHtml(record.issues.scope)}</li>
      <li>Unsafe if: ${escapeHtml(record.issues.unsafeIf)}</li>
      <li>${record.issues.contradictions} contradiction${record.issues.contradictions === 1 ? "" : "s"} and ${record.issues.gaps} gap${record.issues.gaps === 1 ? "" : "s"} visible before approval.</li>
    </ul>
  `;
}

function renderAudit(record) {
  els.auditToggle.setAttribute("aria-expanded", auditOpen ? "true" : "false");
  els.auditToggle.textContent = auditOpen ? "Hide audit details" : "Reveal audit details";
  els.auditPanel.hidden = !auditOpen;
  els.auditList.innerHTML = record.audit
    .map(
      (event) => `
        <div class="audit-row">
          <strong>${escapeHtml(event.who)} - ${escapeHtml(event.when)}</strong>
          <span>${escapeHtml(event.what)}</span>
        </div>
      `
    )
    .join("");
}

function renderSelectedRecord() {
  const record = selectedRecord();

  els.topReadiness.textContent = record.status;
  els.recordTitle.textContent = record.title;
  els.recordSource.textContent = `${record.sourceType}: ${record.sourceName}. ${record.scopeLine}`;
  els.strengthLabel.textContent = `${record.strength}% evidence strength`;
  els.strengthFill.style.width = `${record.strength}%`;
  els.decisionQuestion.textContent = record.decisionQuestion;
  els.compareButton.textContent = compareMode ? "Show evidence" : "Show claim match";

  document.querySelectorAll(".tab-button").forEach((button) => {
    const selected = button.dataset.tab === activeTab && !compareMode;
    button.classList.toggle("is-active", selected);
  });

  renderArtifact(record);
  renderTabPanel(record);
  renderGuidanceFields(record);
  renderDecision(record);
  renderAudit(record);
}

function render() {
  renderRecordList();
  renderSelectedRecord();
}

function updateGuidanceFromFields() {
  const record = selectedRecord();
  record.guidance.summary = els.summaryField.value;
  record.guidance.rootCause = els.rootCauseField.value;
  record.guidance.fix = els.fixField.value;
  record.guidance.scope = els.scopeField.value;
  record.guidance.exclusions = els.exclusionsField.value;
  record.guidance.notes = els.notesField.value;
}

function runPrimaryAction() {
  updateGuidanceFromFields();
  const record = selectedRecord();
  const copy = decisionCopy[record.decision];

  if (blockedTrusted(record)) {
    els.actionFeedback.textContent =
      "Trusted guidance is blocked until the unchecked requirements are resolved. Case history remains allowed.";
    return;
  }

  record.status = copy.label;
  record.feedback =
    record.decision === "trusted"
      ? "Approved for agent guidance inside the stated scope."
      : `${copy.label} saved. Agent-use consequences have been updated.`;
  els.actionFeedback.textContent = record.feedback;
  render();
}

els.recordList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-record-id]");
  if (!button) return;

  selectedId = button.dataset.recordId;
  const record = selectedRecord();
  selectedEvidenceId = record.evidence[0]?.id || "";
  activeTab = "evidence";
  compareMode = false;
  auditOpen = false;
  els.actionFeedback.textContent = "";
  render();
});

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    renderRecordList();
  });
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeTab = button.dataset.tab;
    compareMode = false;
    renderSelectedRecord();
  });
});

document.querySelectorAll(".decision-option").forEach((button) => {
  button.addEventListener("click", () => {
    updateGuidanceFromFields();
    selectedRecord().decision = button.dataset.decision;
    els.actionFeedback.textContent = "";
    renderSelectedRecord();
  });
});

els.search.addEventListener("input", () => {
  searchQuery = els.search.value;
  renderRecordList();
});

els.evidencePanel.addEventListener("click", (event) => {
  const button = event.target.closest("[data-evidence-id]");
  if (!button) return;

  selectedEvidenceId = button.dataset.evidenceId;
  renderSelectedRecord();
});

els.requirementsList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-requirement-id]");
  if (!checkbox) return;

  const requirement = selectedRecord().requirements.find((item) => item.id === checkbox.dataset.requirementId);
  if (requirement) {
    requirement.met = checkbox.checked;
    els.actionFeedback.textContent = "";
    renderSelectedRecord();
  }
});

els.compareButton.addEventListener("click", () => {
  compareMode = !compareMode;
  if (compareMode) activeTab = "claims";
  renderSelectedRecord();
});

els.applySourceButton.addEventListener("click", () => {
  const record = selectedRecord();
  els.fixField.value = record.sourceWording;
  record.guidance.fix = record.sourceWording;
  els.actionFeedback.textContent = "Exact fix replaced with source wording. Review requirements before publishing.";
});

els.auditToggle.addEventListener("click", () => {
  auditOpen = !auditOpen;
  renderSelectedRecord();
});

els.primaryAction.addEventListener("click", runPrimaryAction);
els.topAction.addEventListener("click", runPrimaryAction);

[
  els.summaryField,
  els.rootCauseField,
  els.fixField,
  els.scopeField,
  els.exclusionsField,
  els.notesField
].forEach((field) => {
  field.addEventListener("change", updateGuidanceFromFields);
});

render();
