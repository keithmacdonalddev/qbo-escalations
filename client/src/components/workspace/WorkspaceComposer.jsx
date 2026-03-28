import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const SLASH_COMMANDS = [
  { cmd: '/clear', desc: 'Clear conversation' },
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/history', desc: 'Show recent agent actions' },
  { cmd: '/stop', desc: 'Stop current response' },
  { cmd: '/model', desc: 'Show or switch AI provider' },
  { cmd: '/brief', desc: 'Request inbox & calendar briefing' },
  { cmd: '/status', desc: 'Show session info' },
];

export default function WorkspaceComposer({
  input = '',
  streaming = false,
  inputRef,
  onChangeInput,
  onSubmit,
  onStop,
}) {
  const [showCommandHint, setShowCommandHint] = useState(false);
  const [hintIndex, setHintIndex] = useState(-1);
  const slashRef = useRef({ show: false, index: -1, cmds: [] });
  const blurTimerRef = useRef(0);

  const filteredCommands = useMemo(() => {
    const q = input.trim().toLowerCase();
    return SLASH_COMMANDS.filter((c) => !q || c.cmd.startsWith(q));
  }, [input]);

  const isCommandCandidate = input.startsWith('/') && input.length < 12 && !input.includes(' ');

  useEffect(() => {
    slashRef.current.show = showCommandHint;
    slashRef.current.index = hintIndex;
    slashRef.current.cmds = filteredCommands;
  }, [showCommandHint, hintIndex, filteredCommands]);

  useEffect(() => {
    if (isCommandCandidate) return undefined;
    setShowCommandHint(false);
    setHintIndex(-1);
    return undefined;
  }, [isCommandCandidate]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) {
        window.clearTimeout(blurTimerRef.current);
        blurTimerRef.current = 0;
      }
    };
  }, []);

  const hideCommandHint = useCallback(() => {
    setShowCommandHint(false);
    setHintIndex(-1);
  }, []);

  const selectCommand = useCallback((cmd) => {
    onChangeInput?.(cmd === '/model' ? '/model ' : cmd);
    hideCommandHint();
    inputRef?.current?.focus();
  }, [hideCommandHint, inputRef, onChangeInput]);

  const handleInputKeyDown = useCallback((event) => {
    const { show, index, cmds } = slashRef.current;
    if (!show || cmds.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        setHintIndex((index + 1) % cmds.length);
        return;
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        setHintIndex(index <= 0 ? cmds.length - 1 : index - 1);
        return;
      case 'Enter':
        if (index >= 0 && index < cmds.length) {
          event.preventDefault();
          event.stopPropagation();
          selectCommand(cmds[index].cmd);
        }
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        hideCommandHint();
        return;
      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        selectCommand(cmds[index >= 0 ? index : 0].cmd);
        return;
      default:
        return;
    }
  }, [hideCommandHint, selectCommand]);

  const handleInputChange = useCallback((event) => {
    const nextValue = event.target.value;
    onChangeInput?.(nextValue);
    if (nextValue.startsWith('/') && nextValue.length < 12 && !nextValue.includes(' ')) {
      setShowCommandHint(true);
      setHintIndex(-1);
    } else {
      hideCommandHint();
    }
  }, [hideCommandHint, onChangeInput]);

  const handleInputBlur = useCallback(() => {
    blurTimerRef.current = window.setTimeout(() => {
      hideCommandHint();
    }, 150);
  }, [hideCommandHint]);

  const handleInputFocus = useCallback((event) => {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = 0;
    }
    const value = event.target.value || '';
    if (value.startsWith('/') && value.length < 12 && !value.includes(' ')) {
      setShowCommandHint(true);
      setHintIndex(-1);
    }
  }, []);

  return (
    <div className="workspace-agent-input-wrapper">
      <AnimatePresence>
        {showCommandHint && (
          <motion.div
            className="workspace-command-hint"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
          >
            {filteredCommands.map((command, index) => (
              <button
                key={command.cmd}
                type="button"
                className={`workspace-command-hint-item${index === hintIndex ? ' workspace-command-hint-active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectCommand(command.cmd);
                }}
                onMouseEnter={() => setHintIndex(index)}
              >
                <span className="workspace-command-hint-cmd">{command.cmd}</span>
                <span className="workspace-command-hint-desc">{command.desc}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <form className="workspace-agent-input" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onKeyDown={handleInputKeyDown}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onFocus={handleInputFocus}
          placeholder="Ask your Workspace Agent... (/ for commands)"
          disabled={streaming}
        />
        {streaming ? (
          <button className="workspace-agent-send-btn workspace-agent-stop-btn" onClick={onStop} type="button" aria-label="Stop">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button className="workspace-agent-send-btn" type="submit" disabled={!input.trim()} aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
