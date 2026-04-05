import { useCallback, useMemo, useState } from 'react';
import { apiFetch, apiFetchJson } from '../api/http.js';
import { getProviderShortLabel, PROVIDER_OPTIONS } from '../lib/providerCatalog.js';
import { buildAlertActionPrompt } from '../lib/workspaceAlertBriefing.js';
import {
  dispatchGmailMutations,
} from '../lib/gmailUiEvents.js';

function getAssistantStreamMessage(prev) {
  return prev.streamText
    ? [...prev.messages, { role: 'assistant', content: prev.streamText, timestamp: new Date().toISOString() }]
    : prev.messages;
}

export default function useWorkspaceAgentPanelActions({
  sessionKey,
  patchSession,
  setController,
  abortSession,
  workspaceSessionId,
  setActiveAgentSessionId,
  messages = [],
  input = '',
  streaming = false,
  provider,
  mode,
  fallbackProvider,
  model,
  fallbackModel,
  reasoningEffort,
  clearStallWatch,
  resetReasoningState,
  abortActiveAgentSession,
  handleStartNewConversation,
  startWorkspaceRequest,
  viewContext,
  toast,
  dismissAlert,
  logAlertInteraction,
  setShowCommandHint,
} = {}) {
  const [feedbackMap, setFeedbackMap] = useState({});

  const addSystemMessage = useCallback((content) => {
    patchSession((prev) => ({
      ...prev,
      messages: [...prev.messages, { role: 'system', content, timestamp: new Date().toISOString() }],
    }));
  }, [patchSession]);

  const stopActiveWorkspaceResponse = useCallback(() => {
    abortActiveAgentSession('Workspace session stopped by the user');
    abortSession();
    clearStallWatch();
    patchSession((prev) => ({
      ...prev,
      messages: getAssistantStreamMessage(prev),
      streamText: '',
      thinkingText: '',
      streaming: false,
      statusState: null,
    }));
    resetReasoningState();
    setController(null);
    setActiveAgentSessionId(null);
  }, [
    abortActiveAgentSession,
    abortSession,
    clearStallWatch,
    patchSession,
    resetReasoningState,
    setActiveAgentSessionId,
    setController,
  ]);

  const queueWorkspaceRequest = useCallback((promptText) => {
    const text = typeof promptText === 'string' ? promptText.trim() : '';
    if (!text) return false;
    if (streaming) return false;
    patchSession({ input: text });
    window.setTimeout(() => startWorkspaceRequest(text), 0);
    return true;
  }, [patchSession, startWorkspaceRequest, streaming]);

  const handleSlashCommand = useCallback((text) => {
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();

    switch (cmd) {
      case '/clear': {
        handleStartNewConversation();
        return true;
      }
      case '/help': {
        const lines = [
          '**Available commands:**',
          '',
          '| Command | Description |',
          '|---------|-------------|',
          '| `/clear` | Clear conversation |',
          '| `/help` | Show this help |',
          '| `/history` | Show recent agent actions |',
          '| `/stop` | Stop current response |',
          '| `/model` | Show current provider |',
          '| `/model <name>` | Switch provider |',
          '| `/brief` | Briefing on inbox & calendar |',
          '| `/status` | Show session info |',
        ];
        addSystemMessage(lines.join('\n'));
        return true;
      }
      case '/history': {
        addSystemMessage('Loading action history...');
        apiFetchJson('/api/workspace/action-log?limit=50', {}, 'Failed to fetch action history')
          .then((data) => {
            if (!data.ok || !data.actions || data.actions.length === 0) {
              addSystemMessage('No agent actions recorded yet.');
              return;
            }
            const header = `**Agent Action Replay** (${data.actions.length} of ${data.total} total)\n`;
            const rows = data.actions.map((a) => {
              const t = new Date(a.timestamp);
              const time = t.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const dur = a.durationMs > 0 ? ` (${a.durationMs}ms)` : '';
              const icon = a.status === 'error' ? 'x' : 'v';
              const brief = typeof a.result === 'string'
                ? a.result
                : a.result && typeof a.result === 'object'
                  ? (a.result.summary || a.result.id || JSON.stringify(a.result))
                  : 'done';
              return `\`[${time}]\` **${a.action}** ${dur} — [${icon}] ${brief}`;
            });
            addSystemMessage(header + rows.join('\n'));
          })
          .catch(() => {
            addSystemMessage('Failed to fetch action history.');
          });
        return true;
      }
      case '/stop': {
        if (streaming) {
          stopActiveWorkspaceResponse();
          addSystemMessage('Response stopped.');
        } else {
          addSystemMessage('Nothing is streaming right now.');
        }
        return true;
      }
      case '/model': {
        if (!arg) {
          const modeLabel = mode === 'fallback'
            ? `${getProviderShortLabel(provider)} + ${getProviderShortLabel(fallbackProvider)} (fallback)`
            : getProviderShortLabel(provider);
          const available = PROVIDER_OPTIONS.map((o) => `\`${o.value}\``).join(', ');
          addSystemMessage([
            `**Current provider:** ${modeLabel}`,
            `**Model override:** ${model || 'provider default'}`,
            mode === 'fallback' ? `**Fallback model:** ${fallbackModel || 'provider default'}` : '',
            `**Reasoning effort:** ${reasoningEffort}`,
            '',
            `**Available providers:** ${available}`,
          ].filter(Boolean).join('\n'));
        } else {
          const match = PROVIDER_OPTIONS.find(
            (o) => o.value.toLowerCase() === arg.toLowerCase() || o.label.toLowerCase() === arg.toLowerCase()
          );
          if (match) {
            patchSession({ provider: match.value, model: '' });
            addSystemMessage(`Provider switched to **${match.label}** (\`${match.value}\`).`);
          } else {
            const available = PROVIDER_OPTIONS.map((o) => `\`${o.value}\``).join(', ');
            addSystemMessage(`Unknown provider: \`${arg}\`\n\nAvailable: ${available}`);
          }
        }
        return true;
      }
      case '/brief': {
        if (streaming) {
          addSystemMessage('Wait for the current response to finish first.');
          return true;
        }
        return false;
      }
      case '/status': {
        const msgCount = messages.filter((m) => m.role !== 'system').length;
        const modeLabel = mode === 'fallback'
          ? `${getProviderShortLabel(provider)} + ${getProviderShortLabel(fallbackProvider)} (fallback)`
          : getProviderShortLabel(provider);
        const lines = [
          '**Session info:**',
          '',
          `| Field | Value |`,
          `|-------|-------|`,
          `| Provider | ${modeLabel} |`,
          `| Model | ${model || 'provider default'} |`,
          mode === 'fallback' ? `| Fallback Model | ${fallbackModel || 'provider default'} |` : '',
          `| Mode | ${mode} |`,
          `| Reasoning | ${reasoningEffort} |`,
          `| Messages | ${msgCount} |`,
          `| Session ID | \`${workspaceSessionId || 'none'}\` |`,
        ].filter(Boolean);
        addSystemMessage(lines.join('\n'));
        return true;
      }
      default:
        addSystemMessage(`Unknown command: \`${cmd}\`. Type \`/help\` for available commands.`);
        return true;
    }
  }, [
    addSystemMessage,
    fallbackProvider,
    fallbackModel,
    handleStartNewConversation,
    messages,
    model,
    mode,
    patchSession,
    provider,
    reasoningEffort,
    streaming,
    stopActiveWorkspaceResponse,
    workspaceSessionId,
  ]);

  const handleSend = useCallback((e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setShowCommandHint?.(false);

    if (text.startsWith('/')) {
      patchSession({ input: '' });
      const handled = handleSlashCommand(text);
      if (handled) return;
      if (text.split(/\s+/)[0].toLowerCase() === '/brief') {
        if (!streaming) {
          startWorkspaceRequest('Brief me on my inbox and calendar.');
        }
        return;
      }
      return;
    }

    if (streaming) return;
    startWorkspaceRequest(text);
  }, [handleSlashCommand, input, patchSession, setShowCommandHint, startWorkspaceRequest, streaming]);

  const handleStop = useCallback(() => {
    stopActiveWorkspaceResponse();
  }, [stopActiveWorkspaceResponse]);

  const handleQuickAction = useCallback((promptText) => {
    queueWorkspaceRequest(promptText);
  }, [queueWorkspaceRequest]);

  const handleAlertAction = useCallback((alert) => {
    if (streaming) return;
    const promptText = buildAlertActionPrompt(alert);
    if (!promptText) return;
    const key = `${alert.type}:${alert.sourceId || ''}`;
    dismissAlert(key);
    logAlertInteraction(alert, 'clicked');
    queueWorkspaceRequest(promptText);
  }, [dismissAlert, logAlertInteraction, queueWorkspaceRequest, streaming]);

  const handleBriefingCardAction = useCallback(async (action) => {
    try {
      const actionType = String(action?.type || '').toLowerCase();

      if (actionType === 'prompt') {
        const promptText = typeof action?.prompt === 'string' ? action.prompt.trim() : '';
        if (!promptText) {
          throw new Error('This briefing action is missing its prompt.');
        }
        if (streaming) {
          toast.warning('Wait for the current workspace reply to finish first.');
          return;
        }
        queueWorkspaceRequest(promptText);
        return;
      }

      if (actionType === 'navigate') {
        const target = typeof action?.target === 'string' ? action.target.trim() : '';
        if (!target) {
          throw new Error('This briefing action is missing its destination.');
        }
        window.location.hash = target.startsWith('#') ? target : `#${target}`;
        return;
      }

      if (actionType === 'open_url') {
        const url = typeof action?.url === 'string' ? action.url.trim() : '';
        if (!/^https?:\/\//i.test(url)) {
          throw new Error('This briefing link is invalid.');
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }

      if (actionType === 'copy_text') {
        const text = typeof action?.text === 'string' ? action.text : '';
        if (!text) {
          throw new Error('There is no text to copy for this action.');
        }
        await navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard.');
        return;
      }

      if (actionType === 'archive_email' || actionType === 'mark_read') {
        const messageId = typeof action?.messageId === 'string' ? action.messageId.trim() : '';
        if (!messageId) {
          throw new Error('This email action is missing its message id.');
        }
        const body = {
          removeLabelIds: actionType === 'archive_email' ? ['INBOX'] : ['UNREAD'],
        };
        if (typeof action?.account === 'string' && action.account.trim()) {
          body.account = action.account.trim();
        }
        const data = await apiFetchJson(`/api/gmail/messages/${encodeURIComponent(messageId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }, 'Email action failed');
        dispatchGmailMutations({
          messageId,
          account: body.account,
          labelIds: data?.labelIds,
          removeLabelIds: body.removeLabelIds,
        }, { source: 'workspace-briefing-card' });
        toast.success(actionType === 'archive_email' ? 'Email archived.' : 'Email marked as read.');
        return;
      }

      if (actionType === 'trash_email') {
        const messageId = typeof action?.messageId === 'string' ? action.messageId.trim() : '';
        if (!messageId) {
          throw new Error('This email action is missing its message id.');
        }
        const query = typeof action?.account === 'string' && action.account.trim()
          ? `?account=${encodeURIComponent(action.account.trim())}`
          : '';
        const data = await apiFetchJson(`/api/gmail/messages/${encodeURIComponent(messageId)}${query}`, {
          method: 'DELETE',
        }, 'Email action failed');
        dispatchGmailMutations({
          messageId,
          account: typeof action?.account === 'string' && action.account.trim() ? action.account.trim() : '',
          deleted: true,
        }, { source: 'workspace-briefing-card' });
        toast.success('Email moved to trash.');
        return;
      }

      throw new Error('This briefing action type is not supported yet.');
    } catch (err) {
      toast.error(err?.message || 'Briefing action failed.');
      throw err;
    }
  }, [queueWorkspaceRequest, streaming, toast]);

  const handleFeedback = useCallback((messageIndex, rating) => {
    if (feedbackMap[messageIndex]) return;
    setFeedbackMap((prev) => ({ ...prev, [messageIndex]: rating }));

    let promptText = '';
    for (let j = messageIndex - 1; j >= 0; j--) {
      if (messages[j]?.role === 'user') {
        promptText = (messages[j].content || '').slice(0, 200);
        break;
      }
    }

    apiFetch('/api/workspace/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionKey,
        messageIndex,
        rating,
        prompt: promptText,
      }),
    }).catch(() => { /* best effort */ });
  }, [feedbackMap, messages, sessionKey]);

  const quickActions = useMemo(() => {
    const currentView = viewContext?.view;
    const hour = new Date().getHours();
    const isEvening = hour >= 17;
    const smartActions = [];

    smartActions.push({ label: 'What needs my attention?', prompt: 'Scan my inbox and calendar. What needs my attention most urgently right now? Prioritize by urgency.' });
    smartActions.push({ label: 'Check for schedule conflicts', prompt: 'Check for conflicts in my schedule today. Look for overlapping events, double-bookings, back-to-back meetings with no buffer, and any meetings that might conflict with travel time.' });
    smartActions.push({ label: 'What do you remember?', prompt: 'What do you remember about my upcoming trips, recurring commitments, and important deadlines? Review my calendar and recent emails for context.' });
    smartActions.push({ label: 'Build today\'s timeline', prompt: 'Build me a detailed timeline for today. Include all calendar events, suggest optimal windows for focused work, email responses, and breaks. Factor in travel time between locations if relevant.' });

    if (isEvening) {
      smartActions.push({ label: 'Wrap up my day', prompt: 'Give me an end-of-day wrap-up. Summarize what happened today (emails, meetings) and what I should tackle first thing tomorrow morning.' });
    }

    if (currentView === 'gmail') {
      if (viewContext?.emailId) {
        return [
          { label: 'Summarize this email', prompt: 'Summarize this email concisely. Highlight key points, action items, and sender intent.' },
          { label: 'Draft a reply', prompt: 'Draft a professional reply to this email.' },
          { label: 'Extract action items', prompt: 'Extract all action items and deadlines from this email as a bullet list.' },
          { label: 'Related calendar events', prompt: 'Are there any upcoming calendar events related to this email? Check my calendar.' },
          ...smartActions,
        ];
      }
      return [
        { label: 'Triage my inbox', prompt: 'Search for my unread emails and triage them. Categorize each as urgent, needs-reply, FYI, or newsletter. Present a summary table with recommended actions.' },
        { label: 'Unread summary', prompt: 'Search for my unread emails and give me a brief summary of each.' },
        { label: 'Today\'s schedule', prompt: 'What\'s on my calendar today? List all events with times.' },
        { label: 'Important emails', prompt: 'Search for important emails from the last 24 hours and summarize them.' },
        ...smartActions,
      ];
    }

    if (currentView === 'calendar') {
      return [
        { label: 'Today\'s schedule', prompt: 'List all my events for today with times and details.' },
        { label: 'Prep me for my next meeting', prompt: 'What\'s my next meeting? Search for recent emails from the attendees and summarize any relevant threads so I\'m prepared.' },
        { label: 'This week\'s events', prompt: 'Give me an overview of my calendar this week.' },
        { label: 'Find free time', prompt: 'When am I free this week? Find available time slots.' },
        { label: 'Unread emails', prompt: 'Search for my unread emails and give me a brief summary.' },
        ...smartActions,
      ];
    }

    return [
      { label: 'Inbox overview', prompt: 'Search for my recent unread emails and summarize them.' },
      { label: 'Today\'s schedule', prompt: 'What\'s on my calendar today?' },
      { label: 'Triage my inbox', prompt: 'Search for my unread emails and triage them by urgency. Categorize each as urgent, needs-reply, FYI, or newsletter.' },
      { label: 'Prep me for my next meeting', prompt: 'What\'s my next meeting? Search for recent emails from the attendees and summarize any relevant threads so I\'m prepared.' },
      ...smartActions,
    ];
  }, [viewContext]);

  return {
    feedbackMap,
    quickActions,
    handleSend,
    handleStop,
    handleQuickAction,
    handleAlertAction,
    handleBriefingCardAction,
    handleFeedback,
    addSystemMessage,
    handleSlashCommand,
  };
}
