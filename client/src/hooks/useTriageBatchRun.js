import { useCallback, useRef, useState } from 'react';
import { getAgentTestHarness } from '../components/agent-tests/agentTestHarnesses.js';

// useTriageBatchRun drives the "Run all" control on the triage test surface.
// It runs every approved escalation case sequentially, headless (no per-case
// modal), against the real triage runtime via the registered harness — the SAME
// run path a single case uses, so each run persists a TriageTestResult. Sequential
// (not parallel) because the server enforces a single-flight triage test guard;
// firing them in parallel would just bounce off TRIAGE_TEST_ALREADY_RUNNING.
//
// Progress is surfaced live so the operator can watch 15 real cases stream
// through. `onCaseComplete` lets the caller refresh the results table as each
// run lands. The whole batch is abortable.
const TRIAGE_AGENT_ID = 'triage-agent';

const IDLE_PROGRESS = Object.freeze({
  running: false,
  total: 0,
  completed: 0,
  passed: 0,
  failed: 0,
  current: null, // { id, label }
  error: '',
  done: false,
  cancelled: false,
});

export default function useTriageBatchRun({ onCaseComplete } = {}) {
  const [progress, setProgress] = useState(IDLE_PROGRESS);
  const abortRef = useRef(null);
  const runningRef = useRef(false);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  const reset = useCallback(() => {
    if (runningRef.current) return;
    setProgress(IDLE_PROGRESS);
  }, []);

  // cases: [{ id, label }, ...] in the order they should run.
  const runAll = useCallback(async (cases = []) => {
    if (runningRef.current) return;
    const list = Array.isArray(cases) ? cases.filter((entry) => entry && entry.id) : [];
    if (!list.length) {
      setProgress({ ...IDLE_PROGRESS, done: true, error: 'No approved cases to run.' });
      return;
    }
    const harness = getAgentTestHarness(TRIAGE_AGENT_ID);
    if (!harness?.run) {
      setProgress({ ...IDLE_PROGRESS, done: true, error: 'No triage test harness registered.' });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    runningRef.current = true;

    let completed = 0;
    let passed = 0;
    let failed = 0;
    setProgress({
      ...IDLE_PROGRESS,
      running: true,
      total: list.length,
      current: { id: list[0].id, label: list[0].label || list[0].id },
    });

    for (const triageCase of list) {
      if (controller.signal.aborted) break;
      setProgress((prev) => ({
        ...prev,
        current: { id: triageCase.id, label: triageCase.label || triageCase.id },
      }));
      try {
        const data = await harness.run({
          request: { agentId: TRIAGE_AGENT_ID, caseId: triageCase.id },
          signal: controller.signal,
          // Batch mode is headless; we intentionally drop per-case stage events.
          onStageEvent: () => {},
        });
        completed += 1;
        // A run is a "pass-able" result if a triage card came back. We don't
        // auto-grade pass/fail here (operator review owns that); we only count
        // whether the run produced a card vs. errored.
        if (data && (data.triageCard || data.ok)) passed += 1;
        else failed += 1;
        onCaseComplete?.({ triageCase, result: data, error: null });
      } catch (err) {
        if (controller.signal.aborted) break;
        completed += 1;
        failed += 1;
        onCaseComplete?.({ triageCase, result: null, error: err });
      }
      setProgress((prev) => ({
        ...prev,
        completed,
        passed,
        failed,
      }));
    }

    const wasAborted = controller.signal.aborted;
    runningRef.current = false;
    abortRef.current = null;
    setProgress((prev) => ({
      ...prev,
      running: false,
      done: true,
      cancelled: wasAborted,
      current: null,
    }));
  }, [onCaseComplete]);

  return { progress, runAll, cancel, reset, isRunning: progress.running };
}
