export function createSSEDecoder(onEvent) {
  let buffer = '';
  let currentEvent = '';
  let dataLines = [];

  function resetEvent() {
    currentEvent = '';
    dataLines = [];
  }

  function flushEvent() {
    if (!currentEvent && dataLines.length === 0) return;
    const rawData = dataLines.join('\n');
    if (!rawData) {
      resetEvent();
      return;
    }

    try {
      const data = JSON.parse(rawData);
      onEvent?.(currentEvent, data);
    } catch {
      // ignore malformed payloads
    }

    resetEvent();
  }

  function processLine(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line) {
      flushEvent();
      return;
    }

    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  function pushChunk(chunkText) {
    if (!chunkText) return;
    buffer += chunkText;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) processLine(line);
  }

  function finish() {
    if (buffer) processLine(buffer);
    flushEvent();
  }

  return { pushChunk, finish };
}

export async function consumeSSEStream(res, onEvent) {
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEDecoder(onEvent);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.pushChunk(decoder.decode(value, { stream: true }));
  }

  parser.finish();
}
