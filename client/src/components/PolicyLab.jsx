import { useEffect, useMemo, useState } from 'react';
import {
  getPolicyLabBootstrap,
  getPolicyLabHistory,
  getProjectPolicyArtifact,
  runPolicyLabEvaluation,
} from '../api/policyLabApi.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_OPTIONS,
} from '../lib/providerCatalog.js';

const FAMILY_OPTIONS = [
  { value: 'agents', label: 'AGENTS.md' },
  { value: 'claude', label: 'CLAUDE.md' },
  { value: 'hooks', label: 'Hooks' },
  { value: 'skills', label: 'Skills' },
  { value: 'prompts', label: 'Prompt Files' },
  { value: 'agent-prompts', label: 'Agent Definitions' },
  { value: 'custom', label: 'Custom Agentic File' },
];

function findById(entries, id) {
  return entries.find((entry) => entry.id === id) || { score: 0, title: id };
}

function humanize(value) {
  return String(value).replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').replace(/^./, (char) => char.toUpperCase());
}

function toFixed(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0';
}

function formatBulletList(items, fallback = '- none') {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items.map((item) => `- ${item}`).join('\n');
}

function formatScoreTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '- none';
  return rows.map((row) => `- ${row}`).join('\n');
}

function buildModelAssessmentText(modelEval) {
  return [
    `${modelEval.slotLabel} model: ${modelEval.providerLabel}`,
    `Status: ${modelEval.ok ? 'completed' : 'failed'}`,
    `Overall score: ${toFixed(modelEval.overallScore)}`,
    `Confidence: ${modelEval.confidence || 'Unknown'}`,
    `Recommendation: ${modelEval.recommendation || 'None'}`,
    modelEval.error ? `Error: ${modelEval.error}` : null,
    'Strengths:',
    formatBulletList(modelEval.strengths),
    'Risks:',
    formatBulletList(modelEval.risks),
    'Category scores:',
    formatScoreTable((modelEval.categoryScores || []).map((entry) => `${entry.label}: ${toFixed(entry.score)}`)),
  ].filter(Boolean).join('\n');
}

function buildAgenticAssessmentText(agenticEval) {
  return [
    `${agenticEval.slotLabel} full agentic evaluator: ${agenticEval.providerLabel}`,
    `Status: ${agenticEval.ok ? 'completed' : 'failed'}`,
    `Overall score: ${toFixed(agenticEval.overallScore)}`,
    `Confidence: ${agenticEval.confidence || 'Unknown'}`,
    `Verdict: ${agenticEval.verdict || 'unknown'}`,
    `Summary: ${agenticEval.summary || 'None'}`,
    `Benchmark meaning: ${agenticEval.benchmarkMeaning || 'None'}`,
    `Why not recommended: ${agenticEval.whyNotRecommended || 'None'}`,
    agenticEval.error ? `Error: ${agenticEval.error}` : null,
    'Strengths:',
    formatBulletList(agenticEval.strengths),
    'Risks:',
    formatBulletList(agenticEval.risks),
    'Priority fixes:',
    formatBulletList(agenticEval.priorityFixes),
    'Hard gate checks:',
    formatScoreTable((agenticEval.hardGateChecks || []).map((entry) => `${entry.title}: ${entry.status} | ${entry.reason || 'no reason'} | improve=${entry.improvement || 'none'}`)),
    'Benchmark tasks:',
    formatScoreTable((agenticEval.benchmarkTasks || []).map((entry) => `${entry.title}: ${entry.status} | ${entry.reason || 'no reason'} | improve=${entry.improvement || 'none'}`)),
  ].filter(Boolean).join('\n');
}

function buildArtifactAnalysisText(analysis) {
  return [
    `${analysis.slotLabel}: ${analysis.displayName}`,
    `Overall: ${toFixed(analysis.overallScore)}`,
    `Policy average: ${toFixed(analysis.scenarioAverage)}`,
    `Category average: ${toFixed(analysis.categoryAverage)}`,
    `Benchmark average: ${toFixed(analysis.taskAverage)}`,
    `Word count: ${analysis.metrics.wordCount}`,
    `Line count: ${analysis.metrics.lineCount}`,
    `Directive count: ${analysis.metrics.directiveCount}`,
    'Dimensions:',
    formatScoreTable(Object.entries(analysis.dimensions).map(([label, value]) => `${humanize(label)}: ${toFixed(value)}`)),
    'Static risks:',
    formatBulletList(analysis.riskFlags),
    'Hard gates:',
    formatScoreTable((analysis.hardGates || []).map((entry) => `${entry.title}: ${entry.required ? 'required' : 'optional'}, actual ${toFixed(entry.actual)}, threshold ${toFixed(entry.threshold)}, ${entry.passed ? 'passed' : 'failed'}`)),
    'Category scores:',
    formatScoreTable((analysis.categoryScores || []).map((entry) => `${entry.title}: ${toFixed(entry.score)} | matched=${entry.matchedSignals.join(', ') || 'none'} | missing=${entry.missingSignals.join(', ') || 'none'}`)),
    'Scenario scores:',
    formatScoreTable((analysis.scenarioScores || []).map((entry) => `${entry.title}: ${toFixed(entry.score)} (weight ${entry.weight})`)),
    'Task benchmark scores:',
    formatScoreTable((analysis.taskScores || []).map((entry) => `${entry.title}: ${toFixed(entry.score)} | passed=${entry.passed ? 'yes' : 'no'} | ${entry.notes}`)),
    'Contradiction signals:',
    formatBulletList(analysis.conflicts),
  ].join('\n');
}

function buildEvaluatorMethodologyText(result) {
  return [
    'Evaluator methodology:',
    '- This report comes from the integrated Policy Lab repo-aware evaluator.',
    '- Comparison is same-family only. The compared family is anchored to the selected artifact family.',
    '- Static scoring is computed from file-text analysis against family-specific categories, repo-fit dimensions, hard gates, scenario packs, and benchmark task packs.',
    '- For AGENTS.md files, the task pack in this repo includes prototype containment, production multi-file edit, review findings-first, testing restraint, process safety, delegation and skills, and long-term stability.',
    '- A benchmark task only passes when required hard gates pass and the weighted task score clears that task threshold.',
    '- Static recommendation is blocked if the stronger side still fails required hard gates, even if it clearly out-scores the other side.',
    '- Model score is a separate optional lens. It does not replace the static verdict.',
    '- If the two sides use different models, the model comparison is directional rather than definitive.',
    '- A model score of 0.0 means the model-backed assessment failed and the result fell back to static scoring only.',
    `Selected mode: ${result.mode}`,
    `Compared family: ${result.familyLabel}`,
    `Artifact path: ${result.artifactPath || '(uploaded pair)'}`,
    'Workspace profile:',
    formatScoreTable([
      `hasClient=${result.projectProfile?.hasClient ? 'yes' : 'no'}`,
      `hasServer=${result.projectProfile?.hasServer ? 'yes' : 'no'}`,
      `hasPrototypes=${result.projectProfile?.hasPrototypes ? 'yes' : 'no'}`,
      `hasHooks=${result.projectProfile?.hasHooks ? 'yes' : 'no'}`,
      `hasRootAgents=${result.projectProfile?.hasRootAgents ? 'yes' : 'no'}`,
      `hasClaudeMd=${result.projectProfile?.hasClaudeMd ? 'yes' : 'no'}`,
      `testScriptPresent=${result.projectProfile?.testScriptPresent ? 'yes' : 'no'}`,
      `devScriptPresent=${result.projectProfile?.devScriptPresent ? 'yes' : 'no'}`,
    ]),
    'Scenario pack used:',
    formatScoreTable((result.scenarioPack || []).map((entry) => `${entry.title} | weight=${entry.weight} | categories=${entry.categories.join(', ')} | dimensions=${entry.dimensions.join(', ')}`)),
    'Task benchmark pack used:',
    formatScoreTable((result.taskPack || []).map((entry) => `${entry.title} | passThreshold=${entry.passThreshold} | weight=${entry.weight} | requiredCategories=${entry.requiredCategories.join(', ')} | requiredDimensions=${entry.requiredDimensions.join(', ')} | requiredGates=${entry.requiredGates.join(', ')}`)),
  ].join('\n');
}

function buildClipboardReport({ result, leftFile, rightFile, leftModel, rightModel, leftReasoningEffort, rightReasoningEffort }) {
  return [
    'You are reviewing a Policy Lab evaluation from the qbo-escalations repository.',
    'Your job is to interpret the verdict, explain any contradictions in the output, identify why the stronger file still may not be recommendable, and propose concrete edits to improve the weaker or blocked file.',
    'Treat the static evaluator as the primary signal unless you find a clear methodology flaw in the report below.',
    '',
    '=== POLICY LAB EVALUATION REPORT ===',
    `Run ID: ${result.runId}`,
    `Generated at: ${result.generatedAt}`,
    `Mode: ${result.mode}`,
    `Family: ${result.familyLabel}`,
    `Artifact path: ${result.artifactPath || '(uploaded pair)'}`,
    '',
    'Static verdict summary:',
    `- Recommended label: ${result.comparison.recommendedLabel}`,
    `- Winner slot: ${result.comparison.winner}`,
    `- Score margin: ${toFixed(result.comparison.scoreMargin)}`,
    `- Confidence: ${result.comparison.confidence.level} (${toFixed(result.comparison.confidence.score)})`,
    `- Conclusion: ${result.comparison.conclusion}`,
    'Reasons:',
    formatBulletList(result.comparison.reasons),
    'Hard gate summary:',
    formatBulletList([
      `Current failures: ${(result.comparison.hardGateSummary?.leftFailures || []).join(', ') || 'none'}`,
      `Proposed failures: ${(result.comparison.hardGateSummary?.rightFailures || []).join(', ') || 'none'}`,
    ]),
    '',
    'Policy-only comparison:',
    `- Winner: ${result.policyComparison.winner}`,
    `- Margin: ${toFixed(result.policyComparison.scoreMargin)}`,
    'Reasons:',
    formatBulletList(result.policyComparison.reasons),
    '',
    'Benchmark-only comparison:',
    `- Winner: ${result.taskBenchmark.winner}`,
    `- Margin: ${toFixed(result.taskBenchmark.margin)}`,
    `- Current passes: ${result.taskBenchmark.leftPassCount} of ${result.taskBenchmark.totalTasks}`,
    `- Proposed passes: ${result.taskBenchmark.rightPassCount} of ${result.taskBenchmark.totalTasks}`,
    'Reasons:',
    formatBulletList(result.taskBenchmark.reasons),
    '',
    'Model evaluation summary:',
    `- Current model: ${leftModel} @ ${leftReasoningEffort}`,
    `- Proposed model: ${rightModel} @ ${rightReasoningEffort}`,
    `- AI comparison winner: ${result.modelEvaluations.comparison.winner}`,
    `- AI score margin: ${toFixed(result.modelEvaluations.comparison.scoreMargin)}`,
    `- Same model: ${result.modelEvaluations.comparison.sameModel ? 'yes' : 'no'}`,
    result.modelEvaluations.comparison.caution ? `- Caution: ${result.modelEvaluations.comparison.caution}` : null,
    '',
    buildModelAssessmentText(result.modelEvaluations.left),
    '',
    buildModelAssessmentText(result.modelEvaluations.right),
    '',
    'Full agentic evaluation summary:',
    `- Winner: ${result.agenticEvaluations.comparison.winner}`,
    `- Recommended label: ${result.agenticEvaluations.comparison.recommendedLabel}`,
    `- Score margin: ${toFixed(result.agenticEvaluations.comparison.scoreMargin)}`,
    `- Confidence: ${result.agenticEvaluations.comparison.confidence.level} (${toFixed(result.agenticEvaluations.comparison.confidence.score)})`,
    `- Conclusion: ${result.agenticEvaluations.comparison.conclusion}`,
    'Reasons:',
    formatBulletList(result.agenticEvaluations.comparison.reasons),
    '',
    buildAgenticAssessmentText(result.agenticEvaluations.left),
    '',
    buildAgenticAssessmentText(result.agenticEvaluations.right),
    '',
    'Evaluator feedback and meanings:',
    `- Static meaning: ${result.feedback.staticMeaning.strongerButBlocked}`,
    `- Benchmark meaning: ${result.feedback.staticMeaning.benchmarkMeaning}`,
    `- Current model meaning: ${result.feedback.staticMeaning.modelMeaningLeft}`,
    `- Proposed model meaning: ${result.feedback.staticMeaning.modelMeaningRight}`,
    '',
    `Current feedback benchmark meaning: ${result.feedback.left.benchmarkMeaning}`,
    'Current top blockers:',
    formatBulletList(result.feedback.left.topBlockers),
    'Current priority fixes:',
    formatBulletList(result.feedback.left.priorityFixes),
    '',
    `Proposed feedback benchmark meaning: ${result.feedback.right.benchmarkMeaning}`,
    'Proposed top blockers:',
    formatBulletList(result.feedback.right.topBlockers),
    'Proposed priority fixes:',
    formatBulletList(result.feedback.right.priorityFixes),
    '',
    buildArtifactAnalysisText(result.left),
    '',
    buildArtifactAnalysisText(result.right),
    '',
    buildEvaluatorMethodologyText(result),
    '',
    'Agentic evaluator methodology:',
    `- Version: ${result.agenticEvaluations.methodology.version}`,
    `- Scenario pack size: ${result.agenticEvaluations.methodology.scenarioPackSize}`,
    `- Task pack size: ${result.agenticEvaluations.methodology.taskPackSize}`,
    ...((result.agenticEvaluations.methodology.process || []).map((entry) => `- ${entry}`)),
    '',
    'Compared file contents:',
    '--- CURRENT FILE START ---',
    leftFile?.content || '',
    '--- CURRENT FILE END ---',
    '--- PROPOSED FILE START ---',
    rightFile?.content || '',
    '--- PROPOSED FILE END ---',
    '=== END POLICY LAB EVALUATION REPORT ===',
  ].filter(Boolean).join('\n');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!ok) throw new Error('Clipboard copy failed.');
}

export default function PolicyLab() {
  const [family, setFamily] = useState('agents');
  const [mode, setMode] = useState('full');
  const [artifactCatalog, setArtifactCatalog] = useState([]);
  const [projectProfile, setProjectProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [models, setModels] = useState([]);
  const [artifactPath, setArtifactPath] = useState('');
  const [leftModel, setLeftModel] = useState(DEFAULT_PROVIDER);
  const [rightModel, setRightModel] = useState(DEFAULT_PROVIDER);
  const [leftReasoningEffort, setLeftReasoningEffort] = useState(DEFAULT_REASONING_EFFORT);
  const [rightReasoningEffort, setRightReasoningEffort] = useState(DEFAULT_REASONING_EFFORT);
  const [linkedEvaluationControls, setLinkedEvaluationControls] = useState(true);
  const [leftFile, setLeftFile] = useState(null);
  const [rightFile, setRightFile] = useState(null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState({ tone: 'pending', message: 'Loading Policy Lab...' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    getPolicyLabBootstrap()
      .then((payload) => {
        if (!mounted) return;
        setArtifactCatalog(payload.artifactCatalog || []);
        setProjectProfile(payload.projectProfile || null);
        setHistory(payload.history || []);
        setModels(payload.models || []);
        const primaryModel = payload.models?.[0]?.id || DEFAULT_PROVIDER;
        setLeftModel(primaryModel);
        setRightModel(primaryModel);
        const defaultArtifact = (payload.artifactCatalog || []).find((entry) => entry.family === 'agents')?.path || '';
        setArtifactPath(defaultArtifact);
        setStatus({ tone: 'good', message: 'Policy Lab ready. Choose a file family, load the current project file, upload the proposed version, then run the evaluation.' });
      })
      .catch((error) => {
        if (!mounted) return;
        setStatus({ tone: 'bad', message: error.message || 'Policy Lab failed to load.' });
      });
    return () => { mounted = false; };
  }, []);

  const familyCatalog = useMemo(() => artifactCatalog.filter((entry) => entry.family === family), [artifactCatalog, family]);

  useEffect(() => {
    const firstPath = familyCatalog[0]?.path || '';
    setArtifactPath(firstPath);
    setLeftFile(null);
    setRightFile(null);
    setResult(null);
  }, [family]);

  useEffect(() => {
    if (!linkedEvaluationControls) return;
    setRightModel(leftModel);
  }, [leftModel, linkedEvaluationControls]);

  useEffect(() => {
    if (!linkedEvaluationControls) return;
    setRightReasoningEffort(leftReasoningEffort);
  }, [leftReasoningEffort, linkedEvaluationControls]);

  function toggleLinkedEvaluationControls() {
    setLinkedEvaluationControls((current) => {
      const next = !current;
      if (next) {
        setRightModel(leftModel);
        setRightReasoningEffort(leftReasoningEffort);
      }
      return next;
    });
  }

  async function loadCurrentProjectFile() {
    if (!artifactPath) {
      setStatus({ tone: 'bad', message: 'No project file is available for this family.' });
      return;
    }

    setStatus({ tone: 'pending', message: `Loading ${artifactPath}...` });
    try {
      const artifact = await getProjectPolicyArtifact(artifactPath);
      setLeftFile({ ...artifact, slotLabel: 'Current' });
      setStatus({ tone: 'good', message: `Loaded ${artifactPath} into Current.` });
    } catch (error) {
      setStatus({ tone: 'bad', message: error.message || 'Could not load the current project file.' });
    }
  }

  async function handleUpload(side, file) {
    if (!file) return;
    const content = await file.text();
    const payload = {
      slotLabel: side === 'left' ? 'Current' : 'Proposed',
      name: file.name,
      content,
      family,
      artifactPath,
    };
    if (side === 'left') setLeftFile(payload);
    else setRightFile(payload);
  }

  async function runEvaluation() {
    if (!(leftFile && rightFile)) return;
    setBusy(true);
    setStatus({ tone: 'pending', message: 'Running preflight checks before evaluation...' });
    try {
      const payload = await runPolicyLabEvaluation({
        family,
        mode,
        artifactPath,
        leftModel,
        rightModel,
        leftReasoningEffort,
        rightReasoningEffort,
        left: { ...leftFile, family, artifactPath },
        right: { ...rightFile, family, artifactPath },
      });
      setResult(payload);
      if (payload.preflight?.passed === false) {
        setStatus({ tone: 'bad', message: payload.preflight.summary || 'Evaluation blocked by preflight checks.' });
        return;
      }
      setHistory(await getPolicyLabHistory());
      setStatus({ tone: 'good', message: 'Evaluation complete.' });
    } catch (error) {
      setStatus({ tone: 'bad', message: error.message || 'Evaluation failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function copyEvaluationPrompt() {
    if (!result) return;
    const report = result.promptReport || buildClipboardReport({
      result,
      leftFile,
      rightFile,
      leftModel,
      rightModel,
      leftReasoningEffort,
      rightReasoningEffort,
    });

    try {
      await copyTextToClipboard(report);
      setStatus({ tone: 'good', message: 'Copied a complete evaluation prompt report to the clipboard.' });
    } catch (error) {
      setStatus({ tone: 'bad', message: error.message || 'Clipboard copy failed.' });
    }
  }

  return (
    <div className="policy-lab-page">
      <section className="policy-lab-hero">
        <div>
          <p className="policy-lab-eyebrow">Policy Lab Prototype</p>
          <h1>Agentic File Evaluations</h1>
          <p className="policy-lab-lede">
            Compare <code>v1</code> vs <code>v2</code> of the same agentic file family inside the main app. Static repo-aware scoring stays anchored to the prototype evaluator, while each side can also be reviewed by a selected model. Controlled comparisons keep both sides on the same evaluator by default.
          </p>
          <div className="policy-lab-toolbar">
            <select className="input" value={family} onChange={(event) => setFamily(event.target.value)}>
              {FAMILY_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
            <select className="input" value={artifactPath} onChange={(event) => setArtifactPath(event.target.value)}>
              {familyCatalog.length
                ? familyCatalog.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)
                : <option value="">No project file found for this family</option>}
            </select>
            <button className="btn btn-primary" type="button" onClick={loadCurrentProjectFile}>Load Current Project File</button>
            <select className="input" value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="full">Full Comparison</option>
              <option value="policy">Policy Only</option>
              <option value="benchmark">Benchmark Only</option>
            </select>
            <button className="btn btn-primary" type="button" disabled={busy || !(leftFile && rightFile)} onClick={runEvaluation}>
              {busy ? 'Running Checks...' : 'Run Evaluation'}
            </button>
            <button className="btn btn-secondary" type="button" disabled={!result} onClick={copyEvaluationPrompt}>
              {result?.preflight?.passed === false ? 'Copy Failure Report' : 'Copy Prompt Report'}
            </button>
          </div>
          <label className="policy-lab-inlinecheck">
            <input type="checkbox" checked={linkedEvaluationControls} onChange={toggleLinkedEvaluationControls} />
            <span>Keep model and effort matched on both sides for a controlled apples-to-apples evaluation.</span>
          </label>
          <p className={`policy-lab-status is-${status.tone}`}>{status.message}</p>
        </div>
        <aside className="policy-lab-note">
          <h2>How this works</h2>
          <ul>
            <li>Only same-family files can be compared.</li>
            <li>Repo-aware scoring still comes from the prototype evaluator in `prototypes/policy-lab`.</li>
            <li>Each side can also be scored by a chosen model.</li>
            <li>Controlled mode keeps both sides on the same model and effort by default.</li>
            <li>If you unlock the controls and choose different models, the model-score comparison becomes directional rather than definitive.</li>
          </ul>
        </aside>
      </section>

      <section className="policy-lab-grid">
        <article className="card policy-lab-filecard">
          <div className="policy-lab-cardhead">
            <span className="badge">Current</span>
            <h3>Baseline Version</h3>
          </div>
          <label className="policy-lab-label">Model for Current</label>
          <select className="input" value={leftModel} onChange={(event) => setLeftModel(event.target.value)}>
            {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <label className="policy-lab-label">Effort for Current</label>
          <select className="input" value={leftReasoningEffort} onChange={(event) => setLeftReasoningEffort(event.target.value)}>
            {REASONING_EFFORT_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
          <label className="policy-lab-label">Upload Current</label>
          <input className="input" type="file" onChange={(event) => handleUpload('left', event.target.files?.[0])} />
          <div className="policy-lab-meta">{leftFile ? `${leftFile.slotLabel} | ${leftFile.name || '(project file)'}` : 'No file selected.'}</div>
          <pre className="policy-lab-preview">{leftFile ? leftFile.content : 'Awaiting file.'}</pre>
        </article>

        <article className="card policy-lab-filecard">
          <div className="policy-lab-cardhead">
            <span className="badge badge-accent">Proposed</span>
            <h3>Candidate Version</h3>
          </div>
          <label className="policy-lab-label">Model for Proposed</label>
          <select className="input" value={rightModel} onChange={(event) => setRightModel(event.target.value)} disabled={linkedEvaluationControls}>
            {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <label className="policy-lab-label">Effort for Proposed</label>
          <select className="input" value={rightReasoningEffort} onChange={(event) => setRightReasoningEffort(event.target.value)} disabled={linkedEvaluationControls}>
            {REASONING_EFFORT_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
          {linkedEvaluationControls && (
            <p className="policy-lab-hint">Proposed mirrors Current while controlled comparison mode is on.</p>
          )}
          <label className="policy-lab-label">Upload Proposed</label>
          <input className="input" type="file" onChange={(event) => handleUpload('right', event.target.files?.[0])} />
          <div className="policy-lab-meta">{rightFile ? `${rightFile.slotLabel} | ${rightFile.name}` : 'No file selected.'}</div>
          <pre className="policy-lab-preview">{rightFile ? rightFile.content : 'Awaiting file.'}</pre>
        </article>
      </section>

      <section className="policy-lab-grid">
        <article className="card">
          <div className="policy-lab-cardhead">
            <span className="badge">Repo Signals</span>
            <h3>Current Workspace Profile</h3>
          </div>
          <div className="policy-lab-chipgrid">
            {projectProfile && [
              ['client', projectProfile.hasClient],
              ['server', projectProfile.hasServer],
              ['prototypes', projectProfile.hasPrototypes],
              ['hooks', projectProfile.hasHooks],
              ['root AGENTS', projectProfile.hasRootAgents],
              ['CLAUDE', projectProfile.hasClaudeMd],
              ['test script', projectProfile.testScriptPresent],
              ['dev script', projectProfile.devScriptPresent],
            ].map(([label, value]) => (
              <span key={label} className={`policy-lab-chip ${value ? 'is-on' : 'is-off'}`}>{label}: {value ? 'yes' : 'no'}</span>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="policy-lab-cardhead">
            <span className="badge">Recent Runs</span>
            <h3>History</h3>
          </div>
          <div className="policy-lab-history">
            {history.length === 0 ? <p className="muted">No saved comparisons yet.</p> : history.map((entry) => (
              <article key={entry.runId} className="policy-lab-historyitem">
                <strong>{entry.winner}</strong>
                <span>{entry.familyLabel}</span>
                <span>{entry.artifactPath || 'uploaded pair'}</span>
                <span>{new Date(entry.generatedAt).toLocaleString()}</span>
                <span>{entry.leftModel || '--'} vs {entry.rightModel || '--'}</span>
              </article>
            ))}
          </div>
        </article>
      </section>

      {result?.preflight?.passed === false && (
        <section className="policy-lab-results">
          <article className="card">
            <div className="policy-lab-cardhead">
              <span className="badge badge-accent">Preflight Blocked</span>
              <h3>Evaluation Not Run</h3>
            </div>
            <div className="policy-lab-summarygrid">
              <div><span>Family</span><strong>{result.familyLabel || family}</strong></div>
              <div><span>Path</span><strong>{result.artifactPath || 'uploaded pair'}</strong></div>
              <div><span>Current model</span><strong>{leftModel} @ {leftReasoningEffort}</strong></div>
              <div><span>Proposed model</span><strong>{rightModel} @ {rightReasoningEffort}</strong></div>
            </div>
            <p className="policy-lab-conclusion">{result.preflight.summary}</p>
            <div className="policy-lab-listgrid">
              <div>
                <h4>Failed Checks</h4>
                <ul>
                  {(result.preflight.failures || []).map((entry) => (
                    <li key={entry.id}>{entry.title}: {entry.detail}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>All Checks</h4>
                <ul>
                  {(result.preflight.checks || []).map((entry) => (
                    <li key={entry.id}>{entry.title}: {entry.passed ? 'PASS' : 'FAIL'} | {entry.detail}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="policy-lab-hint">
              `Copy Failure Report` creates a complete prompt with the preflight errors and expected operational requirements for Codex or Claude Code.
            </p>
          </article>
        </section>
      )}

      {result && result.preflight?.passed !== false && (
        <>
          <section className="policy-lab-results">
            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge">Static Verdict</span>
                <h3>{result.comparison.recommendedLabel}</h3>
              </div>
              <div className="policy-lab-summarygrid">
                <div><span>Margin</span><strong>{result.comparison.scoreMargin.toFixed(1)} pts</strong></div>
                <div><span>Confidence</span><strong>{result.comparison.confidence.level} ({result.comparison.confidence.score})</strong></div>
                <div><span>Family</span><strong>{result.familyLabel}</strong></div>
                <div><span>Path</span><strong>{result.artifactPath || 'uploaded pair'}</strong></div>
              </div>
              <p className="policy-lab-conclusion">{result.comparison.conclusion}</p>
              <div className="policy-lab-reasons">
                {result.comparison.reasons.map((reason) => <p key={reason}>{reason}</p>)}
              </div>
              <p className="policy-lab-hint">
                `Copy Prompt Report` includes the full verdict, hard gates, scenario/task packs, model outcomes, and both compared file contents for pasting into Codex or Claude Code.
              </p>
            </article>

            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge badge-accent">Agentic Verdict</span>
                <h3>{result.agenticEvaluations.comparison.recommendedLabel}</h3>
              </div>
              <div className="policy-lab-summarygrid">
                <div><span>Winner</span><strong>{result.agenticEvaluations.comparison.winner}</strong></div>
                <div><span>Margin</span><strong>{result.agenticEvaluations.comparison.scoreMargin.toFixed(1)} pts</strong></div>
                <div><span>Confidence</span><strong>{result.agenticEvaluations.comparison.confidence.level} ({result.agenticEvaluations.comparison.confidence.score})</strong></div>
                <div><span>Same model</span><strong>{result.agenticEvaluations.comparison.sameModel ? 'yes' : 'no'}</strong></div>
              </div>
              <p className="policy-lab-conclusion">{result.agenticEvaluations.comparison.conclusion}</p>
              <div className="policy-lab-reasons">
                {result.agenticEvaluations.comparison.reasons.map((reason) => <p key={reason}>{reason}</p>)}
              </div>
              {result.agenticEvaluations.comparison.caution && (
                <p className="policy-lab-warning">{result.agenticEvaluations.comparison.caution}</p>
              )}
            </article>

            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge badge-accent">Model Lens</span>
                <h3>{result.modelEvaluations.comparison.winner === 'tie' ? 'No clear AI winner' : result.modelEvaluations.comparison.winner === 'left' ? 'Current' : 'Proposed'}</h3>
              </div>
              <div className="policy-lab-summarygrid">
                <div><span>Current model</span><strong>{result.modelEvaluations.left.providerLabel}</strong></div>
                <div><span>Proposed model</span><strong>{result.modelEvaluations.right.providerLabel}</strong></div>
                <div><span>AI margin</span><strong>{result.modelEvaluations.comparison.scoreMargin.toFixed(1)} pts</strong></div>
                <div><span>Same model</span><strong>{result.modelEvaluations.comparison.sameModel ? 'yes' : 'no'}</strong></div>
              </div>
              {result.modelEvaluations.comparison.caution && (
                <p className="policy-lab-warning">{result.modelEvaluations.comparison.caution}</p>
              )}
            </article>
          </section>

          <section className="policy-lab-results">
            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge">What This Means</span>
                <h3>Evaluator Interpretation</h3>
              </div>
              <div className="policy-lab-reasons">
                <p>{result.feedback.staticMeaning.strongerButBlocked}</p>
                <p>{result.feedback.staticMeaning.benchmarkMeaning}</p>
                <p>{result.feedback.staticMeaning.modelMeaningLeft}</p>
                <p>{result.feedback.staticMeaning.modelMeaningRight}</p>
              </div>
            </article>
          </section>

          <section className="policy-lab-results">
            {[result.left, result.right].map((analysis, index) => {
              const modelEval = index === 0 ? result.modelEvaluations.left : result.modelEvaluations.right;
              const agenticEval = index === 0 ? result.agenticEvaluations.left : result.agenticEvaluations.right;
              const feedback = index === 0 ? result.feedback.left : result.feedback.right;
              return (
                <article key={analysis.slotLabel} className="card">
                  <div className="policy-lab-cardhead">
                    <span className="badge">{analysis.slotLabel}</span>
                    <h3>{analysis.displayName}</h3>
                  </div>
                  <div className="policy-lab-summarygrid">
                    <div><span>Overall</span><strong>{analysis.overallScore.toFixed(1)}</strong></div>
                    <div><span>Policy Avg</span><strong>{analysis.scenarioAverage.toFixed(1)}</strong></div>
                    <div><span>Benchmark Avg</span><strong>{analysis.taskAverage.toFixed(1)}</strong></div>
                    <div><span>Model Score</span><strong>{modelEval.overallScore.toFixed(1)}</strong></div>
                  </div>
                  <div className="policy-lab-dimensions">
                    {Object.entries(analysis.dimensions).map(([label, value]) => (
                      <div key={label} className="policy-lab-barrow">
                        <span>{humanize(label)}</span>
                        <div className="policy-lab-bar"><div style={{ width: `${value}%` }} /></div>
                        <strong>{value.toFixed(1)}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="policy-lab-listgrid">
                    <div>
                      <h4>Static Risks</h4>
                      <ul>{analysis.riskFlags.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div>
                      <h4>{modelEval.providerLabel}</h4>
                      <p className="muted">{modelEval.recommendation}</p>
                      <ul>{modelEval.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                      <ul>{modelEval.risks.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div>
                      <h4>Full Agentic Review</h4>
                      <p className="muted">{agenticEval.summary}</p>
                      <ul><li>Verdict: {agenticEval.verdict}</li></ul>
                      <ul><li>{agenticEval.benchmarkMeaning}</li></ul>
                      <ul>{agenticEval.priorityFixes.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div>
                      <h4>Improve This File</h4>
                      <p className="muted">{feedback.benchmarkMeaning}</p>
                      <ul>{feedback.topBlockers.map((item) => <li key={item}>{item}</li>)}</ul>
                      <ul>{feedback.priorityFixes.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="policy-lab-results">
            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge">Categories</span>
                <h3>Static Comparison</h3>
              </div>
              <div className="policy-lab-tablewrap">
                <table className="policy-lab-table">
                  <thead>
                    <tr><th>Category</th><th>Current</th><th>Proposed</th></tr>
                  </thead>
                  <tbody>
                    {result.left.categoryScores.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.title}</td>
                        <td>{entry.score.toFixed(1)}</td>
                        <td>{findById(result.right.categoryScores, entry.id).score.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge">Benchmark Tasks</span>
                <h3>Static Task Breakdown</h3>
              </div>
              <div className="policy-lab-tablewrap">
                <table className="policy-lab-table">
                  <thead>
                    <tr><th>Task</th><th>Current</th><th>Proposed</th></tr>
                  </thead>
                  <tbody>
                    {result.left.taskScores.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.title}</td>
                        <td>{entry.score.toFixed(1)} | {entry.passed ? 'pass' : 'fail'} | {entry.notes}</td>
                        <td>{findById(result.right.taskScores, entry.id).score.toFixed(1)} | {findById(result.right.taskScores, entry.id).passed ? 'pass' : 'fail'} | {findById(result.right.taskScores, entry.id).notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge badge-accent">Agentic Tasks</span>
                <h3>Full Agentic Task Breakdown</h3>
              </div>
              <div className="policy-lab-tablewrap">
                <table className="policy-lab-table">
                  <thead>
                    <tr><th>Task</th><th>Current</th><th>Proposed</th></tr>
                  </thead>
                  <tbody>
                    {(result.agenticEvaluations.left.benchmarkTasks || []).map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.title}</td>
                        <td>{entry.status} | {entry.reason || 'no reason'} | {entry.improvement || 'no improvement given'}</td>
                        <td>{findById(result.agenticEvaluations.right.benchmarkTasks || [], entry.id).status || 'fail'} | {findById(result.agenticEvaluations.right.benchmarkTasks || [], entry.id).reason || 'no reason'} | {findById(result.agenticEvaluations.right.benchmarkTasks || [], entry.id).improvement || 'no improvement given'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge">Model Categories</span>
                <h3>Per-File Model Scores</h3>
              </div>
              <div className="policy-lab-tablewrap">
                <table className="policy-lab-table">
                  <thead>
                    <tr><th>Category</th><th>Current</th><th>Proposed</th></tr>
                  </thead>
                  <tbody>
                    {(result.modelEvaluations.left.categoryScores || []).map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.label}</td>
                        <td>{entry.score.toFixed(1)}</td>
                        <td>{findById(result.modelEvaluations.right.categoryScores || [], entry.id).score.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        </>
      )}
    </div>
  );
}
