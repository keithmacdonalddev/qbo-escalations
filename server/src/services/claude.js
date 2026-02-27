const { spawn } = require('child_process');
const { EventEmitter } = require('events');

/**
 * Spawn Claude CLI as a child process with streaming JSON output.
 *
 * @param {Object} opts
 * @param {string} opts.prompt - User message
 * @param {string} [opts.systemPrompt] - System prompt (playbook context)
 * @param {string[]} [opts.images] - File paths to images
 * @param {string} [opts.sessionId] - Resume a previous session
 * @param {boolean} [opts.continueSession] - Continue most recent session
 * @param {string} [opts.model] - Model override (default: sonnet)
 * @returns {{ emitter: EventEmitter, proc: ChildProcess, abort: () => void }}
 *
 * Emitter events:
 *   'delta'  - { text: string }         Partial text chunk
 *   'result' - { text: string, sessionId: string }  Final result
 *   'error'  - { message: string }      Error
 *   'done'   - {}                        Process exited
 */
function queryClaudeCLI(opts) {
  const { prompt, systemPrompt, images = [], sessionId, continueSession, model } = opts;

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
  ];

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  if (model) {
    args.push('--model', model);
  } else {
    args.push('--model', 'sonnet');
  }

  if (sessionId) {
    args.push('--resume', sessionId);
  } else if (continueSession) {
    args.push('--continue');
  }

  for (const imagePath of images) {
    args.push('--file', imagePath);
  }

  // Disable all tools — we only need text generation
  args.push('--tools', '');

  const emitter = new EventEmitter();
  let buffer = '';
  let lastSessionId = '';
  let fullText = '';

  const proc = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
    shell: true,  // Required on Windows
  });

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        handleMessage(msg, emitter, { lastSessionId, fullText });
        if (msg.session_id) lastSessionId = msg.session_id;
      } catch {
        // Non-JSON output (debug info), ignore
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      // stderr is debug/status output, not errors unless process fails
    }
  });

  proc.on('close', (code) => {
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const msg = JSON.parse(buffer.trim());
        handleMessage(msg, emitter, { lastSessionId, fullText });
        if (msg.session_id) lastSessionId = msg.session_id;
      } catch {
        // ignore
      }
    }

    if (code !== 0 && code !== null) {
      emitter.emit('error', { message: `Claude CLI exited with code ${code}` });
    }
    emitter.emit('done', {});
  });

  proc.on('error', (err) => {
    emitter.emit('error', { message: `Failed to spawn Claude CLI: ${err.message}` });
    emitter.emit('done', {});
  });

  const abort = () => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  };

  return { emitter, proc, abort };
}

function handleMessage(msg, emitter, state) {
  switch (msg.type) {
    case 'assistant': {
      // Extract text from content blocks
      const blocks = msg.message?.content || [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          emitter.emit('delta', { text: block.text });
          state.fullText += block.text;
        }
      }
      break;
    }

    case 'result': {
      emitter.emit('result', {
        text: msg.result || state.fullText,
        sessionId: msg.session_id || state.lastSessionId,
      });
      break;
    }

    case 'system': {
      if (msg.session_id) {
        state.lastSessionId = msg.session_id;
      }
      break;
    }
  }
}

/**
 * Build a multi-turn prompt from conversation history.
 * Since CLI -p mode is single-turn, we reconstruct context
 * by including prior messages in the prompt.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} currentMessage
 * @returns {string}
 */
function buildConversationPrompt(messages, currentMessage) {
  if (!messages.length) return currentMessage;

  const history = messages.map(m => {
    const label = m.role === 'user' ? 'User' : 'Assistant';
    return `${label}: ${m.content}`;
  }).join('\n\n');

  return `Previous conversation:\n${history}\n\nUser: ${currentMessage}`;
}

module.exports = { queryClaudeCLI, buildConversationPrompt };
