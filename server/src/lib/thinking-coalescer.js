'use strict';

// Codex CLI emits reasoning deltas frequently (sometimes per-token). Forwarding
// every raw delta as its own SSE event floods the channel — at ~20 events/sec
// per stage the live caption UI starts to drop frames. This coalescer batches
// deltas on a size or newline boundary so latency stays near-zero (no timer)
// but the per-second event count stays bounded.
//
// Policy: flush whenever the buffered text either
//   - contains a newline (sentence/idea boundary), or
//   - reaches FLUSH_CHARS characters.
// The trailing buffer is flushed by calling `flush()` at end-of-stream.

const FLUSH_CHARS = 80;

function createThinkingCoalescer(onFlush) {
  let buffer = '';

  function push(delta) {
    if (typeof delta !== 'string' || delta.length === 0) return;
    buffer += delta;
    // Loop because a single push can contain multiple newlines.
    while (true) {
      const nlIdx = buffer.indexOf('\n');
      if (nlIdx !== -1) {
        const chunk = buffer.slice(0, nlIdx + 1);
        buffer = buffer.slice(nlIdx + 1);
        try { onFlush(chunk); } catch { /* ignore */ }
        continue;
      }
      if (buffer.length >= FLUSH_CHARS) {
        const chunk = buffer.slice(0, FLUSH_CHARS);
        buffer = buffer.slice(FLUSH_CHARS);
        try { onFlush(chunk); } catch { /* ignore */ }
        continue;
      }
      break;
    }
  }

  function flush() {
    if (!buffer) return;
    const remaining = buffer;
    buffer = '';
    try { onFlush(remaining); } catch { /* ignore */ }
  }

  return { push, flush };
}

module.exports = {
  createThinkingCoalescer,
  FLUSH_CHARS,
};
