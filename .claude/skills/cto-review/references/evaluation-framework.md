# Evaluation framework

The eight sections applied during a CTO review. Each section carries a 1–10 score. Findings within a section list severity (Critical, High, Medium, Low), `file:line`, issue, reproduction, and fix.

## Contents

- Logic and API
- Data integrity
- Security
- Failure modes
- Performance
- Regression risk
- Observability
- State lifecycle

## Logic and API

Whether the code does what it claims and exposes a sensible interface.

Look for:

- Missing input validation on public endpoints.
- Happy-path-only logic where edge cases exist (empty collections, zero, null, undefined, extreme values).
- API response shapes inconsistent with the rest of the codebase.
- Mismatches between what the caller expects and what the callee returns.
- Unreachable branches and dead code.

## Data integrity

Whether data is correctly stored, retrieved, and mutated.

Look for:

- Race conditions on shared mutable state.
- Missing transactions around multi-step writes that must be atomic.
- Unsanitized inputs flowing into database queries.
- Silent type coercions (string "0" treated as falsy, number-to-string drift).
- Lost updates from read-modify-write patterns without locking.
- Missing validation at trust boundaries (client input, third-party responses).

## Security

Whether the code can be abused.

Look for:

- Authentication or authorization skipped on routes that handle user data.
- Unescaped user content rendered to HTML.
- Secrets logged or returned in responses.
- Path traversal in file operations.
- NoSQL or SQL injection via unsanitized query construction.
- Permissive CORS or missing origin checks.
- Internal error messages (stack traces) leaked to end users.

## Failure modes

What happens when things go wrong.

Look for:

- Unhandled promise rejections.
- Silent `catch` blocks (caught error, no log, no recovery).
- Missing timeouts on network calls or subprocesses.
- No retry or backoff on transient failures where retry is safe.
- Operations with no fallback when a dependency is down.
- Error paths that leave state partially mutated.

## Performance

Whether the code will hold up under load.

Look for:

- N+1 queries.
- Unbounded loops over untrusted input.
- Synchronous blocking calls on the request path.
- Missing pagination on list endpoints.
- Memory leaks (long-lived references to request-scoped objects).
- Redundant work per request that could be cached.

Do not flag performance issues that only matter at scales the code will not reach.

## Regression risk

Whether this change breaks existing behavior.

Look for:

- Modified shared utilities used by unrelated features.
- Changed database schemas without a migration plan.
- Removed or renamed public API fields.
- Changed default values that downstream code relies on.
- Modified behavior in shared middleware.

Cross-reference every modified function against its callers.

## Observability

Whether a future engineer can debug this when it breaks.

Look for:

- Errors that log "something went wrong" without the actual error.
- No structured logging on request-scoped operations.
- Missing correlation IDs across service boundaries.
- No metrics emitted for the new feature.
- No way to distinguish different failure modes from logs alone.

## State lifecycle

Whether state is created, updated, and destroyed cleanly.

Look for:

- Resources (connections, file handles, intervals, subscriptions) opened without a corresponding close.
- Event listeners attached without removal.
- Stale state persisting across user sessions where it should not.
- Component state that diverges from server state without sync.
- Caches with no invalidation strategy.
