#!/usr/bin/env node
/**
 * Workspace Guard - PreToolUse hook
 *
 * Blocks a small set of commands that are too destructive or too likely to
 * expose secrets for routine coding-agent work. Fails open on hook errors so
 * the project is not bricked by malformed input.
 */

const RULES = [
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: 'Workspace protection: git reset --hard can erase concurrent or uncommitted work. Use a narrower, reviewed operation.',
  },
  {
    pattern: /\bgit\s+clean\s+(?:-[^\s]*f|--force)\b/i,
    reason: 'Workspace protection: git clean can permanently delete untracked work from another session.',
  },
  {
    pattern: /\bgit\s+push\b[^\r\n;&|]*(?:--force(?:-with-lease)?|-f)\b/i,
    reason: 'Workspace protection: force-pushing shared history is not allowed from an automated coding session.',
  },
  {
    pattern: /\bgit\s+branch\s+-D\b/i,
    reason: 'Workspace protection: force-deleting a branch requires the user to perform or explicitly supervise the operation.',
  },
  {
    pattern: /(?:\b(?:cat|type|more)\b|\bget-content\b)[^\r\n;&|]*(?:^|[\\/])(?:\.env(?:\.[\w.-]+)?|\.tokens\.json|id_rsa|id_ed25519)\b/i,
    reason: 'Secret protection: do not print an entire environment, token, or private-key file. Inspect only a named non-secret field with redacted output.',
  },
];

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell') process.exit(0);
    const command = String(input.tool_input?.command ?? '');
    const blocked = RULES.find(({ pattern }) => pattern.test(command));
    if (blocked) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: blocked.reason,
        },
      }));
    }
  } catch {
    // Fail open. Root instructions still apply.
  }
  process.exit(0);
});
