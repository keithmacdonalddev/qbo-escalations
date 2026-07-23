# Live Case and Knowledge Updates

## What the user gains

Escalation lists, an open escalation, and its related Knowledge Review state now refresh automatically after another tab, chat workflow, background draft, or server route saves a change. A quiet **Live** indicator confirms that updates are connected. If the connection is interrupted, the indicator changes to **Reconnecting**, **Offline**, or **Updates paused** and offers a retry instead of silently implying that the screen is current.

Important background knowledge completions and failures can show one deduplicated notice with an **Open case** action. Routine field changes stay quiet.

If a knowledge draft changes elsewhere while the user has unsaved review text, the app keeps the local text and offers an explicit **Replace with latest** action. It does not silently overwrite the in-progress review.

## Product boundary

The existing HTTP routes still own create, edit, status, approval, publication, and deletion commands. The WebSocket—a persistent connection used for live updates—only reports successful saved changes. The client then reloads the authoritative record through the existing HTTP API.

SSE streams remain in place for request-scoped response streaming where they already work well. Phase 1 does not replace transports merely to make the architecture uniform.

## Server contract

- Shared path: `/api/realtime`
- Channel: `case-workflow`
- Subscription key:
  - `all` for dashboard and queue changes
  - one escalation ObjectId for an open case
- Initial subscription: `snapshot` event requiring an authoritative HTTP refresh
- Reconnect within retained history: ordered events after the client’s `since` cursor
- Reconnect outside retained history or after a server sequence reset: authoritative `snapshot` with `resyncRequired: true`
- Retention: the latest 500 case-domain events in process memory

Case events contain identifiers, an action, changed field names, a timestamp, a sequence, a stable event ID, a safe summary, and the saved record revision. They do not carry the full case or knowledge document.

Successful writes are observed after Mongoose confirms the save/update/delete. This covers the main routes plus chat persistence, linking, background knowledge drafting, management tools, and evidence recovery without requiring every caller to remember a separate broadcast step. Failed validation does not publish a success event.

Realtime publication is best-effort after persistence: a notification-classification or delivery defect is logged but cannot turn an already-saved database write into an HTTP failure. The next successful event, reconnect, initial subscription, or manual retry still converges through an authoritative HTTP reload.

## Connection and ordering behavior

The shared browser client:

- reuses one socket for multiple mounted subscribers;
- reconnects with capped exponential delay and jitter;
- resubscribes from each channel cursor;
- removes duplicate event IDs and older/non-increasing sequenced events;
- accepts an authoritative cursor reset when replay is no longer possible;
- sends application pings and reconnects when the server stops answering;
- pauses retries while the browser reports that the device is offline;
- supports a user-triggered retry without waiting for the current cooldown.

Dashboard reloads are guarded so an older HTTP response cannot overwrite a newer request’s state.

## Access boundary

The handshake preserves the existing same-origin policy and rejects unapproved cross-origin connections. The realtime server retains a per-channel authorization hook for future protected channels.

Escalation and knowledge read routes currently use the app's existing deployment boundary, so the case-workflow channel intentionally uses that same boundary. Anonymous feedback continuity applies only to `/api/ticket-snitch/reporting`; it neither protects nor authorizes realtime case data. If those HTTP routes become protected later, the channel must enable the matching authenticated-user requirement in the same change.

## Deliberate Phase 1 gaps

- No trusted real-browser multi-tab run has yet proved the full create/change/disconnect/replay journey.
- Presence and soft edit locks are not implemented.
- Evidence-recovery progress still polls while a recovery operation is active.
- Agent/provider health polling remains where there is no proven server-side state-change source.
- Existing room, agent-session, workspace-monitor, live-call, and SSE behavior remains in place.
- The bounded event sequence and replay history are local to one server process. Horizontal multi-instance deployment requires a shared broker and replay store before cross-instance consistency is guaranteed.

These gaps are also recorded in `TODOS/websocket-quality-of-life-roadmap.md` and `testing/app-capabilities.json` so incomplete evidence cannot be mistaken for completion.

## Runtime note

The server and client must be restarted by the user after pulling or applying this code so the new channel and browser bundle are loaded. Coding agents must not restart the user’s persistent services without explicit permission.
