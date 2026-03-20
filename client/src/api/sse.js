export function createSSEDecoder(onEvent) {
  let buffer = '';
  let currentEvent = '';
  let dataLines = [];
  let eventCount = 0;
  let malformedEventCount = 0;
  let terminalEventType = null;

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

    let data;
    try {
      data = JSON.parse(rawData);
    } catch {
      malformedEventCount += 1;
      resetEvent();
      return;
    }

    const eventType = currentEvent || 'message';
    eventCount += 1;
    if (eventType === 'done' || eventType === 'error') {
      terminalEventType = eventType;
    }
    onEvent?.(eventType, data);

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
    return {
      eventCount,
      malformedEventCount,
      terminalEventType,
    };
  }

  return { pushChunk, finish };
}

export async function consumeSSEStream(res, onEvent) {
  if (!res.body) {
    return {
      eventCount: 0,
      malformedEventCount: 0,
      terminalEventType: null,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEDecoder(onEvent);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.pushChunk(decoder.decode(value, { stream: true }));
  }

  const trailing = decoder.decode();
  if (trailing) parser.pushChunk(trailing);
  return parser.finish();
}
