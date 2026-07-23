# WebSocket Quality-of-Life Roadmap

## Role in the platform

The user goal is to work from one current, trustworthy view of a QBO escalation while specialist agents and background workflows continue around it. Realtime delivery supports that goal by keeping case state, knowledge review, agent activity, and completion signals synchronized without making the user refresh pages.

This work deliberately does not move normal create, edit, approve, publish, or delete commands onto WebSockets. Those actions remain on the existing HTTP routes; the shared realtime connection tells open screens what changed and when they need to reload authoritative data.

## Current-state audit — 2026-07-23

Status meanings:

- **Complete:** current source and focused tests cover the recommendation end to end.
- **Partial:** useful pieces exist, but an important user workflow or trust guarantee is missing.
- **Missing:** no production path currently provides the outcome.
- **Deferred:** intentionally outside the first production phase, with the remaining need stated plainly.

| # | Recommendation | Status before Phase 1 | Current evidence and gap |
|---|---|---|---|
| 1 | Live escalation updates | Missing | `server/src/services/realtime-server.js` registers only workspace-monitor, agent-session, and room channels. `client/src/hooks/useEscalations.js` loads the dashboard through HTTP and refreshes only on mount, filters, or manual action. `client/src/components/EscalationDetail.jsx` loads once per case. |
| 2 | Background-work progress | Partial | Agent sessions stream through `server/src/services/realtime-channels/agent-session.js` and fall back to SSE in `client/src/api/agentStream.js`. Workspace work completion is live through `WorkspaceMonitorContext.jsx`. Evidence recovery still polls every 2.5 seconds in `client/src/components/chat-v5/useEvidenceRecovery.js`, and several other background paths use SSE or fixed polling. |
| 3 | Live agent and chat activity | Partial | Room and agent-session channels provide snapshots/replay and live events. `useChatRoom.js` and `agentStream.js` consume them. The shared client advances its sequence cursor but currently still dispatches duplicate or older events, so ordering protection is incomplete. |
| 4 | Live knowledge lifecycle | Missing | Knowledge creation, review, publication, and retraction are persisted through escalation routes and knowledge services, but no realtime channel reaches the escalation detail or Knowledge Review queue. |
| 5 | Live health changes | Partial | Workspace monitor state is pushed live. Agent and provider health still depend on 60-second polling, with 15-second recovery polling in `AgentRegistryContext.jsx` and `useAgentHealth.js`. This is not changed merely for transport consistency in Phase 1. |
| 6 | Actionable notifications | Partial | The app has general toast surfaces and workspace completion signals, but case/knowledge background changes do not produce deduplicated notices linked to the affected escalation. |
| 7 | Multi-tab consistency | Missing | Tabs can each open the shared realtime endpoint, but escalation and knowledge mutations are not published, so another tab remains stale until a manual reload. |
| 8 | Connection truth and recovery controls | Partial | `client/src/api/realtime.js` reconnects with capped exponential delays and resubscribes. It has no retry jitter, application-level stale-connection check, manual reconnect command, or escalation-facing current/reconnecting/stale UI. |
| 9 | Missed-event recovery | Partial | Room and agent-session runtimes keep bounded event histories and accept a `since` cursor. The shared client retains that cursor across reconnects, but it does not suppress duplicate/out-of-order events, and there is no explicit snapshot fallback when a cursor is older than retained escalation events. |
| 10 | Presence and edit-conflict awareness | Missing; deferred from Phase 1 | There is no case presence or edit-conflict contract. The current product is primarily single-user, so Phase 1 prioritizes truthful multi-tab synchronization. Presence and version-aware edit protection remain future work rather than decorative cursor sharing. |

## End-to-end flow found in the audit

1. Escalations are written from `server/src/routes/escalations.js`, `server/src/lib/escalation-dedup.js`, chat persistence, and conversation cleanup paths.
2. Knowledge candidates are written from escalation routes, the knowledge management service, the background draft trigger, and evidence recovery.
3. Successful model writes currently stop at MongoDB; there is no case-domain event publication step.
4. Dashboard and detail React state is populated through `client/src/api/escalationsApi.js` and remains local until another HTTP request is made.
5. The existing multiplexed socket and shared browser client are suitable foundations for a new case-workflow channel.

## Trust and operational risks found

| Risk | Audit result | Phase 1 response |
|---|---|---|
| Origin protection | Present through `server/src/lib/origin-policy.js`; cross-origin handshake rejection is tested. | Preserve and extend focused handshake tests. |
| Authentication parity | The realtime handshake does not attach the optional app session. Escalation and knowledge read routes themselves are currently not session-protected; QBO app auth protects signed-in reporting only. | Do not invent a stricter socket-only boundary. Attach the same optional session context for future channel authorization and document/test parity with the corresponding HTTP routes. |
| Subscription authorization | Channel registration has no explicit authorization hook. | Add a channel authorization contract so any future protected channel must opt into and test its access rule. |
| Cleanup | Socket close removes subscriptions; channel cleanup functions exist. | Add coverage for case-channel unsubscribe/close cleanup. |
| Memory growth | Room and agent runtimes are bounded, but the new case channel does not exist. | Use a bounded case event buffer with test reset/status helpers. |
| Reconnect storms | Delay is capped exponential but has no jitter. | Add bounded jitter and a user-triggered retry that cancels the current cooldown safely. |
| Silent stale connection | Server ping/pong can terminate dead peers, but the browser client does not run an application heartbeat or expose stale state. | Add client ping/pong tracking and close/reconnect a socket that stops answering. |
| Duplicate/out-of-order delivery | Sequence is stored but older events still reach consumers. | Drop duplicate event IDs and non-increasing sequenced events before React state handlers run. |
| Replay gap | Existing channels replay what remains but do not explicitly prove a requested cursor is still available. | The case channel will send an authoritative snapshot/resync signal when replay is no longer safe. |
| Stale HTTP overwrite | Concurrent dashboard refreshes can resolve out of order. | Guard state commits with request generations and make realtime refreshes converge on the newest authoritative response. |

## Phase 1 production slice — delivered 2026-07-23

Phase 1 delivered:

1. One bounded, replayable case-workflow event runtime covering escalation and related knowledge writes.
2. One channel on the existing `/api/realtime` connection, supporting all-cases and one-case subscriptions.
3. Automatic dashboard, Knowledge Review, and open-detail synchronization, including multi-tab changes.
4. Small, deduplicated notices for important off-screen knowledge completion/failure events with a direct case action.
5. Quiet live/reconnecting/offline/stale/recovered state with a manual retry.
6. Shared-client jitter, heartbeat, deduplication, ordering, cleanup, and resynchronization tests.

## Status after Phase 1

| # | Recommendation | Status after Phase 1 | What that means now |
|---|---|---|---|
| 1 | Live escalation updates | Complete for the current QBO workflow | Dashboard, queues, and an open escalation converge on saved changes through the shared case channel and authoritative HTTP reloads. |
| 2 | Background-work progress | Partial | Knowledge completion/failure is live. Evidence-recovery progress and several request-scoped streams deliberately retain their current polling or SSE transport. |
| 3 | Live agent and chat activity | Partial, hardened | Existing room and agent-session streaming remains. The shared client now rejects duplicate and older sequenced events, but Phase 1 does not replace healthy SSE streams. |
| 4 | Live knowledge lifecycle | Complete for escalation-linked knowledge | Creation, generation, review state, publication, retraction, deletion, and background failure signals reach the dashboard, Knowledge Review queue, and open detail. |
| 5 | Live health changes | Partial | Connection health for case updates is truthful and actionable. Wider agent/provider health push conversion remains deferred until the server owns trustworthy change events. |
| 6 | Actionable notifications | Complete for important case/knowledge transitions | Important changes are grouped, deduplicated, and link directly to the case; routine field updates stay quiet. |
| 7 | Multi-tab consistency | Complete for the case workflow | Multiple tabs receive the same saved escalation and knowledge events and refetch authoritative records. |
| 8 | Connection truth and recovery controls | Complete for shared case surfaces | Live, syncing, reconnecting, offline, and paused states are visible; heartbeat, jitter, offline pause, and manual retry are implemented. |
| 9 | Missed-event recovery | Complete within one server process | Reconnect resumes from a per-subscription cursor, and an expired/ahead cursor forces an authoritative snapshot. A multi-instance deployment still needs a shared broker and shared event history. |
| 10 | Presence and edit-conflict awareness | Partial; presence deferred | Unsaved knowledge text is protected and never silently overwritten. Multi-user presence, soft locks, and field-level/version-aware merging remain future work. |

## Verification evidence — 2026-07-23

- Focused WebSocket/model checks passed: 11 server tests and 9 client tests.
- Production client build passed.
- Testing capability map passed with 12 capabilities. Its eight previously known critical browser-evidence gaps remain visible.
- The first `verify:core` run exposed a post-write knowledge-event classifier defect. After the fix, all nine affected knowledge/recovery files passed; a targeted rerun passed 182 of 183 tests, with only the unrelated pre-existing triage provenance assertion remaining.
- `verify:qbo` ran the complete client and server groups after that fix. The client group passed and 112 of 113 server files passed; only `test/triage-failover.test.js` failed on its pre-existing `backup` versus `fallback` assertion. This work does not touch that code or test.
- QBO stress slices for escalation-domain, image-intake-and-parse, and main-chat passed. The client-surfaces slice was **incomplete**, not failed: `agent-browser open` timed out after 15 seconds while opening its isolated local Chat page.
- Structured summaries: `test-results/app-check/2026-07-23T07-48-42-178Z-27c78a16/summary.json` and `test-results/app-check/2026-07-23T07-56-08-123Z-cfb4a04e/summary.json`.

## Deliberately remaining after Phase 1

- Evidence-recovery polling conversion and wider background-work progress channels.
- Agent/provider health push conversion where the server does not already own a trustworthy state-change event.
- Presence, soft edit locks, and version-aware conflict resolution.
- Broad replacement of healthy SSE request streams.
- Browser-run confidence remains separate from component/server proof and must stay marked incomplete when browser transport or a live runtime is unavailable.
- Replay history is process-local. A future multi-instance deployment needs a shared event broker and shared replay store before cross-instance delivery can be claimed.
