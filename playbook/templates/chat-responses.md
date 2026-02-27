# Chat-Ready Response Templates

These are short, copy-paste-ready responses for inserting directly into a chat conversation with a phone agent. For full case documentation, use the detailed templates (escalation-response.md, needs-investigation.md, etc.).

---

## Resolved — Standard Fix

```
Hi [AGENT NAME],

Here's what's going on and how to fix it:

**Issue:** [1 sentence description]
**Root cause:** [what went wrong]

**Steps to walk the customer through:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**What to tell the customer:** "[plain language explanation they can hear]"

The fix should take effect [immediately / on next payroll run / within 24 hours]. Let me know if you hit any issues.
```

## Resolved — Known Bug

```
Hi [AGENT NAME],

This is a known QBO issue that Intuit is aware of. Here's what to tell the customer:

**What's happening:** [brief bug description]
**Who's affected:** [scope]
**Workaround:** [steps, or "No workaround available at this time"]
**Expected fix:** [timeline if known, or "No ETA from Intuit yet"]

**Suggested script for the customer:** "This is a known issue that our engineering team is actively working on. [Workaround explanation if available]. We apologize for the inconvenience and will notify you when the fix is deployed."

I've documented this on our end. No further action needed from you unless the customer calls back.
```

## Needs More Info

```
Hi [AGENT NAME],

I need a bit more info to diagnose this. Can you check with the customer:

1. [Question 1]
2. [Question 2]
3. [Question 3]

If possible, also [take a screenshot of X / check Y in Settings / try Z].

Send me what you find and I'll have an answer for you right away.
```

## Needs Investigation (Going Offline)

```
Hi [AGENT NAME],

This one needs some offline investigation. Here's what I can tell you so far:

**Initial assessment:** [what you think might be happening]
**What I need to check:** [what you're going to investigate]

**What to tell the customer:** "Our specialist is reviewing your account and will follow up within [24-48 hours / by end of day]. In the meantime, [interim workaround if any / no action needed]."

**Best callback number:** [confirm with agent]
**Preferred callback time:** [confirm with agent]

I'll message you as soon as I have an answer.
```

## Workaround Available

```
Hi [AGENT NAME],

The ideal fix for this isn't available right now, but here's a workaround that gets the customer unblocked:

**Workaround steps:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Important:** This workaround [limitation — e.g., "needs to be done each time" / "only works for new transactions" / "doesn't fix the underlying data"]. The permanent fix requires [what needs to happen].

**What to tell the customer:** "[plain language explanation of the workaround and why it's temporary]"
```

## Escalating Further

```
Hi [AGENT NAME],

This needs to go to [Intuit Payroll / Intuit Billing / Intuit Engineering / my supervisor]. Here's why:

**Reason:** [why this is beyond our scope]
**What I've already tried:** [brief summary]

**What to tell the customer:** "I'm bringing in our [specialist team / engineering team] to resolve this. They will [call back within X hours / have this fixed within X days]. Your case number is [NUMBER]."

I'll follow up with you when I hear back from [team]. Case #[NUMBER] is open.
```

## Quick Answer (Simple How-To)

```
Hi [AGENT NAME],

Quick answer: [direct instruction]

**Navigation:** [exact QBO path, e.g., "Gear icon > Account and Settings > Advanced > Accounting"]

[1-2 sentences of context if needed]

Let me know if they need anything else!
```

## Cannot Reproduce

```
Hi [AGENT NAME],

I tested this on my end and the feature is working correctly. This could mean:
- It was a temporary issue that's already resolved
- It might be specific to their browser or device
- Their specific data might trigger the issue

**Ask the customer to try:**
1. Clear browser cache for intuit.com
2. Try in an incognito/private window
3. Try a different browser

If it happens again, have them [take a screenshot including the URL bar / note the exact time / save the error message] and call back. That will help us catch it while it's active.
```
