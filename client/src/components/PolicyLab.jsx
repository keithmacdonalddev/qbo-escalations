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
  return entries.find((entry) => entry.id === id) || { score: 0, title: id, passed: false, notes: '' };
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

function sideToLabel(side) {
  if (side === 'left') return 'Current';
  if (side === 'right') return 'Proposed';
  return 'Neither';
}

function getSidePayload(result, side) {
  if (side === 'left') {
    return {
      analysis: result.left,
      modelEval: result.modelEvaluations.left,
      agenticEval: result.agenticEvaluations.left,
      feedback: result.feedback.left,
    };
  }
  if (side === 'right') {
    return {
      analysis: result.right,
      modelEval: result.modelEvaluations.right,
      agenticEval: result.agenticEvaluations.right,
      feedback: result.feedback.right,
    };
  }
  return {
    analysis: null,
    modelEval: null,
    agenticEval: null,
    feedback: null,
  };
}

function getFailedHardGates(analysis) {
  return (analysis?.hardGates || []).filter((entry) => entry.required && !entry.passed).map((entry) => entry.title);
}

function getPassedTaskCount(analysis) {
  return (analysis?.taskScores || []).filter((entry) => entry.passed).length;
}

function getTaskCount(analysis) {
  return Array.isArray(analysis?.taskScores) ? analysis.taskScores.length : 0;
}

function getTopCategoryNames(analysis, direction = 'top', limit = 3) {
  const scores = Array.isArray(analysis?.categoryScores) ? [...analysis.categoryScores] : [];
  const sorted = scores.sort((left, right) => direction === 'top' ? right.score - left.score : left.score - right.score);
  return sorted.slice(0, limit).map((entry) => `${entry.title} (${toFixed(entry.score)})`);
}

function buildDecisionSummary(result) {
  const strongerSide = result?.comparison?.winner === 'left' || result?.comparison?.winner === 'right'
    ? result.comparison.winner
    : 'tie';
  const strongerLabel = sideToLabel(strongerSide);
  const stronger = getSidePayload(result, strongerSide);
  const weakerSide = strongerSide === 'left' ? 'right' : strongerSide === 'right' ? 'left' : 'tie';
  const weakerLabel = sideToLabel(weakerSide);
  const staticBlocked = result?.comparison?.recommendedLabel === 'No clear winner';
  const failedGates = getFailedHardGates(stronger.analysis);
  const passCount = getPassedTaskCount(stronger.analysis);
  const totalTasks = getTaskCount(stronger.analysis);
  const modelWinner = sideToLabel(result?.modelEvaluations?.comparison?.winner);
  const modelDisagrees = (result?.modelEvaluations?.comparison?.winner === 'left' || result?.modelEvaluations?.comparison?.winner === 'right')
    && result.modelEvaluations.comparison.winner !== strongerSide;

  let blockedReason = 'The static evaluator did not find a stronger file.';
  if (strongerSide !== 'tie') {
    if (failedGates.length > 0) {
      blockedReason = `${strongerLabel} is stronger, but it still fails required hard gates: ${failedGates.join(', ')}.`;
    } else if (passCount < totalTasks) {
      blockedReason = `${strongerLabel} is stronger, but it only passes ${passCount}/${totalTasks} benchmark tasks, so it is still not ready for default use.`;
    } else if (staticBlocked) {
      blockedReason = `${strongerLabel} is stronger, but the evaluator still blocked recommendation because the separation was not durable enough.`;
    } else {
      blockedReason = `${strongerLabel} is both stronger and recommendable.`;
    }
  }

  let modelNote = 'Static and model signals are aligned closely enough.';
  if (modelDisagrees) {
    modelNote = `The model lens preferred ${modelWinner}, but the static evaluator still treats ${strongerLabel} as better. Use the static result as primary because it enforces repo-specific hard gates and benchmark thresholds.`;
  }

  const agenticNote = result?.agenticEvaluations?.comparison?.conclusion
    || 'No agentic conclusion available.';

  return {
    strongerSide,
    strongerLabel,
    weakerSide,
    weakerLabel,
    adoptable: !staticBlocked,
    blockedReason,
    failedGates,
    passCount,
    totalTasks,
    modelNote,
    agenticNote,
  };
}

function buildCondensedClipboardReport({ result, leftModel, rightModel, leftReasoningEffort, rightReasoningEffort }) {
  const summary = buildDecisionSummary(result);
  const stronger = getSidePayload(result, summary.strongerSide);
  const weaker = getSidePayload(result, summary.weakerSide);

  return [
    '=== POLICY LAB SUMMARY ===',
    `Run ID: ${result.runId}`,
    `Generated at: ${result.generatedAt}`,
    `Family: ${result.familyLabel}`,
    `Artifact path: ${result.artifactPath || '(uploaded pair)'}`,
    '',
    'Decision:',
    `- Better version: ${summary.strongerLabel}`,
    `- Adopt now: ${summary.adoptable ? 'yes' : 'no'}`,
    `- Static confidence: ${result.comparison.confidence.level} (${toFixed(result.comparison.confidence.score)})`,
    `- Why blocked: ${summary.blockedReason}`,
    '',
    'Why this call:',
    formatBulletList(result.comparison.reasons?.slice(0, 5)),
    '',
    'Model and agentic notes:',
    `- Current model: ${leftModel} @ ${leftReasoningEffort}`,
    `- Proposed model: ${rightModel} @ ${rightReasoningEffort}`,
    `- Model note: ${summary.modelNote}`,
    `- Agentic note: ${summary.agenticNote}`,
    '',
    `${summary.strongerLabel}: keep as the base? ${summary.adoptable ? 'yes' : 'not yet'}`,
    'Top blockers:',
    formatBulletList(stronger.feedback?.topBlockers?.slice(0, 5)),
    'Best edits next:',
    formatBulletList(stronger.feedback?.priorityFixes?.slice(0, 6)),
    '',
    `${summary.weakerLabel}: why it loses`,
    'Top blockers:',
    formatBulletList(weaker.feedback?.topBlockers?.slice(0, 5)),
    'Best edits next:',
    formatBulletList(weaker.feedback?.priorityFixes?.slice(0, 6)),
    '=== END POLICY LAB SUMMARY ===',
  ].filter(Boolean).join('\n');
}

function buildClipboardReport({ result, leftFile, rightFile, leftModel, rightModel, leftReasoningEffort, rightReasoningEffort }) {
  return buildCondensedClipboardReport({
    result,
    leftFile,
    rightFile,
    leftModel,
    rightModel,
    leftReasoningEffort,
    rightReasoningEffort,
  });
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
  const decisionSummary = useMemo(() => {
    if (!result || result.preflight?.passed === false) return null;
    return buildDecisionSummary(result);
  }, [result]);

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
              {result?.preflight?.passed === false ? 'Copy Failure Report' : 'Copy Condensed Report'}
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
          <section className="policy-lab-results policy-lab-results--summary">
            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge">Decision</span>
                <h3>{decisionSummary?.strongerLabel || 'No stronger file yet'}</h3>
              </div>
              <div className="policy-lab-summarygrid policy-lab-summarygrid--five">
                <div><span>Better version</span><strong>{decisionSummary?.strongerLabel || 'Neither'}</strong></div>
                <div><span>Adopt now</span><strong>{decisionSummary?.adoptable ? 'yes' : 'no'}</strong></div>
                <div><span>Static confidence</span><strong>{result.comparison.confidence.level} ({toFixed(result.comparison.confidence.score)})</strong></div>
                <div><span>Benchmark passes</span><strong>{decisionSummary ? `${decisionSummary.passCount}/${decisionSummary.totalTasks}` : '--'}</strong></div>
                <div><span>Family</span><strong>{result.familyLabel}</strong></div>
              </div>
              <p className="policy-lab-conclusion">{decisionSummary?.blockedReason || result.comparison.conclusion}</p>
              <div className="policy-lab-reasons">
                {(result.comparison.reasons || []).slice(0, 4).map((reason) => <p key={reason}>{reason}</p>)}
              </div>
              <p className="policy-lab-hint">
                `Copy Condensed Report` now copies the short human-readable decision memo instead of the full raw evaluator dump.
              </p>
            </article>

            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge badge-accent">Why This Call</span>
                <h3>Static First, Other Lenses Secondary</h3>
              </div>
              <div className="policy-lab-summarygrid">
                <div><span>Static winner</span><strong>{decisionSummary?.strongerLabel || 'Neither'}</strong></div>
                <div><span>Static margin</span><strong>{toFixed(result.comparison.scoreMargin)} pts</strong></div>
                <div><span>Model winner</span><strong>{sideToLabel(result.modelEvaluations.comparison.winner)}</strong></div>
                <div><span>Agentic winner</span><strong>{sideToLabel(result.agenticEvaluations.comparison.winner)}</strong></div>
              </div>
              <p className="policy-lab-conclusion">{decisionSummary?.modelNote}</p>
              <div className="policy-lab-reasons">
                <p>{result.feedback.staticMeaning.strongerButBlocked}</p>
                <p>{result.feedback.staticMeaning.benchmarkMeaning}</p>
                <p>{decisionSummary?.agenticNote}</p>
              </div>
              {result.modelEvaluations.comparison.caution && (
                <p className="policy-lab-warning">{result.modelEvaluations.comparison.caution}</p>
              )}
            </article>

            <article className="card">
              <div className="policy-lab-cardhead">
                <span className="badge badge-accent">Next Action</span>
                <h3>{decisionSummary?.strongerLabel ? `Keep improving ${decisionSummary.strongerLabel}` : 'Revise both files'}</h3>
              </div>
              <div className="policy-lab-reasons">
                {(getSidePayload(result, decisionSummary?.strongerSide).feedback?.priorityFixes || []).slice(0, 5).map((item) => <p key={item}>{item}</p>)}
              </div>
            </article>
          </section>

          <section className="policy-lab-results">
            {[result.left, result.right].map((analysis, index) => {
              const modelEval = index === 0 ? result.modelEvaluations.left : result.modelEvaluations.right;
              const agenticEval = index === 0 ? result.agenticEvaluations.left : result.agenticEvaluations.right;
              const feedback = index === 0 ? result.feedback.left : result.feedback.right;
              const side = index === 0 ? 'left' : 'right';
              const failedGates = getFailedHardGates(analysis);
              const benchmarkPassCount = getPassedTaskCount(analysis);
              const totalTasks = getTaskCount(analysis);
              const stronger = decisionSummary?.strongerSide === side;
              return (
                <article key={analysis.slotLabel} className="card">
                  <div className="policy-lab-cardhead">
                    <span className={`badge ${stronger ? '' : 'badge-accent'}`}>{analysis.slotLabel}</span>
                    <h3>{analysis.displayName}</h3>
                  </div>
                  <div className="policy-lab-summarygrid">
                    <div><span>Role</span><strong>{stronger ? 'Better base' : 'Weaker candidate'}</strong></div>
                    <div><span>Adopt now</span><strong>{stronger && decisionSummary?.adoptable ? 'yes' : 'no'}</strong></div>
                    <div><span>Hard gate failures</span><strong>{failedGates.length || 0}</strong></div>
                    <div><span>Benchmark passes</span><strong>{benchmarkPassCount}/{totalTasks}</strong></div>
                  </div>
                  <div className="policy-lab-listgrid">
                    <div>
                      <h4>{stronger ? 'Why keep this file' : 'Why this file loses'}</h4>
                      <p className="muted">
                        {stronger
                          ? (decisionSummary?.adoptable
                            ? `${analysis.slotLabel} is the stronger file and is ready to adopt.`
                            : `${analysis.slotLabel} is the stronger file, but it is still blocked from recommendation.`)
                          : `${analysis.slotLabel} is weaker than ${decisionSummary?.strongerLabel || 'the stronger file'} and should not replace it yet.`}
                      </p>
                      <ul>{getTopCategoryNames(analysis, 'top', 3).map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div>
                      <h4>Top blockers</h4>
                      <ul>{(feedback.topBlockers || []).slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div>
                      <h4>Best edits next</h4>
                      <ul>{(feedback.priorityFixes || []).slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div>
                      <h4>Why still blocked</h4>
                      <ul>
                        <li>{feedback.benchmarkMeaning}</li>
                        {failedGates.length > 0 ? <li>Failed hard gates: {failedGates.join(', ')}</li> : null}
                        <li>Weakest categories: {getTopCategoryNames(analysis, 'bottom', 3).join(', ') || 'none'}</li>
                      </ul>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="policy-lab-results policy-lab-results--details">
            <details className="card policy-lab-detailcard">
              <summary className="policy-lab-detailsummary">
                <span className="badge">Deep Dive</span>
                <strong>Static comparison tables</strong>
              </summary>
              <div className="policy-lab-detailbody">
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
              </div>
            </details>

            <details className="card policy-lab-detailcard">
              <summary className="policy-lab-detailsummary">
                <span className="badge badge-accent">Deep Dive</span>
                <strong>Model and agentic details</strong>
              </summary>
              <div className="policy-lab-detailbody policy-lab-listgrid">
                {[result.left, result.right].map((analysis, index) => {
                  const modelEval = index === 0 ? result.modelEvaluations.left : result.modelEvaluations.right;
                  const agenticEval = index === 0 ? result.agenticEvaluations.left : result.agenticEvaluations.right;
                  return (
                    <div key={`${analysis.slotLabel}-details`}>
                      <h4>{analysis.slotLabel}</h4>
                      <p className="muted">{modelEval.recommendation}</p>
                      <ul>{modelEval.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                      <ul>{modelEval.risks.map((item) => <li key={item}>{item}</li>)}</ul>
                      <p className="muted">{agenticEval.summary}</p>
                      <ul><li>Verdict: {agenticEval.verdict}</li></ul>
                      <ul><li>{agenticEval.benchmarkMeaning}</li></ul>
                      <ul>{agenticEval.priorityFixes.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  );
                })}
              </div>
            </details>

            <details className="card policy-lab-detailcard">
              <summary className="policy-lab-detailsummary">
                <span className="badge">Methodology</span>
                <strong>How Policy Lab scored this run</strong>
              </summary>
              <div className="policy-lab-detailbody">
                <pre className="policy-lab-reporttext">{buildEvaluatorMethodologyText(result)}</pre>
              </div>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
