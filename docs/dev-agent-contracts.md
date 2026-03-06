# Dev Agent System -- Integration Contracts

This document defines the dependency graph, stability contracts, and
interface rules that govern the 15 hooks composing the dev agent subsystem.
Every hook lives in `client/src/hooks/` and is orchestrated by
`client/src/context/DevAgentContext.jsx`.

---

## Dependency Graph

```
Layer 0  (Foundation -- no cross-hook deps)
  useAgentActivityLog        -> { entries, log, clear }
  useTabLeadership           -> { isLeader, tabId, broadcastStatus, onStatusUpdate }
  useBackgroundConversations -> { channels, getConversationId, getTurns,
                                  setConversationId, incrementTurns,
                                  clearChannel, clearAll }

Layer 1  (Transport -- depends on Layer 0)
  useBackgroundAgent
    consumes: useBackgroundConversations (internal)
    accepts:  { log }
    returns:  { sendBackground, bgStreaming, bgQueue, lastResults, channels }

  useDevChat
    accepts:  { aiSettings, log }
    returns:  { messages, sendMessage, isStreaming, conversationId,
                sessionId, conversations, provider, mode, fallbackProvider,
                reasoningEffort, streamingText, streamProvider, toolEvents,
                fallbackNotice, error, responseTime, ...setters }

Layer 2  (Detection -- depends on Layer 1)
  useAutoErrorReporter
    accepts:  { sendBackground, isLeader, log }
    returns:  { circuitTrips, circuitMax, circuitWindow, isActive }

  useDevToolsBridge
    accepts:  { enabled, isLeader, sendBackground, log }
    returns:  void (side-effect only)

  useClientHealthMonitor
    accepts:  { enabled, isLeader, sendBackground, log }
    returns:  void (side-effect only)

  useClientHealthExtended
    accepts:  { enabled, isLeader, sendBackground, log }
    returns:  void (side-effect only)

  useServerErrors
    accepts:  { enabled, isLeader, sendBackground, log }
    returns:  void (side-effect only)

  useWaterfallInsights
    accepts:  { enabled, isLeader, sendBackground, log }
    returns:  void (side-effect only)

Layer 3  (Orchestration -- depends on Layer 1+2)
  useDevTaskQueue
    accepts:  { isStreaming, bgStreaming, sendBackground, sendMessage, log }
    returns:  { queue, enqueue, dequeue, clearQueue, paused, setPaused,
                queueDepth, processing, canSendBackground,
                canSendForeground, rateBudget }

  useCodeReview
    accepts:  { enabled, isLeader, enqueue, log }
    returns:  void (side-effect only)
```

### Wiring order inside DevAgentProvider

```
1. activityLog  = useAgentActivityLog()
2. devChat      = useDevChat({ aiSettings, log: activityLog.log })
3. bgAgent      = useBackgroundAgent({ log: activityLog.log })
4. tabLeadership = useTabLeadership({ log: activityLog.log })
5. initTelemetry(activityLog.log, bgAgent.sendBackground)
6. errorReporter = useAutoErrorReporter({ sendBackground, isLeader, log })
7. useDevToolsBridge({ enabled, isLeader, sendBackground, log })
8. taskQueue    = useDevTaskQueue({ isStreaming, bgStreaming, sendBackground, sendMessage, log })
9. useClientHealthMonitor({ enabled, isLeader, sendBackground, log })
10. useClientHealthExtended({ enabled, isLeader, sendBackground, log })
11. useServerErrors({ enabled, isLeader, sendBackground, log })
12. useWaterfallInsights({ enabled, isLeader, sendBackground, log })
13. useCodeReview({ enabled, isLeader, enqueue, log })
```

---

## Stability Contracts

Functions that are passed between hooks MUST have a stable reference
identity (same `===` across renders) to prevent cascading effect
re-runs and re-renders.

| Function | Provider Hook | Stable? | Mechanism |
|----------------|---------------------------|---------|--------------------------------------|
| log | useAgentActivityLog | YES | useCallback with [] deps |
| sendBackground | useBackgroundAgent | YES | useCallback with [] deps + ref bridge for bgConvs and log |
| sendMessage | useDevChat | YES | useCallback with stable-only deps (loadConversations, setProvider) + logRef |
| enqueue | useDevTaskQueue | YES | useCallback with [] deps + logRef |
| isLeader | useTabLeadership | N/A | Boolean state value (not a function) |
| broadcastStatus| useTabLeadership | YES | useCallback with [] deps |
| onStatusUpdate | useTabLeadership | YES | useCallback with [] deps |

### Ref-bridge pattern

When a stable callback needs access to values that change (e.g. channel
state, log function), it reads them via refs instead of closing over
them in the dependency array:

```js
const bgConvsRef = useRef(bgConvs);
bgConvsRef.current = bgConvs;

const sendBackground = useCallback(async (channel, msg) => {
  const convs = bgConvsRef.current; // always latest
  // ...
}, []); // empty deps = stable forever
```

This pattern is used in:
- `useBackgroundAgent` -- bgConvsRef, logRef
- `useDevChat` -- logRef (plus existing providerRef, modeRef, etc.)
- `useDevTaskQueue` -- logRef, sendBackgroundRef, sendMessageRef

---

## Null Safety Contracts

Every hook that receives external functions MUST guard against them
being undefined or null before use.

### Guard patterns in use

**Effect-level guard (early return):**
All Layer 2 detection hooks guard at the top of their useEffect:
```js
if (!enabled || !isLeader || typeof sendBackground !== 'function') return;
```

**Call-site guard (optional chaining):**
Logging always uses optional chaining since log may be undefined:
```js
log?.({ type: 'bg-send', message: '...' });
```

**Type-checked guard:**
Critical function parameters use `typeof` checks:
```js
if (typeof sendBackground !== 'function') return;
if (typeof enqueue !== 'function') return;
```

### Per-hook guard inventory

| Hook | sendBackground guard | log guard | Other guards |
|--------------------------|-------------------------------|-----------------|------------------------------|
| useAutoErrorReporter | typeof check in handleErrors | optional chain | isLeader check |
| useDevToolsBridge | typeof check in useEffect | optional chain | enabled + isLeader |
| useClientHealthMonitor | typeof check in useEffect | optional chain | enabled + isLeader |
| useClientHealthExtended | typeof check in useEffect | optional chain | enabled + isLeader |
| useServerErrors | typeof check in useEffect | optional chain | enabled + isLeader |
| useWaterfallInsights | optional chain in alertEndpoint| optional chain | enabled + isLeader |
| useCodeReview | N/A (uses enqueue) | optional chain | typeof enqueue + isLeader |
| useDevTaskQueue | ref + optional chain | ref + optional chain | N/A |

---

## Rules

1. **No hook may call `useDevAgent()`** -- all dependencies are passed
   as props from DevAgentProvider to prevent circular dependencies.

2. **Core hooks (Layer 0-1) must never throw during render.** They
   guard all external calls with try/catch or optional chaining.

3. **Monitor hooks (Layer 2-3) are wrapped by the effect boundary** --
   they can fail gracefully without crashing the provider. Each has
   an early-return guard and internal try/catch around risky operations.

4. **All functions passed between hooks must be stable** -- use
   `useCallback` with empty deps + ref-bridge pattern for mutable state.

5. **All hook parameters must be null-checked before use** -- either
   via `typeof fn === 'function'` at effect top, or optional chaining
   at call sites.

6. **Layer 2 hooks are leader-only** -- only one browser tab runs
   detection/monitoring to prevent duplicate background messages.

7. **Cleanup is mandatory** -- every useEffect that subscribes,
   patches globals, or starts timers must clean up in its return
   function.

8. **Feedback loop prevention** -- any hook that captures errors must
   filter out errors originating from `/api/dev/` to prevent
   self-referential error cascades.

---

## Adding a New Hook

1. Determine the layer (0-3) based on dependencies.
2. Accept dependencies as named parameters -- never import useDevAgent.
3. If accepting `sendBackground`, `log`, or `enqueue`, do NOT add them
   to useCallback deps. Use the ref-bridge pattern.
4. Add `typeof fn !== 'function'` guard at the top of any useEffect
   that calls an external function.
5. Use `log?.()` optional chaining for all activity log calls.
6. If the hook is a monitor (Layer 2), add `enabled` and `isLeader`
   parameters with early-return guards.
7. Register the hook call in DevAgentProvider in the correct layer
   position.
8. Update this document with the new hook's layer, interface, and
   guard inventory.
