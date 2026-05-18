import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import AgentProgressStrip from './AgentProgressStrip.jsx';
import { useRunningTimer } from './useRunningTimer.js';

const PASS_FAIL_KEY = 'v5_parser_accuracy_log';

function readLog() {
  try {
    const raw = localStorage.getItem(PASS_FAIL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function appendLog(entry) {
  try {
    const log = readLog();
    log.push(entry);
    localStorage.setItem(PASS_FAIL_KEY, JSON.stringify(log));
  } catch { /* noop */ }
}

const PLACEHOLDER_FIELDS = [
  { key: 'attemptingTo', label: 'Attempting to' },
  { key: 'expectedOutcome', label: 'Expected outcome' },
  { key: 'actualOutcome', label: 'Actual outcome' },
  { key: 'clientContact', label: 'Client / contact' },
  { key: 'agentName', label: 'Phone agent' },
  { key: 'tsSteps', label: 'Steps tried' },
];

export default function Widget2ParsedTemplate({ stageState, parsedFields, caseIntake }) {
  const parser = stageState.parser;
  const isParsing = parser.status === 'running';
  const isDone = parser.status === 'done';
  const isFailed = parser.status === 'failed';
  const timerText = useRunningTimer(parser.startedAt, isParsing, parser.finishedAt);
  const [accuracy, setAccuracy] = useState(null);

  const parserModel = caseIntake?.runs?.find?.((r) => r?.phase === 'parse-template')?.model || 'image-parser';
  const caseId = caseIntake?._id || caseIntake?.conversationId || '';

  const visibleFields = (isDone && Array.isArray(parsedFields) && parsedFields.length > 0)
    ? parsedFields
    : PLACEHOLDER_FIELDS.map((f) => ({ ...f, value: '' }));

  useEffect(() => {
    if (!isDone) setAccuracy(null);
  }, [isDone]);

  const handleAccuracy = (verdict) => {
    if (accuracy) return;
    setAccuracy(verdict);
    appendLog({
      timestamp: new Date().toISOString(),
      verdict,
      model: parserModel,
      caseId,
    });
  };

  return (
    <div className="v5-widget v5-widget--parsed">
      <header className="v5-widget__head">
        <div className="v5-widget__head-row">
          <div className="v5-widget__heading-stack">
            <span className="v5-widget__eyebrow">02</span>
            <h2 className="v5-widget__title">{isFailed ? 'Parser failed' : 'Reading template'}</h2>
          </div>
          <div className="v5-widget__timer" aria-live="polite">
            {isParsing && <span className="v5-widget__timer-dot v5-widget__timer-dot--running" />}
            {isDone && <span className="v5-widget__timer-dot v5-widget__timer-dot--done" />}
            {isFailed && <span className="v5-widget__timer-dot v5-widget__timer-dot--failed" />}
            <span className="v5-widget__timer-value">{isDone || isFailed ? `${((parser.durationMs || 0) / 1000).toFixed(1)}s` : timerText}</span>
          </div>
        </div>
        {isParsing && (
          <div className="v5-progress" aria-hidden="true">
            <motion.div
              className="v5-progress__bar"
              initial={{ x: '-40%' }}
              animate={{ x: '120%' }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        )}
      </header>

      <div className="v5-widget__body v5-widget__body--scroll">
        {isFailed && (
          <div className="v5-triage-placeholder" style={{ color: '#f97373' }}>
            <span>Parser failed: {parser.error || 'unknown error'}</span>
          </div>
        )}
        {!isFailed && (
          <dl className="v5-fields">
            {visibleFields.map((field, fieldIdx) => (
              <div key={field.key || `field-${fieldIdx}`} className="v5-field">
                <dt className="v5-field__label">{field.label}</dt>
                <dd className="v5-field__value">
                  <AnimatePresence mode="wait">
                    {isDone && field.value ? (
                      <motion.span
                        key="filled"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22, delay: fieldIdx * 0.04 }}
                      >
                        {field.value}
                      </motion.span>
                    ) : (
                      <motion.span
                        key="placeholder"
                        className="v5-field__placeholder"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      />
                    )}
                  </AnimatePresence>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {isDone && !isFailed && (
          <motion.div
            className="v5-accuracy"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.4 }}
          >
            <div className="v5-accuracy__label">Logged parser accuracy</div>
            <div className="v5-accuracy__buttons">
              <button
                type="button"
                className={`v5-accuracy__btn v5-accuracy__btn--pass ${accuracy === 'pass' ? 'is-on' : ''}`}
                onClick={() => handleAccuracy('pass')}
                disabled={!!accuracy}
              >
                Pass · 100% correct
              </button>
              <button
                type="button"
                className={`v5-accuracy__btn v5-accuracy__btn--fail ${accuracy === 'fail' ? 'is-on' : ''}`}
                onClick={() => handleAccuracy('fail')}
                disabled={!!accuracy}
              >
                Fail · anything less
              </button>
            </div>
            {accuracy && <div className="v5-accuracy__ack">Logged — {parserModel}</div>}
          </motion.div>
        )}
      </div>

      <footer className="v5-widget__foot">
        <AgentProgressStrip stageState={stageState} exclude="parser" />
      </footer>
    </div>
  );
}
