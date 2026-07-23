# Live Work and Attention Center

## What the user gains

The app header now contains one **Live work** control that remains available on every screen. It answers two practical questions without requiring the user to stay on Chat:

1. What is the agent team doing now?
2. What is waiting for me to review or decide?

Opening the control shows current work, the responsible agent, the current plain-language phase, recent completion or failure, and direct **Open** or **Review** actions. A QBO escalation run also shows the actual Image Parser → INV Search Agent → Triage Agent → QBO Assistant handoff. This is status derived from real workflow stages, not generated reasoning or simulated progress.

The sidebar now has direct, live destinations for:

- **Attention**: saved open items that still need review;
- **Knowledge**: saved knowledge-review items;
- **Sessions**: running agent sessions;
- **Chat**: active QBO or chat work.

Counts cap visually at `99+`, remain readable to assistive technology, and link to a screen where the user can act.

## Two kinds of truth

The feature deliberately separates durable attention from transient activity.

### Needs your attention is saved

The Attention inbox uses `EscalationAttentionItem` records in MongoDB. These items survive navigation, browser refreshes, socket reconnects, and server restarts. They remain until the existing workflow resolves, dismisses, or splits them. The global center only previews the highest-priority items; `#/attention` remains the authoritative full queue.

Every successful Attention model save or single-record update publishes the same `attention.changed` signal, including writes from escalation workflows, knowledge review, the Knowledge Agent, and agent identity monitoring. Bulk manual updates publish one bounded aggregate signal. The client responds by reloading the queue through HTTP, so complicated filters and populated record links still come from the database rather than from a partial socket payload.

### Running and recent work is live process state

AI requests and workspace-agent sessions already have honest in-process runtimes. The Live Work Center converts their significant phase changes into safe work summaries. It does not publish every streamed text chunk, raw prompt, response, provider error, stack trace, or customer-sensitive field.

Current and recently finished work is intentionally process-local and bounded. It may disappear after a server restart or after the 30-minute recent-work window. That is correct for activity status. Work that genuinely requires a lasting human decision belongs in a saved Attention record instead.

The exact four-agent QBO handoff is reported by the already-mounted Chat V5 workflow in the originating browser tab. Other tabs still receive server-confirmed active AI/session work and saved Attention counts, but they do not invent client-only stage detail the server has never observed.

## Realtime contract

- Shared socket: `/api/realtime`
- Channel: `work-center`
- Scope key: `all`
- Initial event: authoritative `snapshot` containing bounded current/recent work
- Live events:
  - `work.changed`
  - `work.removed`
  - `attention.changed`
- Reconnect: ordered replay after the subscription cursor
- Replay gap: a new authoritative work snapshot with `resyncRequired: true`
- Event retention: latest 500 events in server memory
- Work retention: at most 80 current/recent items; terminal items expire after 30 minutes

The channel uses the existing shared socket, same-origin handshake protection, optional app-auth context, heartbeat, jittered reconnect, event-ID deduplication, sequence ordering, and subscription cleanup. It does not open a second WebSocket.

Realtime publication is best-effort after a successful database write. A listener or publication error cannot roll back or turn the saved HTTP operation into a failure. On reconnect, snapshot, or the next event, the client reconverges on saved Attention data through the existing HTTP endpoint.

## Connection behavior

The center displays **Live**, **Reconnecting**, **Offline**, or **Updates paused**. When updates cannot be confirmed, it preserves the last confirmed work and Attention information, labels it honestly, and provides **Retry**. It never clears the useful last-known state merely because the socket is reconnecting.

The Attention tab keeps its existing request-generation guard, so an older HTTP response cannot overwrite a newer request. A live Attention signal triggers an authoritative background reload; resolved and dismissed records therefore leave an open queue without a manual refresh.

## Product boundary

This feature is a reusable application-shell view of coordinated work. QBO escalation is its first detailed workflow, but the event and UI contracts accept future work kinds and agent teams.

It does not create a new job system, replace healthy request-scoped SSE streams, expose chain-of-thought, add multi-user presence, or claim durable work history. Existing case-workflow, room, agent-session, workspace-monitor, chat, and SSE paths remain in place.

## Verification and current evidence gap

Focused tests cover safe summaries, saved Attention post-write events, failed validation, bounded event history, snapshot/live/replay behavior, scope validation, cleanup, sidebar/context counts, stale-state preservation, the global panel, and handoff rendering. The client production build is also part of closeout.

A trusted real-browser journey is still required to prove the complete visual flow on a running app: start a QBO run, navigate away, see the global indicator, receive a saved Attention item, follow a direct action, and observe another tab update. Coding agents must not start or restart the user’s persistent app merely to obtain that evidence. Until the existing runtime and browser transport allow the journey, browser confidence remains incomplete rather than being reported as passed.

## Runtime note

The server and client must be restarted by the user after this change is pulled or applied so the new channel and browser bundle are loaded. The coding-agent session does not restart persistent services without explicit permission.
