# QBO Escalation Assistant — App Intent Research

_Compiled: 2026-03-19 9:34 PM_

---

## 1. App Purpose

This is a **back-office decision support tool** for a QuickBooks Online (QBO) escalation specialist. The user does NOT talk to customers directly. Phone agents (front-line support reps) have the customer on the line and escalate to the user when they can't solve a problem. The user receives the escalation (typically as a screenshot of a DM from the phone agent), diagnoses it with AI assistance, and sends back actionable instructions the phone agent can relay to the customer.

**Core value proposition:** Speed + accuracy under pressure. The phone agent has a customer waiting on the line. Every second the user spends diagnosing = the customer is on hold.

The app wraps Claude AI (via CLI subprocess, not API key — uses the user's Max subscription) with deep QBO domain knowledge to turn raw escalation screenshots into structured diagnoses with step-by-step resolution paths.

---

## 2. User Workflow (Detailed)

### Primary Loop (80% of daily work)
1. **Receive escalation** — Phone agent DMs the user (screenshot or text) via internal Slack/Teams with a structured template containing: COID, MID, case number, client contact, what the customer is attempting, expected vs actual outcome, troubleshooting steps already tried, whether they tested on a test account.
2. **Upload to app** — User pastes/uploads the screenshot into the Chat view.
3. **AI parses the image** — Two-step process: (A) transcribe all visible text from the screenshot, (B) extract structured fields into a triage card (Agent, Client, Category, Severity, instant Read, immediate Action).
4. **AI diagnoses** — Using the playbook knowledge base (9 QBO categories: payroll, bank-feeds, reconciliation, permissions, billing, tax, invoicing, reports, technical), Claude provides: diagnosis, numbered steps for the agent, customer-facing explanation, recommended template, resolution note, and similar symptoms flag.
5. **INV cross-reference** — The system automatically checks whether the customer's issue matches a known Intuit investigation (INV-XXXXXX). If it matches, troubleshooting is skipped entirely and the agent is told to add the customer to the affected users list.
6. **User sends response back** — Copies the resolution or uses a chat-ready template to send instructions back to the phone agent.
7. **Escalation saved** — The parsed escalation is stored in MongoDB with full metadata, linked to the conversation.

### Secondary Workflows
- **INV Import** — User uploads screenshots from the #sitel-stcats-sbseg-articles Slack channel containing new INV entries. The app parses them and bulk-imports into the investigation database.
- **Follow-up conversations** — After initial triage, the phone agent may come back with "that didn't work" or "customer says X." The user continues the conversation with Claude for deeper diagnosis.
- **Playbook maintenance** — User can review and edit the QBO knowledge base categories (playbook editor).
- **Template management** — Chat-ready response templates for common scenarios (resolved, known bug, needs more info, workaround, escalating further, quick answer, cannot reproduce).
- **Gmail integration** — Multi-account Gmail inbox with smart folders, unsubscribe detection, tracker pixel shielding.
- **Calendar integration** — Google Calendar view within the app.
- **Analytics** — Dashboard showing escalation volumes, category breakdown, resolution rates, trends.
- **Investigations view** — Dedicated UI for managing INV entries (status, workaround, resolution, symptoms, affected count).
- **Model Lab** — Benchmark different AI models/providers against each other.
- **Workspace** — Agent-powered workspace combining Gmail, Calendar, and automated tasks.

---

## 3. Chat Agent Intent

The Claude AI assistant in this app is NOT a general-purpose chatbot. It is configured via a detailed system prompt (`playbook/system-prompt.md`) to be a **senior QBO escalation specialist**. Its behavior:

### What it does:
- **Extracts structured fields** from escalation screenshots (COID, MID, case number, category, severity)
- **Produces a triage card** as the very first output for image-based escalations — a 5-line speed read that gives the user an instant assessment
- **Diagnoses with specificity** — Names exact QBO features, settings, navigation paths ("Gear icon > Payroll Settings > Time Off Policies"), not vague suggestions
- **Cross-references INV investigations** — Checks the database for known Intuit bugs matching the symptoms
- **Provides chat-ready responses** — Formatted text the user can copy and send directly to the phone agent
- **Respects intent override** — If the user says "not an escalation" or sends INVs, it skips triage and follows the stated intent

### What it must NOT do:
- Generic fluff or preamble — the agent has a customer waiting
- Troubleshoot known INV issues — waste of time, the bug is already identified
- Guess when uncertain — must explicitly say "I need more information"
- Ignore subscription tier limitations — features vary by Simple Start / Essentials / Plus / Advanced

### Extended Thinking
The AI uses extended thinking (reasoning) for its internal deliberation (category classification, playbook cross-referencing, INV matching, confidence assessment) but keeps this hidden from the visible response. The visible response is concise and action-oriented.

---

## 4. Escalation Types & Categories

### Categories (from playbook)
| Category | Focus |
|----------|-------|
| **Payroll** | Vacation accruals, tax withholding, direct deposit, W-2/1099, payroll stuck processing |
| **Bank Feeds** | Connection failures, missing transactions, duplicate transactions, bank rule issues |
| **Reconciliation** | Balance discrepancies, unreconciled items, beginning balance mismatches |
| **Permissions** | User roles, access issues, master admin problems |
| **Billing** | Subscription changes, billing errors, cancellation issues |
| **Tax** | Sales tax rates, automated sales tax (AST), tax form filing |
| **Invoicing** | Invoice creation, recurring invoices, payment links, email delivery |
| **Reports** | Profit & Loss, Balance Sheet, custom reports, export failures |
| **Technical** | Browser issues, mobile app bugs, performance, login/access |

### Severity Levels
- **P1** — Cannot process payroll, cannot access QBO, data loss (immediate response)
- **P2** — Major feature broken (urgent — resolve within the call)
- **P3** — Minor feature issue (standard response)
- **P4** — How-to question, general guidance (standard — educate)

### INV Investigations
- Intuit's internal tracking for product bugs under engineering investigation
- Tracked by INV-XXXXXX number, with subject, agent, team, category, symptoms, affected count
- When an escalation matches a known INV: skip troubleshooting, tell agent to add customer to affected users list, provide workaround if available
- The inv-matcher service uses a 3-strategy approach: MongoDB text search, regex fallback, symptom array overlap, all scored by relevance with recency and trending boosts

---

## 5. Data Model

### Escalation
Core entity. Fields: COID, MID, case number, client contact, agent name, attempting to, expected outcome, actual outcome, troubleshooting steps, test account tried, category, status (open/in-progress/resolved/escalated-further), resolution, resolution notes, linked conversation ID, source (screenshot/manual/cli/chat), parse metadata with provider attempts and validation scores, screenshot paths and hashes.

### Investigation
INV entries. Fields: invNumber (unique), subject, agent name, team, reported date, category, status (new/in-progress/closed), workaround, resolution, symptoms array, affected count, last matched date.

### Conversation
Chat history. Fields: title, messages array (role, content, thinking, images, provider, mode, fallback info, usage tokens), linked escalation ID, system prompt hash, fork support.

### Other Models
- Template, ModelPerformance, PromptVersion, DevAgentLog, DevConversation, WorkspaceFeedback, WorkspaceBehaviorLog, WorkspaceAutoRule, WorkspaceBriefing, WorkspaceActivity, WorkspaceEntity, WorkspaceMemory, AiTrace, ParallelCandidateTurn, KnowledgeCandidate, UserPreferences, GmailAuth, UsageLog, Shipment, LabResult.

---

## 6. Provider Architecture

The app supports multiple AI providers through a provider registry and orchestration layer:
- **Modes:** single (one provider), fallback (try primary, fall back to alternate on failure), parallel (send to multiple providers simultaneously, display side-by-side)
- **Health tracking:** Records successes/failures per provider, uses health status to reorder fallback sequence
- **Usage logging:** Tracks input/output tokens, costs, model info per request
- **AI Traces:** Full request lifecycle tracing for debugging and usage dashboards

---

## 7. What Makes a Good Feature for This App

Based on the deep research, a good feature for this app must:

1. **Help the user respond to phone agents faster or more accurately** — This is the #1 metric. The customer is on the line.
2. **Fit the back-office advisor workflow** — The user reads escalations, diagnoses, and types responses. They don't talk to customers.
3. **Leverage the domain knowledge** — The playbook, INV investigations, templates, and escalation history are the app's competitive advantage over generic AI chat.
4. **Be genuinely surprising** — 169 features have already been suggested. Dev tooling, micro-polish, and obvious variations are exhausted.
5. **Scale with usage** — The more escalations handled, the more valuable the feature becomes.
6. **Not be about "right vs wrong"** — Escalations are problem-solving, not debates. The rejected #170 tried to make AI models disagree, but that doesn't help solve a customer's broken bank feed.

### Anti-patterns (what to avoid):
- Dev tooling (flame bars, waterfalls, error pipelines — already built)
- Ambient/aesthetic features (sound mixers, typing sounds — nice but don't help work)
- Generic AI features (parallel responses, debate modes — not domain-specific)
- Micro-polish (tooltip tweaks, animation refinements — too small)

### Sweet spot:
Features that **make the user's institutional knowledge compound** — things that get smarter the more escalations are processed, that surface patterns humans would miss, that turn individual case resolutions into team-wide capability.

---

## 8. Revised Feature #170 Proposal

### Shift Debrief — Auto-Generated End-of-Shift Intelligence Report

**Concept:** At the end of the user's work session (triggered manually via a button, or auto-suggested after 4+ hours of activity), the app generates a comprehensive intelligence report summarizing everything that happened during the shift:

**What it includes:**

1. **Escalation Summary** — How many handled, by category, average resolution time, which were INV matches vs fresh troubleshooting.

2. **Emerging Pattern Detection** — "3 payroll escalations today all involved vacation accrual after upgrading to QBO Advanced. This is NOT a tracked INV yet. Consider flagging to your lead." The AI cross-references today's escalations against each other and against historical patterns to surface potential new product issues before they become official INVs.

3. **Playbook Gap Report** — If the AI had to go outside the playbook to resolve an issue (low confidence, no matching category section, novel symptoms), it flags: "The playbook's bank-feeds section doesn't cover the new Chase OAuth2 reconnection flow. Here's a draft addition based on today's resolution." Auto-generates playbook improvement suggestions from real cases.

4. **Agent Performance Snapshot** — Which phone agents escalated what. "Agent Sarah Chen escalated 4 times today — 3 were permissions issues. She might benefit from the permissions quick-reference." Helps the user spot which agents need coaching on which topics (the user advises agents — this directly supports that role).

5. **Unresolved Handoff Notes** — Any escalations still open get a handoff summary: what was tried, where it's stuck, what the next person should try first. Perfect for shift changes or picking up tomorrow where you left off.

6. **INV Trend Alert** — "INV-147963 was matched 6 times today across the team. Affected count jumped from 12 to 18. This investigation may be accelerating." Surfaces INVs that are heating up so the user can proactively prepare responses.

**Why this fits:**
- Directly supports the back-office advisor role (coaching agents, tracking patterns, playbook maintenance)
- Gets smarter with more data — the more escalations processed, the richer the debrief
- Surfaces things humans miss — cross-case pattern detection is superhuman
- Turns individual case work into institutional knowledge (playbook suggestions, agent coaching insights)
- The "emerging pattern" detection could catch new QBO bugs before Intuit's own INV system does
- Handoff notes solve a real pain point for shift changes
- It's genuinely surprising — no escalation tool does this

**Complexity:** High (requires aggregation across escalations, conversations, INV matches, playbook gap analysis, and AI summarization)
