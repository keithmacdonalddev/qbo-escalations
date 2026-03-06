const FAMILY_OPTIONS = [
  { value: 'agents', label: 'AGENTS.md' },
  { value: 'claude', label: 'CLAUDE.md' },
  { value: 'hooks', label: 'Hooks' },
  { value: 'skills', label: 'Skills' },
  { value: 'prompts', label: 'Prompt Files' },
  { value: 'agent-prompts', label: 'Agent Definitions' },
  { value: 'custom', label: 'Custom Agentic File' },
];

const state = {
  family: 'agents',
  left: null,
  right: null,
  history: [],
  projectProfile: null,
  artifactCatalog: [],
  taskPack: [],
};

const elements = {
  familySelect: document.getElementById('familySelect'),
  projectArtifactSelect: document.getElementById('projectArtifactSelect'),
  loadProjectButton: document.getElementById('loadProjectButton'),
  modeSelect: document.getElementById('modeSelect'),
  runButton: document.getElementById('runButton'),
  statusText: document.getElementById('statusText'),
  familySummary: document.getElementById('familySummary'),
  artifactPathInput: document.getElementById('artifactPathInput'),
  catalogSummary: document.getElementById('catalogSummary'),
  projectProfile: document.getElementById('projectProfile'),
  coverageGrid: document.getElementById('coverageGrid'),
  leftInput: document.getElementById('leftInput'),
  rightInput: document.getElementById('rightInput'),
  leftPickerLabel: document.getElementById('leftPickerLabel'),
  rightPickerLabel: document.getElementById('rightPickerLabel'),
  leftMeta: document.getElementById('leftMeta'),
  rightMeta: document.getElementById('rightMeta'),
  leftPreview: document.getElementById('leftPreview'),
  rightPreview: document.getElementById('rightPreview'),
  taskPackList: document.getElementById('taskPackList'),
  historyList: document.getElementById('historyList'),
  resultsPanel: document.getElementById('resultsPanel'),
  winnerName: document.getElementById('winnerName'),
  winnerMargin: document.getElementById('winnerMargin'),
  winnerConfidence: document.getElementById('winnerConfidence'),
  winnerMode: document.getElementById('winnerMode'),
  winnerFamily: document.getElementById('winnerFamily'),
  winnerPath: document.getElementById('winnerPath'),
  winnerConclusion: document.getElementById('winnerConclusion'),
  winnerReasons: document.getElementById('winnerReasons'),
  leftTitle: document.getElementById('leftTitle'),
  rightTitle: document.getElementById('rightTitle'),
  leftScoreBlock: document.getElementById('leftScoreBlock'),
  rightScoreBlock: document.getElementById('rightScoreBlock'),
  hardGateTable: document.getElementById('hardGateTable'),
  taskBenchmarkTable: document.getElementById('taskBenchmarkTable'),
  categoryTable: document.getElementById('categoryTable'),
  scenarioTable: document.getElementById('scenarioTable'),
  evidenceColumns: document.getElementById('evidenceColumns'),
  riskColumns: document.getElementById('riskColumns'),
};

async function bootstrap() {
  renderFamilySelect();
  syncFamilyUI();
  setStatus('Checking Policy Lab server...', 'pending');

  try {
    const response = await fetch('/api/bootstrap');
    const payload = await response.json();
    state.projectProfile = payload.projectProfile;
    state.artifactCatalog = payload.artifactCatalog || [];
    state.history = payload.history || [];
    renderCatalog();
    renderProjectProfile();
    renderHistory();
    renderTaskPackHint([]);
    setStatus('Ready. Load a project file or upload both versions from the same file family, then run the comparison.', 'good');
  } catch {
    setStatus('Server unavailable. Start the app with `npm run app` in prototypes/policy-lab.', 'bad');
  }
}

function renderFamilySelect() {
  elements.familySelect.innerHTML = FAMILY_OPTIONS
    .map((entry) => `<option value="${entry.value}">${entry.label}</option>`)
    .join('');
  elements.familySelect.value = state.family;
}

function renderCatalog() {
  const familyCatalog = getFamilyCatalog();
  elements.projectArtifactSelect.innerHTML = familyCatalog.length
    ? familyCatalog.map((entry) => `<option value="${entry.path}">${entry.path}</option>`).join('')
    : '<option value="">No project files found for this family</option>';

  const selected = familyCatalog[0]?.path || '';
  if (!elements.projectArtifactSelect.value && selected) {
    elements.projectArtifactSelect.value = selected;
  }

  const familyLabel = FAMILY_OPTIONS.find((entry) => entry.value === state.family)?.label || state.family;
  elements.familySummary.textContent = `Comparing ${familyLabel} versions only. This prevents unlike-for-unlike comparisons such as a skill against AGENTS.md.`;
  elements.catalogSummary.innerHTML = familyCatalog.length
    ? `<p>${familyCatalog.length} project file(s) available for this family.</p><div class="mini-catalog">${familyCatalog
        .slice(0, 8)
        .map((entry) => `<span>${entry.path}</span>`)
        .join('')}</div>`
    : '<p>No matching project file was discovered for this family. You can still upload both versions manually.</p>';

  if (!elements.artifactPathInput.value || elements.artifactPathInput.dataset.autofill === 'true') {
    elements.artifactPathInput.value = selected;
    elements.artifactPathInput.dataset.autofill = selected ? 'true' : 'false';
  }
}

function renderProjectProfile() {
  if (!state.projectProfile) {
    elements.projectProfile.innerHTML = '<div class="chip">Project profile unavailable.</div>';
    return;
  }

  const chips = [
    ['client', state.projectProfile.hasClient],
    ['server', state.projectProfile.hasServer],
    ['prototypes', state.projectProfile.hasPrototypes],
    ['hooks', state.projectProfile.hasHooks],
    ['root AGENTS', state.projectProfile.hasRootAgents],
    ['CLAUDE', state.projectProfile.hasClaudeMd],
    ['test script', state.projectProfile.testScriptPresent],
    ['dev script', state.projectProfile.devScriptPresent],
  ];

  elements.projectProfile.innerHTML = chips
    .map(([label, value]) => `<div class="chip ${value ? 'on' : 'off'}">${label}: ${value ? 'yes' : 'no'}</div>`)
    .join('');

  const counts = state.projectProfile.artifactCounts || {};
  elements.coverageGrid.innerHTML = Object.entries(counts)
    .map(([key, value]) => `<div class="coverage-card"><span>${humanize(key)}</span><strong>${value}</strong></div>`)
    .join('');
}

function renderTaskPackHint(taskPack) {
  const fallback = [
    'Prototype containment',
    'Production app edit',
    'Testing restraint',
    'Process safety',
    'Stale-state verification',
    'Long-term stability',
  ];
  const list = taskPack.length ? taskPack.map((entry) => entry.title) : fallback;
  elements.taskPackList.innerHTML = list.map((entry) => `<li>${entry}</li>`).join('');
}

function renderHistory() {
  if (!state.history.length) {
    elements.historyList.innerHTML = '<p class="empty">No saved comparisons yet.</p>';
    return;
  }

  elements.historyList.innerHTML = state.history
    .map(
      (entry) => `
        <article class="history-item">
          <strong>${entry.winner}</strong>
          <span>${entry.familyLabel || humanize(entry.family || 'agents')}</span>
          <span>${entry.artifactPath || 'uploaded pair'}</span>
          <span>${new Date(entry.generatedAt).toLocaleString()}</span>
          <span>mode: ${humanize(entry.mode || 'full')}</span>
          <span>confidence: ${entry.confidence}</span>
          <span>margin: ${entry.margin}</span>
        </article>
      `,
    )
    .join('');
}

function syncFamilyUI() {
  const label = FAMILY_OPTIONS.find((entry) => entry.value === state.family)?.label || 'File';
  elements.leftPickerLabel.textContent = `Choose Current ${label}`;
  elements.rightPickerLabel.textContent = `Choose Proposed ${label}`;
}

function getFamilyCatalog() {
  return state.artifactCatalog.filter((entry) => entry.family === state.family);
}

function updateRunButton() {
  elements.runButton.disabled = !(state.left && state.right);
}

function resetLoadedFiles() {
  state.left = null;
  state.right = null;
  elements.leftInput.value = '';
  elements.rightInput.value = '';
  elements.resultsPanel.classList.add('hidden');
  renderFile('left');
  renderFile('right');
  updateRunButton();
}

function setStatus(message, tone) {
  elements.statusText.textContent = message;
  elements.statusText.dataset.tone = tone;
}

async function handleFileSelection(side, file) {
  if (!file) return;

  const slotLabel = side === 'left' ? 'Current' : 'Proposed';
  const content = await file.text();
  state[side] = {
    slotLabel,
    name: file.name,
    content,
    family: state.family,
    artifactPath: elements.artifactPathInput.value.trim(),
  };

  renderFile(side);
  updateRunButton();
}

function renderFile(side) {
  const target = state[side];
  const metaElement = side === 'left' ? elements.leftMeta : elements.rightMeta;
  const previewElement = side === 'left' ? elements.leftPreview : elements.rightPreview;

  if (!target) {
    metaElement.textContent = 'No file selected.';
    previewElement.textContent = 'Awaiting file.';
    return;
  }

  const words = target.content.trim().split(/\s+/).filter(Boolean).length;
  metaElement.textContent = `${target.slotLabel} | ${target.name} | ${target.family} | ${words} words`;
  previewElement.textContent = target.content.split(/\r?\n/).slice(0, 18).join('\n');
}

async function loadProjectArtifact() {
  const selectedPath = elements.projectArtifactSelect.value;
  if (!selectedPath) {
    setStatus('No project file is available for the selected family.', 'bad');
    return;
  }

  setStatus(`Loading ${selectedPath}...`, 'pending');
  try {
    const response = await fetch(`/api/project-artifact?path=${encodeURIComponent(selectedPath)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load the selected project file.');
    state.left = payload;
    state.family = payload.family || state.family;
    elements.familySelect.value = state.family;
    elements.artifactPathInput.value = payload.artifactPath || selectedPath;
    elements.artifactPathInput.dataset.autofill = 'true';
    syncFamilyUI();
    renderCatalog();
    renderFile('left');
    updateRunButton();
    setStatus(`Loaded ${selectedPath} into the Current slot.`, 'good');
  } catch (error) {
    setStatus(error.message || 'Could not load the selected project file.', 'bad');
  }
}

async function runEvaluation() {
  if (!(state.left && state.right)) return;

  setStatus('Running evaluation...', 'pending');
  elements.runButton.disabled = true;

  try {
    const response = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: elements.modeSelect.value,
        family: state.family,
        artifactPath: elements.artifactPathInput.value.trim(),
        left: { ...state.left, family: state.family, artifactPath: elements.artifactPathInput.value.trim() },
        right: { ...state.right, family: state.family, artifactPath: elements.artifactPathInput.value.trim() },
      }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Evaluation failed.');

    state.taskPack = payload.taskPack || [];
    renderTaskPackHint(state.taskPack);
    await refreshHistory();
    renderResults(payload);
    setStatus('Evaluation complete.', 'good');
  } catch (error) {
    setStatus(error.message || 'Evaluation failed.', 'bad');
  } finally {
    updateRunButton();
  }
}

async function refreshHistory() {
  try {
    const response = await fetch('/api/history');
    const payload = await response.json();
    state.history = payload.history || [];
    renderHistory();
  } catch {
    // keep previous history
  }
}

function renderResults(result) {
  const { left, right, comparison, taskBenchmark } = result;
  elements.resultsPanel.classList.remove('hidden');
  elements.leftTitle.textContent = left.displayName;
  elements.rightTitle.textContent = right.displayName;
  elements.winnerName.textContent = comparison.recommendedLabel;
  elements.winnerMargin.textContent = `${comparison.scoreMargin.toFixed(1)} pts`;
  elements.winnerConfidence.textContent = `${comparison.confidence.level} (${comparison.confidence.score})`;
  elements.winnerMode.textContent = humanize(comparison.mode);
  elements.winnerFamily.textContent = comparison.familyLabel;
  elements.winnerPath.textContent = result.artifactPath || 'uploaded pair';
  elements.winnerConclusion.textContent = comparison.conclusion;
  elements.winnerReasons.innerHTML = comparison.reasons.map((reason) => `<p>${reason}</p>`).join('');

  elements.leftScoreBlock.innerHTML = buildScoreBlock(left);
  elements.rightScoreBlock.innerHTML = buildScoreBlock(right);
  elements.hardGateTable.innerHTML = buildHardGateTable(left, right);
  elements.taskBenchmarkTable.innerHTML = buildTaskBenchmarkTable(left, right, taskBenchmark);
  elements.categoryTable.innerHTML = buildComparisonTable(
    ['Category', left.slotLabel, right.slotLabel],
    left.categoryScores.map((entry) => [entry.title, entry.score.toFixed(1), findById(right.categoryScores, entry.id).score.toFixed(1)]),
  );
  elements.scenarioTable.innerHTML = buildComparisonTable(
    ['Scenario', left.slotLabel, right.slotLabel],
    left.scenarioScores.map((entry) => [entry.title, entry.score.toFixed(1), findById(right.scenarioScores, entry.id).score.toFixed(1)]),
  );
  elements.evidenceColumns.innerHTML = buildEvidenceCard(left) + buildEvidenceCard(right);
  elements.riskColumns.innerHTML = buildRiskCard(left) + buildRiskCard(right);
}

function buildScoreBlock(analysis) {
  const dimensionBars = Object.entries(analysis.dimensions)
    .map(
      ([label, value]) => `
        <div class="bar-row">
          <span>${humanize(label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${value}%"></div></div>
          <strong>${value.toFixed(1)}</strong>
        </div>
      `,
    )
    .join('');

  const gateSummary = analysis.hardGateFailures.length
    ? `<span class="alert bad">${analysis.hardGateFailures.length} hard-gate failure(s)</span>`
    : `<span class="alert good">All required hard gates passed</span>`;

  return `
    <div class="score-hero">
      <div><span class="meta-label">Overall</span><strong>${analysis.overallScore.toFixed(1)}</strong></div>
      <div><span class="meta-label">Policy Avg</span><strong>${analysis.scenarioAverage.toFixed(1)}</strong></div>
      <div><span class="meta-label">Task Avg</span><strong>${analysis.taskAverage.toFixed(1)}</strong></div>
    </div>
    <div class="meta-grid">
      <span>${analysis.familyLabel}</span>
      <span>${analysis.metrics.wordCount} words</span>
      <span>${analysis.metrics.lineCount} lines</span>
      <span>${analysis.metrics.directiveCount} directives</span>
      <span>${analysis.conflicts.length} contradiction signals</span>
    </div>
    <div class="meta-grid"><span>${analysis.artifactPath || 'uploaded pair'}</span></div>
    <div class="alert-row">${gateSummary}</div>
    <div class="bar-stack">${dimensionBars}</div>
  `;
}

function buildHardGateTable(left, right) {
  const rows = left.hardGates.map((gate) => {
    const other = findById(right.hardGates, gate.id);
    return [
      gate.title,
      gate.required ? `${gate.actual.toFixed(1)} / ${gate.threshold}` : 'not required',
      other.required ? `${other.actual.toFixed(1)} / ${other.threshold}` : 'not required',
      gate.passed ? 'pass' : 'fail',
      other.passed ? 'pass' : (other.required ? 'fail' : 'n/a'),
    ];
  });

  return buildComparisonTable(['Gate', 'Current', 'Proposed', 'Current Status', 'Proposed Status'], rows);
}

function buildTaskBenchmarkTable(left, right, taskBenchmark) {
  const rows = left.taskScores.map((task) => {
    const other = findById(right.taskScores, task.id);
    return [task.title, `${task.score.toFixed(1)} (${task.passed ? 'pass' : 'watch'})`, `${other.score.toFixed(1)} (${other.passed ? 'pass' : 'watch'})`];
  });

  const summary = `<p class="benchmark-summary">Winner: <strong>${taskBenchmark.recommendedLabel}</strong> | Current passes ${taskBenchmark.leftPassCount}/${taskBenchmark.totalTasks} | Proposed passes ${taskBenchmark.rightPassCount}/${taskBenchmark.totalTasks}</p>`;
  return summary + buildComparisonTable(['Task', 'Current', 'Proposed'], rows);
}

function buildEvidenceCard(analysis) {
  const evidenceRows = analysis.categoryScores
    .map(
      (entry) => `
        <article class="evidence-item">
          <strong>${entry.title} (${entry.score})</strong>
          <p><span class="mini-label">matched</span> ${formatSignalList(entry.matchedSignals)}</p>
          <p><span class="mini-label">missing</span> ${formatSignalList(entry.missingSignals)}</p>
        </article>
      `,
    )
    .join('');

  return `<div class="evidence-card"><h4>${analysis.displayName}</h4>${evidenceRows}</div>`;
}

function buildRiskCard(analysis) {
  return `<div class="risk-card"><h4>${analysis.displayName}</h4>${buildRiskList(analysis.riskFlags)}</div>`;
}

function buildRiskList(items) {
  if (!items.length) return '<p class="empty">No high-risk flags triggered.</p>';
  return `<ul class="risk-list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function buildComparisonTable(headers, rows) {
  const head = headers.map((header) => `<th>${header}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function formatSignalList(items) {
  if (!items.length) return 'none';
  return items.slice(0, 4).map((item) => item.replace(/\\/g, '')).join(', ');
}

function findById(entries, id) {
  return entries.find((entry) => entry.id === id) || { score: 0, required: false, actual: 0, threshold: 0, passed: false };
}

function humanize(value) {
  return String(value).replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').replace(/^./, (char) => char.toUpperCase());
}

elements.familySelect?.addEventListener('change', (event) => {
  state.family = event.target.value;
  syncFamilyUI();
  renderCatalog();
  resetLoadedFiles();
  setStatus('Family changed. Load or upload both versions for the selected file family.', 'pending');
});

elements.projectArtifactSelect?.addEventListener('change', (event) => {
  elements.artifactPathInput.value = event.target.value;
  elements.artifactPathInput.dataset.autofill = 'true';
});

elements.artifactPathInput?.addEventListener('input', () => {
  elements.artifactPathInput.dataset.autofill = 'false';
});

elements.leftInput?.addEventListener('change', async (event) => {
  await handleFileSelection('left', event.target.files?.[0]);
});

elements.rightInput?.addEventListener('change', async (event) => {
  await handleFileSelection('right', event.target.files?.[0]);
});

elements.loadProjectButton?.addEventListener('click', loadProjectArtifact);
elements.runButton?.addEventListener('click', runEvaluation);

bootstrap();
