import React, { useMemo, useState, useImperativeHandle, forwardRef, useCallback, useEffect, useRef } from 'react';
import AgentAvatar from './AgentAvatar.jsx';

const MAX_VISIBLE = 5;

const MentionAutocomplete = forwardRef(function MentionAutocomplete(
  { agents = [], filter = '', onSelect, onClose, visible = false, position },
  ref,
) {
  const [highlightIndex, setHighlightIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!filter && filter !== '') return agents;
    const q = filter.toLowerCase();
    return agents.filter(
      (a) =>
        (a.name && a.name.toLowerCase().includes(q)) ||
        (a.id && a.id.toLowerCase().includes(q)) ||
        (a.shortName && a.shortName.toLowerCase().includes(q)),
    );
  }, [agents, filter]);

  // Reset highlight when the filtered list changes (moved to useEffect to
  // avoid setState during render, which can cause infinite render loops in
  // React 19 strict mode)
  useEffect(() => {
    if (highlightIndex >= filtered.length && filtered.length > 0) {
      setHighlightIndex(0);
    }
  }, [filtered.length, highlightIndex]);

  const getSelectedAgent = useCallback(() => {
    return filtered[highlightIndex] || null;
  }, [filtered, highlightIndex]);

  useImperativeHandle(ref, () => ({
    getSelectedAgent,
    handleKeyDown(e) {
      if (!visible || filtered.length === 0) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((prev) => (prev + 1) % filtered.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
        return true;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const agent = filtered[highlightIndex];
        if (agent && onSelect) onSelect(agent);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (onClose) onClose();
        return true;
      }
      return false;
    },
  }), [visible, filtered, highlightIndex, onSelect, onClose, getSelectedAgent]);

  if (!visible) return null;

  const posStyle = position
    ? { top: position.top, left: position.left }
    : {};

  return (
    <div className="mention-autocomplete" style={posStyle} role="listbox" aria-label="Mention agents">
      {filtered.length === 0 ? (
        <div className="mention-autocomplete-empty">No matching agents</div>
      ) : (
        <div
          className="mention-autocomplete-list"
          style={{ maxHeight: MAX_VISIBLE * 44, overflowY: filtered.length > MAX_VISIBLE ? 'auto' : 'hidden' }}
        >
          {filtered.map((agent, i) => (
            <button
              key={agent.id}
              type="button"
              className={`mention-autocomplete-item${i === highlightIndex ? ' is-highlighted' : ''}`}
              role="option"
              aria-selected={i === highlightIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect && onSelect(agent)}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              <AgentAvatar agent={agent} size={20} interactive={false} />
              <span className="mention-autocomplete-name">{agent.name}</span>
              {agent.description && (
                <span className="mention-autocomplete-desc">{agent.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default MentionAutocomplete;
