#!/usr/bin/env node
/**
 * Runtime Guard — PreToolUse hook
 *
 * Denies shell commands that would start, stop, or restart local servers or
 * dev processes. Runtime ownership belongs to the user (see CLAUDE.md
 * "Runtime Ownership"). Fails open: malformed input or any error allows the
 * tool call so a hook bug never bricks the session.
 */

const DENY_REASON =
  'Runtime ownership: the user controls local servers/processes. ' +
  'Make the change, then tell the user exactly what to restart — or ask them to run this command themselves.';

// Case-insensitive server-lifecycle patterns.
const BLOCKED_PATTERNS = [
  /\bnpm\b[^&|;]*\brun\s+dev\b/i,                       // npm run dev / dev:client / dev:server, any --prefix
  /\bnpm(?:\.cmd)?\s+(?:--prefix\s+\S+\s+)?start\b/i,   // npm start (incl. --prefix variants)
  /\bnodemon\b/i,                                       // nodemon launches
  /^\s*rs\s*$/i,                                        // nodemon manual restart
  /(?:^|[\s;&|])(?:npx\s+)?vite\s*$|(?:^|[\s;&|])(?:npx\s+)?vite\s+(?!build\b)/i, // vite dev server (vite build allowed)
  /\bnode\b[^&|;]*\bserver[\\/]src[\\/]index\.js\b/i,   // direct server entry launch
  /\bstop-process\b/i,                                  // PowerShell process kill
  /\btaskkill\b/i,                                      // Windows process kill
  /\|\s*(?:xargs\s+)?kill\b/i,                          // piping port/process lookups into kill
];

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell') process.exit(0);
    const command = String(input.tool_input?.command ?? '');
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: DENY_REASON,
          },
        }));
        process.exit(0);
      }
    }
    process.exit(0); // no match — allow
  } catch {
    process.exit(0); // fail open
  }
});
