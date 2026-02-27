const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Chat with Claude via CLI subprocess.
 *
 * @param {Object} opts
 * @param {Array<{role: string, content: string}>} opts.messages - Conversation history
 * @param {string} [opts.systemPrompt] - System prompt (playbook content)
 * @param {string[]} [opts.images] - Base64-encoded images
 * @param {function} opts.onChunk - Called with each text delta
 * @param {function} opts.onDone - Called with full response text
 * @param {function} opts.onError - Called on failure
 * @returns {function} cleanup - Call to kill the subprocess
 */
function chat({ messages, systemPrompt, images, onChunk, onDone, onError }) {
  const prompt = buildPrompt(messages);
  const tempFiles = [];
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  if (images && images.length > 0) {
    for (let i = 0; i < images.length; i++) {
      const tmpPath = path.join(os.tmpdir(), 'qbo-escalation-img-' + Date.now() + '-' + i + '.png');
      const base64Data = images[i].replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'));
      tempFiles.push(tmpPath);
      args.push('--image', tmpPath);
    }
  }

  let fullResponse = '';
  let killed = false;

  const child = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env },
  });

  let stdoutBuffer = '';

  child.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const text = extractText(msg);
        if (text) {
          fullResponse += text;
          onChunk(text);
        }
      } catch {
        // Non-JSON line (verbose output), ignore
      }
    }
  });

  let stderrOutput = '';
  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  child.on('close', (code) => {
    if (stdoutBuffer.trim()) {
      try {
        const msg = JSON.parse(stdoutBuffer);
        const text = extractText(msg);
        if (text) {
          fullResponse += text;
          onChunk(text);
        }
      } catch { /* ignore */ }
    }

    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }

    if (killed) return;
    if (code !== 0 && !fullResponse) {
      onError(new Error('Claude CLI exited with code ' + code + ': ' + stderrOutput.slice(0, 500)));
    } else {
      onDone(fullResponse);
    }
  });

  child.on('error', (err) => {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    if (!killed) onError(err);
  });

  return function cleanup() {
    killed = true;
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  };
}

/**
 * Parse an escalation from image or text using Claude CLI with structured output.
 *
 * @param {string} imageBase64OrText - Either a base64 image string or plain text
 * @returns {Promise<Object>} Parsed escalation fields
 */
async function parseEscalation(imageBase64OrText) {
  const isBase64Image = imageBase64OrText.startsWith('data:image') ||
    /^[A-Za-z0-9+/=]{100,}/.test(imageBase64OrText);

  const schema = JSON.stringify({
    type: 'object',
    properties: {
      coid:             { type: 'string' },
      mid:              { type: 'string' },
      caseNumber:       { type: 'string' },
      clientContact:    { type: 'string' },
      agentName:        { type: 'string' },
      attemptingTo:     { type: 'string' },
      expectedOutcome:  { type: 'string' },
      actualOutcome:    { type: 'string' },
      tsSteps:          { type: 'string' },
      triedTestAccount: { type: 'string', enum: ['yes', 'no', 'unknown'] },
      category: {
        type: 'string',
        enum: [
          'payroll', 'bank-feeds', 'reconciliation', 'permissions',
          'billing', 'tax', 'invoicing', 'reporting', 'inventory',
          'payments', 'integrations', 'general', 'unknown',
        ],
      },
    },
    required: ['category'],
  });

  let prompt;
  let tmpPath = null;

  if (isBase64Image) {
    tmpPath = path.join(os.tmpdir(), 'qbo-parse-' + Date.now() + '.png');
    const base64Data = imageBase64OrText.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'));

    prompt = 'Parse this escalation screenshot. Extract all fields: COID, MID, case number, ' +
      'client contact, agent name, what they are attempting, expected outcome, actual outcome, ' +
      'troubleshooting steps, whether they tried a test account, and issue category. ' +
      'Return ONLY the JSON.';
  } else {
    prompt = 'Parse this escalation text. Extract all fields: COID, MID, case number, ' +
      'client contact, agent name, what they are attempting, expected outcome, actual outcome, ' +
      'troubleshooting steps, whether they tried a test account, and issue category. ' +
      'Return ONLY the JSON.\n\nEscalation text:\n' + imageBase64OrText;
  }

  const args = ['-p', prompt, '--output-format', 'json', '--json-schema', schema];

  // Use --image flag for image files
  if (tmpPath) {
    args.push('--image', tmpPath);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }

      if (code !== 0 && !stdout) {
        return reject(new Error('Claude CLI parse failed (code ' + code + '): ' + stderr.slice(0, 500)));
      }

      try {
        const parsed = JSON.parse(stdout);
        const data = parsed.structured_output || parsed.result || parsed;
        if (typeof data === 'string') {
          const jsonMatch = data.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve({ category: 'unknown', attemptingTo: data });
          }
        } else {
          resolve(data);
        }
      } catch {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            resolve(JSON.parse(jsonMatch[0]));
          } catch {
            resolve({ category: 'unknown', attemptingTo: stdout.slice(0, 500) });
          }
        } else {
          resolve({ category: 'unknown', attemptingTo: stdout.slice(0, 500) });
        }
      }
    });

    child.on('error', (err) => {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }
      reject(err);
    });
  });
}

/**
 * Warm up the Claude CLI to reduce first-request latency.
 */
async function warmUp() {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', 'hello', '--output-format', 'text', '--max-turns', '1'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env },
    });

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      console.log('Claude CLI warm-up timed out (30s) -- continuing anyway');
      resolve();
    }, 30000);

    child.on('close', () => {
      clearTimeout(timeout);
      console.log('Claude CLI warm-up complete');
      resolve();
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      console.warn('Claude CLI warm-up failed:', err.message);
      resolve();
    });
  });
}

// --- Helpers ---

/**
 * Build a prompt string from a messages array.
 */
function buildPrompt(messages) {
  if (!messages || messages.length === 0) return '';
  if (messages.length === 1) return messages[0].content;

  const lines = [];
  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(prefix + ': ' + msg.content);
  }
  lines.push('Assistant:');
  return lines.join('\n\n');
}

/**
 * Extract text content from a stream-json message.
 */
function extractText(msg) {
  if (msg.type === 'assistant' && msg.message && msg.message.content) {
    return msg.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  if (msg.type === 'result' && msg.result) {
    return typeof msg.result === 'string' ? msg.result : '';
  }
  if (msg.type === 'content_block_delta' && msg.delta && msg.delta.text) {
    return msg.delta.text;
  }
  return '';
}

module.exports = { chat, parseEscalation, warmUp };
