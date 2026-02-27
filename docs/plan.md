# QBO Escalation Assistant - Implementation Plan

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Claude Integration Decision](#claude-integration-decision)
3. [MongoDB Schema Designs](#mongodb-schema-designs)
4. [API Route Definitions](#api-route-definitions)
5. [Component Hierarchy](#component-hierarchy)
6. [Feature Breakdown](#feature-breakdown)
7. [File-by-File Creation Order](#file-by-file-creation-order)
8. [Phase Breakdown](#phase-breakdown)
9. [Key Design Decisions](#key-design-decisions)

---

## Architecture Overview

```
C:\Users\NewAdmin\Desktop\PROJECTS\qbo-escalations\
├── CLAUDE.md                          # Project instructions for Claude Code CLI
├── .claude/
│   ├── memory/                        # Auto-memory for CLI sessions
│   └── rules/                         # Rules for CLI sessions
├── playbook/
│   ├── categories/
│   │   ├── payroll.md
│   │   ├── bank-feeds.md
│   │   ├── reconciliation.md
│   │   ├── permissions.md
│   │   ├── billing.md
│   │   ├── tax.md
│   │   ├── invoicing.md
│   │   └── general.md
│   ├── templates/
│   │   ├── acknowledgment.md
│   │   ├── resolution.md
│   │   ├── escalation-up.md
│   │   └── follow-up.md
│   └── edge-cases.md
├── client/                            # Vite + React (ESM)
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── App.css
│       ├── components/
│       │   ├── Chat.jsx               # Main chat interface with streaming
│       │   ├── ChatMessage.jsx         # Individual message bubble
│       │   ├── ImageUpload.jsx         # Drag-and-drop image upload
│       │   ├── EscalationDashboard.jsx # List + filter all escalations
│       │   ├── EscalationDetail.jsx    # Single escalation full view
│       │   ├── EscalationForm.jsx      # Manual entry / edit form
│       │   ├── EscalationCard.jsx      # Summary card for list view
│       │   ├── PlaybookEditor.jsx      # Browse + edit playbook entries
│       │   ├── PlaybookViewer.jsx      # Read-only playbook view in chat context
│       │   ├── TemplateLibrary.jsx     # Response template browser
│       │   ├── TemplateCard.jsx        # Individual template with copy button
│       │   ├── Analytics.jsx           # Charts + pattern tracking
│       │   ├── Sidebar.jsx             # Navigation sidebar
│       │   ├── ConversationList.jsx    # Chat history list
│       │   └── ConfirmModal.jsx        # Shared confirmation dialog
│       ├── hooks/
│       │   ├── useChat.js              # Chat state + SSE streaming
│       │   ├── useEscalations.js       # Escalation CRUD + polling
│       │   ├── usePlaybook.js          # Playbook read/write
│       │   ├── useTemplates.js         # Template CRUD
│       │   └── useAnalytics.js         # Analytics data fetching
│       └── api/
│           └── api.js                  # Fetch wrapper for all /api/* calls
├── server/                            # Express (CommonJS)
│   ├── package.json
│   ├── .env
│   ├── .env.example
│   └── src/
│       ├── index.js                   # Entry point: Express app + server start
│       ├── routes/
│       │   ├── chat.js                # Claude chat + SSE streaming
│       │   ├── escalations.js         # Escalation CRUD + search
│       │   ├── playbook.js            # Playbook file read/write
│       │   ├── templates.js           # Template CRUD
│       │   └── analytics.js           # Aggregation queries
│       ├── models/
│       │   ├── Escalation.js          # Escalation Mongoose model
│       │   ├── Conversation.js        # Conversation Mongoose model
│       │   └── Template.js            # Template Mongoose model
│       ├── services/
│       │   └── claude.js              # Claude CLI subprocess wrapper
│       └── lib/
│           ├── playbook-loader.js     # Reads playbook/ dir into context string
│           └── escalation-parser.js   # Regex fallback for template parsing
└── docs/
    └── plan.md                        # This file
```

### System Diagram

```
┌──────────────────────────────────────────────────┐
│              React Client (Vite)                  │
│                                                   │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │   Chat   │ │  Escalation  │ │   Playbook   │ │
│  │ Interface │ │  Dashboard   │ │   Editor     │ │
│  └────┬─────┘ └──────┬───────┘ └──────┬───────┘ │
│       │              │                │          │
│  ┌────┴──────────────┴────────────────┴───────┐  │
│  │          api.js (fetch wrapper)            │  │
│  └────────────────────┬───────────────────────┘  │
└───────────────────────┼──────────────────────────┘
                        │ /api/* proxy (Vite -> :4000)
┌───────────────────────┼──────────────────────────┐
│           Express API Server (:4000)              │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │  Routes: chat, escalations, playbook,      │  │
│  │          templates, analytics              │  │
│  └──────────┬────────────┬────────────────────┘  │
│             │            │                        │
│  ┌──────────┴──┐   ┌────┴────────────────────┐  │
│  │   MongoDB   │   │  Claude Service          │  │
│  │   (Atlas)   │   │  (CLI subprocess)        │  │
│  │             │   │                          │  │
│  │ Escalation  │   │  claude -p               │  │
│  │ Conversation│   │  --output-format         │  │
│  │ Template    │   │    stream-json           │  │
│  └─────────────┘   │  + playbook context      │  │
│                     └────────────┬────────────┘  │
└──────────────────────────────────┼────────────────┘
                                   │
                        ┌──────────┴──────────┐
                        │   playbook/         │
                        │   categories/*.md   │
                        │   templates/*.md    │
                        └─────────────────────┘
```

### SSE Streaming Flow (Chat)

```
Client                    Express                   Claude CLI
  │                          │                          │
  │  POST /api/chat          │                          │
  │  { message, images,      │                          │
  │    conversationId }      │                          │
  │────────────────────────> │                          │
  │                          │  spawn: claude -p        │
  │                          │  --output-format         │
  │                          │    stream-json           │
  │                          │────────────────────────> │
  │  SSE: Content-Type:      │                          │
  │  text/event-stream       │                          │
  │ <──────────────────────  │                          │
  │                          │  stdout: JSON lines      │
  │  data: {"type":"delta",  │ <──────────────────────  │
  │   "text":"..."}          │                          │
  │ <──────────────────────  │                          │
  │  ...more deltas...       │  ...more lines...        │
  │ <──────────────────────  │ <──────────────────────  │
  │                          │                          │
  │  data: {"type":"done",   │  process exit            │
  │   "fullText":"..."}      │ <──────────────────────  │
  │ <──────────────────────  │                          │
  │                          │  Save to MongoDB         │
  │                          │────> Conversation.save() │
```

---

## Claude Integration Decision

### Recommendation: Claude CLI Subprocess (`claude -p`)

The user has a Claude Max subscription. The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) **requires an API key** and explicitly does not support Max subscription billing (as of February 2026). Therefore, the CLI subprocess approach is the correct choice.

#### How It Works

The Express server spawns `claude` as a child process using Node.js `child_process.spawn()`. The CLI binary authenticates via the user's existing Max subscription OAuth session (already logged in on this machine).

```javascript
// server/src/services/claude.js
const { spawn } = require('child_process');

function queryClaudeCLI({ prompt, systemPrompt, images = [] }) {
  const args = [
    '-p', prompt,          // print mode (non-interactive, single prompt)
    '--output-format', 'stream-json',  // streaming JSON lines on stdout
    '--verbose',
  ];

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  // Images: pass as file paths via --image flag (if supported)
  // or encode as base64 data URIs in the prompt
  for (const imagePath of images) {
    args.push('--image', imagePath);
  }

  const proc = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  return proc; // caller reads proc.stdout for streaming JSON lines
}
```

#### Streaming JSON Line Format

Each line from `stdout` is a JSON object. Key message types:

| type | Description |
|------|-------------|
| `assistant` | Contains `message.content` array with text blocks |
| `result` | Final result with `result` text field |
| `system` | System messages (init, session info) |

#### Image Handling

The Claude CLI supports `--image <path>` for passing images. The Express server will:
1. Accept image uploads via `multipart/form-data`
2. Save images temporarily to `server/uploads/` (or a temp directory)
3. Pass file paths to `claude -p --image <path>`
4. Clean up temp files after the response completes

#### Playbook as System Prompt

The playbook loader reads all `.md` files from `playbook/categories/` and `playbook/templates/`, concatenates them into a structured system prompt, and passes it to `claude -p --system-prompt <text>`.

#### CLI Limitations and Mitigations

| Limitation | Mitigation |
|------------|------------|
| No native multi-turn in `-p` mode | Build conversation context ourselves: concatenate prior messages into the prompt |
| Process startup overhead (~1-2s) | Acceptable for escalation workflow; not a chatbot latency concern |
| Node.js spawning can stall (known bug #771) | Use `shell: true` on Windows; test and fall back to writing prompt to temp file + stdin pipe |
| No concurrent session state | Each request spawns a fresh process; conversation history is reconstructed from MongoDB |

#### Fallback: Agent SDK (if user obtains API key later)

If the user later gets an API key, switching to the Agent SDK is straightforward:

```javascript
// Future: server/src/services/claude.js (Agent SDK version)
const { query } = require('@anthropic-ai/claude-agent-sdk');

async function* queryClaudeSDK({ prompt, systemPrompt }) {
  for await (const message of query({
    prompt,
    options: {
      systemPrompt,
      allowedTools: [],  // no file access needed for chat
      permissionMode: 'bypassPermissions',
    }
  })) {
    yield message;
  }
}
```

The route handler abstraction layer (`services/claude.js`) makes this swap invisible to the rest of the app.

---

## MongoDB Schema Designs

### Escalation

```javascript
// server/src/models/Escalation.js
const escalationSchema = new mongoose.Schema({
  // --- Parsed from screenshot template ---
  coid:             { type: String, index: true, default: '' },
  mid:              { type: String, default: '' },
  caseNumber:       { type: String, index: true, default: '' },
  clientContact:    { type: String, default: '' },
  agentName:        { type: String, index: true, default: '' },

  // --- Escalation content ---
  attemptingTo:     { type: String, default: '' },   // "CX IS ATTEMPTING TO"
  expectedOutcome:  { type: String, default: '' },
  actualOutcome:    { type: String, default: '' },
  triedTestAccount: { type: String, enum: ['yes', 'no', 'unknown'], default: 'unknown' },
  tsSteps:          { type: String, default: '' },   // Troubleshooting steps already taken

  // --- Classification ---
  category: {
    type: String,
    enum: [
      'payroll', 'bank-feeds', 'reconciliation', 'permissions',
      'billing', 'tax', 'invoicing', 'reporting', 'inventory',
      'payments', 'integrations', 'general', 'unknown'
    ],
    default: 'unknown',
    index: true,
  },

  // --- Status tracking ---
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'escalated-further'],
    default: 'open',
    index: true,
  },
  resolution:       { type: String, default: '' },  // What fixed it
  resolutionNotes:  { type: String, default: '' },  // Additional context

  // --- Links ---
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
  },

  // --- Source ---
  source: {
    type: String,
    enum: ['screenshot', 'manual', 'cli'],
    default: 'manual',
  },
  screenshotPaths: [{ type: String }],  // Relative paths to uploaded images

  // --- Timestamps ---
  createdAt:   { type: Date, default: Date.now, index: true },
  resolvedAt:  { type: Date, default: null },
  updatedAt:   { type: Date, default: Date.now },
}, {
  timestamps: true,  // auto-manage createdAt + updatedAt
});

// Compound index for common search patterns
escalationSchema.index({ status: 1, createdAt: -1 });
escalationSchema.index({ category: 1, status: 1 });
escalationSchema.index({ agentName: 1, createdAt: -1 });

// Text index for full-text search across escalation content
escalationSchema.index({
  clientContact: 'text',
  attemptingTo: 'text',
  actualOutcome: 'text',
  tsSteps: 'text',
  resolution: 'text',
});
```

### Conversation

```javascript
// server/src/models/Conversation.js
const messageSchema = new mongoose.Schema({
  role:      { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content:   { type: String, required: true },
  images:    [{ type: String }],  // Relative paths to uploaded images
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  title:         { type: String, default: 'New Conversation' },
  messages:      [messageSchema],
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    default: null,
    index: true,
  },
  // System prompt snapshot (so we know what context Claude had)
  systemPromptHash: { type: String, default: '' },
  createdAt:     { type: Date, default: Date.now, index: true },
  updatedAt:     { type: Date, default: Date.now },
}, {
  timestamps: true,
});
```

### Template

```javascript
// server/src/models/Template.js
const templateSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: [
      'payroll', 'bank-feeds', 'reconciliation', 'permissions',
      'billing', 'tax', 'invoicing', 'reporting', 'inventory',
      'payments', 'integrations', 'general',
      'acknowledgment', 'follow-up', 'escalation-up',
    ],
    required: true,
    index: true,
  },
  title:      { type: String, required: true },
  body:       { type: String, required: true },
  variables:  [{ type: String }],  // Placeholder names: ["clientName", "caseNumber"]
  usageCount: { type: Number, default: 0 },
  lastUsed:   { type: Date, default: null },
  createdAt:  { type: Date, default: Date.now },
  updatedAt:  { type: Date, default: Date.now },
}, {
  timestamps: true,
});
```

---

## API Route Definitions

All responses follow `{ ok: true/false, ... }` format. Errors include `error` string.

### Chat Routes (`/api/chat`)

| Method | Path | Description | Body / Query |
|--------|------|-------------|--------------|
| POST | `/api/chat` | Send message to Claude, returns SSE stream | `{ message, conversationId?, images?: File[] }` multipart/form-data |
| GET | `/api/chat/conversations` | List conversations | `?limit=50&offset=0` |
| GET | `/api/chat/conversations/:id` | Get conversation with messages | - |
| DELETE | `/api/chat/conversations/:id` | Delete conversation | - |
| PATCH | `/api/chat/conversations/:id` | Update conversation (title) | `{ title }` |

#### SSE Stream Events (POST /api/chat response)

```
Content-Type: text/event-stream

data: {"type":"start","conversationId":"..."}

data: {"type":"delta","text":"Based on the escalation..."}
data: {"type":"delta","text":" details you provided..."}
...
data: {"type":"done","fullText":"Based on the escalation details...","conversationId":"..."}
```

### Escalation Routes (`/api/escalations`)

| Method | Path | Description | Body / Query |
|--------|------|-------------|--------------|
| GET | `/api/escalations` | List escalations | `?status=open&category=payroll&agent=&search=&coid=&caseNumber=&limit=50&offset=0&sort=-createdAt` |
| GET | `/api/escalations/:id` | Get single escalation | - |
| POST | `/api/escalations` | Create escalation | `{ coid, caseNumber, clientContact, ... }` |
| PATCH | `/api/escalations/:id` | Update escalation | `{ status?, resolution?, category?, ... }` |
| DELETE | `/api/escalations/:id` | Delete escalation | - |
| POST | `/api/escalations/parse` | Upload screenshot for parsing | `{ image: File }` multipart/form-data |

### Playbook Routes (`/api/playbook`)

| Method | Path | Description | Body / Query |
|--------|------|-------------|--------------|
| GET | `/api/playbook/categories` | List all category files | - |
| GET | `/api/playbook/categories/:name` | Get category content | - |
| PUT | `/api/playbook/categories/:name` | Update category content | `{ content }` |
| POST | `/api/playbook/categories` | Create new category | `{ name, content }` |
| DELETE | `/api/playbook/categories/:name` | Delete category file | - |
| GET | `/api/playbook/edge-cases` | Get edge-cases.md content | - |
| PUT | `/api/playbook/edge-cases` | Update edge-cases.md | `{ content }` |
| GET | `/api/playbook/full` | Get full concatenated playbook (for system prompt preview) | - |

### Template Routes (`/api/templates`)

| Method | Path | Description | Body / Query |
|--------|------|-------------|--------------|
| GET | `/api/templates` | List templates | `?category=payroll` |
| GET | `/api/templates/:id` | Get single template | - |
| POST | `/api/templates` | Create template | `{ category, title, body, variables? }` |
| PATCH | `/api/templates/:id` | Update template | `{ title?, body?, category?, variables? }` |
| DELETE | `/api/templates/:id` | Delete template | - |
| POST | `/api/templates/:id/use` | Increment usage count | - |
| POST | `/api/templates/suggest` | Ask Claude to suggest template | `{ escalationId }` |

### Analytics Routes (`/api/analytics`)

| Method | Path | Description | Query |
|--------|------|-------------|-------|
| GET | `/api/analytics/categories` | Escalation count by category | `?dateFrom=&dateTo=` |
| GET | `/api/analytics/resolution-time` | Avg resolution time by category | `?dateFrom=&dateTo=` |
| GET | `/api/analytics/agents` | Escalation count by agent | `?dateFrom=&dateTo=&limit=20` |
| GET | `/api/analytics/trends` | Escalations over time (daily/weekly) | `?dateFrom=&dateTo=&interval=daily` |
| GET | `/api/analytics/recurring` | Most frequent issue patterns | `?limit=10` |
| GET | `/api/analytics/summary` | Dashboard summary stats | - |

---

## Component Hierarchy

```
App.jsx
├── Sidebar.jsx                          # Left nav: pages + conversation list
│   ├── ConversationList.jsx             # Chat history (click to resume)
│   └── nav links                        # Chat, Dashboard, Playbook, Templates, Analytics
│
├── [Route: /chat]
│   └── Chat.jsx                         # Main chat view
│       ├── ChatMessage.jsx              # Message bubble (user/assistant)
│       │   └── (markdown rendering)
│       ├── ImageUpload.jsx              # Drag-and-drop zone
│       └── (input bar + send button)
│
├── [Route: /dashboard]
│   └── EscalationDashboard.jsx          # List + filters
│       ├── (filter bar: status, category, agent, search)
│       └── EscalationCard.jsx           # Summary card per escalation
│
├── [Route: /escalations/:id]
│   └── EscalationDetail.jsx             # Full escalation view
│       ├── EscalationForm.jsx           # Edit fields
│       ├── (linked conversation preview)
│       └── (status transition buttons)
│
├── [Route: /playbook]
│   └── PlaybookEditor.jsx               # Category list + editor
│       └── (markdown editor textarea)
│
├── [Route: /templates]
│   └── TemplateLibrary.jsx              # Template grid
│       └── TemplateCard.jsx             # Title, body preview, copy button
│
├── [Route: /analytics]
│   └── Analytics.jsx                    # Charts + stats
│       ├── (bar chart: categories)
│       ├── (line chart: trends over time)
│       ├── (table: agent leaderboard)
│       └── (summary cards: totals, avg resolution time)
│
└── ConfirmModal.jsx                     # Shared modal (delete confirmations)
```

### Routing

Hash-based routing (same pattern as Media Vault) for simplicity:

| Hash | Component | Description |
|------|-----------|-------------|
| `#/` or `#/chat` | Chat.jsx | Default view: chat with Claude |
| `#/chat/:conversationId` | Chat.jsx | Resume specific conversation |
| `#/dashboard` | EscalationDashboard.jsx | Escalation list |
| `#/escalations/:id` | EscalationDetail.jsx | Single escalation detail |
| `#/playbook` | PlaybookEditor.jsx | Playbook editor |
| `#/templates` | TemplateLibrary.jsx | Template library |
| `#/analytics` | Analytics.jsx | Analytics dashboard |

---

## Feature Breakdown

### Feature 1: Chat Interface with Claude

**Purpose:** The primary interaction point. User pastes/uploads escalation screenshots, chats with Claude to diagnose issues, get response drafts.

**Implementation Details:**

1. **Chat.jsx** renders a scrollable message list + input bar at the bottom
2. **ImageUpload.jsx** provides a drag-and-drop zone above the input (or inline). Uses `FileReader` for preview, sends as `multipart/form-data`
3. **SSE Streaming:** `useChat.js` hook manages:
   - POST request to `/api/chat` with `fetch()` and `ReadableStream` reader
   - Parse SSE `data:` lines, accumulate deltas into display text
   - On `done` event, finalize the message in state
4. **Conversation history:** Prior messages are sent as context in each request. The server reconstructs the full prompt from stored conversation messages
5. **System prompt:** Playbook content is loaded by the server and prepended as system prompt. User never sees it but can preview it in Playbook Editor

**Key hook: `useChat.js`**
```javascript
// State: messages[], isStreaming, conversationId
// Actions: sendMessage(text, images), loadConversation(id), newConversation()
// SSE: connects to POST /api/chat, reads stream, updates messages in real-time
```

### Feature 2: Escalation Dashboard

**Purpose:** Central view of all escalations with filtering, sorting, status tracking.

**Implementation Details:**

1. **EscalationDashboard.jsx** renders filter bar + card list
2. **Filter bar:** dropdowns for status, category; text inputs for search, COID, case number, agent name
3. **EscalationCard.jsx** shows: status badge, category chip, client name, case number, date, truncated description
4. **Click card** navigates to `#/escalations/:id`
5. **useEscalations.js** hook manages: fetch with query params, optimistic status updates, polling (10s interval for dashboard freshness)

### Feature 3: Escalation Parser (Screenshot to Structured Data)

**Purpose:** Upload a screenshot of an agent DM, Claude extracts the structured fields.

**Implementation Details:**

1. **POST /api/escalations/parse** accepts an image upload
2. Server saves image to `server/uploads/`, calls Claude CLI with:
   - System prompt: "Extract structured fields from this QBO escalation template screenshot"
   - Image flag: `--image <path>`
   - Output: JSON with extracted fields
3. Server parses Claude's response (expects JSON), creates an Escalation record
4. Returns the created escalation to the client
5. Client navigates to the new escalation detail page

**Parsing prompt:**
```
You are parsing a screenshot of a QuickBooks Online escalation template.
Extract these fields as JSON:
- coid (COID/MID - company ID)
- caseNumber (CASE number)
- clientContact (CLIENT/CONTACT name)
- agentName (the agent who sent this DM, if visible)
- attemptingTo (CX IS ATTEMPTING TO)
- expectedOutcome (EXPECTED OUTCOME)
- actualOutcome (ACTUAL OUTCOME)
- triedTestAccount (TRIED TEST ACCOUNT - yes/no)
- tsSteps (TS STEPS - troubleshooting already attempted)
- category (classify into one of: payroll, bank-feeds, reconciliation, permissions, billing, tax, invoicing, reporting, inventory, payments, integrations, general)

Return ONLY valid JSON. If a field is not visible or unclear, use empty string.
```

### Feature 4: Playbook / Knowledge Base

**Purpose:** Markdown files on disk that Claude reads as context. Editable from the web UI.

**Implementation Details:**

1. **playbook-loader.js** scans `playbook/categories/*.md` and `playbook/templates/*.md`, concatenates into a structured string:
   ```
   ## QBO Escalation Playbook

   ### Category: Payroll
   [content of payroll.md]

   ### Category: Bank Feeds
   [content of bank-feeds.md]

   ### Response Templates
   [content of templates/*.md]

   ### Edge Cases
   [content of edge-cases.md]
   ```
2. **PlaybookEditor.jsx** shows a sidebar list of categories, clicking one loads the markdown content into a textarea editor
3. **PUT /api/playbook/categories/:name** writes the content back to disk using `fs.writeFile`
4. **Cache invalidation:** playbook-loader maintains a file-watcher (or TTL cache) so changes are reflected immediately in Claude's context
5. **CLI sync:** Since playbook files are on disk, the Claude Code CLI also reads them naturally via CLAUDE.md reference

### Feature 5: Response Templates

**Purpose:** Pre-built response templates that the user can copy, customize, and send to agents.

**Implementation Details:**

1. **TemplateLibrary.jsx** shows a grid of template cards, filterable by category
2. **TemplateCard.jsx** shows title, category chip, body preview, "Copy" button, usage count
3. **Copy button** uses `navigator.clipboard.writeText()`, increments usage count via POST `/api/templates/:id/use`
4. **Template variables:** Templates can contain `{{clientName}}`, `{{caseNumber}}` etc. The UI renders a small form to fill variables before copying
5. **Claude suggestion:** On an escalation detail page, a "Suggest Template" button calls POST `/api/templates/suggest` with the escalation ID. Claude analyzes the escalation and returns the best matching template + customization.

### Feature 6: Analytics / Pattern Tracking

**Purpose:** Identify recurring issues, track resolution times, spot patterns.

**Implementation Details:**

1. **Analytics.jsx** renders charts using a lightweight chart library (Chart.js or Recharts)
2. **Category bar chart:** MongoDB aggregation `$group` by category, `$count`
3. **Resolution time:** Compute `resolvedAt - createdAt` average per category
4. **Trends:** Group by date bucket (day/week), count escalations
5. **Agent leaderboard:** Group by `agentName`, count escalations, sort descending
6. **Recurring issues:** Text analysis -- group similar `attemptingTo` descriptions (use Claude for clustering, or simple keyword frequency)
7. **Summary cards:** Total open, resolved this week, avg resolution time, most common category

### Feature 7: CLI Integration

**Purpose:** User can also interact via Claude Code CLI directly, sharing the same data.

**Implementation Details:**

1. **CLAUDE.md** at project root gives Claude context about the project:
   - How to read/write playbook files
   - How to query MongoDB for escalations
   - How to create/update escalation records
   - Available scripts for common operations
2. **Shared MongoDB:** CLI and web app connect to the same database
3. **Shared playbook:** Both read from the same `playbook/` directory on disk
4. **CLI scripts** in `package.json`:
   ```json
   {
     "scripts": {
       "escalation:new": "node server/src/scripts/new-escalation.js",
       "escalation:resolve": "node server/src/scripts/resolve-escalation.js",
       "playbook:add": "node server/src/scripts/add-playbook-entry.js"
     }
   }
   ```

---

## File-by-File Creation Order

### Phase 0: Project Scaffolding

| # | File | Purpose |
|---|------|---------|
| 1 | `package.json` (root) | Root scripts: dev, build, test |
| 2 | `server/package.json` | Express + Mongoose + dependencies |
| 3 | `client/package.json` | Vite + React dependencies |
| 4 | `server/.env.example` | Environment variable template |
| 5 | `server/.env` | Local environment config (gitignored) |
| 6 | `client/index.html` | HTML entry point |
| 7 | `client/vite.config.js` | Vite config with /api proxy to :4000 |
| 8 | `.gitignore` | Standard ignores |
| 9 | `CLAUDE.md` | Project instructions for CLI |

### Phase 1: Server Foundation

| # | File | Purpose |
|---|------|---------|
| 10 | `server/src/index.js` | Express app: middleware, routes, MongoDB connect, listen |
| 11 | `server/src/models/Escalation.js` | Escalation Mongoose model |
| 12 | `server/src/models/Conversation.js` | Conversation Mongoose model |
| 13 | `server/src/models/Template.js` | Template Mongoose model |
| 14 | `server/src/lib/playbook-loader.js` | Read playbook/ dir into context string |
| 15 | `server/src/services/claude.js` | Claude CLI subprocess wrapper |

### Phase 2: Core Routes

| # | File | Purpose |
|---|------|---------|
| 16 | `server/src/routes/chat.js` | Chat + SSE streaming route |
| 17 | `server/src/routes/escalations.js` | Escalation CRUD + search + parse |
| 18 | `server/src/routes/playbook.js` | Playbook file read/write routes |
| 19 | `server/src/routes/templates.js` | Template CRUD routes |
| 20 | `server/src/routes/analytics.js` | Aggregation query routes |
| 21 | `server/src/lib/escalation-parser.js` | Regex fallback parser for escalation template text |

### Phase 3: Client Foundation

| # | File | Purpose |
|---|------|---------|
| 22 | `client/src/main.jsx` | React root render |
| 23 | `client/src/App.jsx` | Hash router + layout shell |
| 24 | `client/src/App.css` | Global styles (design system tokens) |
| 25 | `client/src/api/api.js` | Fetch wrapper for all /api/* calls |

### Phase 4: Chat Interface (Core Feature)

| # | File | Purpose |
|---|------|---------|
| 26 | `client/src/hooks/useChat.js` | Chat state + SSE streaming hook |
| 27 | `client/src/components/Chat.jsx` | Main chat view |
| 28 | `client/src/components/ChatMessage.jsx` | Message bubble with markdown |
| 29 | `client/src/components/ImageUpload.jsx` | Drag-and-drop image upload |
| 30 | `client/src/components/Sidebar.jsx` | Navigation + conversation list |
| 31 | `client/src/components/ConversationList.jsx` | Chat history list |

### Phase 5: Escalation Dashboard

| # | File | Purpose |
|---|------|---------|
| 32 | `client/src/hooks/useEscalations.js` | Escalation CRUD + polling hook |
| 33 | `client/src/components/EscalationDashboard.jsx` | List + filter view |
| 34 | `client/src/components/EscalationCard.jsx` | Summary card |
| 35 | `client/src/components/EscalationDetail.jsx` | Full escalation view |
| 36 | `client/src/components/EscalationForm.jsx` | Manual entry / edit form |

### Phase 6: Playbook + Templates

| # | File | Purpose |
|---|------|---------|
| 37 | `client/src/hooks/usePlaybook.js` | Playbook read/write hook |
| 38 | `client/src/components/PlaybookEditor.jsx` | Browse + edit playbook |
| 39 | `client/src/components/PlaybookViewer.jsx` | Read-only view in chat |
| 40 | `client/src/hooks/useTemplates.js` | Template CRUD hook |
| 41 | `client/src/components/TemplateLibrary.jsx` | Template grid |
| 42 | `client/src/components/TemplateCard.jsx` | Individual template card |

### Phase 7: Analytics

| # | File | Purpose |
|---|------|---------|
| 43 | `client/src/hooks/useAnalytics.js` | Analytics data fetching hook |
| 44 | `client/src/components/Analytics.jsx` | Charts + stats view |

### Phase 8: Shared + Polish

| # | File | Purpose |
|---|------|---------|
| 45 | `client/src/components/ConfirmModal.jsx` | Shared confirmation dialog |
| 46 | Playbook seed files | `playbook/categories/*.md` initial content |
| 47 | Template seed script | Seed MongoDB with starter templates |

---

## Phase Breakdown

### Phase 1: Chat with Claude (Immediate Usability)

**Goal:** The user can open the app, type a message or upload a screenshot, and get a streaming response from Claude with QBO context.

**Files:** #1-16, #22-31 (scaffolding + server foundation + chat routes + client chat)

**Delivers:**
- Express server with MongoDB connection
- Claude CLI integration with streaming
- Playbook loader (reads from disk)
- Chat UI with SSE streaming
- Image upload (drag-and-drop screenshots)
- Conversation persistence
- Sidebar with conversation history

**Estimated effort:** 2-3 sessions

**Verification:**
- Upload a screenshot of an escalation DM
- See Claude parse it and provide diagnosis
- Response streams in real-time
- Conversation saves and can be resumed

### Phase 2: Escalation Tracking

**Goal:** Structured escalation records with status tracking, search, filtering.

**Files:** #17, #21, #32-36

**Delivers:**
- Escalation CRUD routes
- Screenshot parser (Claude extracts fields)
- Escalation dashboard with filters
- Escalation detail view with status transitions
- Manual entry form
- Link between escalation and chat conversation

**Estimated effort:** 1-2 sessions

**Verification:**
- Create escalation from screenshot upload
- See parsed fields populated correctly
- Filter by status, category, agent
- Update status to resolved with resolution notes
- Search by COID or case number

### Phase 3: Playbook + Templates

**Goal:** Editable knowledge base that Claude uses as context. Copy-paste response templates.

**Files:** #18-19, #37-42, #46-47

**Delivers:**
- Playbook editor (web UI for markdown files)
- Template library with copy-to-clipboard
- Template variable substitution
- Claude template suggestion
- Seed playbook content for common QBO categories

**Estimated effort:** 1-2 sessions

**Verification:**
- Edit a playbook category in the web UI
- See changes reflected in Claude's next response
- Copy a template with variable substitution
- Claude suggests appropriate template for an escalation

### Phase 4: Analytics + Polish

**Goal:** Pattern tracking, resolution metrics, agent insights. UI polish.

**Files:** #20, #43-45

**Delivers:**
- Category distribution chart
- Resolution time tracking
- Agent escalation patterns
- Trend lines over time
- Summary dashboard cards
- Confirm modal for destructive actions
- Loading states, error handling, empty states

**Estimated effort:** 1 session

**Verification:**
- Charts render with real data
- Correct aggregation numbers
- Date range filtering works
- Summary stats match database counts

### Phase 5: CLI Integration + Hardening

**Goal:** Claude Code CLI can access the same data. Edge case handling. Production readiness.

**Delivers:**
- CLAUDE.md with full project context for CLI
- CLI helper scripts
- Error boundaries in React
- Graceful shutdown in Express
- File cleanup (temp uploads)
- Rate limiting on Claude subprocess spawning

**Estimated effort:** 1 session

---

## Key Design Decisions

### 1. Claude Integration: CLI Subprocess (not Agent SDK)

**Decision:** Use `claude -p --output-format stream-json` via `child_process.spawn()`.

**Rationale:** The user has a Claude Max subscription. The Agent SDK requires an API key and explicitly prohibits Max subscription OAuth tokens. The CLI binary uses the user's existing authenticated session.

**Trade-offs:**
- (+) No API key needed, uses existing Max subscription
- (+) Same Claude the user already uses in terminal
- (-) Process startup overhead (~1-2s per request)
- (-) No native multi-turn; we reconstruct conversation context ourselves
- (-) Known Node.js spawning issues on some platforms (mitigable with `shell: true`)

**Migration path:** If the user later obtains an API key, the `services/claude.js` abstraction layer makes switching to the Agent SDK a localized change.

### 2. Image Handling: Filesystem + Relative Paths

**Decision:** Save uploaded images to `server/uploads/<escalationId>/` on disk. Store relative paths in MongoDB.

**Rationale:**
- Claude CLI needs file paths for `--image` flag
- Base64 in MongoDB bloats documents and slows queries
- Filesystem storage is simple and works with the CLI
- Relative paths keep the database portable

**Cleanup:** Temp images (chat-only, not linked to an escalation) are cleaned up after 24 hours via a simple cron-like interval.

### 3. Playbook Sync: Filesystem is Source of Truth

**Decision:** Playbook files live on disk in `playbook/`. No MongoDB mirror. The web UI reads/writes directly to disk via the Express API.

**Rationale:**
- The Claude Code CLI reads files from disk naturally
- No sync problem: one source of truth (the filesystem)
- Git-trackable: playbook changes can be version controlled
- Simple: no cache invalidation logic needed

**Playbook loading:** `playbook-loader.js` reads all files on each chat request (with a 30-second TTL cache to avoid redundant disk reads). Changes made via web UI or CLI are picked up within 30 seconds.

### 4. Streaming: SSE from Express (Same as Media Vault)

**Decision:** POST `/api/chat` returns an SSE stream. The response is `Content-Type: text/event-stream`.

**Rationale:**
- Proven pattern from Media Vault
- No WebSocket complexity
- Works through Vite proxy
- Client uses standard `fetch()` + `ReadableStream` reader (no EventSource, since this is a POST)

**Implementation note:** Since `EventSource` only supports GET, the client uses `fetch()` with a `ReadableStream` reader to parse SSE from a POST response. This is the standard pattern for streaming POST responses.

### 5. Authentication: None (Local Only)

**Decision:** No authentication. The app runs locally on the user's machine.

**Rationale:**
- Single user, local network only
- Adding auth would add friction to every interaction
- The Express server binds to `localhost` by default

**Future option:** If needed, add a simple PIN middleware that checks a hashed value from `.env`.

### 6. Conversation Context Reconstruction

**Decision:** Each chat request sends the full conversation history to Claude as a single prompt (not using Claude sessions).

**Rationale:**
- Claude CLI `-p` mode is stateless (one prompt in, one response out)
- We store messages in MongoDB and reconstruct the context string:
  ```
  [System prompt: playbook content]

  User: [message 1]
  Assistant: [response 1]
  User: [message 2]
  Assistant: [response 2]
  User: [current message]
  ```
- This gives us full control over context window management
- We can truncate old messages if the context gets too long

**Token budget:** Monitor prompt length. If conversation history exceeds ~80K tokens, truncate oldest messages (keep system prompt + last N exchanges).

### 7. Chart Library: Recharts

**Decision:** Use Recharts for analytics charts.

**Rationale:**
- React-native (JSX-based API, not imperative)
- Lightweight compared to Chart.js
- Good defaults for bar charts, line charts, pie charts
- No canvas -- uses SVG, which is accessible and inspectable

### 8. Markdown Rendering: react-markdown

**Decision:** Use `react-markdown` for rendering Claude's responses and playbook content.

**Rationale:**
- Claude returns markdown-formatted text
- Playbook files are markdown
- `react-markdown` is lightweight and customizable
- Supports syntax highlighting via plugins (rehype-highlight)

### 9. Tech Stack Versions

| Package | Version | Rationale |
|---------|---------|-----------|
| React | 19.x | Latest stable, matches Media Vault |
| Vite | 7.x | Latest stable, matches Media Vault |
| Express | 5.x | Latest stable, async error handling, matches Media Vault |
| Mongoose | 9.x | Latest stable, matches Media Vault |
| react-markdown | 9.x | Latest stable |
| recharts | 2.x | Latest stable |
| multer | 1.x | Multipart form handling for image uploads |

### 10. No Framer Motion (Initially)

**Decision:** Skip Framer Motion in Phase 1. Add if needed in Phase 4 polish.

**Rationale:**
- The primary use case is fast diagnosis, not visual delight
- Simpler codebase to start
- CSS transitions are sufficient for basic hover/focus feedback
- Can add Framer Motion later for page transitions and list animations

---

## Appendix: Playbook Seed Content

### playbook/categories/payroll.md (example)

```markdown
# Payroll Escalations

## Common Issues

### Direct Deposit Not Processing
- **Symptoms:** Employee reports DD not received, shows pending in QBO
- **First checks:** Verify bank account info, check payroll processing date vs bank holiday
- **Common fix:** Re-run payroll if past cutoff; verify routing/account numbers
- **Escalation trigger:** If bank info is correct and payroll was processed on time

### Payroll Tax Calculation Errors
- **Symptoms:** Tax amounts seem wrong, employee complaints about withholding
- **First checks:** Verify W-4 info, check tax table updates, verify state/local settings
- **Common fix:** Update tax settings, re-run payroll tax calculation
- **Escalation trigger:** If settings are correct but calculations still wrong

### Year-End Forms (W-2, 1099)
- **Symptoms:** Missing forms, incorrect amounts, can't file
- **First checks:** Verify all payrolls are finalized, check contractor vs employee classification
- **Common fix:** Finalize outstanding payrolls, correct classification
- **Escalation trigger:** If system shows different totals than actual payments

## Diagnosis Steps

1. Get COID and verify payroll subscription is active
2. Check last successful payroll run date
3. Verify employee count matches expectations
4. Check for any pending payroll tax notices
5. Review recent payroll history for anomalies

## Response Templates

### Payroll Processing Delay
"Hi [agent], I've reviewed COID [coid] and here's what I found: [finding].
The recommended next step is: [action]. If the client needs immediate
assistance, they can [workaround]."
```

### playbook/categories/bank-feeds.md (example)

```markdown
# Bank Feeds Escalations

## Common Issues

### Bank Feed Disconnected
- **Symptoms:** Transactions not importing, "connection error" message
- **First checks:** Verify bank supports QBO feeds, check if bank changed login flow
- **Common fix:** Disconnect and reconnect bank feed, update bank credentials
- **Escalation trigger:** If reconnection fails repeatedly

### Duplicate Transactions
- **Symptoms:** Same transaction appears multiple times
- **First checks:** Check if both bank feed and manual import are active
- **Common fix:** Delete duplicates, disable one import method
- **Escalation trigger:** If duplicates keep appearing after cleanup

### Missing Transactions
- **Symptoms:** Bank shows transactions that don't appear in QBO
- **First checks:** Check date range filter, verify account mapping
- **Common fix:** Adjust date range, refresh bank feed connection
- **Escalation trigger:** If transactions are within range but still missing

## Diagnosis Steps

1. Verify bank name and connection type (direct feed vs web connect)
2. Check last successful sync date
3. Look for any error messages in bank feed settings
4. Verify no duplicate bank accounts in chart of accounts
5. Check if client has multiple QBO companies connected to same bank
```

---

## Appendix: Package Dependencies

### Root `package.json`

```json
{
  "name": "qbo-escalations",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "concurrently \"npm run dev:client\" \"npm run dev:server\"",
    "dev:client": "npm --prefix client run dev",
    "dev:server": "npm --prefix server run dev",
    "build": "npm --prefix client run build",
    "start": "node server/src/index.js"
  },
  "devDependencies": {
    "concurrently": "^9.2.0"
  }
}
```

### Server `package.json`

```json
{
  "name": "qbo-escalations-server",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "src/index.js",
  "scripts": {
    "dev": "nodemon src/index.js",
    "start": "node src/index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^5.2.0",
    "mongoose": "^9.2.0",
    "multer": "^1.4.5-lts.1",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  }
}
```

### Client `package.json`

```json
{
  "name": "qbo-escalations-client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-markdown": "^9.0.0",
    "recharts": "^2.15.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.5.0",
    "vite": "^7.3.0"
  }
}
```

### Server `.env.example`

```bash
# Server
PORT=4000

# MongoDB
MONGODB_URI=mongodb+srv://...

# Claude CLI
# No API key needed -- uses Max subscription OAuth session
# CLAUDE_MODEL=claude-sonnet-4  # Optional: override default model

# Uploads
UPLOAD_DIR=uploads
MAX_UPLOAD_SIZE_MB=10

# Playbook
PLAYBOOK_DIR=../playbook
PLAYBOOK_CACHE_TTL_MS=30000
```
