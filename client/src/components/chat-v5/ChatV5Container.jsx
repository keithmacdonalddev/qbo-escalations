import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ImageParserPopup from '../chat/ImageParserPopup.jsx';
import '../chat/ImageParserPopup.css';
import WebcamCapture from '../WebcamCapture.jsx';
import StageEventLogPanel from './StageEventLogPanel.jsx';
import WorkflowLogPanel from './WorkflowLogPanel.jsx';
import { listAgentIdentities } from '../../api/agentIdentitiesApi.js';
import { apiFetch, apiFetchJson } from '../../api/http.js';
import { consumeSSEStream } from '../../api/sse.js';
import { getConversation, getConversationMeta, getEventStats } from '../../api/chatApi.js';
import {
  getEscalation,
  getEscalationKnowledge,
  transitionEscalation,
} from '../../api/escalationsApi.js';
import {
  getAgentRuntimeEffectiveModel,
  getAgentRuntimeProviderLabel,
} from '../../lib/agentRuntimeSettings.js';
import {
  FINAL_ESCALATION_STATUSES,
  getEscalationKnowledgeLifecycle,
} from '../../lib/escalationKnowledgeLifecycle.js';
import { getProviderMeta } from '../../lib/providerCatalog.js';
import { AGENT_PROFILE_UPDATED_EVENT } from '../../lib/agentIdentityEvents.js';
import { SURFACE_DEFAULTS_APPLIED_EVENT } from '../../lib/surfacePreferences.js';
import {
  buildPipelineRuntimePayload,
  PIPELINE_RUNTIME_IDS,
  readPipelineProfileRuntimeStates,
  readPipelineRuntimeStatesSync,
} from './pipelineRuntime.js';
import { useAgentTestModal } from '../agent-tests/AgentTestModalProvider.jsx';
import { useStageOrchestrator } from './useStageOrchestrator.js';
import { useRunningTimer } from './useRunningTimer.js';
import './chat-v5.css';

const WORKFLOW_STEPS = [
  { key: 'parser', number: 2, label: 'Image Parser', runtimeId: 'escalation-template-parser', agentId: 'escalation-template-parser' },
  { key: 'inv', number: 3, label: 'INV Search Agent', runtimeId: 'known-issue-search-agent', agentId: 'known-issue-search-agent' },
  { key: 'triage', number: 4, label: 'Triage Agent', runtimeId: 'triage-agent', agentId: 'triage-agent' },
  { key: 'main', number: 5, label: 'QBO Assistant', runtimeId: 'chat', agentId: 'chat' },
];
const WORKFLOW_AGENT_IDS = new Set(WORKFLOW_STEPS.map((step) => step.agentId));
const LINKED_CASE_BADGE_CLASS = {
  open: 'badge-open',
  'in-progress': 'badge-progress',
  resolved: 'badge-resolved',
  'escalated-further': 'badge-escalated',
};

const TEMPLATE_FIELDS = [
  {
    label: 'COID/MID',
    value: (fields) => [fields.coid, fields.mid].filter(Boolean).join(' / '),
  },
  { label: 'CASE', value: (fields) => fields.caseNumber },
  { label: 'CLIENT/CONTACT', value: (fields) => fields.clientContact },
  { label: 'CX IS ATTEMPTING TO', value: (fields) => fields.attemptingTo },
  { label: 'EXPECTED OUTCOME', value: (fields) => fields.expectedOutcome },
  { label: 'ACTUAL OUTCOME', value: (fields) => fields.actualOutcome },
  { label: 'KB/TOOLS USED', value: (fields) => fields.kbToolsUsed },
  { label: 'TRIED TEST ACCOUNT', value: (fields) => fields.triedTestAccount },
  { label: 'TS STEPS', value: (fields) => fields.tsSteps },
];

const TRIAGE_CONFIDENCE_DOTS = { high: 3, medium: 2, low: 1 };
const PIPELINE_TEST_STAGES = ['parser', 'inv', 'triage', 'main'];
const IMAGE_FILE_NAME_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?)$/i;

function isImageFile(file) {
  if (!file) return false;
  return file.type?.startsWith('image/') || IMAGE_FILE_NAME_RE.test(file.name || '');
}

function getFirstImageFile(files) {
  return Array.from(files || []).find(isImageFile) || null;
}

function getClipboardImageFile(clipboardData) {
  const item = Array.from(clipboardData?.items || []).find((entry) => entry.type?.startsWith('image/'));
  const file = item?.getAsFile();
  return isImageFile(file) ? file : null;
}

function hasFileTransfer(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  if (items.length > 0) return items.some((item) => item.kind === 'file');
  return Array.from(dataTransfer?.types || []).includes('Files');
}

function readImageFileForCapture(file, onCapture) {
  if (!isImageFile(file)) return false;
  const reader = new FileReader();
  reader.onload = (event) => {
    const dataUrl = typeof event.target?.result === 'string' ? event.target.result : '';
    if (dataUrl) {
      onCapture(dataUrl, {
        name: file.name,
        size: file.size,
        type: file.type,
      });
    }
  };
  reader.readAsDataURL(file);
  return true;
}

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  switch (name) {
    case 'upload':
      return (
        <svg {...common}>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case 'camera':
      return (
        <svg {...common}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case 'diamond':
      return (
        <svg {...common}>
          <path d="m12 3 8 9-8 9-8-9 8-9Z" />
          <path d="m12 8 3.5 4-3.5 4-3.5-4 3.5-4Z" />
        </svg>
      );
    case 'analyst':
      return (
        <svg {...common}>
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
          <path d="M4 21a8 8 0 0 1 16 0" />
          <path d="M15.5 14.5 18 17l2.5-2.5" />
        </svg>
      );
    case 'clipboard':
      return (
        <svg {...common}>
          <path d="M9 4h6" />
          <path d="M9 2h6v4H9z" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M8 13h8" />
          <path d="M8 17h5" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case 'collapse':
      return (
        <svg {...common}>
          <path d="m18 15-6-6-6 6" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common}>
          <path d="m22 2-7 20-4-9-9-4 20-7Z" />
          <path d="M22 2 11 13" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M20 12a8 8 0 0 1-13.66 5.66" />
          <path d="M4 12A8 8 0 0 1 17.66 6.34" />
          <path d="M17 2v5h5" />
          <path d="M7 22v-5H2" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      );
    case 'test':
      return (
        <svg {...common}>
          <path d="M9 2v6l-4.8 8.4A3.7 3.7 0 0 0 7.4 22h9.2a3.7 3.7 0 0 0 3.2-5.6L15 8V2" />
          <path d="M8 2h8" />
          <path d="M7 15h10" />
        </svg>
      );
    case 'kebab':
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="12" cy="19" r="1.4" />
        </svg>
      );
    case 'panel-right-open':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16" />
          <path d="M5 12h7" />
          <path d="M9 9l-4 3 4 3" />
        </svg>
      );
    case 'panel-right-close':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M12 12H5" />
          <path d="M8 9l4 3-4 3" />
          <path d="M15 4v16" />
        </svg>
      );
    case 'collapse-all':
      return (
        <svg {...common}>
          <path d="m7 9 5-5 5 5" />
          <path d="m7 20 5-5 5 5" />
        </svg>
      );
    case 'expand-all':
      return (
        <svg {...common}>
          <path d="m7 4 5 5 5-5" />
          <path d="m7 15 5 5 5-5" />
        </svg>
      );
    case 'solo':
      return (
        <svg {...common}>
          <path d="m7 9 5-5 5 5" />
          <path d="m7 15 5 5 5-5" />
          <path d="M5 12h14" />
        </svg>
      );
    default:
      return null;
  }
}

function formatSeconds(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '';
  return `${(value / 1000).toFixed(1)}s`;
}

function stageLabel(stage) {
  const status = stage?.status || 'pending';
  if (status === 'done') return formatSeconds(stage.durationMs) || 'Done';
  if (status === 'failed') return 'Failed';
  if (status === 'running') return null;
  return 'Waiting';
}

function stageProgress(status) {
  if (status === 'done') return 100;
  if (status === 'failed') return 100;
  if (status === 'running') return 58;
  return 0;
}

function cleanValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatTokenCount(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric < 0) return '';
  return Math.round(numeric).toLocaleString();
}

function formatApiCostValue(apiCost) {
  if (!apiCost || typeof apiCost !== 'object') return '';
  const explicit = cleanValue(apiCost.totalCostUsd);
  if (explicit) return explicit.startsWith('$') ? explicit : `$${explicit}`;
  const nanos = toFiniteNumber(apiCost.totalCostNanos);
  if (nanos !== null) return `$${(nanos / 1_000_000_000).toFixed(9)}`;
  const micros = toFiniteNumber(apiCost.totalCostMicros);
  if (micros !== null) return `$${(micros / 1_000_000).toFixed(6)}`;
  return '';
}

function formatApiCostTokens(apiCost) {
  if (!apiCost || typeof apiCost !== 'object') return '';
  const input = formatTokenCount(apiCost.inputTokens);
  const output = formatTokenCount(apiCost.outputTokens);
  const total = formatTokenCount(apiCost.totalTokens);
  if (input || output) return `${input || '0'} in / ${output || '0'} out`;
  return total ? `${total} tokens` : '';
}

function getAgentProfileHref(agentId) {
  const value = cleanValue(agentId);
  return value ? `#/agents/${encodeURIComponent(value)}` : '#/agents';
}

function getProfileAgentLabel(agent, fallbackLabel) {
  return cleanValue(agent?.profile?.roleTitle)
    || cleanValue(agent?.profile?.displayName)
    || fallbackLabel;
}

function buildStageLabels(steps) {
  return Object.fromEntries(steps.map((step) => [step.key, step.label]));
}

function usePipelineAgentLabels() {
  const [labelsByAgentId, setLabelsByAgentId] = useState({});

  const applyAgentLabel = useCallback((agent) => {
    const matchingStep = WORKFLOW_STEPS.find((step) => step.agentId === agent?.agentId);
    if (!matchingStep) return;

    const nextLabel = getProfileAgentLabel(agent, matchingStep.label);
    setLabelsByAgentId((previous) => (
      previous[matchingStep.agentId] === nextLabel
        ? previous
        : { ...previous, [matchingStep.agentId]: nextLabel }
    ));
  }, []);

  const refreshAgentLabels = useCallback(async () => {
    try {
      const agents = await listAgentIdentities();
      const nextLabels = {};
      for (const agent of Array.isArray(agents) ? agents : []) {
        if (!WORKFLOW_AGENT_IDS.has(agent?.agentId)) continue;
        const matchingStep = WORKFLOW_STEPS.find((step) => step.agentId === agent.agentId);
        if (matchingStep) {
          nextLabels[agent.agentId] = getProfileAgentLabel(agent, matchingStep.label);
        }
      }
      setLabelsByAgentId(nextLabels);
    } catch {
      // Static workflow labels remain usable if the profile roster cannot load.
    }
  }, []);

  useEffect(() => {
    refreshAgentLabels();

    const handleProfileUpdated = (event) => {
      const agentId = event?.detail?.agentId;
      if (!WORKFLOW_AGENT_IDS.has(agentId)) return;

      if (event.detail?.agent) {
        applyAgentLabel(event.detail.agent);
      } else {
        refreshAgentLabels();
      }
    };

    window.addEventListener(AGENT_PROFILE_UPDATED_EVENT, handleProfileUpdated);
    return () => {
      window.removeEventListener(AGENT_PROFILE_UPDATED_EVENT, handleProfileUpdated);
    };
  }, [applyAgentLabel, refreshAgentLabels]);

  const workflowSteps = useMemo(
    () => WORKFLOW_STEPS.map((step) => ({
      ...step,
      label: labelsByAgentId[step.agentId] || step.label,
    })),
    [labelsByAgentId]
  );

  return useMemo(() => ({
    workflowSteps,
    stageLabels: buildStageLabels(workflowSteps),
  }), [workflowSteps]);
}

function fieldsByKey(parsedFields) {
  const map = {};
  for (const field of Array.isArray(parsedFields) ? parsedFields : []) {
    if (field?.key) map[field.key] = cleanValue(field.value);
  }
  return map;
}

function buildTemplateRows(caseIntake, parsedFields) {
  const raw = caseIntake?.parseFields && typeof caseIntake.parseFields === 'object'
    ? caseIntake.parseFields
    : {};
  const parsed = fieldsByKey(parsedFields);
  const fields = { ...parsed, ...raw };

  return TEMPLATE_FIELDS.map((field) => ({
    label: field.label,
    value: cleanValue(field.value(fields)),
  }));
}

function runtimeUpdatesFromSurfaceDefaults(surfaces = {}) {
  if (!surfaces || typeof surfaces !== 'object') return null;
  const updates = {};
  for (const [stageKey, runtimeId] of Object.entries(PIPELINE_RUNTIME_IDS)) {
    const runtime = surfaces[runtimeId];
    if (runtime && typeof runtime === 'object') {
      updates[stageKey] = runtime;
    }
  }
  return Object.keys(updates).length > 0 ? updates : null;
}

function getProviderInitials(providerId, providerLabel) {
  const provider = cleanValue(providerId).toLowerCase();
  if (provider === 'llm-gateway') return 'GW';
  if (provider === 'lm-studio') return 'LM';
  if (provider === 'anthropic' || provider.startsWith('claude')) return 'CL';
  if (provider === 'openai' || provider.startsWith('gpt')) return 'AI';
  if (provider === 'gemini') return 'GE';
  if (provider === 'kimi') return 'KI';
  const words = cleanValue(providerLabel || providerId).split(/\s+/).filter(Boolean);
  return words.length > 1
    ? `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase()
    : cleanValue(providerLabel || providerId || '?').slice(0, 2).toUpperCase();
}

function inferRuntimeIcon(provider, model, providerMeta) {
  const providerText = cleanValue(provider).toLowerCase();
  const modelText = cleanValue(model).toLowerCase();
  const familyText = cleanValue(providerMeta?.family).toLowerCase();
  const combined = `${providerText} ${modelText} ${familyText}`;

  if (combined.includes('gpt') || combined.includes('openai') || combined.includes('codex')) {
    return {
      iconPath: '/provider-icons/openai-dark.svg',
      iconLightPath: '/provider-icons/openai.svg',
      iconFamily: 'openai',
    };
  }
  if (combined.includes('claude') || combined.includes('anthropic')) {
    return {
      iconPath: '/provider-icons/anthropic.png',
      iconFamily: 'anthropic',
    };
  }
  if (combined.includes('gemini') || combined.includes('gemma') || combined.includes('google/')) {
    return {
      iconPath: '/provider-icons/gemini.svg',
      iconFamily: 'gemini',
    };
  }
  if (combined.includes('kimi') || combined.includes('moonshot')) {
    return {
      iconPath: '/provider-icons/kimi.ico',
      iconFamily: 'kimi',
    };
  }
  if (combined.includes('lm-studio')) {
    return {
      iconPath: '/provider-icons/lm-studio.webp',
      iconFamily: 'lm-studio',
    };
  }
  return {
    iconPath: providerMeta?.iconPath || '',
    iconLightPath: providerMeta?.iconLightPath || '',
    iconFamily: providerMeta?.family || providerText || 'unknown',
  };
}

function formatReasoningEffortLabel(value) {
  const effort = cleanValue(value).toLowerCase();
  if (!effort) return 'default';
  if (effort === 'xhigh') return 'x-high';
  return effort;
}

function formatServiceTierLabel(value) {
  const tier = cleanValue(value).toLowerCase();
  if (!tier) return '';
  if (tier === 'priority') return 'fast';
  return tier;
}

function buildRuntimeInfo(step, runtimeByStage, health) {
  const state = runtimeByStage?.[step.key] || {};
  const provider = cleanValue(state.provider);
  const providerLabel = getAgentRuntimeProviderLabel(step.runtimeId, state) || 'No provider';
  const configuredModel = cleanValue(state.model);
  const effectiveModel = getAgentRuntimeEffectiveModel(step.runtimeId, state);
  const healthModel = cleanValue(health?.model);
  const model = healthModel && (!configuredModel || configuredModel === 'auto' || configuredModel === 'local' || effectiveModel === 'auto' || effectiveModel === 'local')
    ? healthModel
    : cleanValue(effectiveModel || healthModel) || 'No model';
  const providerMeta = provider ? getProviderMeta(provider) : null;
  const icon = inferRuntimeIcon(provider, model, providerMeta);
  return {
    provider,
    providerLabel,
    model,
    reasoningEffort: cleanValue(state.reasoningEffort),
    reasoningEffortLabel: formatReasoningEffortLabel(state.reasoningEffort),
    serviceTier: cleanValue(state.serviceTier),
    serviceTierLabel: formatServiceTierLabel(state.serviceTier),
    family: providerMeta?.family || provider || 'unknown',
    initials: getProviderInitials(provider, providerLabel),
    iconPath: icon.iconPath,
    iconLightPath: icon.iconLightPath,
    iconFamily: icon.iconFamily,
  };
}

function testStageFromRun(testRun, fallbackStage) {
  if (!testRun || testRun.status === 'idle') return fallbackStage;
  if (testRun.status === 'running') {
    return {
      ...fallbackStage,
      status: 'running',
      startedAt: testRun.startedAt || Date.now(),
      finishedAt: null,
      durationMs: null,
      error: null,
    };
  }
  if (testRun.status === 'failed') {
    return {
      ...fallbackStage,
      status: 'failed',
      startedAt: testRun.startedAt || null,
      finishedAt: testRun.finishedAt || Date.now(),
      durationMs: testRun.durationMs || null,
      error: cleanValue(testRun.error?.message || testRun.error) || 'Test failed.',
    };
  }
  if (testRun.status === 'done') {
    return {
      ...fallbackStage,
      status: 'done',
      startedAt: testRun.startedAt || null,
      finishedAt: testRun.finishedAt || Date.now(),
      durationMs: testRun.durationMs || testRun.data?.elapsedMs || null,
      error: null,
    };
  }
  return fallbackStage;
}

function objectFieldsToParsedRows(parseFields) {
  if (!parseFields || typeof parseFields !== 'object') return [];
  return TEMPLATE_FIELDS.map((field) => ({
    key: field.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: field.label,
    value: cleanValue(field.value(parseFields)),
  }));
}

function normalizeTestError(err) {
  if (!err) return { message: 'Test failed.' };
  if (err instanceof Error) return { message: err.message || 'Test failed.' };
  return {
    message: cleanValue(err.message || err.error || err) || 'Test failed.',
    code: cleanValue(err.code),
  };
}

function resolveTriageCard(triageCard, caseIntake) {
  if (triageCard && typeof triageCard === 'object') return triageCard;
  if (caseIntake?.triageCard && typeof caseIntake.triageCard === 'object') return caseIntake.triageCard;
  return null;
}

function getTriageRead(card) {
  return cleanValue(card?.read || card?.fastRead || card?.quickRead || card?.summary);
}

function getTriageAction(card) {
  return cleanValue(card?.action || card?.nextStep || card?.immediateNextStep);
}

function getTriageCategory(card) {
  return cleanValue(card?.category).replace(/-/g, ' ');
}

function isStarted(stageState) {
  return Object.values(stageState || {}).some((stage) => stage?.status && stage.status !== 'pending');
}

function StatusGlyph({ stage }) {
  const status = stage?.status || 'pending';
  if (status === 'running') return <span className="v5-status-spin" aria-hidden="true" />;
  if (status === 'done') return <Icon name="check" size={13} />;
  if (status === 'failed') return <Icon name="x" size={13} />;
  return null;
}

function PipelineConnector({ active }) {
  return (
    <div className={`v5-workflow-connector${active ? ' is-active' : ''}`} aria-hidden="true">
      <Icon name="chevron" size={20} />
    </div>
  );
}

function ProviderMark({ runtime }) {
  const family = cleanValue(runtime?.iconFamily || runtime?.family || runtime?.provider || 'unknown').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  if (!runtime?.iconPath) {
    return null;
  }
  return (
    <span className={`v5-provider-mark v5-provider-mark--${family}`} title={runtime?.providerLabel || runtime?.provider || 'Provider'}>
      <img src={runtime.iconPath} alt="" aria-hidden="true" />
    </span>
  );
}

function getHealthIndicatorState(health, testRun) {
  const status = testRun?.status === 'running'
    ? 'connecting'
    : testRun?.status === 'failed'
      ? 'error'
      : cleanValue(health?.status || 'unknown').toLowerCase();
  const label = testRun?.status === 'running'
    ? 'Agent test connecting'
    : testRun?.status === 'failed'
      ? 'Agent test failed'
      : cleanValue(health?.message || 'Health not checked yet.');
  if (status === 'online' || status === 'available' || status === 'connected') {
    return { status: 'online', label, litCount: 3 };
  }
  if (status === 'connecting' || status === 'testing' || status === 'checking' || status === 'running') {
    return { status: 'connecting', label, litCount: 1, pulseIndex: 1 };
  }
  if (status === 'failed' || status === 'error') {
    return { status: 'error', label, litCount: 3 };
  }
  if (status === 'offline' || status === 'unavailable') {
    return { status: 'offline', label, litCount: 3 };
  }
  if (status === 'disabled' || status === 'missing-key' || status === 'not-configured') {
    return { status: 'disabled', label, litCount: 3 };
  }
  return { status: 'unknown', label, litCount: 3 };
}

function StatusKebabDots({ health, testRun }) {
  const indicator = getHealthIndicatorState(health, testRun);
  return (
    <span className={`v5-status-kebab is-${indicator.status}`} title={indicator.label} aria-hidden="true">
      {[0, 1, 2].map((dotIndex) => (
        <span
          key={dotIndex}
          className={`v5-status-kebab__dot${dotIndex < indicator.litCount ? ' is-on' : ''}${dotIndex === indicator.pulseIndex ? ' is-pulse' : ''}`}
        />
      ))}
    </span>
  );
}

function TestBanner({ run, agentLabel, onClear }) {
  if (!run || run.status === 'idle') return null;
  const isRunning = run.status === 'running';
  const isFailed = run.status === 'failed';
  const title = isRunning
    ? `${agentLabel} test running`
    : isFailed
      ? `${agentLabel} test failed`
      : `${agentLabel} test result`;
  const detail = isRunning
    ? 'Live test call in progress. This will not be saved.'
    : isFailed
      ? cleanValue(run.error?.message || run.error) || 'Test failed.'
      : cleanValue(run.data?.alert) || 'Test result only - not saved to the database.';

  return (
    <div className={`v5-test-banner${isFailed ? ' is-error' : ''}${isRunning ? ' is-running' : ''}`}>
      {isRunning ? <span className="v5-empty-state__spinner" /> : <Icon name={isFailed ? 'alert' : 'test'} size={15} />}
      <span className="v5-test-banner__copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      {!isRunning && (
        <button type="button" onClick={onClear} aria-label={`Clear ${agentLabel} test result`} title="Clear test result">
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Track whether the left app sidebar is in its expanded (wide) state.
 * App.jsx applies `sidebar-is-collapsed` to `.app` when the left nav is in
 * the icon-only narrow state. Read that via MutationObserver so chat doesn't
 * need a new prop wire-up.
 */
function useLeftSidebarExpanded() {
  const readNow = () => {
    if (typeof document === 'undefined') return false;
    const el = document.querySelector('.app');
    return !!el && !el.classList.contains('sidebar-is-collapsed');
  };
  const [expanded, setExpanded] = useState(readNow);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const el = document.querySelector('.app');
    if (!el) return undefined;
    const update = () => setExpanded(!el.classList.contains('sidebar-is-collapsed'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return expanded;
}

function ImageUploadCard({ imageCaptured, capturedSrc, onCapture, exiting }) {
  const [dragOver, setDragOver] = useState(false);
  const [showWebcam, setShowWebcam] = useState(false);
  const fileInputRef = useRef(null);

  const submitFile = useCallback((file) => {
    readImageFileForCapture(file, onCapture);
  }, [onCapture]);

  const handleWebcamCapture = useCallback((dataUrl) => {
    if (typeof dataUrl !== 'string' || !dataUrl) return;
    // WebcamCapture emits a data URL only; synthesize meta to match the file-upload contract.
    const mimeMatch = /^data:([^;,]+)[;,]/.exec(dataUrl);
    const mime = mimeMatch?.[1] || 'image/webp';
    const ext = mime.split('/')[1] || 'webp';
    const commaIdx = dataUrl.indexOf(',');
    const b64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
    const approxBytes = Math.max(0, Math.round((b64Len * 3) / 4));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    setShowWebcam(false);
    onCapture(dataUrl, {
      name: `webcam-capture-${stamp}.${ext}`,
      size: approxBytes,
      type: mime,
    });
  }, [onCapture]);

  const onDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    submitFile(getFirstImageFile(event.dataTransfer.files));
  };

  const onPaste = (event) => {
    const file = getClipboardImageFile(event.clipboardData);
    if (file) {
      event.preventDefault();
      submitFile(file);
    }
  };

  const openPicker = () => fileInputRef.current?.click();

  return (
    <section
      className={`v5-upload-card${dragOver ? ' is-over' : ''}${imageCaptured ? ' is-captured' : ''}${exiting ? ' is-exiting' : ''}`}
      onDrop={onDrop}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onPaste={onPaste}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPicker();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Upload escalation screenshot"
    >
      <div className="v5-step-index">1</div>
      <div className="v5-upload-card__icon">
        {imageCaptured && capturedSrc ? <Icon name="check" size={22} /> : <Icon name="upload" size={23} />}
      </div>
      <div className="v5-upload-card__title">{imageCaptured ? 'Image captured' : 'Upload image'}</div>
      {!imageCaptured && (
        <div className="v5-upload-card__hint">Drop, paste, or click</div>
      )}
      {!imageCaptured && (
        <button
          type="button"
          className="v5-upload-card__webcam"
          onClick={(event) => {
            event.stopPropagation();
            setShowWebcam(true);
          }}
          aria-label="Capture from webcam"
          title="Capture from webcam"
        >
          <Icon name="camera" size={14} />
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(event) => {
          submitFile(getFirstImageFile(event.target.files));
          event.target.value = '';
        }}
        hidden
      />
      {showWebcam && (
        // Stop clicks/keys inside the modal from bubbling to the card's openPicker/keyDown handlers.
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <WebcamCapture
            onCapture={handleWebcamCapture}
            onClose={() => setShowWebcam(false)}
          />
        </div>
      )}
    </section>
  );
}

function WorkflowCardMenu({ step, health, testRun, testRunning, pipelineRunning, onRunTest, onCancelPipeline }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const healthIndicator = getHealthIndicatorState(health, testRun);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (event) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="v5-workflow-card__actions" ref={wrapRef}>
      <button
        type="button"
        className="v5-workflow-card__test"
        onClick={() => setOpen((v) => !v)}
        disabled={testRunning}
        aria-label={`${step.label} actions. ${healthIndicator.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${step.label} actions - ${healthIndicator.label}`}
      >
        <StatusKebabDots health={health} testRun={testRun} />
      </button>
      {open && (
        <div className="v5-workflow-card__actions-popover" role="menu">
          <button
            type="button"
            role="menuitem"
            className="v5-workflow-card__actions-item"
            onClick={() => {
              setOpen(false);
              onRunTest(step.key);
            }}
            disabled={testRunning}
          >
            Test agent
          </button>
          {pipelineRunning && (
            <button
              type="button"
              role="menuitem"
              className="v5-workflow-card__actions-item is-danger"
              onClick={() => {
                setOpen(false);
                onCancelPipeline();
              }}
            >
              Cancel pipeline
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({ step, stage, runtimeInfo, health, testRun, onRunTest, pipelineRunning, onCancelPipeline, onOpenLog, hasEvents, thinking, eventCount = 0, estimatedEvents = 0 }) {
  const status = stage?.status || 'pending';
  const runningTime = useRunningTimer(stage?.startedAt, status === 'running', stage?.finishedAt);
  const statusText = status === 'running' ? runningTime : stageLabel(stage);
  // Real-progress meter: while running and we have a moving-average estimate,
  // clamp the live count to 95% so it never overshoots before stage.completed
  // arrives. Falls back to the old indeterminate striped animation when we
  // have no historical denominator (first-ever run or empty Mongo).
  const hasEstimate = estimatedEvents > 0;
  const liveCount = Math.max(0, Number(eventCount) || 0);
  const ratio = hasEstimate ? liveCount / estimatedEvents : 0;
  const indeterminate = status === 'running' && !hasEstimate;
  let progress;
  if (status === 'done' || status === 'failed') progress = 100;
  else if (status === 'running' && hasEstimate) progress = Math.min(95, Math.max(4, Math.round(ratio * 100)));
  else progress = stageProgress(status);
  const showCounter = (status === 'running' || status === 'done' || liveCount > 0)
    && (hasEstimate || liveCount > 0);
  const counterText = showCounter
    ? (hasEstimate ? `${liveCount} / ~${estimatedEvents}` : `${liveCount} events`)
    : '';
  const counterTitle = hasEstimate
    ? `${liveCount} events emitted of ~${estimatedEvents} expected (moving avg of recent runs).`
    : `${liveCount} events emitted so far.`;
  const testRunning = testRun?.status === 'running';
  const modelLabel = runtimeInfo?.model || 'No model';
  const effortLabel = runtimeInfo?.reasoningEffortLabel || 'default';
  const serviceTierLabel = runtimeInfo?.serviceTierLabel || '';
  const serviceTierTitle = serviceTierLabel ? ` - service tier: ${serviceTierLabel}` : '';
  const modelTitle = `${modelLabel} - reasoning effort: ${effortLabel}${serviceTierTitle}`;
  const cardRef = useRef(null);
  const captionRef = useRef(null);
  const [captionFrozen, setCaptionFrozen] = useState(false);
  const reasoningTokens = thinking?.tokenEstimate || 0;
  const reasoningChars = thinking?.charCount || 0;
  const hasReasoning = reasoningChars > 0;
  // Tail-slice the buffer so the visible caption is always the latest ~120
  // chars, which renders nicely in the narrow card footer.
  const captionText = useMemo(() => {
    const buf = thinking?.buffer || '';
    if (!buf) return '';
    const slice = buf.slice(-160);
    return slice.replace(/\s+/g, ' ').trim();
  }, [thinking?.buffer]);
  // Hover-to-freeze: while the cursor is over the caption, retain the most
  // recently displayed text by not refreshing the slice. We achieve this by
  // capturing the slice into a ref while frozen.
  const frozenCaptionRef = useRef('');
  useEffect(() => {
    if (!captionFrozen) frozenCaptionRef.current = captionText;
  }, [captionFrozen, captionText]);
  const displayCaption = captionFrozen ? frozenCaptionRef.current : captionText;
  const isStreaming = status === 'running' && hasReasoning;
  const reasoningTitle = hasReasoning
    ? `Reasoning: ~${reasoningTokens} tokens, ${reasoningChars} chars`
    : '';
  // Cards become clickable once *any* signal exists for this stage — live
  // events arriving, persisted events on a prior run, or the stage itself
  // having moved past 'pending'. Keeps the affordance from appearing on the
  // initial empty pipeline before a user uploads anything.
  const clickable = Boolean(onOpenLog && (hasEvents || (status && status !== 'pending')));

  const isNestedControl = (target) => (
    target
    && typeof target.closest === 'function'
    && target.closest('.v5-workflow-card__profile-link, .v5-workflow-card__actions')
  );

  const handleCardClick = (event) => {
    if (!clickable) return;
    // Don't hijack clicks meant for the profile link, kebab menu, or its popover.
    if (isNestedControl(event.target)) return;
    onOpenLog(step.key);
  };

  const handleCardKey = (event) => {
    if (!clickable) return;
    if (isNestedControl(event.target)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenLog(step.key);
    }
  };

  return (
    <section
      ref={cardRef}
      data-stage-card={step.key}
      className={`v5-workflow-card v5-workflow-card--${status}${clickable ? ' is-clickable' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Open ${step.label} event log` : undefined}
      onClick={handleCardClick}
      onKeyDown={handleCardKey}
    >
      <div className="v5-workflow-card__header">
        <span className="v5-step-index v5-step-index--inline">{step.number}</span>
        <h2>
          <a
            className="v5-workflow-card__profile-link"
            href={getAgentProfileHref(step.agentId)}
            title={`Open ${step.label} profile`}
          >
            {step.label}
          </a>
        </h2>
      </div>
      <WorkflowCardMenu
        step={step}
        health={health}
        testRun={testRun}
        testRunning={testRunning}
        pipelineRunning={pipelineRunning}
        onRunTest={onRunTest}
        onCancelPipeline={onCancelPipeline}
      />
      <div className="v5-workflow-card__runtime">
        <ProviderMark runtime={runtimeInfo} />
        <span className="v5-workflow-card__runtime-text">
          <span className="v5-workflow-card__model-line" title={modelTitle}>
            <strong>{modelLabel}</strong>
            {' '}
            <span className="v5-workflow-card__effort" title={`Reasoning effort: ${effortLabel}`}>{effortLabel}</span>
            {serviceTierLabel && (
              <span
                className="v5-workflow-card__tier"
                title={`Codex service tier: ${serviceTierLabel}`}
              >
                {serviceTierLabel}
              </span>
            )}
          </span>
          <span className="v5-workflow-card__provider-label" title={runtimeInfo?.providerLabel || 'No provider'}>{runtimeInfo?.providerLabel || 'No provider'}</span>
        </span>
      </div>
      <div className="v5-workflow-card__footer">
        <div
          className={`v5-workflow-card__meter${indeterminate ? ' is-indeterminate' : ''}`}
          aria-hidden="true"
          role="progressbar"
          aria-valuenow={hasEstimate ? Math.round(ratio * 100) : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={hasEstimate ? `${liveCount} of ~${estimatedEvents} events` : `${liveCount} events`}
        >
          <span style={indeterminate ? undefined : { width: `${progress}%` }} />
        </div>
        {showCounter && (
          <div className="v5-workflow-card__counter" title={counterTitle}>
            {counterText}
          </div>
        )}
        <div className="v5-workflow-card__time">{statusText}</div>
        {hasReasoning && status !== 'running' && (
          <span
            className="v5-workflow-card__reasoning-chip"
            title={reasoningTitle}
            aria-label={reasoningTitle}
          >
            <span className="v5-workflow-card__reasoning-chip-icon" aria-hidden="true">{'\u{1F9E0}'}</span>
            {reasoningTokens > 0 ? `${reasoningTokens} tok` : 'reasoning'}
            <span className="v5-workflow-card__reasoning-chip-arrow" aria-hidden="true">{'›'}</span>
          </span>
        )}
      </div>
      {isStreaming && (
        <div
          ref={captionRef}
          className="v5-workflow-card__caption"
          onMouseEnter={() => setCaptionFrozen(true)}
          onMouseLeave={() => setCaptionFrozen(false)}
          aria-live="polite"
          aria-label="Live reasoning"
        >
          <span className="v5-workflow-card__caption-pulse" aria-hidden="true">{'·'}</span>
          <span className="v5-workflow-card__caption-text">
            {displayCaption || 'thinking'}
          </span>
        </div>
      )}
    </section>
  );
}

function WorkflowLane({
  workflowSteps = WORKFLOW_STEPS,
  imageCaptured,
  capturedImageSrc,
  onCapture,
  stageState,
  runtimeByStage,
  healthByStage,
  testRuns,
  onRunStageTest,
  step1Visible,
  step1Exiting,
  pipelineRunning,
  onCancelPipeline,
  onOpenStageLog,
  stageHasEvents,
  thinkingByStage,
  liveEventCounts,
  eventEstimates,
}) {
  const parserDone = stageState.parser.status === 'done';
  const invDone = stageState.inv.status === 'done';
  const triageDone = stageState.triage.status === 'done' || stageState.triage.status === 'failed';

  return (
    <div
      className={`v5-workflow-lane${step1Exiting ? ' is-shifting' : ''}${step1Visible ? ' has-step-1' : ''}`}
      aria-label="Escalation workflow"
    >
      {step1Visible && (
        <>
          <ImageUploadCard
            imageCaptured={imageCaptured}
            capturedSrc={capturedImageSrc}
            onCapture={onCapture}
            exiting={step1Exiting}
          />
          <PipelineConnector active={imageCaptured} />
        </>
      )}
      {workflowSteps.map((step, index) => (
        <div className="v5-workflow-lane__group" key={step.key}>
          <WorkflowCard
            step={step}
            stage={testStageFromRun(testRuns?.[step.key], stageState[step.key])}
            runtimeInfo={buildRuntimeInfo(step, runtimeByStage, healthByStage?.[step.key])}
            health={healthByStage?.[step.key]}
            testRun={testRuns?.[step.key]}
            onRunTest={onRunStageTest}
            pipelineRunning={pipelineRunning}
            onCancelPipeline={onCancelPipeline}
            onOpenLog={onOpenStageLog}
            hasEvents={Boolean(stageHasEvents?.[step.key])}
            thinking={thinkingByStage?.[step.key] || null}
            eventCount={liveEventCounts?.[step.key] || 0}
            estimatedEvents={eventEstimates?.byStage?.[step.key]?.avg || 0}
          />
          {index < workflowSteps.length - 1 && (
            <PipelineConnector
              active={
                (step.key === 'parser' && parserDone)
                || (step.key === 'inv' && invDone)
                || (step.key === 'triage' && triageDone)
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

function DockSection({ id, icon, title, open, onToggle, onCollapseAll, onSolo, onExpandAll, children, tone, headerAction }) {
  return (
    <section className={`v5-dock-section v5-dock-section--${id}${open ? '' : ' is-collapsed'}${tone ? ` is-${tone}` : ''}`}>
      <div className="v5-dock-section__header">
        <span className="v5-dock-section__title">
          <Icon name={icon} size={18} />
          {title}
        </span>
        <div className="v5-dock-section__header-tools">
          <button
            type="button"
            className="v5-dock-section__tool"
            onClick={onCollapseAll}
            title="Collapse all widgets"
            aria-label="Collapse all widgets"
          >
            <Icon name="collapse-all" size={14} />
          </button>
          <button
            type="button"
            className="v5-dock-section__tool"
            onClick={onSolo}
            title="Solo (collapse all others)"
            aria-label="Solo this widget"
          >
            <Icon name="solo" size={14} />
          </button>
          <button
            type="button"
            className="v5-dock-section__tool"
            onClick={onExpandAll}
            title="Expand all widgets"
            aria-label="Expand all widgets"
          >
            <Icon name="expand-all" size={14} />
          </button>
          <button
            type="button"
            className="v5-dock-section__chevron-btn"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            title={open ? 'Collapse' : 'Expand'}
          >
            <span className="v5-dock-section__chevron">
              <Icon name="collapse" size={16} />
            </span>
          </button>
        </div>
      </div>
      {headerAction && (
        <div className="v5-dock-section__header-action" onClick={(e) => e.stopPropagation()}>
          {headerAction}
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="v5-dock-section__body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function ParserOutput({ caseIntake, parsedFields, stage, testRun, onClearTest, onMarkTestResult, agentLabel = 'Image Parser' }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [markingStatus, setMarkingStatus] = useState('');
  const viewStage = testStageFromRun(testRun, stage);
  const testCaseIntake = testRun?.data?.caseIntake || null;
  const testFixture = testRun?.data?.imageFixture || testCaseIntake?.parseMeta?.imageFixture || null;
  const testFixtureUrl = cleanValue(testFixture?.url);
  const parserValidation = testRun?.data?.parseMeta || testCaseIntake?.parseMeta?.parserValidation || null;
  const canonicalValidation = parserValidation?.canonicalTemplate || null;
  const testFields = testRun?.data?.parseFields && typeof testRun.data.parseFields === 'object'
    ? objectFieldsToParsedRows(testRun.data.parseFields)
    : null;
  const sourceCaseIntake = testCaseIntake || caseIntake;
  const sourceParsedFields = testFields || parsedFields;
  const rows = useMemo(() => buildTemplateRows(sourceCaseIntake, sourceParsedFields), [sourceCaseIntake, sourceParsedFields]);
  const status = viewStage?.status || 'pending';
  const hasAnyValue = rows.some((row) => row.value);
  const rawTemplate = cleanValue(sourceCaseIntake?.canonicalTemplate || testRun?.data?.text);
  const savedTestResultId = cleanValue(testRun?.data?.savedTestResultId || testRun?.data?.savedTestResult?.id);
  const savedStatus = cleanValue(testRun?.data?.savedTestResult?.status);
  const apiCost = testRun?.data?.apiCost || testRun?.data?.savedTestResult?.apiCost || null;
  const apiCostValue = formatApiCostValue(apiCost);
  const apiCostTokens = formatApiCostTokens(apiCost);
  const apiCostModel = cleanValue(apiCost?.model || testRun?.data?.modelUsed);

  useEffect(() => {
    if (!previewOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setPreviewOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewOpen]);

  useEffect(() => {
    if (previewOpen) setPreviewZoom(100);
  }, [previewOpen, testFixtureUrl]);

  const previewModal = previewOpen && testFixtureUrl ? createPortal(
    <div
      className="v5-parser-fixture-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Selected parser test image ${testFixture?.name || ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPreviewOpen(false);
      }}
    >
      <div className="v5-parser-fixture-modal__panel">
        <div className="v5-parser-fixture-modal__header">
          <span>{testFixture?.name || 'Selected parser test image'}</span>
          <div className="v5-parser-fixture-modal__tools" aria-label="Image preview controls">
            <button
              type="button"
              onClick={() => setPreviewZoom((value) => Math.max(50, value - 25))}
              aria-label="Zoom out"
              title="Zoom out"
            >
              -
            </button>
            <span>{previewZoom}%</span>
            <button
              type="button"
              onClick={() => setPreviewZoom((value) => Math.min(225, value + 25))}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setPreviewZoom(100)}
              aria-label="Reset zoom"
              title="Reset zoom"
            >
              1:1
            </button>
            <button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close image preview" title="Close">
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
        <div className="v5-parser-fixture-modal__image">
          <img
            src={testFixtureUrl}
            alt={testFixture?.name || 'Selected parser test fixture'}
            style={{ width: `${previewZoom}%` }}
          />
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  async function markResult(status) {
    if (!savedTestResultId || typeof onMarkTestResult !== 'function') return;
    setMarkingStatus(status);
    try {
      await onMarkTestResult(savedTestResultId, status);
    } finally {
      setMarkingStatus('');
    }
  }

  return (
    <div className="v5-template-output" data-status={status}>
      {previewModal}
      <TestBanner run={testRun} agentLabel={agentLabel} onClear={onClearTest} />
      {testRun && testRun.status !== 'idle' && (
        <div className={`v5-dock-inline-status${canonicalValidation?.passed === false ? ' is-warning' : ''}`}>
          {testFixture?.name
            ? `Fixture: ${testFixture.name}`
            : 'Fixture: selecting parser test image'}
          {canonicalValidation
            ? ` · 9-label contract ${canonicalValidation.passed ? 'passed' : 'failed'}`
            : ''}
        </div>
      )}
      {testFixtureUrl && (
        <>
          <button
            type="button"
            className="v5-parser-fixture-thumb"
            onClick={() => setPreviewOpen(true)}
            aria-label={`Preview parser test fixture ${testFixture?.name || 'image'}`}
            title="Open selected test image"
          >
            <img src={testFixtureUrl} alt="" aria-hidden="true" />
            <span>Preview selected test image</span>
          </button>
        </>
      )}
      {savedTestResultId && status === 'done' && (
        <div className="v5-parser-review-actions" aria-label="Record parser test result">
          <button
            type="button"
            className={savedStatus === 'pass' ? 'is-pass' : ''}
            disabled={Boolean(markingStatus)}
            aria-label="Mark this parser test result as a pass"
            onClick={() => markResult('pass')}
          >
            Pass
          </button>
          <button
            type="button"
            className={savedStatus === 'fail' ? 'is-fail' : ''}
            disabled={Boolean(markingStatus)}
            aria-label="Mark this parser test result as a fail"
            onClick={() => markResult('fail')}
          >
            Fail
          </button>
          <span>{markingStatus ? 'Saving...' : savedStatus ? `Recorded: ${savedStatus}` : 'Pending review'}</span>
        </div>
      )}
      {status === 'done' && apiCost && (
        <div className={`v5-parser-test-cost${apiCost.rateFound === false ? ' is-warning' : ''}`}>
          <span>API COST</span>
          <strong>{apiCost.rateFound === false ? 'Rate missing' : apiCostValue}</strong>
          {(apiCostTokens || apiCostModel) && (
            <small>{[apiCostTokens, apiCostModel].filter(Boolean).join(' - ')}</small>
          )}
        </div>
      )}
      <div className="v5-template-output__lines">
        {rows.map((row) => (
          <div className="v5-template-line" key={row.label}>
            <span>{row.label}:</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
      {status === 'running' && (
        <div className="v5-dock-inline-status">
          <span className="v5-status-spin" aria-hidden="true" />
          Reading uploaded image
        </div>
      )}
      {status === 'failed' && (
        <div className="v5-dock-alert">
          <Icon name="alert" size={15} />
          {viewStage?.error || 'Parser failed.'}
        </div>
      )}
      {status === 'done' && canonicalValidation?.passed === false && (
        <div className="v5-dock-alert">
          <Icon name="alert" size={15} />
          Parser returned non-canonical text. The full 9-label template was not returned exactly.
        </div>
      )}
      {status === 'done' && ((!hasAnyValue && rawTemplate) || canonicalValidation?.passed === false) && rawTemplate && (
        <pre className="v5-template-output__raw">{rawTemplate}</pre>
      )}
    </div>
  );
}

function TriageOutput({ stage, card, testRun, onClearTest, onMarkTestResult, agentLabel = 'Triage Agent' }) {
  const viewStage = testStageFromRun(testRun, stage);
  const testCard = testRun?.data?.triageCard || null;
  const displayCard = testCard || card;
  const status = viewStage?.status || 'pending';
  const isRunning = status === 'running';
  const isFailed = status === 'failed';
  const isDone = status === 'done';
  const severity = cleanValue(displayCard?.severity) || 'P3';
  const category = getTriageCategory(displayCard);
  const read = getTriageRead(displayCard);
  const action = getTriageAction(displayCard);
  const missingInfo = Array.isArray(displayCard?.missingInfo) ? displayCard.missingInfo.map(cleanValue).filter(Boolean) : [];
  const confidence = cleanValue(displayCard?.confidence).toLowerCase() || 'medium';
  const confidenceDots = TRIAGE_CONFIDENCE_DOTS[confidence] || 2;
  const fallbackUsed = Boolean(displayCard?.fallback?.used || viewStage?.fallbackUsed);
  // Triage test surface. When the operator runs a triage test from the
  // workflow card's three-dot menu, the response carries the fixture that
  // was randomly picked plus a savedTestResultId so the operator can record
  // pass/fail. Mirrors the parser test affordances in ParserOutput.
  const testFixture = testRun?.data?.fixture || null;
  const fixtureTags = Array.isArray(testFixture?.tags) ? testFixture.tags.filter(Boolean) : [];
  const savedTestResultId = cleanValue(testRun?.data?.savedTestResultId || testRun?.data?.savedTestResult?.id);
  const savedStatus = cleanValue(testRun?.data?.savedTestResult?.status);
  const [markingStatus, setMarkingStatus] = useState('');

  async function markResult(nextStatus) {
    if (!savedTestResultId || typeof onMarkTestResult !== 'function') return;
    setMarkingStatus(nextStatus);
    try {
      await onMarkTestResult(savedTestResultId, nextStatus);
    } finally {
      setMarkingStatus('');
    }
  }

  if (isFailed && !displayCard) {
    return (
      <div className="v5-output-stack">
        <TestBanner run={testRun} agentLabel={agentLabel} onClear={onClearTest} />
        <div className="v5-empty-state v5-empty-state--error">
          <Icon name="alert" size={44} />
          <span>{viewStage?.error || 'Triage failed.'}</span>
        </div>
      </div>
    );
  }

  if (!isDone || !displayCard) {
    return (
      <div className="v5-output-stack">
        <TestBanner run={testRun} agentLabel={agentLabel} onClear={onClearTest} />
        <div className="v5-empty-state">
          {isRunning ? <span className="v5-empty-state__spinner" /> : <Icon name="clipboard" size={45} />}
          <span>
            {isRunning
              ? 'Triage agent is writing the fast read.'
              : 'Triage details will appear here after the triage agent completes.'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="v5-triage-panel">
      <TestBanner run={testRun} agentLabel={agentLabel} onClear={onClearTest} />
      {testRun && testRun.status !== 'idle' && testFixture && (
        <div className="v5-dock-inline-status">
          {`Fixture: ${testFixture.name || 'triage test fixture'}`}
          {testFixture.description ? ` - ${testFixture.description}` : ''}
        </div>
      )}
      {fixtureTags.length > 0 && (
        <div className="v5-chip-row" aria-label="Triage test fixture tags">
          {fixtureTags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}
      {savedTestResultId && status === 'done' && (
        <div className="v5-parser-review-actions" aria-label="Record triage test result">
          <button
            type="button"
            className={savedStatus === 'pass' ? 'is-pass' : ''}
            disabled={Boolean(markingStatus)}
            aria-label="Mark this triage test result as a pass"
            onClick={() => markResult('pass')}
          >
            Pass
          </button>
          <button
            type="button"
            className={savedStatus === 'fail' ? 'is-fail' : ''}
            disabled={Boolean(markingStatus)}
            aria-label="Mark this triage test result as a fail"
            onClick={() => markResult('fail')}
          >
            Fail
          </button>
          <span>{markingStatus ? 'Saving...' : savedStatus ? `Recorded: ${savedStatus}` : 'Pending review'}</span>
        </div>
      )}
      <div className="v5-triage-panel__meta">
        <span className={`v5-severity v5-severity--${severity.toLowerCase()}`}>{severity}</span>
        {category && <span className="v5-triage-panel__category">{category}</span>}
        <span className="v5-triage-panel__confidence">
          confidence {confidence}
          <span>
            <i className={confidenceDots >= 1 ? 'is-on' : ''} />
            <i className={confidenceDots >= 2 ? 'is-on' : ''} />
            <i className={confidenceDots >= 3 ? 'is-on' : ''} />
          </span>
        </span>
      </div>
      {read && (
        <div className="v5-output-block">
          <span>Fast read</span>
          <p>{read}</p>
        </div>
      )}
      {action && (
        <div className="v5-output-block v5-output-block--action">
          <span>Immediate next step</span>
          <p>{action}</p>
        </div>
      )}
      {missingInfo.length > 0 && (
        <div className="v5-chip-row" aria-label="Missing information">
          {missingInfo.map((item) => <span key={item}>{item}</span>)}
        </div>
      )}
      {fallbackUsed && (
        <div className="v5-dock-inline-status v5-dock-inline-status--warning">
          {displayCard?.fallback?.reason
            ? `Rule fallback used: ${displayCard.fallback.reason}`
            : 'Rule fallback used for this triage card.'}
        </div>
      )}
    </div>
  );
}

function InvOutput({ stage, invMatches, testRun, onClearTest, agentLabel = 'INV Search Agent' }) {
  const viewStage = testStageFromRun(testRun, stage);
  const status = viewStage?.status || 'pending';
  const matches = Array.isArray(testRun?.data?.matches) ? testRun.data.matches : (Array.isArray(invMatches) ? invMatches : []);

  if (status === 'failed') {
    return (
      <div className="v5-output-stack">
        <TestBanner run={testRun} agentLabel={agentLabel} onClear={onClearTest} />
        <div className="v5-empty-state v5-empty-state--error">
          <Icon name="alert" size={44} />
          <span>{viewStage?.error || 'INV search failed.'}</span>
        </div>
      </div>
    );
  }

  if (status !== 'done') {
    return (
      <div className="v5-output-stack">
        <TestBanner run={testRun} agentLabel={agentLabel} onClear={onClearTest} />
        <div className="v5-empty-state">
          {status === 'running' ? <span className="v5-empty-state__spinner" /> : <Icon name="search" size={54} />}
          <span>{status === 'running' ? 'Searching for matching INV cases.' : 'Matching INV cases will appear here.'}</span>
        </div>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="v5-output-stack">
        <TestBanner run={testRun} agentLabel={agentLabel} onClear={onClearTest} />
        <div className="v5-empty-state">
          <Icon name="search" size={54} />
          <span>No INV matches were found.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="v5-inv-results">
      <TestBanner run={testRun} agentLabel={agentLabel} onClear={onClearTest} />
      {matches.map((match) => (
        <article className={`v5-inv-result${match.best ? ' is-best' : ''}`} key={match.id}>
          <header>
            <strong>{match.id}</strong>
            <span>{match.similarity}% match</span>
          </header>
          <p>{match.title}</p>
          <footer>
            <span>{match.status}</span>
            {match.age && <span>{match.age}</span>}
            {match.note && <span>{match.note}</span>}
          </footer>
        </article>
      ))}
    </div>
  );
}

function EvidenceDock({
  caseIntake,
  parsedFields,
  triageCard,
  invMatches,
  stageState,
  testRuns,
  onClearStageTest,
  onMarkParserTestResult,
  onMarkTriageTestResult,
  parserThumbnail,
  onParserThumbnailClick,
  stageLabels = buildStageLabels(WORKFLOW_STEPS),
}) {
  const [openSections, setOpenSections] = useState({
    template: true,
    triage: true,
    inv: true,
  });
  const card = resolveTriageCard(triageCard, caseIntake);

  const toggle = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const collapseAll = () => setOpenSections({ template: false, triage: false, inv: false });
  const expandAll = () => setOpenSections({ template: true, triage: true, inv: true });
  const solo = (key) => setOpenSections({
    template: key === 'template',
    triage: key === 'triage',
    inv: key === 'inv',
  });

  return (
    <aside className="v5-evidence-dock" aria-label="Escalation evidence and agent output">
      <DockSection
        id="template"
        icon="clipboard"
        title={stageLabels.parser || 'Image Parser'}
        open={openSections.template}
        onToggle={() => toggle('template')}
        onCollapseAll={collapseAll}
        onSolo={() => solo('template')}
        onExpandAll={expandAll}
        headerAction={parserThumbnail ? (
          <button
            type="button"
            className="v5-dock-section__thumb"
            onClick={onParserThumbnailClick}
            aria-label="Open uploaded image in parser test modal"
            title="Open uploaded image in parser test modal"
          >
            <img src={parserThumbnail} alt="" />
          </button>
        ) : null}
      >
        <ParserOutput
          caseIntake={caseIntake}
          parsedFields={parsedFields}
          stage={stageState.parser}
          testRun={testRuns?.parser}
          onClearTest={() => onClearStageTest('parser')}
          onMarkTestResult={onMarkParserTestResult}
          agentLabel={stageLabels.parser || 'Image Parser'}
        />
      </DockSection>

      <DockSection
        id="triage"
        icon="shield"
        title={stageLabels.triage || 'Triage Agent'}
        open={openSections.triage}
        onToggle={() => toggle('triage')}
        onCollapseAll={collapseAll}
        onSolo={() => solo('triage')}
        onExpandAll={expandAll}
      >
        <TriageOutput
          stage={stageState.triage}
          card={card}
          testRun={testRuns?.triage}
          onClearTest={() => onClearStageTest('triage')}
          onMarkTestResult={onMarkTriageTestResult}
          agentLabel={stageLabels.triage || 'Triage Agent'}
        />
      </DockSection>

      <DockSection
        id="inv"
        icon="search"
        title={stageLabels.inv || 'INV Search Agent'}
        open={openSections.inv}
        onToggle={() => toggle('inv')}
        onCollapseAll={collapseAll}
        onSolo={() => solo('inv')}
        onExpandAll={expandAll}
      >
        <InvOutput
          stage={stageState.inv}
          invMatches={invMatches}
          testRun={testRuns?.inv}
          onClearTest={() => onClearStageTest('inv')}
          agentLabel={stageLabels.inv || 'INV Search Agent'}
        />
      </DockSection>
    </aside>
  );
}

function AnalystBubble({ role, text, isStreaming, agentLabel = 'QBO Assistant' }) {
  const isOperator = role === 'operator';
  const lines = cleanValue(text).split('\n');

  return (
    <article className={`v5-analyst-message${isOperator ? ' is-operator' : ''}`}>
      <div className="v5-analyst-message__avatar">{isOperator ? 'AD' : 'QA'}</div>
      <div className="v5-analyst-message__content">
        {!isOperator && <span className="v5-analyst-message__name">{agentLabel}</span>}
        <div className="v5-analyst-message__bubble">
          {lines.filter((line, index) => line || index === 0).map((line, index) => (
            <p key={`${line}-${index}`}>{line || ' '}</p>
          ))}
          {isStreaming && <span className="v5-typing-caret" aria-hidden="true" />}
        </div>
      </div>
    </article>
  );
}

function AnalystWorkbench({
  workflowSteps = WORKFLOW_STEPS,
  stageLabels = buildStageLabels(WORKFLOW_STEPS),
  imageCaptured,
  onCaptureImage,
  stageState,
  analyst,
  chatLog,
  onSendOperatorMessage,
  requestError,
  testRun,
  onClearTest,
  onResetWorkflow,
  openStageTabs = [],
  activeTabId = 'main',
  onTabActivate,
  onTabClose,
  stageEvents,
  caseIntake,
  liveEventCounts,
  eventEstimates,
}) {
  const [input, setInput] = useState('');
  const [workbenchDragOver, setWorkbenchDragOver] = useState(false);
  const threadRef = useRef(null);
  const mainStatus = stageState.main.status;
  const hasTestRun = testRun && testRun.status !== 'idle';
  const testRunning = testRun?.status === 'running';
  const testFailed = testRun?.status === 'failed';
  const testDone = testRun?.status === 'done';
  const canReply = !analyst?.isStreaming && !testRunning;
  const isBusy = testRunning || mainStatus === 'running' || analyst?.isStreaming;
  const statusLabel = isBusy ? 'Live' : mainStatus === 'pending' ? 'Ready' : mainStatus;
  const messages = useMemo(() => {
    const entries = Array.isArray(chatLog) ? [...chatLog] : [];
    const hasLiveAnalyst = cleanValue(analyst?.text);
    const last = entries[entries.length - 1];
    if (hasLiveAnalyst && (!last || last.role === 'operator')) {
      entries.push({ role: 'analyst-stream', text: analyst.text, isStreaming: analyst?.isStreaming });
    } else if (hasLiveAnalyst && last?.role === 'analyst-stream' && cleanValue(last.text) !== cleanValue(analyst.text)) {
      entries[entries.length - 1] = { ...last, text: analyst.text, isStreaming: analyst?.isStreaming };
    }
    return entries;
  }, [analyst?.isStreaming, analyst?.text, chatLog]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, testRun?.data?.text, testRun?.status]);

  const mainTabActive = activeTabId === 'main';
  const workflowTabActive = activeTabId === 'workflow';
  const stageTabActive = !mainTabActive && !workflowTabActive;
  const mainAgentLabel = stageLabels.main || 'QBO Assistant';
  const activeStageLogStep = stageTabActive
    ? workflowSteps.find((s) => s.key === activeTabId)
    : null;
  const emptyMainThread = !hasTestRun && !isBusy && messages.length === 0 && !requestError;
  const imageIntakeReady = mainTabActive
    && emptyMainThread
    && mainStatus === 'pending'
    && !imageCaptured
    && typeof onCaptureImage === 'function';
  const workbenchOwnerLabel = imageIntakeReady ? 'Image intake' : mainAgentLabel;
  const workbenchAriaLabel = imageIntakeReady
    ? 'Image intake, drop or paste an escalation image to start'
    : `${mainAgentLabel} response`;

  const send = () => {
    const text = input.trim();
    if (!text || !canReply || imageIntakeReady) return;
    onSendOperatorMessage(text);
    setInput('');
  };

  useEffect(() => {
    if (!imageIntakeReady && workbenchDragOver) setWorkbenchDragOver(false);
  }, [imageIntakeReady, workbenchDragOver]);

  const handleWorkbenchDragOver = useCallback((event) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = imageIntakeReady ? 'copy' : 'none';
    if (imageIntakeReady) setWorkbenchDragOver(true);
  }, [imageIntakeReady]);

  const handleWorkbenchDragLeave = useCallback((event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setWorkbenchDragOver(false);
    }
  }, []);

  const handleWorkbenchDrop = useCallback((event) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setWorkbenchDragOver(false);
    if (!imageIntakeReady) return;

    const file = getFirstImageFile(event.dataTransfer.files);
    readImageFileForCapture(file, onCaptureImage);
  }, [imageIntakeReady, onCaptureImage]);

  const handleWorkbenchPaste = useCallback((event) => {
    if (!imageIntakeReady) return;
    const file = getClipboardImageFile(event.clipboardData);
    if (readImageFileForCapture(file, onCaptureImage)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, [imageIntakeReady, onCaptureImage]);

  return (
    <section
      className={`v5-analyst-workbench${imageIntakeReady ? ' is-intake-ready' : ''}${workbenchDragOver ? ' is-drop-over' : ''}`}
      aria-label={workbenchAriaLabel}
      onDragOver={handleWorkbenchDragOver}
      onDragLeave={handleWorkbenchDragLeave}
      onDrop={handleWorkbenchDrop}
      onPaste={handleWorkbenchPaste}
    >
      <header className="v5-analyst-workbench__header">
        <div className="v5-workbench-tabs" role="tablist" aria-label="Workbench tabs">
          <button
            type="button"
            role="tab"
            aria-selected={mainTabActive}
            className={`v5-workbench-tab v5-workbench-tab--accent-main${mainTabActive ? ' is-active' : ''}`}
            onClick={() => onTabActivate?.('main')}
          >
            <span className="v5-workbench-tab__label">{workbenchOwnerLabel}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workflowTabActive}
            className={`v5-workbench-tab v5-workbench-tab--accent-workflow${workflowTabActive ? ' is-active' : ''}`}
            onClick={() => onTabActivate?.('workflow')}
            title="View the full workflow event log — all four stages, this run and saved runs"
          >
            <span className="v5-workbench-tab__icon" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </span>
            <span className="v5-workbench-tab__label">Workflow Log</span>
          </button>
          {openStageTabs.map((stageKey) => {
            const step = workflowSteps.find((s) => s.key === stageKey);
            const label = stageLabels[stageKey] || step?.label || stageKey;
            const isActive = activeTabId === stageKey;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                key={stageKey}
                className={`v5-workbench-tab v5-workbench-tab--accent-${stageKey}${isActive ? ' is-active' : ''}`}
                onClick={() => onTabActivate?.(stageKey)}
              >
                <span className="v5-workbench-tab__label">{`${label} Logs`}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="v5-workbench-tab__close"
                  aria-label={`Close ${label} logs`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTabClose?.(stageKey);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onTabClose?.(stageKey);
                    }
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
        <div className="v5-analyst-workbench__actions">
          <button
            type="button"
            className="v5-analyst-workbench__reset"
            onClick={onResetWorkflow}
            title="Start a new workflow"
            aria-label="Start a new workflow"
          >
            <span>New</span>
          </button>
          <div className={`v5-analyst-workbench__status is-${mainStatus}`}>
            {isBusy ? <span className="v5-status-spin" /> : <StatusGlyph stage={stageState.main} />}
            {testRunning ? 'Test' : statusLabel}
          </div>
        </div>
      </header>

      {mainTabActive ? (
        <>
          <div className="v5-analyst-workbench__thread" ref={threadRef}>
            {hasTestRun && (
              <TestBanner run={testRun} agentLabel={mainAgentLabel} onClear={onClearTest} />
            )}
            {testRunning && (
              <div className="v5-analyst-waiting">
                <span className="v5-empty-state__spinner" />
                Running {mainAgentLabel} test with the fixture escalation.
              </div>
            )}
            {testFailed && (
              <div className="v5-dock-alert">
                <Icon name="alert" size={16} />
                {cleanValue(testRun.error?.message || testRun.error) || `${mainAgentLabel} test failed.`}
              </div>
            )}
            {testDone && cleanValue(testRun.data?.text) && (
              <AnalystBubble role="analyst-stream" text={testRun.data.text} isStreaming={false} agentLabel={mainAgentLabel} />
            )}
            {messages.map((entry, index) => (
              <AnalystBubble
                key={`${entry.role}-${index}`}
                role={entry.role}
                text={entry.text}
                isStreaming={entry.isStreaming}
                agentLabel={mainAgentLabel}
              />
            ))}
            {mainStatus === 'running' && messages.length === 0 && (
              <div className="v5-analyst-waiting">
                <span className="v5-empty-state__spinner" />
                Reading the parser details, triage card, and matching INV cases.
              </div>
            )}
            {(mainStatus === 'failed' || requestError) && messages.length === 0 && (
              <div className="v5-dock-alert">
                <Icon name="alert" size={16} />
                {stageState.main.error || requestError?.message || `${mainAgentLabel} failed.`}
              </div>
            )}
            {emptyMainThread && (
              imageIntakeReady ? (
                <div className="v5-analyst-intake-prompt">
                  <span className="v5-analyst-intake-prompt__icon" aria-hidden="true">
                    <Icon name="upload" size={24} />
                  </span>
                  <strong>Drop image here</strong>
                  <span>Paste an image into this chat</span>
                </div>
              ) : (
                <div className="v5-analyst-waiting">
                  {mainAgentLabel} is ready.
                </div>
              )
            )}
          </div>

          <footer className="v5-analyst-composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={imageIntakeReady
                ? 'Drop or paste an image to start'
                : canReply ? `Message ${mainAgentLabel}` : `${mainAgentLabel} is still running`}
              disabled={!canReply}
              rows={2}
            />
            <button type="button" onClick={send} disabled={imageIntakeReady || !canReply || !input.trim()} aria-label="Send reply">
              <Icon name="send" size={16} />
            </button>
          </footer>
        </>
      ) : workflowTabActive ? (
        <WorkflowLogPanel
          conversation={{ caseIntake }}
          liveEvents={stageEvents}
          liveEventCounts={liveEventCounts}
          eventEstimates={eventEstimates}
          stageLabels={stageLabels}
        />
      ) : (
        <StageEventLogPanel
          key={activeTabId}
          stageId={activeStageLogStep?.key || activeTabId}
          conversation={{ caseIntake }}
          liveEvents={stageEvents}
          eventCount={liveEventCounts?.[activeStageLogStep?.key || activeTabId] || 0}
          estimatedEvents={eventEstimates?.byStage?.[activeStageLogStep?.key || activeTabId]?.avg || 0}
          stageLabels={stageLabels}
        />
      )}
    </section>
  );
}

function LinkedCaseLifecycleBanner({ escalation, knowledge, resolving, onResolve }) {
  if (!escalation) return null;

  const lifecycle = getEscalationKnowledgeLifecycle({ escalation, knowledge });
  const canResolve = !FINAL_ESCALATION_STATUSES.has(escalation.status);

  return (
    <section className="v5-linked-case" aria-label="Linked case lifecycle">
      <span className={`badge ${LINKED_CASE_BADGE_CLASS[escalation.status] || 'badge-open'}`}>
        {lifecycle.statusLabel}
      </span>
      <div className="v5-linked-case__body">
        <strong>Linked case</strong>
        <span>{lifecycle.nextAction}</span>
      </div>
      {escalation.coid && <span className="v5-linked-case__mono">COID: {escalation.coid}</span>}
      {escalation.category && (
        <span className={`cat-badge cat-${escalation.category}`}>
          {escalation.category.replace(/-/g, ' ')}
        </span>
      )}
      {canResolve && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onResolve}
          disabled={resolving}
        >
          {resolving ? 'Resolving...' : 'Mark Resolved'}
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => { window.location.hash = `#/escalations/${escalation._id}`; }}
      >
        Open Case
      </button>
    </section>
  );
}

export default function ChatV5Container({ isActive = true, conversationIdFromRoute = null }) {
  const {
    imageCaptured,
    captureImage,
    reset,
    stageState,
    stageEvents,
    liveEventCounts,
    ingestStageEvent,
    pushLocalStageEvent,
    capturedImageSrc,
    caseIntake,
    triageCard,
    invMatches,
    parsedFields,
    analyst,
    chatLog,
    sendOperatorMessage,
    requestError,
    conversationId,
  } = useStageOrchestrator();
  const { workflowSteps, stageLabels } = usePipelineAgentLabels();
  const { openAgentTest } = useAgentTestModal();
  // Moving-average denominator per stage, fetched once on mount and refreshed
  // after each completed pipeline run so the bar tracks recent reality. The
  // server response is cheap (capped scan + projection) so this stays light.
  const [eventEstimates, setEventEstimates] = useState({ byStage: {}, totals: { allTime: 0, perSession: 0, sessionCount: 0 } });
  const refreshEventEstimates = useCallback(async () => {
    try {
      const stats = await getEventStats();
      setEventEstimates(stats);
    } catch {
      // Indeterminate-bar fallback is fine; no UI noise needed.
    }
  }, []);
  useEffect(() => {
    refreshEventEstimates();
  }, [refreshEventEstimates]);
  // Refresh once the analyst stage completes so the denominator picks up the
  // just-finished run for the next escalation.
  const mainStatusForStats = stageState.main.status;
  useEffect(() => {
    if (mainStatusForStats === 'done' || mainStatusForStats === 'failed') {
      // Small delay so the server has time to flush events into caseIntake.
      const id = setTimeout(() => { refreshEventEstimates(); }, 1500);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [mainStatusForStats, refreshEventEstimates]);
  const [runtimeByStage, setRuntimeByStage] = useState(() => readPipelineRuntimeStatesSync());
  const [healthByStage, setHealthByStage] = useState({});
  const [testRuns, setTestRuns] = useState({});
  const [dockCollapsed, setDockCollapsed] = useState(() => {
    try {
      return localStorage.getItem('qbo.workspacePanel.collapsed') === 'true';
    } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('qbo.workspacePanel.collapsed', String(dockCollapsed)); } catch {}
  }, [dockCollapsed]);

  const leftExpanded = useLeftSidebarExpanded();
  const isState4 = leftExpanded && !dockCollapsed;
  const effectiveConversationId = cleanValue(conversationIdFromRoute || conversationId);
  const [linkedEscalation, setLinkedEscalation] = useState(null);
  const [linkedKnowledge, setLinkedKnowledge] = useState(null);
  const [resolvingLinkedCase, setResolvingLinkedCase] = useState(false);
  // Saved caseIntake for a PAST run opened from history. On mount the
  // orchestrator only has live state, and the linked-escalation lookup above
  // fetches /meta (which omits caseIntake), so a reopened conversation has no
  // pipeline events to show until we pull the full conversation here. Only used
  // as a fallback — a live run's own caseIntake always takes precedence.
  const [pastCaseIntake, setPastCaseIntake] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLinkedEscalation() {
      if (!effectiveConversationId) {
        setLinkedEscalation(null);
        setLinkedKnowledge(null);
        return;
      }

      try {
        const conversation = await getConversationMeta(effectiveConversationId);
        if (cancelled) return;
        if (!conversation?.escalationId) {
          setLinkedEscalation(null);
          setLinkedKnowledge(null);
          return;
        }
        const [escalation, knowledge] = await Promise.all([
          getEscalation(conversation.escalationId),
          getEscalationKnowledge(conversation.escalationId).catch(() => null),
        ]);
        if (!cancelled) {
          setLinkedEscalation(escalation);
          setLinkedKnowledge(knowledge);
        }
      } catch {
        if (!cancelled) {
          setLinkedEscalation(null);
          setLinkedKnowledge(null);
        }
      }
    }

    loadLinkedEscalation();
    return () => { cancelled = true; };
  }, [effectiveConversationId]);

  // Hydrate the Workflow Log for a PAST run. When a conversation is opened from
  // history (route id present) and there's no live pipeline in this session,
  // fetch the full conversation so its saved caseIntake.runs[].events render in
  // the unified log. A live run supersedes this — once the orchestrator has its
  // own caseIntake we drop the past copy so we never show stale saved events
  // over a fresh run.
  const hasLiveCaseIntake = Boolean(caseIntake);
  useEffect(() => {
    let cancelled = false;
    const routeId = cleanValue(conversationIdFromRoute);
    if (!routeId || hasLiveCaseIntake) {
      setPastCaseIntake(null);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const conversation = await getConversation(routeId);
        if (!cancelled) setPastCaseIntake(conversation?.caseIntake || null);
      } catch {
        if (!cancelled) setPastCaseIntake(null);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationIdFromRoute, hasLiveCaseIntake]);

  // What the Workflow Log and evidence surfaces should read: the live run's
  // caseIntake while a pipeline is active, otherwise the saved past run.
  const effectiveCaseIntake = caseIntake || pastCaseIntake;

  const handleResolveLinkedCase = useCallback(async () => {
    if (!linkedEscalation?._id || resolvingLinkedCase) return;
    setResolvingLinkedCase(true);
    try {
      const { escalation } = await transitionEscalation(linkedEscalation._id, 'resolved');
      setLinkedEscalation(escalation);
    } catch {
      // Keep the banner visible; the detail page can still be opened for manual updates.
    } finally {
      setResolvingLinkedCase(false);
    }
  }, [linkedEscalation?._id, resolvingLinkedCase]);

  // Step-1 lifecycle: visible by default; when parser flips to running, kick
  // off the exit transition; after ~520ms unmount the step.
  const [step1Visible, setStep1Visible] = useState(true);
  const [step1Exiting, setStep1Exiting] = useState(false);
  const parserStatus = stageState.parser.status;
  const prevParserStatusRef = useRef(parserStatus);
  const step1TimerRef = useRef(null);
  // Read isState4 via ref so the effect below only fires on parserStatus
  // transitions — toggling sidebars mid-exit shouldn't re-trigger or cancel.
  const isState4Ref = useRef(isState4);
  useEffect(() => { isState4Ref.current = isState4; }, [isState4]);
  useEffect(() => {
    const prev = prevParserStatusRef.current;
    prevParserStatusRef.current = parserStatus;
    // Only run the exit/shift/unmount choreography when both sidebars are
    // open (state 4) at the moment parser starts. States 1/2/3 leave step 1
    // in the pipeline as a normal stage card.
    if (prev !== 'running' && parserStatus === 'running' && isState4Ref.current) {
      setStep1Exiting(true);
      if (step1TimerRef.current) clearTimeout(step1TimerRef.current);
      step1TimerRef.current = setTimeout(() => {
        setStep1Visible(false);
        setStep1Exiting(false);
        step1TimerRef.current = null;
      }, 520);
    }
    if (parserStatus === 'pending' && prev !== 'pending') {
      if (step1TimerRef.current) {
        clearTimeout(step1TimerRef.current);
        step1TimerRef.current = null;
      }
      setStep1Visible(true);
      setStep1Exiting(false);
    }
  }, [parserStatus]);
  useEffect(() => () => {
    if (step1TimerRef.current) clearTimeout(step1TimerRef.current);
  }, []);

  // Image preview/parser utility popup opened from the dock thumbnail. Agent
  // test runs now use the shared AgentTestModal instead of this live-image tool.
  const [parserPopupOpen, setParserPopupOpen] = useState(false);

  // Cancel-pipeline confirm modal. Opened from the kebab menu's
  // "Cancel pipeline" item or from a global Esc keypress when running.
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  // Per-stage event log tabs inside the analyst workbench header. Each tab
  // corresponds to a pipeline stage; clicking a pipeline card opens/toggles
  // its tab. The "main" tab is always the chat thread and is implicit (not
  // in openStageTabs). activeTabId is either 'main' or one of the open stage
  // keys; if it points at a tab that's been closed we fall back to 'main'.
  const [openStageTabs, setOpenStageTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState('main');
  const closeTransientWorkbenchTabs = useCallback(() => {
    setOpenStageTabs([]);
    setActiveTabId('main');
  }, []);
  const handleStageCardClick = useCallback((stageKey) => {
    if (!stageKey || stageKey === 'main') return;
    setOpenStageTabs((prev) => {
      const isOpen = prev.includes(stageKey);
      if (isOpen) {
        // Toggle off: remove and, if it was active, fall back to main.
        setActiveTabId((current) => (current === stageKey ? 'main' : current));
        if (stageKey === 'parser') {
          pushLocalStageEvent?.('parser', 'parser.popup_closed', {
            via: 'card-toggle',
          });
        }
        return prev.filter((k) => k !== stageKey);
      }
      // Open and activate.
      setActiveTabId(stageKey);
      if (stageKey === 'parser') {
        pushLocalStageEvent?.('parser', 'parser.popup_opened', {
          via: 'card-click',
        });
      }
      return [...prev, stageKey];
    });
  }, [pushLocalStageEvent]);
  const handleTabActivate = useCallback((tabId) => {
    if (!tabId) return;
    setActiveTabId(tabId);
  }, []);
  const handleTabClose = useCallback((stageKey) => {
    if (!stageKey || stageKey === 'main') return;
    setOpenStageTabs((prev) => prev.filter((k) => k !== stageKey));
    setActiveTabId((current) => (current === stageKey ? 'main' : current));
    if (stageKey === 'parser') {
      pushLocalStageEvent?.('parser', 'parser.popup_closed', {
        via: 'tab-close',
      });
    }
  }, [pushLocalStageEvent]);
  const stageHasEvents = useMemo(() => {
    const live = stageEvents || {};
    const runs = Array.isArray(caseIntake?.runs) ? caseIntake.runs : [];
    const savedPhases = new Set(runs.filter((r) => Array.isArray(r?.events) && r.events.length > 0).map((r) => r.phase));
    const phaseByKey = { parser: 'parse-template', inv: 'known-issue-search', triage: 'triage', main: 'analyst' };
    return {
      parser: Boolean(live.parser?.length) || savedPhases.has(phaseByKey.parser),
      inv: Boolean(live.inv?.length) || savedPhases.has(phaseByKey.inv),
      triage: Boolean(live.triage?.length) || savedPhases.has(phaseByKey.triage),
      main: Boolean(live.main?.length) || savedPhases.has(phaseByKey.main),
    };
  }, [stageEvents, caseIntake]);
  // Per-stage reasoning buffer derived from llm.thinking events. Live events
  // win while the pipeline is running; once it's saved, the saved run events
  // take over so completed cards still show their reasoning chip on reload.
  // Buffer is capped at THINKING_BUFFER_CHAR_CAP to avoid unbounded memory in
  // long runs.
  const thinkingByStage = useMemo(() => {
    const THINKING_BUFFER_CHAR_CAP = 8192;
    const phaseByKey = { parser: 'parse-template', inv: 'known-issue-search', triage: 'triage', main: 'analyst' };
    const runs = Array.isArray(caseIntake?.runs) ? caseIntake.runs : [];
    const out = {};
    for (const stageKey of ['parser', 'inv', 'triage', 'main']) {
      const liveList = Array.isArray(stageEvents?.[stageKey]) ? stageEvents[stageKey] : [];
      const liveThinking = liveList.filter((ev) => ev?.kind === 'llm.thinking');
      let events = liveThinking;
      if (events.length === 0) {
        const phase = phaseByKey[stageKey];
        const run = runs.find((r) => r && r.phase === phase);
        const saved = Array.isArray(run?.events) ? run.events.filter((ev) => ev?.kind === 'llm.thinking') : [];
        events = saved;
      }
      let buffer = '';
      let charCount = 0;
      for (const ev of events) {
        const delta = typeof ev?.data?.delta === 'string' ? ev.data.delta : '';
        if (!delta) continue;
        buffer += delta;
        charCount += delta.length;
        if (buffer.length > THINKING_BUFFER_CHAR_CAP) {
          buffer = buffer.slice(buffer.length - THINKING_BUFFER_CHAR_CAP);
        }
      }
      out[stageKey] = {
        buffer,
        charCount,
        tokenEstimate: charCount > 0 ? Math.max(1, Math.round(charCount / 4)) : 0,
        eventCount: events.length,
      };
    }
    return out;
  }, [stageEvents, caseIntake]);
  const pipelineRunning = useMemo(() => {
    return Object.values(stageState || {}).some((s) => s?.status === 'running');
  }, [stageState]);

  const requestCancelPipeline = useCallback(() => {
    setCancelConfirmOpen(true);
  }, []);

  const confirmCancelPipeline = useCallback(() => {
    setCancelConfirmOpen(false);
    closeTransientWorkbenchTabs();
    // reset() aborts the SSE stream and clears stage/case/triage/inv/analyst
    // state back to INITIAL_STAGE_STATE. The step-1 effect re-fires on the
    // parser pending transition and restores the upload card cleanly.
    try { reset(); } catch { /* noop */ }
  }, [closeTransientWorkbenchTabs, reset]);

  // Global Esc-to-cancel — only mounted while a stage is running. Skip if
  // focus is in an editable element so chat composers keep their normal Esc.
  useEffect(() => {
    if (!pipelineRunning) return undefined;
    const isEditableTarget = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (cancelConfirmOpen) return; // modal owns its own Esc
      if (isEditableTarget(document.activeElement)) return;
      event.preventDefault();
      setCancelConfirmOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pipelineRunning, cancelConfirmOpen]);

  // Esc inside the confirm modal just closes the modal — does NOT cascade
  // into another cancel prompt.
  useEffect(() => {
    if (!cancelConfirmOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setCancelConfirmOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cancelConfirmOpen]);

  const refreshPipelineStatus = useCallback(async (forceRefresh = false) => {
    const runtime = await readPipelineProfileRuntimeStates();
    setRuntimeByStage(runtime);
    try {
      const data = await apiFetchJson('/api/pipeline-tests/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runtime: buildPipelineRuntimePayload(runtime),
          forceRefresh,
        }),
        timeout: 90_000,
        noRetry: true,
      }, 'Failed to check pipeline health');
      setHealthByStage(data?.stages || {});
    } catch (err) {
      const normalized = normalizeTestError(err);
      const failed = Object.fromEntries(
        PIPELINE_TEST_STAGES.map((key) => [
          key,
          {
            status: 'unknown',
            message: normalized.message,
          },
        ])
      );
      setHealthByStage(failed);
    }
  }, []);

  useEffect(() => {
    refreshPipelineStatus(false);
    const id = setInterval(() => refreshPipelineStatus(false), 60_000);
    return () => clearInterval(id);
  }, [refreshPipelineStatus]);

  useEffect(() => {
    const handleRuntimeDefaultsApplied = (event) => {
      const updates = runtimeUpdatesFromSurfaceDefaults(event?.detail?.surfaces);
      if (!updates) return;
      setRuntimeByStage((previous) => ({
        ...previous,
        ...updates,
      }));
      refreshPipelineStatus(true);
    };

    window.addEventListener(SURFACE_DEFAULTS_APPLIED_EVENT, handleRuntimeDefaultsApplied);
    return () => {
      window.removeEventListener(SURFACE_DEFAULTS_APPLIED_EVENT, handleRuntimeDefaultsApplied);
    };
  }, [refreshPipelineStatus]);

  const runStageTest = useCallback(async (stageKey) => {
    if (!PIPELINE_TEST_STAGES.includes(stageKey)) return;
    const agentId = PIPELINE_RUNTIME_IDS[stageKey];
    if (agentId) {
      openAgentTest({
        agentId,
        stageKey,
        launchSurface: 'chat-stage-card',
        context: {
          imageCaptured,
          hasCurrentImage: Boolean(capturedImageSrc),
        },
        onRecorded: () => {
          refreshPipelineStatus(false);
        },
      });
      return;
    }
    const runtime = await readPipelineProfileRuntimeStates();
    const startedAt = Date.now();
    setRuntimeByStage(runtime);
    setTestRuns((prev) => ({
      ...prev,
      [stageKey]: {
        status: 'running',
        startedAt,
        finishedAt: null,
        durationMs: null,
        data: null,
        error: null,
      },
    }));
    try {
      const requestBody = {
        stage: stageKey,
        runtime: buildPipelineRuntimePayload(runtime),
      };
      let data;
      if (stageKey === 'triage') {
        // Stage 4 (Triage Agent) test runs against the dedicated
        // /api/triage-tests/run endpoint, which picks a random fixture from
        // server/fixtures/pipeline-tests/triage/, streams stage events over
        // SSE, and persists the run as a TriageTestResult the operator can
        // grade pass/fail. This is parity with the parser test route.
        const triageRuntime = runtime?.triage || runtime?.['triage-agent'] || {};
        pushLocalStageEvent('triage', 'triage.client_request_started', {
          provider: triageRuntime.provider || '',
          model: triageRuntime.model || '',
          requestStartedAt: startedAt,
          testRun: true,
          status: 'sent',
          surfaceToUser: true,
          displayMessage: 'triage test payload sent to server - sent',
        });
        const res = await apiFetch('/api/triage-tests/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(requestBody),
          timeout: 180_000,
          noRetry: true,
        });
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/event-stream')) {
          let completed = null;
          let errorPayload = null;
          await consumeSSEStream(res, (eventType, payload) => {
            if (eventType === 'stage_event') {
              ingestStageEvent?.(payload);
            } else if (eventType === 'test_complete') {
              completed = payload;
            } else if (eventType === 'error') {
              errorPayload = payload;
            }
          });
          data = completed || {
            ok: false,
            error: errorPayload?.error || errorPayload?.message || 'Triage test stream ended without a result.',
            code: errorPayload?.code,
          };
        } else {
          data = await res.json().catch(() => ({ ok: false, error: res.statusText }));
        }
        if (!res.ok || !data?.ok) {
          throw normalizeTestError(data || { message: `Triage agent test failed (HTTP ${res.status})` });
        }
        pushLocalStageEvent('triage', 'triage.client_result_received', {
          provider: data.providerUsed || triageRuntime.provider || '',
          model: data.modelUsed || triageRuntime.model || '',
          severity: data.triageCard?.severity || '',
          category: data.triageCard?.category || '',
          confidence: data.triageCard?.confidence || '',
          elapsedMs: data.elapsedMs ?? 0,
          testRun: true,
          status: 'complete',
        });
      } else {
        data = await apiFetchJson('/api/pipeline-tests/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          timeout: 180_000,
          noRetry: true,
        }, 'Pipeline agent test failed');
      }
      const finishedAt = Date.now();
      setTestRuns((prev) => ({
        ...prev,
        [stageKey]: {
          status: 'done',
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          data,
          error: null,
        },
      }));
      refreshPipelineStatus(false);
    } catch (err) {
      const finishedAt = Date.now();
      setTestRuns((prev) => ({
        ...prev,
        [stageKey]: {
          status: 'failed',
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          data: null,
          error: normalizeTestError(err),
        },
      }));
      refreshPipelineStatus(false);
    }
  }, [capturedImageSrc, imageCaptured, ingestStageEvent, openAgentTest, pushLocalStageEvent, refreshPipelineStatus]);

  const clearStageTest = useCallback((stageKey) => {
    setTestRuns((prev) => {
      const next = { ...prev };
      delete next[stageKey];
      return next;
    });
  }, []);

  const markParserTestResult = useCallback(async (resultId, status) => {
    const data = await apiFetchJson(`/api/pipeline-tests/parser-results/${encodeURIComponent(resultId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        operatorNote: status === 'fail'
          ? 'Operator marked the live parser test output as incorrect.'
          : 'Operator marked the live parser test output as correct.',
      }),
      noRetry: true,
    }, 'Failed to record parser test result');

    if (status === 'pass') {
      closeTransientWorkbenchTabs();
      reset();
      setTestRuns({});
      return;
    }

    setTestRuns((prev) => ({
      ...prev,
      parser: prev.parser
        ? {
            ...prev.parser,
            data: {
              ...(prev.parser.data || {}),
              savedTestResult: data.result,
              savedTestResultId: data.result?.id || resultId,
            },
          }
        : prev.parser,
    }));
  }, [closeTransientWorkbenchTabs, reset]);

  // Mirror of markParserTestResult but targeting the triage test result
  // collection. PATCH succeeds, then we replace testRuns.triage.data with
  // the updated savedTestResult so the UI reflects the new status without a
  // refetch.
  const markTriageTestResult = useCallback(async (resultId, status) => {
    const data = await apiFetchJson(`/api/triage-tests/results/${encodeURIComponent(resultId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        operatorNote: status === 'fail'
          ? 'Operator marked the live triage test output as incorrect.'
          : 'Operator marked the live triage test output as correct.',
      }),
      noRetry: true,
    }, 'Failed to record triage test result');

    setTestRuns((prev) => ({
      ...prev,
      triage: prev.triage
        ? {
            ...prev.triage,
            data: {
              ...(prev.triage.data || {}),
              savedTestResult: data.result,
              savedTestResultId: data.result?.id || resultId,
            },
          }
        : prev.triage,
    }));
  }, []);

  const startNewWorkflow = useCallback(() => {
    closeTransientWorkbenchTabs();
    reset();
    setTestRuns({});
  }, [closeTransientWorkbenchTabs, reset]);

  const started = isStarted(stageState) || imageCaptured || Object.keys(testRuns).length > 0;

  return (
    <div className={`v5-shell${started ? ' is-started' : ''}${dockCollapsed ? ' is-dock-collapsed' : ''}${isState4 ? ' is-state-4' : ''}`}>
      <main className="v5-console">
        <LinkedCaseLifecycleBanner
          escalation={linkedEscalation}
          knowledge={linkedKnowledge}
          resolving={resolvingLinkedCase}
          onResolve={handleResolveLinkedCase}
        />
        <WorkflowLane
          workflowSteps={workflowSteps}
          imageCaptured={imageCaptured}
          capturedImageSrc={capturedImageSrc}
          onCapture={captureImage}
          stageState={stageState}
          runtimeByStage={runtimeByStage}
          healthByStage={healthByStage}
          testRuns={testRuns}
          onRunStageTest={runStageTest}
          step1Visible={step1Visible}
          step1Exiting={step1Exiting}
          pipelineRunning={pipelineRunning}
          onCancelPipeline={requestCancelPipeline}
          onOpenStageLog={handleStageCardClick}
          stageHasEvents={stageHasEvents}
          thinkingByStage={thinkingByStage}
          liveEventCounts={liveEventCounts}
          eventEstimates={eventEstimates}
        />
        <AnalystWorkbench
          workflowSteps={workflowSteps}
          stageLabels={stageLabels}
          imageCaptured={imageCaptured}
          onCaptureImage={captureImage}
          stageState={stageState}
          analyst={analyst}
          chatLog={chatLog}
          onSendOperatorMessage={sendOperatorMessage}
          requestError={requestError}
          testRun={testRuns.main}
          onClearTest={() => clearStageTest('main')}
          onResetWorkflow={startNewWorkflow}
          openStageTabs={openStageTabs}
          activeTabId={activeTabId}
          onTabActivate={handleTabActivate}
          onTabClose={handleTabClose}
          stageEvents={stageEvents}
          caseIntake={effectiveCaseIntake}
          liveEventCounts={liveEventCounts}
          eventEstimates={eventEstimates}
        />
      </main>
      <div className={`v5-evidence-dock-wrap${dockCollapsed ? ' is-leaving' : ''}`} aria-hidden={dockCollapsed}>
        <EvidenceDock
          stageLabels={stageLabels}
          caseIntake={caseIntake}
          parsedFields={parsedFields}
          triageCard={triageCard}
          invMatches={invMatches}
          stageState={stageState}
          testRuns={testRuns}
          onClearStageTest={clearStageTest}
          onMarkParserTestResult={markParserTestResult}
          onMarkTriageTestResult={markTriageTestResult}
          parserThumbnail={!step1Visible && capturedImageSrc ? capturedImageSrc : null}
          onParserThumbnailClick={() => setParserPopupOpen(true)}
        />
      </div>
      {cancelConfirmOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="v5-cancel-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="v5-cancel-confirm-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCancelConfirmOpen(false);
          }}
        >
          <div className="v5-cancel-confirm">
            <h2 id="v5-cancel-confirm-title">Cancel pipeline?</h2>
            <p>
              This stops every running agent for this escalation. Parsed
              fields, triage, INV matches, and the assistant draft will
              be cleared.
            </p>
            <div className="v5-cancel-confirm__actions">
              <button
                type="button"
                className="v5-cancel-confirm__btn"
                onClick={() => setCancelConfirmOpen(false)}
                autoFocus
              >
                Keep running
              </button>
              <button
                type="button"
                className="v5-cancel-confirm__btn is-danger"
                onClick={confirmCancelPipeline}
              >
                Cancel pipeline
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      <ImageParserPopup
        open={parserPopupOpen && Boolean(capturedImageSrc)}
        seedImage={capturedImageSrc || null}
        parserMode="escalation-template-parser"
        onClose={() => setParserPopupOpen(false)}
        onParsed={() => {}}
      />
      {isActive && typeof document !== 'undefined' && createPortal(
        <button
          type="button"
          className={`v5-evidence-dock__fab${dockCollapsed ? ' is-collapsed' : ' is-expanded'}`}
          onClick={() => setDockCollapsed((prev) => !prev)}
          aria-label={dockCollapsed ? 'Show workspace panel' : 'Hide workspace panel'}
          aria-pressed={!dockCollapsed}
          title={dockCollapsed ? 'Show workspace panel' : 'Hide workspace panel'}
        >
          <span className="v5-evidence-dock__fab-icon v5-evidence-dock__fab-icon--close" aria-hidden="true">
            <Icon name="panel-right-close" size={18} />
          </span>
          <span className="v5-evidence-dock__fab-icon v5-evidence-dock__fab-icon--open" aria-hidden="true">
            <Icon name="panel-right-open" size={18} />
          </span>
          <span className="v5-evidence-dock__fab-label" aria-hidden="true">Workspace</span>
        </button>,
        document.body
      )}
    </div>
  );
}
