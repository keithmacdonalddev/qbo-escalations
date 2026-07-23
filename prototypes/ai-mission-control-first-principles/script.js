const agents = {
  parser: {
    name: "Image Parser",
    lead: "The careful reader at the start of every screenshot-based case.",
    purpose: "Transcribe visible facts from screenshots without guessing what they mean.",
    input: "The original screenshot and any note you add to it.",
    output: "A structured list of visible fields, messages, dates, amounts, and uncertainties.",
    boundary: "Diagnose the problem, invent missing text, or decide the next troubleshooting step.",
    evidence: "Passed 24 of 24 reviewed screenshot cases.",
    primary: "OpenAI · GPT-5.4",
    backup: "Google · Gemini 3.1 Pro"
  },
  search: {
    name: "INV Search",
    lead: "The known-issue specialist who checks whether this has happened before.",
    purpose: "Compare the case evidence with active and historical investigation records.",
    input: "Parsed evidence, product area, symptoms, and relevant dates.",
    output: "Ranked possible matches with reasons for and against each match.",
    boundary: "Declare a match without supporting evidence or create a new investigation record.",
    evidence: "Passed 18 of 18 reviewed known-issue searches.",
    primary: "OpenAI · GPT-5.4 Mini",
    backup: "Anthropic · Haiku 4.5"
  },
  triage: {
    name: "Triage",
    lead: "The diagnostic specialist who turns symptoms into safe next checks.",
    purpose: "Separate facts from assumptions, identify likely causes, and propose the safest checks.",
    input: "Parsed evidence, customer context, conversation history, and approved knowledge.",
    output: "A ranked diagnosis, open questions, and a short sequence of next checks.",
    boundary: "Present a hypothesis as fact, skip safety checks, or send a customer response.",
    evidence: "Passed 22 of 22 reviewed diagnosis cases.",
    primary: "Anthropic · Sonnet 4.6",
    backup: "OpenAI · GPT-5.4"
  },
  analyst: {
    name: "QBO Analyst",
    lead: "The lead specialist who turns separate findings into one useful recommendation.",
    purpose: "Reconcile investigation and triage findings into a clear, evidence-backed answer.",
    input: "The original evidence plus outputs from Image Parser, INV Search, and Triage.",
    output: "A recommended response, its evidence, unresolved risks, and what you need to approve.",
    boundary: "Hide disagreement between specialists, approve its own answer, or publish knowledge.",
    evidence: "Passed 24 of 24 reviewed recommendations; one case remains disputed.",
    primary: "Anthropic · Sonnet 4.6",
    backup: "OpenAI · GPT-5.4"
  },
  curator: {
    name: "Knowledge Curator",
    lead: "The memory specialist who helps the team learn only from confirmed outcomes.",
    purpose: "Turn a resolved case into a reviewable knowledge draft with a clear scope.",
    input: "The confirmed outcome, supporting evidence, and the final approved response.",
    output: "A knowledge draft that names what is reusable, uncertain, and case-specific.",
    boundary: "Publish a draft, treat an unconfirmed outcome as truth, or broaden its scope silently.",
    evidence: "Passed 15 of 15 reviewed knowledge-draft cases.",
    primary: "Anthropic · Sonnet 4.6",
    backup: "Google · Gemini 3.1 Pro"
  }
};

const views = document.querySelectorAll(".view");
const tabs = document.querySelectorAll(".view-tab");
const agentOverlay = document.getElementById("agentOverlay");
const advancedOverlay = document.getElementById("advancedOverlay");
const toast = document.getElementById("toast");
let toastTimer;

function showView(name) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
  views.forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function openOverlay(overlay) {
  overlay.hidden = false;
  document.body.classList.add("overlay-open");
  requestAnimationFrame(() => overlay.querySelector(".close-button").focus());
}

function closeOverlay(overlay) {
  overlay.hidden = true;
  if (agentOverlay.hidden && advancedOverlay.hidden) document.body.classList.remove("overlay-open");
}

tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));

document.querySelectorAll(".agent-step").forEach((button) => {
  button.addEventListener("click", () => {
    const agent = agents[button.dataset.agent];
    document.getElementById("agentPanelTitle").textContent = agent.name;
    document.getElementById("agentPanelLead").textContent = agent.lead;
    document.getElementById("agentPurpose").textContent = agent.purpose;
    document.getElementById("agentInput").textContent = agent.input;
    document.getElementById("agentOutput").textContent = agent.output;
    document.getElementById("agentBoundary").textContent = agent.boundary;
    document.getElementById("agentEvidence").textContent = agent.evidence;
    document.getElementById("agentPrimary").textContent = agent.primary;
    document.getElementById("agentBackup").textContent = agent.backup;
    openOverlay(agentOverlay);
  });
});

document.getElementById("advancedButton").addEventListener("click", () => openOverlay(advancedOverlay));
document.querySelectorAll("[data-close='agent']").forEach((button) => button.addEventListener("click", () => closeOverlay(agentOverlay)));
document.querySelectorAll("[data-close='advanced']").forEach((button) => button.addEventListener("click", () => closeOverlay(advancedOverlay)));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!advancedOverlay.hidden) closeOverlay(advancedOverlay);
  else if (!agentOverlay.hidden) closeOverlay(agentOverlay);
});

["checkTeamButton", "runCheckButton"].forEach((id) => {
  document.getElementById(id).addEventListener("click", (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Checking…";
    setTimeout(() => {
      button.disabled = false;
      button.textContent = original;
      showToast("Team check complete — ready for QBO work");
    }, 850);
  });
});

const modelChoices = document.querySelectorAll("input[name='modelChoice']");
const approveButton = document.getElementById("approveDecision");
modelChoices.forEach((choice) => choice.addEventListener("change", () => {
  approveButton.disabled = document.querySelector("input[name='modelChoice']:checked").value !== "proposed";
}));

function resolveDecision(message) {
  document.getElementById("decisionCard").hidden = true;
  document.getElementById("emptyDecisions").hidden = false;
  document.querySelector(".tab-count").hidden = true;
  showToast(message);
}

approveButton.addEventListener("click", () => resolveDecision("Change approved — it will be verified before release"));
document.getElementById("dismissDecision").addEventListener("click", () => resolveDecision("Decision postponed — current setup remains active"));
document.getElementById("providerDetailsButton").addEventListener("click", () => showToast("Detailed provider management would open here"));
