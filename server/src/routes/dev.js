const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const DevConversation = require('../models/DevConversation');
const DEV_CHANNEL_TYPES = new Set(DevConversation.CHANNEL_TYPES || ['user']);
const DEFAULT_CHANNEL_TYPE = DevConversation.DEFAULT_CHANNEL_TYPE || 'user';
const MONITOR_CHANNEL_TYPES = new Set([...DEV_CHANNEL_TYPES].filter((type) => type !== DEFAULT_CHANNEL_TYPE));
const DEFAULT_MONITOR_CHANNEL_TYPE = MONITOR_CHANNEL_TYPES.has('auto-errors')
  ? 'auto-errors'
  : (MONITOR_CHANNEL_TYPES.values().next().value || DEFAULT_CHANNEL_TYPE);
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  isValidProvider,
  normalizeProvider,
  getDefaultProvider,
  getProviderFamily,
} = require('../services/providers/registry');
const { getProviderModelId } = require('../services/providers/catalog');
const {
  VALID_MODES,
  resolvePolicy,
} = require('../services/chat-orchestrator');
const { randomUUID, createHash } = require('node:crypto');
const { extractUsageFromMessage } = require('../lib/usage-extractor');
const { logUsage } = require('../lib/usage-writer');
const { calculateCost } = require('../lib/pricing');
const { normalizeToolEvent, extractFilesFromNormalized } = require('../lib/tool-normalizer');
const { logAgentAction, retrieveRelevantMemory, addToRecentAgentFiles } = require('../lib/agent-memory');
const DevAgentLog = require('../models/DevAgentLog');
const PromptVersion = require('../models/PromptVersion');
const { reportServerError, subscribe: subscribeServerErrors, getRecentErrors } = require('../lib/server-error-pipeline');
const {
  beginMonitorIncident,
  finishMonitorIncident,
  getMonitorIncidentHealth,
  transitionRuntimeIncidents,
  transitionMonitorIncidentKeys,
  transitionMonitorIncidentsByMetadata,
} = require('../services/monitor-incidents');
const {
  createRuntimeRemediationAttempt,
  finalizeRuntimeRemediationAttempt,
  getRuntimeRemediationHealth,
} = require('../services/runtime-remediation');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const UPLOADS_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const DEV_MODE_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'dev-mode');
const DEFAULT_PROVIDER = getDefaultProvider();
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoundedPositiveInt(value, fallback, max) {
  const parsed = parsePositiveInt(value, fallback);
  if (!Number.isFinite(max) || max <= 0) return parsed;
  return Math.min(parsed, max);
}

const DEV_CHAT_TIMEOUT_MS = parsePositiveInt(process.env.DEV_CHAT_TIMEOUT_MS, 600000);
const DEV_CHAT_MAX_TIMEOUT_MS = parsePositiveInt(process.env.DEV_CHAT_MAX_TIMEOUT_MS, 1800000);
const CODEX_DEV_MODEL = process.env.CODEX_DEV_MODEL || process.env.CODEX_CHAT_MODEL || 'gpt-5.3-codex';
const CODEX_DEV_REASONING_EFFORT = process.env.CODEX_DEV_REASONING_EFFORT || process.env.CODEX_REASONING_EFFORT || 'high';
const CLAUDE_DEV_IMAGE_HELP_TIMEOUT_MS = parsePositiveInt(process.env.CLAUDE_DEV_IMAGE_HELP_TIMEOUT_MS, 5000);
const DEFAULT_DEV_MAX_IMAGES = 6;
const DEFAULT_DEV_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_DEV_MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;
let supportsClaudeDevImageFlagCache = null;
const CLAUDE_DEV_ALLOWED_EFFORTS = new Set(['low', 'medium', 'high']);
const DEV_ALLOWED_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

function normalizeDevReasoningEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return DEV_ALLOWED_REASONING_EFFORTS.has(normalized) ? normalized : CODEX_DEV_REASONING_EFFORT;
}

function normalizeClaudeDevEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'xhigh') return 'high';
  return CLAUDE_DEV_ALLOWED_EFFORTS.has(normalized) ? normalized : 'high';
}

/**
 * Classify an agent action into a category based on message + file content.
 */
function classifyCategory(message, filesAffected) {
  const text = (message || '').toLowerCase();
  const files = (filesAffected || []).join(' ').toLowerCase();
  const combined = text + ' ' + files;

  if (/build|vite|compile|bundle|esbuild|webpack/.test(combined)) return 'build-error';
  if (/runtime|uncaught|undefined is not|cannot read|TypeError|ReferenceError|crash/.test(combined)) return 'runtime-error';
  if (/style|css|layout|margin|padding|flex|grid|animation/.test(combined)) return 'style';
  if (/performance|slow|memory|leak|render|rerender|loop/.test(combined)) return 'performance';
  if (/security|xss|injection|auth|token|csrf/.test(combined)) return 'security';
  if (/refactor|clean|unused|dead code|duplicate/.test(combined)) return 'quality';
  if (/logic|bug|wrong|incorrect|missing|null|undefined/.test(combined)) return 'logic';
  return 'other';
}

/**
 * Extract a concise resolution summary from the assistant's response text.
 * Takes the first 2 sentences, strips markdown formatting, caps at 300 chars.
 */
function extractResolution(assistantText) {
  if (!assistantText) return '';
  // Split on sentence boundaries (". " or ".\n")
  const sentences = assistantText.split(/\.\s|\.\n/);
  let summary = sentences.slice(0, 2).join('. ').trim();
  if (sentences.length > 0 && !summary.endsWith('.')) summary += '.';
  // Strip markdown formatting
  summary = summary.replace(/#{1,6}\s?/g, '').replace(/\*{1,2}/g, '').replace(/`{1,3}/g, '');
  return summary.slice(0, 300);
}

if (!fs.existsSync(DEV_MODE_UPLOADS_DIR)) {
  fs.mkdirSync(DEV_MODE_UPLOADS_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Dev Agent system prompt / role identity
// ---------------------------------------------------------------------------

const CLAUDE_ROLE = [
  'You are the Dev Agent for the QBO Escalations project. You are always on — monitoring, fixing, and improving this codebase autonomously.',
  '',
  'CORE BEHAVIORS:',
  '- When you receive an error report: investigate the source file, determine root cause, and FIX IT directly. Don\'t explain — act. If you can\'t fix with confidence, explain why.',
  '- When asked to review code changes: read the files, check for bugs/edge cases/missing error handling, fix what you find. Report what you changed.',
  '- When asked about the codebase: use your tools to explore before answering. Never guess.',
  '- Make changes directly to files. Don\'t describe what to do — do it.',
  '',
  'TOOLS: Full filesystem access via Read, Write, Edit, Bash, Glob, Grep.',
  '',
  'PROJECT:',
  '- Stack: React 19 + Vite (ESM client), Express 5 + Mongoose 9 (CommonJS server), MongoDB Atlas',
  '- Convention: CommonJS server (require), ESM client (import), Express 5 async errors auto-caught',
  '- API shape: { ok: true/false, ... } with code and error on failures',
  '- Root: ' + PROJECT_ROOT,
  '',
  'MESSAGES PREFIXED WITH [AUTO-ERROR], [AUTO-REVIEW], OR [IDLE-SCAN]:',
  'System-generated. Act on them immediately and autonomously. Fix what you can, report what you did.',
].join('\n');

const CODEX_ROLE = [
  'You are the Dev Agent for the QBO Escalations project — always on, monitoring and fixing this codebase autonomously.',
  '',
  'BEHAVIORS:',
  '- Error reports: investigate source, find root cause, fix it directly. Explain only if you cannot fix with confidence.',
  '- Code review: read files, find bugs/edge cases, fix them, report changes.',
  '- Codebase questions: explore first, never guess.',
  '- You can execute code and read/write files.',
  '',
  'PROJECT: React 19 + Vite (ESM client), Express 5 + Mongoose 9 (CommonJS server), MongoDB Atlas.',
  'Convention: CommonJS server (require), ESM client (import). API shape: { ok: true/false }.',
  '',
  '[AUTO-ERROR], [AUTO-REVIEW], [IDLE-SCAN] prefixed messages are system-generated — act immediately.',
].join('\n');

const DEV_SYSTEM_PROMPT_FALLBACK = 'You are the Dev Agent for the QBO Escalations project. Fix errors, review code, and improve the codebase.';

/**
 * Build the system prompt for a dev agent spawn.
 * Synchronous, cannot fail — returns a fallback string on any unexpected condition.
 *
 * Delegates to dev-context-builder for the full prompt (role + CLAUDE.md + file tree + memory).
 * Falls back to bare role text if the builder module is unavailable.
 *
 * @param {string} providerFamily - 'claude' | 'codex' | other
 * @param {Array} [memoryEntries] - Optional memory entries from agent-memory module
 * @returns {string} System prompt text
 */
function buildDevSystemPrompt(providerFamily, memoryEntries) {
  try {
    const { buildFullSystemPrompt, snapshotPromptVersion } = require('../lib/dev-context-builder');

    const roleText = providerFamily === 'codex' ? CODEX_ROLE : CLAUDE_ROLE;

    // Agent-memory module may not exist yet (parallel phase) — graceful fallback
    let memoryText = '';
    try {
      const { formatMemoryForPrompt } = require('../lib/agent-memory');
      if (formatMemoryForPrompt) {
        memoryText = formatMemoryForPrompt(memoryEntries || []);
      }
    } catch { /* agent-memory not available yet */ }

    const prompt = buildFullSystemPrompt(roleText, memoryText);

    // Fire-and-forget: snapshot if prompt changed (async, non-blocking)
    snapshotPromptVersion(prompt, { primary: providerFamily });

    return prompt;
  } catch {
    // dev-context-builder not available — bare role fallback
    try {
      if (providerFamily === 'codex') return CODEX_ROLE;
      if (providerFamily === 'claude') return CLAUDE_ROLE;
      return CODEX_ROLE;
    } catch {
      return DEV_SYSTEM_PROMPT_FALLBACK;
    }
  }
}

/**
 * Compute a short hash of all system-prompt inputs.
 * When the hash differs from the stored value the session must be invalidated
 * so the CLI subprocess starts fresh with the updated context.
 *
 * Fields beyond `rolePrompt` (claudeMdContent, treeGeneratedAt, memorySelectionBasis)
 * are placeholders for later phases and default to empty strings for now.
 */
function computeContextHash({ rolePrompt, claudeMdContent, treeGeneratedAt, memorySelectionBasis } = {}) {
  const input = [
    rolePrompt || '',
    claudeMdContent || '',
    treeGeneratedAt || '',
    memorySelectionBasis || '',
  ].join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// Active dev sessions: sessionKey -> { child, killed, provider, conversationId }
const activeSessions = new Map();

// Prune stale dev sessions every 5 minutes (30-min TTL)
const DEV_SESSION_TTL_MS = 30 * 60 * 1000;
let _devSessionPruneInterval = setInterval(() => {
  const cutoff = Date.now() - DEV_SESSION_TTL_MS;
  for (const [key, session] of activeSessions) {
    if ((session.updatedAt || 0) < cutoff) {
      try { session.child?.kill('SIGTERM'); } catch {}
      activeSessions.delete(key);
    }
  }
}, 5 * 60 * 1000);
if (_devSessionPruneInterval.unref) _devSessionPruneInterval.unref();

function stopDevSessionPruning() {
  if (_devSessionPruneInterval) {
    clearInterval(_devSessionPruneInterval);
    _devSessionPruneInterval = null;
  }
}

const devChatRateLimit = createRateLimiter({ name: 'dev-chat', limit: 8, windowMs: 60_000 });
const devMonitorRateLimit = createRateLimiter({ name: 'dev-monitor', limit: 30, windowMs: 60_000 });

function isValidMode(mode) {
  return mode === undefined || VALID_MODES.has(mode);
}

function shouldResumeClaudeSession(primaryProvider, previousProvider, currentContextHash, storedContextHash) {
  if (getProviderFamily(primaryProvider) !== 'claude' || getProviderFamily(previousProvider) !== 'claude') {
    return false;
  }
  // If we have a current hash and it differs from the stored one, the system
  // prompt inputs changed — force a fresh session so the CLI picks up the new context.
  if (currentContextHash && currentContextHash !== storedContextHash) {
    return false;
  }
  return true;
}

function didCliExitSuccessfully(code) {
  return code === 0;
}

function isPathWithinRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function formatDevCliFailure(provider, code, stderr) {
  const preview = (stderr || '').slice(0, 500);
  const lower = preview.toLowerCase();
  const missingBinary =
    lower.includes('not recognized as an internal or external command') ||
    lower.includes('command not found') ||
    lower.includes('enoent');

  const family = getProviderFamily(provider);
  const label = family === 'codex' ? 'Codex CLI' : 'Claude CLI';
  if (missingBinary) {
    if (family === 'codex') {
      return 'Codex CLI command not found. Ensure `codex` is installed and available on PATH.';
    }
    return 'Claude CLI command not found. Ensure `claude` is installed and available on PATH.';
  }
  return `${label} exited with code ${code}: ${preview}`;
}

function normalizeProviderError(provider, err, defaultCode = 'PROVIDER_EXEC_FAILED') {
  return {
    provider,
    code: err && err.code ? err.code : defaultCode,
    message: err && err.message ? err.message : `${provider} request failed`,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeIncidentContext(value, depth = 0) {
  if (depth > 4) return '[depth-limited]';
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim().slice(0, 1000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeIncidentContext(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value).slice(0, 30)) {
      result[String(key).slice(0, 80)] = sanitizeIncidentContext(entry, depth + 1);
    }
    return result;
  }
  return String(value).slice(0, 200);
}

function buildMonitorSnapshotForPrompt() {
  const snapshot = {};

  try {
    const { getWorkspaceRuntimeHealth } = require('../services/workspace-runtime');
    const workspace = getWorkspaceRuntimeHealth();
    snapshot.workspace = {
      activeSessions: workspace.activeSessions || 0,
      staleCount: workspace.staleCount || 0,
      longestActiveMs: workspace.longestActiveMs || 0,
    };
  } catch { /* ignore */ }

  try {
    const { getAiRuntimeHealth } = require('../services/ai-runtime');
    const ai = getAiRuntimeHealth();
    snapshot.ai = {
      totalActiveOperations: ai.totalActiveOperations || 0,
      chat: { activeSessions: ai.chat?.activeSessions || 0, staleCount: ai.chat?.staleCount || 0 },
      copilot: { activeSessions: ai.copilot?.activeSessions || 0, staleCount: ai.copilot?.staleCount || 0 },
      gmail: { activeSessions: ai.gmail?.activeSessions || 0, staleCount: ai.gmail?.staleCount || 0 },
      parse: { activeSessions: ai.parse?.activeSessions || 0, staleCount: ai.parse?.staleCount || 0 },
    };
  } catch { /* ignore */ }

  try {
    const { getRequestRuntimeHealth } = require('../services/request-runtime');
    const requests = getRequestRuntimeHealth();
    snapshot.requests = {
      activeRequests: requests.activeRequests || 0,
      staleCount: requests.staleCount || 0,
      longestActiveMs: requests.longestActiveMs || 0,
    };
  } catch { /* ignore */ }

  try {
    const { getBackgroundRuntimeHealth } = require('../services/background-runtime');
    const background = getBackgroundRuntimeHealth();
    snapshot.background = {
      activeTasks: background.activeTasks || 0,
      staleCount: background.staleCount || 0,
      longestActiveMs: background.longestActiveMs || 0,
    };
  } catch { /* ignore */ }

  try {
    const monitor = getMonitorIncidentHealth();
    snapshot.monitor = {
      activeIncidents: monitor.activeIncidents || 0,
      failedIncidents: monitor.failedIncidents || 0,
      suppressedIncidents: monitor.collapsedIncidents || 0,
      activeMonitorTransportIncidents: monitor.activeMonitorTransportIncidents || 0,
    };
  } catch { /* ignore */ }

  return snapshot;
}

function buildMonitorPromptContent({ message, channelType, incidentMeta, incidentContext, requestId }) {
  const baseMessage = message || '(image attached)';
  const safeMeta = sanitizeIncidentContext(incidentMeta);
  const safeContext = sanitizeIncidentContext(incidentContext);
  const snapshot = buildMonitorSnapshotForPrompt();
  const lines = [
    baseMessage,
    '',
    '[SUPERVISOR_CONTEXT]',
    `Channel: ${channelType || 'unknown'}`,
    requestId ? `Request ID: ${requestId}` : '',
    safeMeta ? `Incident Meta: ${JSON.stringify(safeMeta, null, 2)}` : '',
    safeContext ? `Incident Context: ${JSON.stringify(safeContext, null, 2)}` : '',
    `Runtime Snapshot: ${JSON.stringify(snapshot, null, 2)}`,
    'Treat the structured context above as current supervisory state gathered from the app. Use it to investigate the right runtime path before editing code.',
    '[/SUPERVISOR_CONTEXT]',
  ].filter(Boolean);

  return lines.join('\n');
}

async function verifyRuntimeTargetsCleared({ workspaceSessionIds = [], aiOperationIds = [], timeoutMs = 4_000, intervalMs = 250 } = {}) {
  const requestedWorkspaceIds = [...new Set((Array.isArray(workspaceSessionIds) ? workspaceSessionIds : []).filter(Boolean))];
  const requestedAiIds = [...new Set((Array.isArray(aiOperationIds) ? aiOperationIds : []).filter(Boolean))];

  let listWorkspaceSessions = () => [];
  let listAiOperations = () => [];

  try {
    ({ listWorkspaceSessions } = require('../services/workspace-runtime'));
  } catch { /* ignore */ }

  try {
    ({ listAiOperations } = require('../services/ai-runtime'));
  } catch { /* ignore */ }

  const initialWorkspaceSet = new Set(listWorkspaceSessions().map((session) => session.id));
  const initialAiSet = new Set(listAiOperations().map((operation) => operation.id));

  const missingWorkspaceIds = requestedWorkspaceIds.filter((id) => !initialWorkspaceSet.has(id));
  const missingAiIds = requestedAiIds.filter((id) => !initialAiSet.has(id));

  const trackedWorkspaceIds = requestedWorkspaceIds.filter((id) => initialWorkspaceSet.has(id));
  const trackedAiIds = requestedAiIds.filter((id) => initialAiSet.has(id));

  const deadline = Date.now() + timeoutMs;
  let remainingWorkspaceIds = [...trackedWorkspaceIds];
  let remainingAiIds = [...trackedAiIds];

  while (remainingWorkspaceIds.length > 0 || remainingAiIds.length > 0) {
    const activeWorkspaceIds = new Set(listWorkspaceSessions().map((session) => session.id));
    const activeAiIds = new Set(listAiOperations().map((operation) => operation.id));

    remainingWorkspaceIds = remainingWorkspaceIds.filter((id) => activeWorkspaceIds.has(id));
    remainingAiIds = remainingAiIds.filter((id) => activeAiIds.has(id));

    if ((remainingWorkspaceIds.length === 0 && remainingAiIds.length === 0) || Date.now() >= deadline) {
      break;
    }

    await wait(intervalMs);
  }

  return {
    missingWorkspaceIds,
    missingAiIds,
    verifiedWorkspaceIds: trackedWorkspaceIds.filter((id) => !remainingWorkspaceIds.includes(id)),
    verifiedAiIds: trackedAiIds.filter((id) => !remainingAiIds.includes(id)),
    remainingWorkspaceIds,
    remainingAiIds,
  };
}

function supportsClaudeDevImageFlag() {
  if (supportsClaudeDevImageFlagCache !== null) return supportsClaudeDevImageFlagCache;

  if (process.env.CLAUDE_SUPPORTS_IMAGE_INPUT !== undefined) {
    const normalized = String(process.env.CLAUDE_SUPPORTS_IMAGE_INPUT).trim().toLowerCase();
    supportsClaudeDevImageFlagCache = normalized === '1'
      || normalized === 'true'
      || normalized === 'yes'
      || normalized === 'on';
    return supportsClaudeDevImageFlagCache;
  }

  try {
    const help = spawnSync('claude', ['--help'], {
      shell: true,
      cwd: PROJECT_ROOT,
      env: { ...process.env, CLAUDECODE: undefined },
      encoding: 'utf8',
      timeout: CLAUDE_DEV_IMAGE_HELP_TIMEOUT_MS,
    });
    const text = `${help.stdout || ''}\n${help.stderr || ''}`.toLowerCase();
    supportsClaudeDevImageFlagCache = text.includes('--image');
  } catch {
    supportsClaudeDevImageFlagCache = false;
  }
  return supportsClaudeDevImageFlagCache;
}

function appendImagePathsToPrompt(prompt, imagePaths) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return prompt;
  const lines = [
    'Attached image files are available at these local paths:',
    ...imagePaths.map((filePath, index) => `${index + 1}. ${filePath}`),
    'Inspect these files as part of the task.',
  ];
  return `${prompt}\n\n${lines.join('\n')}`;
}

function addCompatibilityImageAccessArgs(args, filePaths) {
  args.push('--permission-mode', 'bypassPermissions');
  const directories = new Set(
    (Array.isArray(filePaths) ? filePaths : [])
      .map((filePath) => path.dirname(filePath))
      .filter(Boolean)
  );
  for (const directory of directories) {
    args.push('--add-dir', directory);
  }
}

function publicDevImagePathToRelative(publicPath) {
  if (typeof publicPath !== 'string') return null;
  const trimmed = publicPath.trim();
  if (!trimmed.startsWith('/uploads/dev-mode/')) return null;
  return trimmed.replace(/^\/uploads\//, '');
}

function resolveStoredDevImageRef(imageRef) {
  const relativePath = publicDevImagePathToRelative(imageRef);
  if (!relativePath) return null;
  const absolutePath = path.resolve(UPLOADS_ROOT, relativePath);
  if (!isPathWithinRoot(DEV_MODE_UPLOADS_DIR, absolutePath)) return null;
  if (!fs.existsSync(absolutePath)) return null;
  return {
    publicPath: `/uploads/${relativePath.replace(/\\/g, '/')}`,
    relativePath: relativePath.replace(/\\/g, '/'),
    filePath: absolutePath,
  };
}

function mimeSubtypeToExtension(subtype) {
  const normalized = String(subtype || '').toLowerCase();
  if (!normalized) return 'png';
  if (normalized === 'jpeg' || normalized === 'pjpeg') return 'jpg';
  if (normalized === 'svg+xml') return 'svg';
  if (normalized === 'x-icon' || normalized === 'vnd.microsoft.icon') return 'ico';
  const clean = normalized.replace(/[^a-z0-9]/g, '');
  return clean || 'png';
}

function decodeDevImageInput(imageInput) {
  const input = typeof imageInput === 'string' ? imageInput.trim() : '';
  if (!input) {
    const err = new Error('Image payload is empty');
    err.code = 'INVALID_IMAGE';
    throw err;
  }

  const dataUrlMatch = input.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
  const subtype = dataUrlMatch ? dataUrlMatch[1] : '';
  const payload = (dataUrlMatch ? dataUrlMatch[2] : input).replace(/\s+/g, '');

  if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
    const err = new Error('Unable to decode image payload');
    err.code = 'INVALID_IMAGE';
    throw err;
  }

  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length) {
    const err = new Error('Unable to decode image payload');
    err.code = 'INVALID_IMAGE';
    throw err;
  }

  return {
    buffer,
    extension: mimeSubtypeToExtension(subtype),
  };
}

function persistDevImages(conversationId, images) {
  const conversationDir = path.join(DEV_MODE_UPLOADS_DIR, String(conversationId));
  if (!fs.existsSync(conversationDir)) {
    fs.mkdirSync(conversationDir, { recursive: true });
  }

  const storedImages = [];
  const localPaths = [];
  const writtenFiles = [];

  try {
    for (const image of images) {
      const existing = resolveStoredDevImageRef(image);
      if (existing) {
        storedImages.push(existing.publicPath);
        localPaths.push(existing.filePath);
        continue;
      }

      const decoded = decodeDevImageInput(image);
      const fileName = `${Date.now()}-${randomUUID()}.${decoded.extension}`;
      const filePath = path.join(conversationDir, fileName);
      fs.writeFileSync(filePath, decoded.buffer);
      writtenFiles.push(filePath);
      storedImages.push(`/uploads/dev-mode/${conversationId}/${fileName}`);
      localPaths.push(filePath);
    }

    return { storedImages, localPaths };
  } catch (err) {
    for (const filePath of writtenFiles) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
    throw err;
  }
}

function collectConversationImageRefs(conversation) {
  if (!conversation || !Array.isArray(conversation.messages)) return [];
  const refs = [];
  for (const message of conversation.messages) {
    if (!Array.isArray(message.images)) continue;
    for (const imageRef of message.images) {
      if (typeof imageRef === 'string' && imageRef.trim()) refs.push(imageRef.trim());
    }
  }
  return refs;
}

function cleanupStoredDevImages(imageRefs) {
  const touchedDirs = new Set();
  for (const imageRef of imageRefs) {
    const resolved = resolveStoredDevImageRef(imageRef);
    if (!resolved) continue;
    try {
      if (fs.existsSync(resolved.filePath)) fs.unlinkSync(resolved.filePath);
      touchedDirs.add(path.dirname(resolved.filePath));
    } catch { /* ignore */ }
  }

  for (const dirPath of touchedDirs) {
    try {
      if (!fs.existsSync(dirPath)) continue;
      const entries = fs.readdirSync(dirPath);
      if (entries.length === 0) fs.rmdirSync(dirPath);
    } catch { /* ignore */ }
  }
}

function buildConversationPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const lines = [];
  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(prefix + ': ' + (msg.content || ''));
    if (Array.isArray(msg.images) && msg.images.length > 0) {
      const filePaths = msg.images
        .map((imageRef) => resolveStoredDevImageRef(imageRef))
        .filter(Boolean)
        .map((image) => image.filePath);
      if (filePaths.length > 0) {
        lines.push(`${prefix} attached image files:\n${filePaths.map((filePath, index) => `${index + 1}. ${filePath}`).join('\n')}`);
      }
    }
  }
  lines.push('Assistant:');
  return lines.join('\n\n');
}

function classifyEvent(msg, options = {}) {
  const provider = options.provider || 'claude';
  if (!msg) return 'unknown';

  if (getProviderFamily(provider) === 'codex') {
    if (msg.item && msg.item.type) {
      const type = String(msg.item.type).toLowerCase();
      if (type.includes('tool') && type.includes('result')) return 'tool_result';
      if (type.includes('tool')) return 'tool_use';
      if (type === 'agent_message') return 'text';
    }
    if (msg.type === 'tool_result') return 'tool_result';
    if (msg.type === 'result') return 'result';
    if (typeof msg.delta === 'string' || (msg.delta && typeof msg.delta.text === 'string')) return 'delta';
    return 'unknown';
  }

  if (!msg.type) return 'unknown';
  switch (msg.type) {
    case 'system':
      return 'system';
    case 'assistant':
      if (msg.message && msg.message.content) {
        const hasToolUse = msg.message.content.some((b) => b.type === 'tool_use');
        if (hasToolUse) return 'tool_use';
        const hasText = msg.message.content.some((b) => b.type === 'text');
        if (hasText) return 'text';
      }
      return 'assistant';
    case 'tool_result':
      return 'tool_result';
    case 'result':
      return 'result';
    case 'content_block_delta':
      return 'delta';
    default:
      return 'unknown';
  }
}

function extractTextChunk(msg, options = {}) {
  const provider = options.provider || 'claude';
  const seenAgentTextByItem = options.seenAgentTextByItem || new Map();
  if (!msg) return '';

  if (getProviderFamily(provider) === 'codex') {
    if (msg.item && msg.item.type === 'agent_message' && typeof msg.item.text === 'string') {
      const id = msg.item.id || '__default__';
      const prevText = seenAgentTextByItem.get(id) || '';
      const nextText = msg.item.text;
      seenAgentTextByItem.set(id, nextText);
      if (nextText.startsWith(prevText)) return nextText.slice(prevText.length);
      return nextText;
    }
    if (typeof msg.delta === 'string') return msg.delta;
    if (msg.delta && typeof msg.delta.text === 'string') return msg.delta.text;
    if (msg.type === 'result' && typeof msg.result === 'string') return msg.result;
    return '';
  }

  if (!msg.type) return '';
  if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  if (msg.type === 'content_block_delta' && msg.delta && typeof msg.delta.text === 'string') {
    return msg.delta.text;
  }
  if (msg.type === 'result' && typeof msg.result === 'string') {
    return msg.result;
  }
  return '';
}

function toToolEvents(msg, options = {}) {
  const provider = options.provider || 'claude';
  if (!msg) return [];

  if (getProviderFamily(provider) === 'codex') {
    if (msg.type === 'tool_result') {
      return [{
        tool: msg.name || 'tool_result',
        status: msg.is_error ? 'error' : 'success',
        details: msg,
      }];
    }
    if (msg.item && msg.item.type) {
      const type = String(msg.item.type).toLowerCase();
      const toolName = msg.item.name || msg.item.tool_name || msg.item.tool || msg.item.type;
      if (type.includes('tool') && type.includes('result')) {
        const status = msg.item.is_error || msg.item.error ? 'error' : 'success';
        return [{
          tool: toolName,
          status,
          details: msg.item,
        }];
      }
      if (type.includes('tool')) {
        return [{
          tool: toolName,
          status: 'started',
          details: msg.item.input || msg.item,
        }];
      }
    }
    return [];
  }

  if (!msg.type) return [];
  if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        tool: block.name || 'tool_use',
        status: 'started',
        details: block.input || {},
      }));
  }
  if (msg.type === 'tool_result') {
    return [{
      tool: msg.name || 'tool_result',
      status: msg.is_error ? 'error' : 'success',
      details: msg,
    }];
  }
  return [];
}

function toToolEvent(msg, options = {}) {
  const events = toToolEvents(msg, options);
  return events.length > 0 ? events[0] : null;
}

function getDevChatMaxImages() {
  return parsePositiveInt(process.env.DEV_CHAT_MAX_IMAGES_PER_REQUEST, DEFAULT_DEV_MAX_IMAGES);
}

function getDevChatMaxImageBytes() {
  return parsePositiveInt(process.env.DEV_CHAT_MAX_IMAGE_BYTES, DEFAULT_DEV_MAX_IMAGE_BYTES);
}

function getDevChatMaxTotalImageBytes() {
  return parsePositiveInt(process.env.DEV_CHAT_MAX_TOTAL_IMAGE_BYTES, DEFAULT_DEV_MAX_TOTAL_IMAGE_BYTES);
}

function extractBase64Payload(image) {
  const trimmed = typeof image === 'string' ? image.trim() : '';
  const dataUrlMatch = trimmed.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,([\s\S]+)$/);
  return dataUrlMatch ? dataUrlMatch[1].replace(/\s+/g, '') : trimmed.replace(/\s+/g, '');
}

function normalizeDevImages(images) {
  if (images === undefined || images === null) {
    return { ok: true, images: [], totalBytes: 0 };
  }
  if (!Array.isArray(images)) {
    return { ok: false, code: 'INVALID_IMAGES', error: 'images must be an array of base64 strings or stored dev upload paths' };
  }
  if (images.length > getDevChatMaxImages()) {
    return {
      ok: false,
      code: 'TOO_MANY_IMAGES',
      error: `Maximum ${getDevChatMaxImages()} images per request`,
    };
  }

  const maxImageBytes = getDevChatMaxImageBytes();
  const maxTotalBytes = getDevChatMaxTotalImageBytes();
  const normalizedImages = [];
  let totalBytes = 0;

  for (const rawImage of images) {
    if (typeof rawImage !== 'string') {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Each image must be a string' };
    }
    const trimmed = rawImage.trim();
    if (!trimmed) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Each image must be a non-empty string' };
    }

    const stored = resolveStoredDevImageRef(trimmed);
    if (stored) {
      const bytes = fs.statSync(stored.filePath).size;
      if (bytes > maxImageBytes) {
        return {
          ok: false,
          code: 'IMAGE_TOO_LARGE',
          error: `Image exceeds ${maxImageBytes} bytes`,
        };
      }

      totalBytes += bytes;
      if (totalBytes > maxTotalBytes) {
        return {
          ok: false,
          code: 'IMAGES_TOO_LARGE',
          error: `Total image payload exceeds ${maxTotalBytes} bytes`,
        };
      }
      normalizedImages.push(stored.publicPath);
      continue;
    }

    const payload = extractBase64Payload(trimmed);
    if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Unable to decode image payload' };
    }

    const bytes = Buffer.from(payload, 'base64').length;
    if (!bytes) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Unable to decode image payload' };
    }
    if (bytes > maxImageBytes) {
      return {
        ok: false,
        code: 'IMAGE_TOO_LARGE',
        error: `Image exceeds ${maxImageBytes} bytes`,
      };
    }

    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      return {
        ok: false,
        code: 'IMAGES_TOO_LARGE',
        error: `Total image payload exceeds ${maxTotalBytes} bytes`,
      };
    }
    normalizedImages.push(trimmed);
  }

  return { ok: true, images: normalizedImages, totalBytes };
}

function buildProviderCommand({
  providerId,
  message,
  resumeSessionId,
  historyMessages,
  imagePaths,
  reasoningEffort,
  systemPrompt,
}) {
  const family = getProviderFamily(providerId);
  if (family === 'codex') {
    const codexModel = getProviderModelId(providerId) || CODEX_DEV_MODEL;
    const effectiveReasoningEffort = normalizeDevReasoningEffort(reasoningEffort);
    const args = [
      'exec',
      '--json',
      '--model', codexModel,
      '-c', `reasoning_effort="${effectiveReasoningEffort}"`,
      '--skip-git-repo-check',
    ];
    if (Array.isArray(imagePaths)) {
      for (const imgPath of imagePaths) {
        args.push('--image', imgPath);
      }
    }
    args.push('-');
    let codexStdin = buildConversationPrompt(historyMessages);
    if (systemPrompt) {
      codexStdin = `System instructions:\n${systemPrompt}\n\n${codexStdin}`;
    }
    return {
      command: 'codex',
      args,
      stdinText: codexStdin,
      supportsSessionResume: false,
    };
  }

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];
  const claudeModel = getProviderModelId(providerId);
  if (claudeModel) args.push('--model', claudeModel);
  args.push('--effort', normalizeClaudeDevEffort(reasoningEffort));
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  let stdinText = resumeSessionId ? message : buildConversationPrompt(historyMessages);
  // Prepend system prompt only for non-resume spawns (resume sessions already have it)
  if (systemPrompt && !resumeSessionId) {
    stdinText = `System instructions:\n${systemPrompt}\n\n${stdinText}`;
  }
  if (Array.isArray(imagePaths) && imagePaths.length > 0) {
    if (supportsClaudeDevImageFlag()) {
      for (const imgPath of imagePaths) {
        args.push('--image', imgPath);
      }
    } else {
      stdinText = appendImagePathsToPrompt(stdinText, imagePaths);
      addCompatibilityImageAccessArgs(args, imagePaths);
    }
  }
  return {
    command: 'claude',
    args,
    stdinText,
    supportsSessionResume: true,
  };
}

function runDevAttempt({
  providerId,
  message,
  resumeSessionId,
  historyMessages,
  imagePaths,
  reasoningEffort,
  systemPrompt,
  timeoutMs,
  sessionEntry,
  writeEvent,
  onSession,
}) {
  const startedAt = Date.now();
  const seenAgentTextByItem = new Map();
  const cmd = buildProviderCommand({
    providerId,
    message,
    resumeSessionId,
    historyMessages,
    imagePaths,
    reasoningEffort,
    systemPrompt,
  });

  return new Promise((resolve) => {
    let settled = false;
    let killed = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let stderrRaw = '';
    let assistantText = '';
    const capturedToolEvents = [];
    const capturedNormalizedToolEvents = [];
    let capturedSessionId = resumeSessionId || null;
    let capturedUsage = null;

    // shell: true required on Windows where claude/codex may be .cmd shims.
    // User content is piped via stdin — never passed as a CLI argument.
    const child = spawn(cmd.command, cmd.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      cwd: PROJECT_ROOT,
      env: { ...process.env, CLAUDECODE: undefined },
    });

    sessionEntry.child = child;
    sessionEntry.provider = providerId;
    sessionEntry.updatedAt = Date.now();
    sessionEntry.phase = 'spawning';

    if (cmd.stdinText) {
      child.stdin.write(cmd.stdinText);
      child.stdin.end();
    }

    function finalize(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    function processParsedMessage(msg) {
      if (getProviderFamily(providerId) === 'claude' && msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
        capturedSessionId = msg.session_id;
        onSession?.(capturedSessionId);
        writeEvent('session', { provider: providerId, sessionId: capturedSessionId });
      }

      const textChunk = extractTextChunk(msg, { provider: providerId, seenAgentTextByItem });
      if (textChunk) {
        assistantText += textChunk;
        writeEvent('chunk', { provider: providerId, text: textChunk });
      }

      const usageFromMsg = extractUsageFromMessage(msg, providerId);
      if (usageFromMsg) capturedUsage = usageFromMsg;

      const toolEvents = toToolEvents(msg, { provider: providerId });
      for (const toolEvent of toolEvents) {
        if (capturedToolEvents.length < 200) capturedToolEvents.push(toolEvent);
        if (capturedNormalizedToolEvents.length < 200) capturedNormalizedToolEvents.push(normalizeToolEvent(toolEvent, providerId));
        const eventName = toolEvent.status === 'started' ? 'tool_use' : 'tool_result';
        writeEvent(eventName, { provider: providerId, ...toolEvent });
      }
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      killed = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const error = normalizeProviderError(providerId, {
        code: 'TIMEOUT',
        message: `Dev attempt timed out after ${timeoutMs}ms`,
      }, 'TIMEOUT');
      reportServerError({
        message: `Dev CLI timeout: ${providerId} after ${timeoutMs}ms`,
        detail: 'The dev agent CLI subprocess did not complete within the allowed time limit.',
        source: 'dev.js',
        category: 'runtime-error',
      });
      finalize({
        ok: false,
        provider: providerId,
        error,
        usage: capturedUsage,
        latencyMs: Date.now() - startedAt,
      });
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      if (settled) return;
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          processParsedMessage(msg);
        } catch {
          writeEvent('log', { provider: providerId, text: line });
        }
      }
    });

    child.stderr.on('data', (data) => {
      if (settled) return;
      if (stderrRaw.length < 20480) stderrRaw += data.toString();
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        writeEvent('stderr', { provider: providerId, text: line });
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      sessionEntry.child = null;
      sessionEntry.updatedAt = Date.now();

      if (stdoutBuffer.trim()) {
        try {
          processParsedMessage(JSON.parse(stdoutBuffer));
        } catch { /* ignore */ }
      }

      if (killed || sessionEntry.killed) {
        const error = normalizeProviderError(providerId, {
          code: 'ABORTED',
          message: 'Dev session aborted',
        }, 'ABORTED');
        finalize({
          ok: false,
          provider: providerId,
          error,
          usage: capturedUsage,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      if (!didCliExitSuccessfully(code)) {
        const baseMessage = formatDevCliFailure(providerId, code, stderrRaw || stderrBuffer);
        const error = normalizeProviderError(providerId, {
          code: 'PROVIDER_EXEC_FAILED',
          message: assistantText ? `${baseMessage} (partial output discarded)` : baseMessage,
        });
        reportServerError({
          message: `Dev CLI failed: ${providerId} exit ${code}`,
          detail: `stderr: ${(stderrRaw || stderrBuffer || '').slice(0, 500)}`,
          source: 'dev.js',
          category: 'runtime-error',
        });
        finalize({
          ok: false,
          provider: providerId,
          error,
          usage: capturedUsage,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      finalize({
        ok: true,
        provider: providerId,
        sessionId: cmd.supportsSessionResume ? capturedSessionId : null,
        assistantText,
        toolEvents: capturedToolEvents,
        normalizedToolEvents: capturedNormalizedToolEvents,
        usage: capturedUsage,
        latencyMs: Date.now() - startedAt,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (settled) return;
      sessionEntry.child = null;
      sessionEntry.updatedAt = Date.now();
      const error = normalizeProviderError(providerId, err);
      reportServerError({
        message: `Dev CLI spawn error: ${err.message}`,
        detail: `The ${providerId} CLI process emitted an error event.`,
        stack: err.stack || '',
        source: 'dev.js',
        category: 'runtime-error',
      });
      finalize({
        ok: false,
        provider: providerId,
        error,
        usage: capturedUsage,
        latencyMs: Date.now() - startedAt,
      });
    });
  });
}

async function handleDevChatRequest(req, res, {
  defaultChannelType = DEFAULT_CHANNEL_TYPE,
  allowedChannelTypes = DEV_CHANNEL_TYPES,
  collapseDuplicateIncidents = false,
} = {}) {
  const {
    message,
    images,
    conversationId,
    sessionId,
    channelType,
    provider, // backward-compat alias for primaryProvider
    primaryProvider,
    mode,
    fallbackProvider,
    timeoutMs,
    reasoningEffort,
    incidentMeta,
    incidentContext,
  } = req.body || {};
  const allowedChannels = allowedChannelTypes instanceof Set
    ? allowedChannelTypes
    : new Set(Array.isArray(allowedChannelTypes) ? allowedChannelTypes : [defaultChannelType]);

  if (message !== undefined && typeof message !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_MESSAGE', error: 'message must be a string' });
  }
  const normalizedImagesResult = normalizeDevImages(images);
  if (!normalizedImagesResult.ok) {
    return res.status(400).json({
      ok: false,
      code: normalizedImagesResult.code,
      error: normalizedImagesResult.error,
    });
  }
  const normalizedImages = normalizedImagesResult.images;
  const normalizedMessage = typeof message === 'string' ? message.trim() : '';
  if (!normalizedMessage && normalizedImages.length === 0) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'message or images required' });
  }
  const incidentMessage = normalizedMessage || '(image attached)';
  if (provider !== undefined && !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported provider' });
  }
  if (primaryProvider !== undefined && !isValidProvider(primaryProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported primary provider' });
  }
  if (fallbackProvider !== undefined && !isValidProvider(fallbackProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported fallback provider' });
  }
  if (!isValidMode(mode)) {
    return res.status(400).json({ ok: false, code: 'INVALID_MODE', error: 'Unsupported mode' });
  }
  if (mode === 'parallel') {
    return res.status(400).json({ ok: false, code: 'UNSUPPORTED_MODE', error: 'Dev mode does not support parallel' });
  }

  if (channelType !== undefined && (typeof channelType !== 'string' || !allowedChannels.has(channelType))) {
    return res.status(400).json({ ok: false, code: 'INVALID_CHANNEL', error: 'Unsupported channel type' });
  }
  if (incidentMeta !== undefined && (incidentMeta === null || typeof incidentMeta !== 'object' || Array.isArray(incidentMeta))) {
    return res.status(400).json({ ok: false, code: 'INVALID_INCIDENT_META', error: 'incidentMeta must be an object' });
  }
  if (incidentContext !== undefined && (incidentContext === null || typeof incidentContext !== 'object' || Array.isArray(incidentContext))) {
    return res.status(400).json({ ok: false, code: 'INVALID_INCIDENT_CONTEXT', error: 'incidentContext must be an object' });
  }

  const resolvedChannelType = channelType || defaultChannelType;
  if (!allowedChannels.has(resolvedChannelType)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CHANNEL', error: 'Unsupported channel type' });
  }

  let monitorIncidentKey = null;
  let monitorIncidentClosed = false;
  function getConversationIdValue() {
    return conversation && conversation._id ? conversation._id.toString() : null;
  }
  function closeMonitorIncident(status, error = null, finalConversationId = null) {
    if (monitorIncidentClosed || !monitorIncidentKey) return;
    const result = finishMonitorIncident(monitorIncidentKey, {
      status,
      error,
      conversationId: finalConversationId,
    });
    monitorIncidentClosed = true;
    return result;
  }

  let conversation = null;
  if (conversationId) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ ok: false, code: 'INVALID_ID', error: 'Invalid conversation ID format' });
    }
    conversation = await DevConversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Dev conversation not found' });
    }
    if (channelType !== undefined && resolvedChannelType !== (conversation.channelType || DEFAULT_CHANNEL_TYPE)) {
      return res.status(409).json({
        ok: false,
        code: 'CHANNEL_MISMATCH',
        error: 'Conversation channel does not match requested channel type',
      });
    }
  }

  if (collapseDuplicateIncidents) {
    const incidentDecision = beginMonitorIncident({
      channelType: resolvedChannelType,
      message: incidentMessage,
      conversationId: conversation ? conversation._id.toString() : (conversationId || null),
      metadata: incidentMeta,
    });
    monitorIncidentKey = incidentDecision.incidentKey || null;

    if (incidentDecision.action === 'collapse') {
      const collapsedConversationId = conversation
        ? conversation._id.toString()
        : (conversationId || incidentDecision.incident?.lastConversationId || null);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('event: start\ndata: ' + JSON.stringify({
        conversationId: collapsedConversationId,
        requestId: req.requestId,
        channelType: resolvedChannelType,
        collapsed: true,
        collapseReason: incidentDecision.reason || 'duplicate',
      }) + '\n\n');
      res.write('event: done\ndata: ' + JSON.stringify({
        conversationId: collapsedConversationId,
        collapsed: true,
        collapseReason: incidentDecision.reason || 'duplicate',
        incident: incidentDecision.incident || null,
        usage: null,
        usageAvailable: false,
      }) + '\n\n');
      try { res.end(); } catch { /* ignore */ }
      monitorIncidentClosed = true;
      return;
    }
  }

  if (!conversation) {
    conversation = new DevConversation({
      title: normalizedMessage.slice(0, 80) || 'New Dev Session',
      provider: normalizeProvider(primaryProvider || provider || DEFAULT_PROVIDER),
      channelType: resolvedChannelType,
      messages: [],
    });
    await conversation.save();
  }

  const previousProvider = conversation.provider || DEFAULT_PROVIDER;
  const requestedPrimary = primaryProvider || provider || conversation.provider || DEFAULT_PROVIDER;
  const policy = resolvePolicy({
    mode,
    primaryProvider: requestedPrimary,
    fallbackProvider,
  });
  if (policy.mode === 'fallback' && policy.fallbackProvider === policy.primaryProvider) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_FALLBACK_PROVIDER',
      error: 'fallbackProvider must differ from primaryProvider in fallback mode',
    });
  }

  conversation.provider = policy.primaryProvider;
  if (getProviderFamily(policy.primaryProvider) !== 'claude') {
    conversation.sessionId = '';
  }

  // Retrieve relevant agent memory with a 500ms timeout (non-blocking fallback)
  let memoryEntries = [];
  try {
    const memoryPromise = retrieveRelevantMemory(normalizedMessage);
    const memoryTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('memory timeout')), 500));
    memoryEntries = await Promise.race([memoryPromise, memoryTimeout]).catch(() => []);
  } catch { memoryEntries = []; }

  // Build system prompt with memory entries and compute context hash
  const memorySelectionBasis = memoryEntries.length > 0
    ? memoryEntries.map(e => e._id ? String(e._id) : '').filter(Boolean).join(',')
    : '';
  const currentSystemPrompt = buildDevSystemPrompt(getProviderFamily(policy.primaryProvider), memoryEntries);
  const currentContextHash = computeContextHash({ rolePrompt: currentSystemPrompt, memorySelectionBasis });

  const persistedImages = persistDevImages(conversation._id, normalizedImages);
  const effectiveUserContent = resolvedChannelType === DEFAULT_CHANNEL_TYPE
    ? (normalizedMessage || '(image attached)')
    : buildMonitorPromptContent({
      message: normalizedMessage || '(image attached)',
      channelType: resolvedChannelType,
      incidentMeta,
      incidentContext,
      requestId: req.requestId,
    });
  conversation.messages.push({
    role: 'user',
    content: effectiveUserContent,
    images: persistedImages.storedImages,
    meta: resolvedChannelType === DEFAULT_CHANNEL_TYPE ? null : {
      incidentMeta: sanitizeIncidentContext(incidentMeta),
      incidentContext: sanitizeIncidentContext(incidentContext),
      requestId: req.requestId || null,
      channelType: resolvedChannelType,
    },
    timestamp: new Date(),
  });

  // Check for context drift BEFORE mutating conversation.contextHash.
  const storedContextHash = conversation.contextHash || '';
  const hashChanged = currentContextHash !== storedContextHash;

  // Store contextHash on new conversations or when hash changes (context drift).
  if (!conversationId || hashChanged) {
    conversation.contextHash = currentContextHash;
    // Hash mismatch on an existing conversation means context inputs changed —
    // clear the sessionId so the CLI starts fresh with the new system prompt.
    if (conversationId && hashChanged) {
      conversation.sessionId = '';
    }
  }
  await conversation.save();

  const resumeSessionId = shouldResumeClaudeSession(
    policy.primaryProvider, previousProvider, currentContextHash, storedContextHash
  )
    ? (sessionId || conversation.sessionId || null)
    : null;
  const historyMessages = conversation.messages.map((m) => ({
    role: m.role,
    content: m.content || '',
    images: Array.isArray(m.images) ? m.images : [],
  }));
  const imagePaths = persistedImages.localPaths;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let streamClosed = false;
  function markSessionActivity(eventName) {
    sessionEntry.updatedAt = Date.now();
    sessionEntry.lastEvent = eventName;
    if (eventName === 'start') sessionEntry.phase = 'starting';
    else if (eventName === 'chunk' || eventName === 'session') sessionEntry.phase = 'streaming';
    else if (eventName === 'tool_use' || eventName === 'tool_result') sessionEntry.phase = 'tools';
    else if (eventName === 'fallback') sessionEntry.phase = 'fallback';
    else if (eventName === 'provider_error') sessionEntry.phase = 'provider_error';
    else if (eventName === 'done') sessionEntry.phase = 'done';
    else if (eventName === 'error') sessionEntry.phase = 'error';
    sessionEntry.eventCount = (sessionEntry.eventCount || 0) + 1;
  }

  function writeEvent(eventName, payload) {
    if (streamClosed) return false;
    markSessionActivity(eventName);
    try {
      res.write('event: ' + eventName + '\ndata: ' + JSON.stringify(payload) + '\n\n');
      return true;
    } catch {
      return false;
    }
  }

  function endStream() {
    if (streamClosed) return;
    streamClosed = true;
    try { res.end(); } catch { /* ignore */ }
  }

  const sessionKey = Date.now().toString(36);
  const sessionEntry = {
    child: null,
    killed: false,
    provider: policy.primaryProvider,
    conversationId: conversation._id.toString(),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    phase: 'starting',
    lastEvent: 'init',
    eventCount: 0,
  };
  activeSessions.set(sessionKey, sessionEntry);

  const sequence = policy.mode === 'fallback' && policy.fallbackProvider !== policy.primaryProvider
    ? [policy.primaryProvider, policy.fallbackProvider]
    : [policy.primaryProvider];
  const attempts = [];
  let finalSessionId = resumeSessionId;
  let fallbackFrom = null;

  writeEvent('start', {
    sessionKey,
    conversationId: conversation._id.toString(),
    requestId: req.requestId,
    provider: policy.primaryProvider, // backward-compat
    primaryProvider: policy.primaryProvider,
    fallbackProvider: policy.mode === 'fallback' ? policy.fallbackProvider : null,
    mode: policy.mode,
    incidentKey: monitorIncidentKey || null,
    incidentState: collapseDuplicateIncidents && monitorIncidentKey ? 'active' : null,
  });

  const devRequestId = req.requestId;
  let devStreamSettled = false;

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    sessionEntry.killed = true;
    sessionEntry.updatedAt = Date.now();
    sessionEntry.phase = devStreamSettled ? 'done' : 'aborted';
    if (sessionEntry.child) {
      try { sessionEntry.child.kill('SIGTERM'); } catch { /* ignore */ }
      sessionEntry.child = null;
    }
    activeSessions.delete(sessionKey);
  };

  req.on('close', () => {
    if (!devStreamSettled) {
      closeMonitorIncident('aborted', null, getConversationIdValue());
    }
    if (!devStreamSettled) cleanup();
  });

  (async () => {
    try {
      for (let i = 0; i < sequence.length; i++) {
        if (sessionEntry.killed || streamClosed) return;

        const providerId = sequence[i];
        const effectiveTimeoutMs = parseBoundedPositiveInt(timeoutMs, DEV_CHAT_TIMEOUT_MS, DEV_CHAT_MAX_TIMEOUT_MS);

        // System prompt: inject on first spawn, skip on resume (session already has it).
        // For fallback attempts (i > 0), recompute for the new provider family.
        const attemptSystemPrompt = finalSessionId
          ? null
          : buildDevSystemPrompt(getProviderFamily(providerId), memoryEntries);

        const attemptResult = await runDevAttempt({
          providerId,
          message: normalizedMessage || '(image attached)',
          resumeSessionId: finalSessionId,
          historyMessages,
          imagePaths,
          reasoningEffort,
          systemPrompt: attemptSystemPrompt,
          timeoutMs: effectiveTimeoutMs,
          sessionEntry,
          writeEvent,
          onSession: (newSessionId) => {
            finalSessionId = newSessionId;
          },
        });

        // R17: Always log usage BEFORE checking killed guard
        const attemptUsage = attemptResult.usage || {};
        logUsage({
          requestId: devRequestId, attemptIndex: i, service: 'dev', provider: providerId,
          model: attemptUsage.model, inputTokens: attemptUsage.inputTokens, outputTokens: attemptUsage.outputTokens,
          usageAvailable: !!attemptResult.usage, usageComplete: attemptUsage.usageComplete, rawUsage: attemptUsage.rawUsage,
          conversationId: conversation._id, mode: policy.mode,
          status: attemptResult.ok ? 'ok'
            : sessionEntry.killed ? 'abort'
            : (attemptResult.error && attemptResult.error.code === 'TIMEOUT') ? 'timeout'
            : 'error',
          latencyMs: attemptResult.latencyMs,
        });

        if (sessionEntry.killed || streamClosed) return;

        if (attemptResult.ok) {
          attempts.push({
            provider: providerId,
            status: 'ok',
            latencyMs: attemptResult.latencyMs,
          });

          conversation.provider = providerId;
          if (getProviderFamily(providerId) === 'claude') {
            if (attemptResult.sessionId) {
              conversation.sessionId = attemptResult.sessionId;
              finalSessionId = attemptResult.sessionId;
            }
          } else {
            conversation.sessionId = '';
            finalSessionId = null;
          }
          const devUsageSubdoc = attemptResult.usage ? {
            inputTokens: attemptResult.usage.inputTokens || 0,
            outputTokens: attemptResult.usage.outputTokens || 0,
            totalTokens: (attemptResult.usage.inputTokens || 0) + (attemptResult.usage.outputTokens || 0),
            model: attemptResult.usage.model || null,
            totalCostMicros: calculateCost(attemptResult.usage.inputTokens || 0, attemptResult.usage.outputTokens || 0, attemptResult.usage.model, null).totalCostMicros,
            usageAvailable: true,
            rawUsage: attemptResult.usage.rawUsage || null,
          } : null;
          conversation.messages.push({
            role: 'assistant',
            content: attemptResult.assistantText || '',
            toolEvents: attemptResult.toolEvents || [],
            provider: providerId,
            mode: policy.mode,
            fallbackFrom: fallbackFrom || null,
            attemptMeta: { attempts },
            usage: devUsageSubdoc,
            timestamp: new Date(),
          });
          await conversation.save();

          // Agent memory: log action + track files (async fire-and-forget)
          const normalizedEvents = attemptResult.normalizedToolEvents || [];
          const filesAffected = extractFilesFromNormalized(normalizedEvents);
          const actionType = incidentMessage.startsWith('[AUTO-ERROR]') ? 'error-fix'
            : incidentMessage.startsWith('[AUTO-REVIEW]') ? 'code-review'
            : incidentMessage.startsWith('[IDLE-SCAN]') ? 'idle-scan'
            : 'user-request';
          logAgentAction({
            type: actionType,
            summary: incidentMessage.slice(0, 500),
            detail: (attemptResult.assistantText || '').slice(0, 5000),
            resolution: extractResolution(attemptResult.assistantText),
            category: classifyCategory(normalizedMessage, filesAffected),
            filesAffected,
            conversationId: conversation._id,
            provider: providerId,
            tokens: attemptResult.usage ? {
              input: attemptResult.usage.inputTokens || 0,
              output: attemptResult.usage.outputTokens || 0,
            } : undefined,
          }).catch(() => {}); // fire-and-forget
          if (filesAffected.length > 0) {
            addToRecentAgentFiles(filesAffected);
          }

          devStreamSettled = true;
          const monitorIncident = closeMonitorIncident('resolved', null, conversation._id.toString());
          writeEvent('done', {
            sessionId: getProviderFamily(providerId) === 'claude' ? (finalSessionId || null) : null,
            conversationId: conversation._id.toString(),
            provider: providerId, // backward-compat
            providerUsed: providerId,
            fallbackUsed: Boolean(fallbackFrom),
            fallbackFrom,
            mode: policy.mode,
            attempts,
            usage: devUsageSubdoc,
            usageAvailable: !!attemptResult.usage,
            incident: monitorIncident || null,
          });
          endStream();
          cleanup();
          return;
        }

        attempts.push({
          provider: providerId,
          status: 'error',
          latencyMs: attemptResult.latencyMs,
          errorCode: attemptResult.error.code,
          errorMessage: attemptResult.error.message,
        });

        writeEvent('provider_error', {
          provider: providerId,
          code: attemptResult.error.code,
          message: attemptResult.error.message,
          retriable: i < sequence.length - 1,
        });

        const hasNext = i < sequence.length - 1;
        if (!hasNext) {
          devStreamSettled = true;
          const monitorIncident = closeMonitorIncident('error', new Error(attemptResult.error.message || 'Dev chat failed'), getConversationIdValue());
          writeEvent('error', {
            error: attemptResult.error.message || 'Dev chat failed',
            code: attemptResult.error.code || 'PROVIDER_EXEC_FAILED',
            attempts,
            incident: monitorIncident || null,
          });
          endStream();
          cleanup();
          return;
        }

        const nextProvider = sequence[i + 1];
        fallbackFrom = providerId;
        writeEvent('fallback', {
          from: providerId,
          to: nextProvider,
          reason: attemptResult.error.code || 'PROVIDER_EXEC_FAILED',
        });
      }
    } catch (err) {
      if (sessionEntry.killed || streamClosed) return;
      const normalized = normalizeProviderError(policy.primaryProvider, err, 'INTERNAL');
      const monitorIncident = closeMonitorIncident('error', err, getConversationIdValue());
      writeEvent('error', {
        error: normalized.message,
        code: normalized.code,
        attempts,
        incident: monitorIncident || null,
      });
      endStream();
      cleanup();
    }
  })();
}

// POST /api/dev/chat -- Developer mode stream with persistent dev conversations
router.post('/chat', devChatRateLimit, async (req, res) => {
  return handleDevChatRequest(req, res, {
    defaultChannelType: DEFAULT_CHANNEL_TYPE,
    allowedChannelTypes: DEV_CHANNEL_TYPES,
    collapseDuplicateIncidents: false,
  });
});

// POST /api/dev/monitor -- Dedicated ingestion path for autonomous monitor traffic
router.post('/monitor', devMonitorRateLimit, async (req, res) => {
  return handleDevChatRequest(req, res, {
    defaultChannelType: DEFAULT_MONITOR_CHANNEL_TYPE,
    allowedChannelTypes: MONITOR_CHANNEL_TYPES,
    collapseDuplicateIncidents: true,
  });
});

// GET /api/dev/monitor -- Monitor status & incident health (read-only companion to POST ingestion)
router.get('/monitor', (req, res) => {
  let incidentHealth = {
    trackedIncidents: 0,
    activeIncidents: 0,
    collapsedIncidents: 0,
    totalForwarded: 0,
    totalSuppressed: 0,
    kindCounts: {},
    incidents: [],
  };
  try {
    incidentHealth = getMonitorIncidentHealth();
  } catch { /* monitor incidents not available */ }

  let remediationStatus = { totalAttempts: 0, activeAttempts: 0, verifiedAttempts: 0, partialAttempts: 0, failedAttempts: 0, recentAttempts: [] };
  try {
    remediationStatus = getRuntimeRemediationHealth();
  } catch { /* remediation runtime not available */ }

  res.json({
    ok: true,
    monitor: incidentHealth,
    remediation: remediationStatus,
  });
});

// POST /api/dev/monitor/incidents/transition -- Update incident state by metadata match
router.post('/monitor/incidents/transition', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const match = body.match && typeof body.match === 'object' && !Array.isArray(body.match) ? body.match : {};
  const state = typeof body.state === 'string' ? body.state.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 120) : null;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 400) : null;
  const error = typeof body.error === 'string' && body.error.trim()
    ? new Error(body.error.trim().slice(0, 400))
    : null;

  if (!state) {
    return res.status(400).json({ ok: false, code: 'INVALID_STATE', error: 'state is required' });
  }

  const incidents = transitionMonitorIncidentsByMetadata(match, state, {
    reason,
    note,
    error,
  });

  res.json({
    ok: true,
    matched: incidents.length,
    incidents,
  });
});

// GET /api/dev/memory -- Browse agent memory entries
router.get('/memory', async (req, res) => {
  const { type, limit = 20 } = req.query;
  const filter = type ? { type } : {};
  const maxLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
  const entries = await DevAgentLog.find(filter).sort({ createdAt: -1 }).limit(maxLimit).lean();
  res.json({ ok: true, count: entries.length, entries });
});

// PATCH /api/dev/memory/:id/pin -- Pin or unpin a memory entry
router.patch('/memory/:id/pin', async (req, res) => {
  const { id } = req.params;
  const pinned = req.body.pinned === true;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ID', error: 'Invalid memory entry ID' });
  }

  const update = pinned
    ? { pinned: true, expiresAt: null }
    : { pinned: false, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };

  const entry = await DevAgentLog.findByIdAndUpdate(id, update, { returnDocument: 'after' }).select('_id pinned expiresAt').lean();
  if (!entry) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Memory entry not found' });
  }

  res.json({ ok: true, entry: { _id: entry._id, pinned: entry.pinned, expiresAt: entry.expiresAt } });
});

// POST /api/dev/abort -- Abort a running dev session
router.post('/abort', (req, res) => {
  const { sessionKey } = req.body;
  if (!sessionKey) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'sessionKey required' });
  }

  const session = activeSessions.get(sessionKey);
  if (!session) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Session not found or already ended' });
  }

  session.killed = true;
  if (session.child) {
    try { session.child.kill('SIGTERM'); } catch { /* ignore */ }
    session.child = null;
  }
  activeSessions.delete(sessionKey);

  res.json({ ok: true });
});

// GET /api/dev/sessions -- List active dev sessions
router.get('/sessions', (req, res) => {
  const sessions = [];
  for (const [key, session] of activeSessions) {
    const now = Date.now();
    sessions.push({
      sessionKey: key,
      provider: session.provider || null,
      killed: session.killed,
      conversationId: session.conversationId || null,
      phase: session.phase || 'unknown',
      lastEvent: session.lastEvent || null,
      ageMs: session.startedAt ? now - session.startedAt : null,
      idleMs: session.updatedAt ? now - session.updatedAt : null,
      eventCount: session.eventCount || 0,
    });
  }
  res.json({ ok: true, sessions, count: sessions.length });
});

// GET /api/dev/conversations -- List persistent dev conversations
router.get('/conversations', async (req, res) => {
  // Fail fast when DB is not connected — prevents requests from hanging
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Database is not available' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const skip = parseInt(req.query.skip) || parseInt(req.query.offset) || 0;
  const search = (req.query.search || '').trim();
  const channelType = typeof req.query.channelType === 'string'
    ? req.query.channelType.trim()
    : DEFAULT_CHANNEL_TYPE;

  if (!DEV_CHANNEL_TYPES.has(channelType)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CHANNEL', error: 'Unsupported channel type' });
  }

  // Escape regex special chars to prevent regex injection / ReDoS
  const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = { channelType };
  if (escapedSearch) {
    filter.title = { $regex: escapedSearch, $options: 'i' };
  }

  try {
    // Aggregation pipeline projects only needed fields server-side,
    // avoiding transfer of the full messages array per conversation.
    const docs = await DevConversation.aggregate([
      { $match: filter },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: {
        title: 1,
        provider: 1,
        channelType: 1,
        sessionId: 1,
        createdAt: 1,
        updatedAt: 1,
        messageCount: { $size: { $ifNull: ['$messages', []] } },
        lastMessage: { $arrayElemAt: ['$messages', -1] },
      }},
    ]).option({ maxTimeMS: 8000 });

    const items = docs.map((doc) => {
      const lastMsg = doc.lastMessage || null;
      return {
        _id: doc._id,
        title: doc.title,
        provider: normalizeProvider(doc.provider),
        channelType: doc.channelType || DEFAULT_CHANNEL_TYPE,
        sessionId: doc.sessionId || null,
        messageCount: doc.messageCount || 0,
        lastMessage: lastMsg
          ? {
              role: lastMsg.role,
              preview: (lastMsg.content || '').slice(0, 120),
              provider: lastMsg.provider || null,
              timestamp: lastMsg.timestamp,
            }
          : null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    });

    const total = await DevConversation.countDocuments(filter).maxTimeMS(5000);
    res.json({ ok: true, conversations: items, total });
  } catch (err) {
    const isTimeout = err.codeName === 'MaxTimeMSExpired' || err.code === 50;
    res.status(isTimeout ? 504 : 500).json({
      ok: false,
      code: isTimeout ? 'QUERY_TIMEOUT' : 'LIST_FAILED',
      error: isTimeout ? 'Query timed out' : 'Failed to list dev conversations',
    });
  }
});

// Validate ObjectId format for all :id param routes
router.param('id', (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ID', error: 'Invalid ID format' });
  }
  next();
});

// GET /api/dev/conversations/:id -- Get full persistent dev conversation
router.get('/conversations/:id', async (req, res) => {
  const conversation = await DevConversation.findById(req.params.id).lean();
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Dev conversation not found' });
  }
  res.json({ ok: true, conversation });
});

// PATCH /api/dev/conversations/:id -- Rename dev conversation
router.patch('/conversations/:id', async (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (!title) {
    return res.status(400).json({ ok: false, code: 'MISSING_TITLE', error: 'title required' });
  }

  const conversation = await DevConversation.findByIdAndUpdate(
    req.params.id,
    { $set: { title: title.slice(0, 200) } },
    { returnDocument: 'after' }
  ).lean();

  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Dev conversation not found' });
  }
  res.json({ ok: true, conversation });
});

// DELETE /api/dev/conversations/:id/messages/last -- Remove the last message from a conversation
router.delete('/conversations/:id/messages/last', async (req, res) => {
  const conversation = await DevConversation.findById(req.params.id);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Dev conversation not found' });
  }
  if (!conversation.messages || conversation.messages.length === 0) {
    return res.status(400).json({ ok: false, code: 'NO_MESSAGES', error: 'Conversation has no messages' });
  }
  conversation.messages.pop();
  await conversation.save();
  res.json({ ok: true, messageCount: conversation.messages.length });
});

// DELETE /api/dev/conversations/:id -- Delete persistent dev conversation
router.delete('/conversations/:id', async (req, res) => {
  const deleted = await DevConversation.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Dev conversation not found' });
  }
  cleanupStoredDevImages(collectConversationImageRefs(deleted));
  res.json({ ok: true });
});

// GET /api/dev/file -- Read a project file (for diff display)
router.get('/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ ok: false, code: 'MISSING_PATH', error: 'path query param required' });
  }

  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!isPathWithinRoot(PROJECT_ROOT, resolved)) {
    return res.status(403).json({ ok: false, code: 'PATH_TRAVERSAL', error: 'Path must be within project' });
  }

  const basename = path.basename(resolved);
  if (basename === '.env' || basename.startsWith('.env.')) {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Cannot read environment files' });
  }

  const fs = require('fs');
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'File not found' });
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(resolved, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : null,
    }));
    return res.json({ ok: true, type: 'directory', entries });
  }

  if (stat.size > 1024 * 1024) {
    return res.status(413).json({ ok: false, code: 'TOO_LARGE', error: 'File too large (>1MB)' });
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  const ext = path.extname(resolved).slice(1);

  res.json({ ok: true, type: 'file', path: filePath, content, ext, size: stat.size });
});

// GET /api/dev/prompt-inspector -- Full transparency prompt breakdown
router.get('/prompt-inspector', async (req, res) => {
  const { getCachedClaudeMd, getCachedFileTreeText, buildFullSystemPrompt, snapshotPromptVersion, CAPS } = require('../lib/dev-context-builder');

  const now = Date.now();

  // Role text — full content, no truncation for display
  const roleText = (CLAUDE_ROLE || '').slice(0, CAPS.role);

  // CLAUDE.md — full content
  const claudeMd = getCachedClaudeMd();
  const claudeMdAge = claudeMd.loadedAt ? Math.round((now - claudeMd.loadedAt) / 1000) : null;

  // File tree — full content
  const treeData = getCachedFileTreeText();
  const treeAge = treeData.generatedAt ? Math.round((now - treeData.generatedAt) / 1000) : null;

  // Memory — non-blocking with 2s timeout
  let memoryText = '';
  let memoryEntryCount = 0;
  try {
    const agentMemory = require('../lib/agent-memory');
    const memoryPromise = agentMemory.retrieveRelevantMemory('prompt inspector context', { topK: 10 });
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve([]), 2000));
    const entries = await Promise.race([memoryPromise, timeoutPromise]);
    memoryEntryCount = Array.isArray(entries) ? entries.length : 0;
    if (agentMemory.formatMemoryForPrompt && entries.length > 0) {
      memoryText = agentMemory.formatMemoryForPrompt(entries).slice(0, CAPS.memory);
    }
  } catch { /* agent-memory not available */ }

  // Build assembled prompt — the EXACT text the agent receives as system instructions
  const assembledPrompt = buildFullSystemPrompt(roleText, memoryText);
  const assembledPromptChars = assembledPrompt.length;
  const assembledPromptEstTokens = Math.ceil(assembledPromptChars / 4);

  // Assemble section data — FULL content, not previews
  const sections = {
    role: {
      chars: roleText.length,
      cap: CAPS.role,
      content: roleText,
    },
    claudeMd: {
      chars: claudeMd.content.length,
      cap: CAPS.claudeMd,
      hash: claudeMd.hash || null,
      loadedAt: claudeMd.loadedAt ? new Date(claudeMd.loadedAt).toISOString() : null,
      cacheAge: claudeMdAge,
      stale: claudeMdAge !== null ? claudeMdAge > 300 : null,
      content: claudeMd.content,
    },
    fileTree: {
      chars: treeData.text.length,
      cap: CAPS.fileTree,
      fileCount: treeData.fileCount,
      generatedAt: treeData.generatedAt ? new Date(treeData.generatedAt).toISOString() : null,
      cacheAge: treeAge,
      stale: treeAge !== null ? treeAge > 300 : null,
      content: treeData.text,
    },
    memory: {
      chars: memoryText.length,
      cap: CAPS.memory,
      entryCount: memoryEntryCount,
      content: memoryText,
    },
  };

  const totalChars = sections.role.chars + sections.claudeMd.chars + sections.fileTree.chars + sections.memory.chars;
  const estimatedTokens = Math.ceil(totalChars / 4);

  // Context hash for quick change detection
  const hashInput = [roleText, claudeMd.hash, String(treeData.generatedAt), memoryText.slice(0, 100)].join('|');
  const contextHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

  // Conversation history — if conversationId provided, include full message list
  let conversationHistory = null;
  const conversationId = req.query.conversationId;
  if (conversationId && mongoose.Types.ObjectId.isValid(conversationId)) {
    try {
      const conv = await DevConversation.findById(conversationId).lean();
      if (conv && conv.messages) {
        const messages = conv.messages.map(m => ({
          role: m.role,
          chars: (m.content || '').length,
          contentPreview: (m.content || '').slice(0, 200),
          timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : null,
          provider: m.provider || null,
        }));
        const totalHistoryChars = messages.reduce((s, m) => s + m.chars, 0);
        conversationHistory = {
          id: conv._id,
          title: conv.title,
          messageCount: messages.length,
          totalChars: totalHistoryChars,
          estimatedTokens: Math.ceil(totalHistoryChars / 4),
          messages,
        };
      }
    } catch { /* conversation lookup failed — non-critical */ }
  }

  // Provider info — resolve current settings
  let providerInfo = null;
  try {
    const defaultProv = getDefaultProvider();
    const family = getProviderFamily(defaultProv);
    const modelId = getProviderModelId(defaultProv);
    providerInfo = {
      primary: defaultProv,
      family: family || null,
      model: modelId || null,
    };
  } catch { /* provider resolution failed — non-critical */ }

  // Snapshot prompt version if changed (fire-and-forget, shared logic with dev chat)
  snapshotPromptVersion(assembledPrompt, providerInfo);

  res.json({
    ok: true,
    sections,
    totalChars,
    estimatedTokens,
    contextHash,
    assembledPrompt,
    assembledPromptChars,
    assembledPromptEstTokens,
    conversationHistory,
    provider: providerInfo,
  });
});

// GET /api/dev/prompt-versions -- List all prompt versions (lightweight, no full content)
router.get('/prompt-versions', async (req, res) => {
  const versions = await PromptVersion.find()
    .sort({ createdAt: -1 })
    .select('contextHash totalChars estimatedTokens createdAt sections provider')
    .lean();

  // Strip full content from sections in list response — keep only chars/cap metadata
  const lightweight = versions.map(v => {
    const sectionsMeta = {};
    if (v.sections) {
      for (const [key, sec] of Object.entries(v.sections)) {
        sectionsMeta[key] = {
          chars: sec.chars,
          cap: sec.cap,
        };
        if (sec.fileCount !== undefined) sectionsMeta[key].fileCount = sec.fileCount;
        if (sec.entryCount !== undefined) sectionsMeta[key].entryCount = sec.entryCount;
        if (sec.hash) sectionsMeta[key].hash = sec.hash;
      }
    }
    return {
      _id: v._id,
      contextHash: v.contextHash,
      totalChars: v.totalChars,
      estimatedTokens: v.estimatedTokens,
      createdAt: v.createdAt,
      sections: sectionsMeta,
      provider: v.provider,
    };
  });

  res.json({ ok: true, versions: lightweight });
});

// GET /api/dev/prompt-versions/:id -- Get a single prompt version with full content
router.get('/prompt-versions/:id', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ID', error: 'Invalid version ID' });
  }

  const version = await PromptVersion.findById(id).lean();
  if (!version) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Version not found' });
  }

  res.json({ ok: true, version });
});

// GET /api/dev/health -- Server-observable health state for dev mode dashboard
router.get('/health', async (req, res) => {
  // Context health from the builder module
  let contextHealth = { prompt: {}, tree: {} };
  try {
    const { getContextHealth } = require('../lib/dev-context-builder');
    contextHealth = getContextHealth();
  } catch { /* builder not available */ }

  // Memory stats — agent-memory module may not exist yet (parallel phase)
  let memoryHealth = { totalEntries: 0, byType: {} };
  try {
    const { getMemoryStats } = require('../lib/agent-memory');
    if (getMemoryStats) {
      const rawStats = await getMemoryStats();
      // rawStats is an aggregation array: [{_id: 'type', count: N}, ...]
      // Normalize into a structured object for the health endpoint
      const byType = {};
      let totalEntries = 0;
      for (const entry of rawStats) {
        byType[entry._id] = entry.count;
        totalEntries += entry.count;
      }
      memoryHealth = { totalEntries, byType };
    }
  } catch { /* agent-memory not available yet */ }

  // Active session info
  let sessionHealth = { activeSessions: activeSessions.size, sessions: [] };
  for (const [key, session] of activeSessions) {
    const now = Date.now();
    sessionHealth.sessions.push({
      sessionKey: key,
      provider: session.provider || null,
      conversationId: session.conversationId || null,
      alive: !!(session.child && !session.killed),
      phase: session.phase || 'unknown',
      lastEvent: session.lastEvent || null,
      ageMs: session.startedAt ? now - session.startedAt : null,
      idleMs: session.updatedAt ? now - session.updatedAt : null,
      eventCount: session.eventCount || 0,
    });
  }

  let workspaceHealth = { activeSessions: 0, longestActiveMs: 0, stalestIdleMs: 0, staleCount: 0, sessions: [] };
  try {
    const { getWorkspaceRuntimeHealth } = require('../services/workspace-runtime');
    workspaceHealth = getWorkspaceRuntimeHealth();
  } catch { /* workspace runtime not available */ }

  let aiHealth = {
    totalActiveOperations: 0,
    chat: { activeSessions: 0, longestActiveMs: 0, stalestIdleMs: 0, staleCount: 0, sessions: [] },
    copilot: { activeSessions: 0, longestActiveMs: 0, stalestIdleMs: 0, staleCount: 0, sessions: [] },
  };
  try {
    const { getAiRuntimeHealth } = require('../services/ai-runtime');
    aiHealth = getAiRuntimeHealth();
  } catch { /* ai runtime not available */ }

  let requestHealth = { activeRequests: 0, longestActiveMs: 0, stalestIdleMs: 0, staleCount: 0, requests: [] };
  try {
    const { getRequestRuntimeHealth } = require('../services/request-runtime');
    requestHealth = getRequestRuntimeHealth();
    if (req.requestId && Array.isArray(requestHealth.requests)) {
      const filteredRequests = requestHealth.requests.filter((entry) => entry.requestId !== req.requestId);
      requestHealth = {
        activeRequests: filteredRequests.length,
        longestActiveMs: filteredRequests.reduce((max, entry) => Math.max(max, entry.ageMs || 0), 0),
        stalestIdleMs: filteredRequests.reduce((max, entry) => Math.max(max, entry.idleMs || 0), 0),
        staleCount: filteredRequests.filter((entry) => (entry.ageMs || 0) >= 30_000).length,
        requests: filteredRequests,
      };
    }
  } catch { /* request runtime not available */ }

  let backgroundHealth = { activeTasks: 0, longestActiveMs: 0, staleCount: 0, tasks: [], services: [] };
  try {
    const { getBackgroundRuntimeHealth } = require('../services/background-runtime');
    backgroundHealth = getBackgroundRuntimeHealth();
  } catch { /* background runtime not available */ }

  let monitorHealth = {
    trackedIncidents: 0,
    activeIncidents: 0,
    collapsedIncidents: 0,
    totalForwarded: 0,
    totalSuppressed: 0,
    kindCounts: {},
    monitorTransportIncidents: 0,
    activeMonitorTransportIncidents: 0,
    monitorTransportStateCounts: {},
    incidents: [],
  };
  try {
    monitorHealth = getMonitorIncidentHealth();
  } catch { /* monitor incidents not available */ }

  let remediationHealth = { totalAttempts: 0, activeAttempts: 0, verifiedAttempts: 0, partialAttempts: 0, failedAttempts: 0, recentAttempts: [] };
  try {
    remediationHealth = getRuntimeRemediationHealth();
  } catch { /* remediation runtime not available */ }

  let domainHealth = {
    gmail: { status: 'ok', activeRequests: 0, issues: [] },
    calendar: { status: 'ok', activeRequests: 0, issues: [] },
    escalations: { status: 'ok', activeRequests: 0, issues: [] },
  };
  try {
    const { getDomainHealth } = require('../services/domain-health');
    domainHealth = await getDomainHealth();
  } catch { /* domain health not available */ }

  res.json({
    ok: true,
    ...contextHealth,
    memory: memoryHealth,
    session: sessionHealth,
    workspace: workspaceHealth,
    ai: aiHealth,
    requests: requestHealth,
    background: backgroundHealth,
    monitor: monitorHealth,
    remediation: remediationHealth,
    domains: domainHealth,
    server: {
      uptime: Math.floor(process.uptime()),
      pid: process.pid,
      nodeVersion: process.version,
    },
  });
});

// POST /api/dev/runtime/remediate -- Abort clearly stuck runtime sessions
router.post('/runtime/remediate', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const workspaceSessionIds = Array.isArray(body.workspaceSessionIds) ? body.workspaceSessionIds.slice(0, 10) : [];
  const aiOperationIds = Array.isArray(body.aiOperationIds) ? body.aiOperationIds.slice(0, 10) : [];
  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 240)
    : 'Runtime session aborted by supervisor';
  const source = typeof body.source === 'string' && body.source.trim()
    ? body.source.trim().slice(0, 80)
    : 'supervisor';

  const attempt = createRuntimeRemediationAttempt({
    source,
    reason,
    workspaceSessionIds,
    aiOperationIds,
  });

  let targetedAiKinds = [];
  try {
    const { listAiOperations } = require('../services/ai-runtime');
    const targetedAi = listAiOperations().filter((operation) => aiOperationIds.includes(operation.id));
    targetedAiKinds = [...new Set(targetedAi.map((operation) => operation.kind).filter(Boolean))];
  } catch { /* ai runtime unavailable */ }

  const linkedIncidents = transitionRuntimeIncidents({
    workspace: workspaceSessionIds.length > 0,
    aiKinds: targetedAiKinds,
  }, 'remediating', {
    reason: 'runtime-remediation-started',
    note: reason,
  });
  const linkedIncidentKeys = linkedIncidents.map((incident) => incident.key);

  let workspaceResults = [];
  try {
    const { abortWorkspaceSession } = require('../services/workspace-runtime');
    workspaceResults = workspaceSessionIds.map((id) => ({ id, ...abortWorkspaceSession(id, reason) }));
  } catch (err) {
    workspaceResults = workspaceSessionIds.map((id) => ({
      id,
      ok: false,
      code: 'WORKSPACE_RUNTIME_UNAVAILABLE',
      error: err.message || 'Workspace runtime unavailable',
    }));
  }

  let aiResults = [];
  try {
    const { abortAiOperation } = require('../services/ai-runtime');
    aiResults = aiOperationIds.map((id) => ({ id, ...abortAiOperation(id, reason) }));
  } catch (err) {
    aiResults = aiOperationIds.map((id) => ({
      id,
      ok: false,
      code: 'AI_RUNTIME_UNAVAILABLE',
      error: err.message || 'AI runtime unavailable',
    }));
  }

  const abortedWorkspace = workspaceResults.filter((item) => item.ok).length;
  const abortedAi = aiResults.filter((item) => item.ok).length;
  const verification = await verifyRuntimeTargetsCleared({
    workspaceSessionIds,
    aiOperationIds,
  });

  const workspaceFailures = workspaceResults
    .filter((item) => !item.ok)
    .map((item) => ({ id: item.id, code: item.code || 'ABORT_FAILED', error: item.error || 'Failed to abort workspace session' }));
  const aiFailures = aiResults
    .filter((item) => !item.ok)
    .map((item) => ({ id: item.id, code: item.code || 'ABORT_FAILED', error: item.error || 'Failed to abort AI operation' }));

  const verificationFailures = verification.remainingWorkspaceIds.length
    + verification.remainingAiIds.length
    + workspaceFailures.length
    + aiFailures.length;
  const verificationSuccesses = verification.verifiedWorkspaceIds.length + verification.verifiedAiIds.length;
  const attemptStatus = verificationFailures === 0
    ? 'verified'
    : verificationSuccesses > 0
      ? 'partial'
      : 'failed';

  const finalizedAttempt = finalizeRuntimeRemediationAttempt(attempt.id, {
    status: attemptStatus,
    linkedIncidentKeys,
    summary: attemptStatus === 'verified'
      ? 'All targeted runtime sessions were cleared after remediation'
      : attemptStatus === 'partial'
        ? 'Some targeted runtime sessions cleared, but remediation was incomplete'
        : 'Runtime remediation did not clear the targeted sessions',
    results: {
      abortedWorkspaceIds: workspaceResults.filter((item) => item.ok).map((item) => item.id),
      abortedAiIds: aiResults.filter((item) => item.ok).map((item) => item.id),
      verifiedWorkspaceIds: verification.verifiedWorkspaceIds,
      verifiedAiIds: verification.verifiedAiIds,
      remainingWorkspaceIds: verification.remainingWorkspaceIds,
      remainingAiIds: verification.remainingAiIds,
      missingWorkspaceIds: verification.missingWorkspaceIds,
      missingAiIds: verification.missingAiIds,
      workspaceFailures,
      aiFailures,
    },
    lastError: attemptStatus === 'failed'
      ? {
        message: 'Runtime remediation did not clear the targeted sessions',
        stack: '',
      }
      : null,
  });

  if (linkedIncidentKeys.length > 0) {
    transitionMonitorIncidentKeys(linkedIncidentKeys, attemptStatus === 'verified' ? 'resolved' : 'failed', {
      reason: attemptStatus === 'verified' ? 'runtime-remediation-verified' : 'runtime-remediation-incomplete',
      note: finalizedAttempt.summary || null,
      error: attemptStatus === 'verified'
        ? null
        : new Error(finalizedAttempt.summary || 'Runtime remediation did not clear the targeted sessions'),
    });
  }

  res.json({
    ok: true,
    attempt: finalizedAttempt,
    abortedWorkspace,
    abortedAi,
    verifiedWorkspace: verification.verifiedWorkspaceIds.length,
    verifiedAi: verification.verifiedAiIds.length,
    remainingWorkspace: verification.remainingWorkspaceIds.length,
    remainingAi: verification.remainingAiIds.length,
    workspaceResults,
    aiResults,
    verification,
  });
});

// GET /api/dev/tree -- Project file tree (for navigation)
router.get('/tree', (req, res) => {
  const fs = require('fs');
  const maxDepth = parseInt(req.query.depth) || 3;

  const IGNORE = new Set(['node_modules', '.git', '.claude', 'dist', 'build', '.next', '__pycache__', '.DS_Store', 'NUL']);

  function buildTree(dir, depth) {
    if (depth > maxDepth) return [];
    const entries = [];

    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (IGNORE.has(item.name)) continue;
        if (item.name.startsWith('.') && item.name !== '.env.example') continue;

        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/');

        if (item.isDirectory()) {
          entries.push({
            name: item.name,
            path: relativePath,
            type: 'dir',
            children: buildTree(fullPath, depth + 1),
          });
        } else {
          entries.push({
            name: item.name,
            path: relativePath,
            type: 'file',
            ext: path.extname(item.name).slice(1),
          });
        }
      }
    } catch { /* ignore */ }

    return entries;
  }

  res.json({ ok: true, root: PROJECT_ROOT, tree: buildTree(PROJECT_ROOT, 0) });
});

// ---------------------------------------------------------------------------
// GET /api/dev/server-errors — SSE stream of server-side errors for dev agent
// ---------------------------------------------------------------------------
router.get('/server-errors', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send recent errors on connect (last 10)
  const recent = getRecentErrors();
  if (recent.length > 0) {
    res.write(`data: ${JSON.stringify({ type: 'history', errors: recent.slice(-10) })}\n\n`);
  }

  // Immediate flush so the client sees the connection open
  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* client disconnected */ }
  }, 30_000);

  const unsubscribe = subscribeServerErrors((entry) => {
    try {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    } catch {
      /* connection may have been closed mid-write */
    }
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// GET /api/dev/watch — SSE stream of external file changes detected by git polling
// ---------------------------------------------------------------------------
router.get('/watch', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering if behind proxy
  });

  // Immediate flush so the client sees the connection open
  res.write(': connected\n\n');

  // Heartbeat every 30s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* client disconnected */ }
  }, 30_000);

  const { getChangeDetector } = require('../services/change-detector');
  const detector = getChangeDetector();

  const callback = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      /* connection may have been closed mid-write */
    }
  };

  const unsubscribe = detector.subscribe(callback);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

module.exports = router;
module.exports.stopDevSessionPruning = stopDevSessionPruning;
module.exports._internal = {
  classifyEvent,
  extractTextChunk,
  toToolEvent,
  toToolEvents,
  extractBase64Payload,
  normalizeDevImages,
  buildProviderCommand,
  buildDevSystemPrompt,
  computeContextHash,
  parsePositiveInt,
  isPathWithinRoot,
  shouldResumeClaudeSession,
  didCliExitSuccessfully,
};
