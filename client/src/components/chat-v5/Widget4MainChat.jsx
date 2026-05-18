import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import AgentProgressStrip from './AgentProgressStrip.jsx';
import { useRunningTimer } from './useRunningTimer.js';

const ANALYST = {
  name: 'QBO Assistant',
  role: 'senior escalation analyst',
  initials: 'QA',
};

function TypingDots() {
  return (
    <span className="v5-typing" aria-label="Analyst is typing">
      <span /><span /><span />
    </span>
  );
}

function AnalystBubble({ text }) {
  const lines = (text || '').split('\n');
  return (
    <div className="v5-msg v5-msg--analyst">
      <div className="v5-msg__avatar">{ANALYST.initials}</div>
      <div className="v5-msg__body">
        <div className="v5-msg__name"><strong>{ANALYST.name}</strong> · {ANALYST.role}</div>
        <div className="v5-msg__bubble">{lines.map((line, i) => <p key={i}>{line || ' '}</p>)}</div>
      </div>
    </div>
  );
}

function OperatorBubble({ text }) {
  const lines = (text || '').split('\n');
  return (
    <div className="v5-msg v5-msg--operator">
      <div className="v5-msg__avatar v5-msg__avatar--op">You</div>
      <div className="v5-msg__body">
        <div className="v5-msg__bubble">{lines.map((line, i) => <p key={i}>{line || ' '}</p>)}</div>
      </div>
    </div>
  );
}

export default function Widget4MainChat({ stageState, analyst, chatLog, onSendOperatorMessage }) {
  const main = stageState.main;
  const isRunning = main.status === 'running' || analyst?.isStreaming;
  const isDone = main.status === 'done' && !analyst?.isStreaming;
  const isFailed = main.status === 'failed';
  const timerText = useRunningTimer(main.startedAt, isRunning, main.finishedAt);
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  const streamingText = analyst?.text || '';
  const composedChatLog = Array.isArray(chatLog) && chatLog.length > 0
    ? chatLog
    : (streamingText
      ? [{ role: 'analyst-stream', text: streamingText, isStreaming: analyst?.isStreaming }]
      : []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [composedChatLog, analyst?.isStreaming]);

  const handleSend = () => {
    const t = input.trim();
    if (!t || analyst?.isStreaming) return;
    onSendOperatorMessage?.(t);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const composerReady = (isDone || (main.status === 'done')) && !analyst?.isStreaming;

  return (
    <div className="v5-widget v5-widget--chat">
      <header className="v5-widget__head v5-widget__head--chat">
        <div className="v5-widget__head-row">
          <div className="v5-widget__heading-stack">
            <span className="v5-widget__eyebrow">04</span>
            <h2 className="v5-widget__title">{ANALYST.name} · analyst</h2>
          </div>
          <div className="v5-widget__timer">
            {isRunning && <span className="v5-widget__timer-dot v5-widget__timer-dot--running" />}
            {isDone && <span className="v5-widget__timer-dot v5-widget__timer-dot--done" />}
            {isFailed && <span className="v5-widget__timer-dot v5-widget__timer-dot--failed" />}
            <span className="v5-widget__timer-value">{isDone || isFailed ? `${((main.durationMs || 0) / 1000).toFixed(1)}s` : timerText}</span>
          </div>
        </div>
        <AgentProgressStrip stageState={stageState} exclude="main" variant="header" />
      </header>

      <div className="v5-widget__body v5-widget__body--chat" ref={scrollRef}>
        {!isRunning && !isDone && !isFailed && composedChatLog.length === 0 && (
          <div className="v5-chat-warming">
            <motion.span
              className="v5-triage-placeholder__spin"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <span>{ANALYST.name} is reading the triage call, parsed template, and prior INVs…</span>
          </div>
        )}
        {isRunning && composedChatLog.length === 0 && (
          <div className="v5-chat-warming">
            <motion.span
              className="v5-triage-placeholder__spin"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <span>{ANALYST.name} is composing a response…</span>
          </div>
        )}
        {isFailed && composedChatLog.length === 0 && (
          <div className="v5-chat-warming" style={{ color: '#f97373' }}>
            <span>Analyst failed: {main.error || analyst?.error?.message || 'unknown error'}</span>
          </div>
        )}
        {composedChatLog.map((entry, i) =>
          entry.role === 'operator' ? (
            <OperatorBubble key={i} text={entry.text} />
          ) : (
            <AnalystBubble key={i} text={entry.text} />
          )
        )}
        <AnimatePresence>
          {analyst?.isStreaming && composedChatLog.some((e) => e.role === 'operator')
            && composedChatLog[composedChatLog.length - 1]?.role === 'operator' && (
            <motion.div
              key="typing"
              className="v5-msg v5-msg--analyst"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="v5-msg__avatar">{ANALYST.initials}</div>
              <div className="v5-msg__body">
                <div className="v5-msg__name"><strong>{ANALYST.name}</strong></div>
                <div className="v5-msg__bubble v5-msg__bubble--typing"><TypingDots /></div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <footer className="v5-widget__foot v5-widget__foot--composer">
        <textarea
          className="v5-composer__textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={composerReady ? `Reply to ${ANALYST.name}…` : 'Analyst is still warming up…'}
          rows={2}
          disabled={!composerReady}
        />
        <button
          type="button"
          className="v5-btn v5-btn--primary v5-btn--send"
          onClick={handleSend}
          disabled={!composerReady || !input.trim()}
        >
          Send
        </button>
      </footer>
    </div>
  );
}
