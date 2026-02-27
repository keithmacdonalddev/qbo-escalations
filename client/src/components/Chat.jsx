import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../hooks/useChat.js';
import { exportConversation, getConversation, forkConversation } from '../api/chatApi.js';
import { createEscalation, linkEscalation, getEscalation, transitionEscalation } from '../api/escalationsApi.js';
import { listTemplates, trackTemplateUsage } from '../api/templatesApi.js';
import ChatMessage from './ChatMessage.jsx';
import ImageUpload from './ImageUpload.jsx';

const QUICK_PROMPTS = [
  { label: 'Parse Escalation', prompt: 'Parse this escalation and identify: COID, MID, case number, client contact, agent name, what they\'re attempting, expected vs actual outcome, troubleshooting steps taken, and the QBO category. Then recommend next steps.' },
  { label: 'Draft Response', prompt: 'Based on our conversation, draft a professional response I can send back to the phone agent. Include specific resolution steps.' },
  { label: 'Categorize Issue', prompt: 'What QBO category does this issue fall under? Explain your reasoning and list related known issues in that category.' },
  { label: 'Suggest Troubleshooting', prompt: 'Based on the issue described, what troubleshooting steps should the agent try next? List them in order of likelihood to resolve.' },
];

/** Check if an assistant message looks like it contains parsed escalation data */
function detectEscalationFields(text) {
  if (!text || text.length < 50) return null;
  const fields = {};
  const coidMatch = text.match(/\bCOID[:\s]*(\d{5,})/i);
  if (coidMatch) fields.coid = coidMatch[1];
  const caseMatch = text.match(/\bcase\s*(?:#|number|num)?[:\s]*(\d{6,})/i);
  if (caseMatch) fields.caseNumber = caseMatch[1];
  const agentMatch = text.match(/\bagent(?:\s+name)?[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/);
  if (agentMatch) fields.agentName = agentMatch[1];
  const categoryMap = [
    { pattern: /payroll/i, category: 'payroll' },
    { pattern: /bank.?feed/i, category: 'bank-feeds' },
    { pattern: /reconciliation/i, category: 'reconciliation' },
    { pattern: /permission/i, category: 'permissions' },
    { pattern: /billing/i, category: 'billing' },
    { pattern: /\btax\b/i, category: 'tax' },
    { pattern: /invoic/i, category: 'invoicing' },
    { pattern: /report/i, category: 'reporting' },
  ];
  for (const { pattern, category } of categoryMap) {
    if (pattern.test(text)) {
      fields.category = category;
      break;
    }
  }
  const attemptMatch = text.match(/(?:attempting|trying|issue|problem)[:\s]*(.{10,80}?)(?:\.|$)/im);
  if (attemptMatch) fields.attemptingTo = attemptMatch[1].trim();
  // Need at least 2 recognized fields to consider it an escalation parse
  return Object.keys(fields).length >= 2 ? fields : null;
}

export default function Chat({ conversationIdFromRoute }) {
  const {
    messages,
    conversationId,
    isStreaming,
    streamingText,
    error,
    responseTime,
    sendMessage,
    abortStream,
    selectConversation,
    newConversation,
    setError,
  } = useChat();

  const [exportCopied, setExportCopied] = useState(false);
  const [savedEscalationId, setSavedEscalationId] = useState(null);
  const [savingEscalation, setSavingEscalation] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateCategory, setTemplateCategory] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const [linkedEscalation, setLinkedEscalation] = useState(null);
  const [resolvingEscalation, setResolvingEscalation] = useState(false);

  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Check if current conversation has a linked escalation
  useEffect(() => {
    if (!conversationId) { setLinkedEscalation(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const conv = await getConversation(conversationId);
        if (cancelled) return;
        if (conv.escalationId) {
          const esc = await getEscalation(conv.escalationId);
          if (!cancelled) setLinkedEscalation(esc);
        } else {
          setLinkedEscalation(null);
        }
      } catch {
        if (!cancelled) setLinkedEscalation(null);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId, savedEscalationId]);

  // Load conversation from route param
  useEffect(() => {
    if (conversationIdFromRoute && conversationIdFromRoute !== conversationId) {
      selectConversation(conversationIdFromRoute);
    }
  }, [conversationIdFromRoute, conversationId, selectConversation]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Ctrl+N: new conversation
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        newConversation();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [newConversation]);

  // Focus input after streaming ends
  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  const handleSubmit = useCallback(() => {
    if ((!input.trim() && images.length === 0) || isStreaming) return;
    sendMessage(input, images);
    setInput('');
    setImages([]);
    setShowUpload(false);
  }, [input, images, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
    if (imageItems.length > 0) {
      e.preventDefault();
      setShowUpload(true);
      const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
      const readers = files.map(file => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      }));
      Promise.all(readers).then(results => {
        setImages(prev => [...prev, ...results]);
      });
    }
  }, []);

  const handleQuickPrompt = useCallback((prompt) => {
    if (isStreaming) return;
    sendMessage(prompt, images);
    setImages([]);
    setShowUpload(false);
  }, [isStreaming, images, sendMessage]);

  // Save parsed escalation from the last assistant message
  const handleSaveEscalation = useCallback(async (fields) => {
    if (!conversationId || savingEscalation) return;
    setSavingEscalation(true);
    try {
      const esc = await createEscalation({ ...fields, source: 'chat' });
      await linkEscalation(esc._id, conversationId);
      setSavedEscalationId(esc._id);
    } catch { /* ignore */ }
    setSavingEscalation(false);
  }, [conversationId, savingEscalation]);

  // Mark linked escalation as resolved
  const handleResolveEscalation = useCallback(async () => {
    if (!linkedEscalation || resolvingEscalation) return;
    setResolvingEscalation(true);
    try {
      const updated = await transitionEscalation(linkedEscalation._id, 'resolved');
      setLinkedEscalation(updated);
    } catch { /* ignore */ }
    setResolvingEscalation(false);
  }, [linkedEscalation, resolvingEscalation]);

  // Reset saved escalation when conversation changes
  useEffect(() => {
    setSavedEscalationId(null);
  }, [conversationId]);

  // Detect escalation fields in the last assistant message
  const lastAssistantMsg = messages.length > 0 ? [...messages].reverse().find(m => m.role === 'assistant') : null;
  const detectedFields = lastAssistantMsg ? detectEscalationFields(lastAssistantMsg.content) : null;
  const showEscalationAction = detectedFields && !savedEscalationId && !isStreaming && conversationId;

  // Template picker
  const openTemplatePicker = useCallback(async () => {
    setShowTemplatePicker(true);
    setLoadingTemplates(true);
    try {
      const list = await listTemplates(templateCategory || undefined);
      setTemplates(list);
    } catch { /* ignore */ }
    setLoadingTemplates(false);
  }, [templateCategory]);

  const handleTemplateInsert = useCallback((template) => {
    setInput(prev => prev ? prev + '\n\n' + template.body : template.body);
    setShowTemplatePicker(false);
    trackTemplateUsage(template._id).catch(() => {});
    textareaRef.current?.focus();
  }, []);

  const handleTemplateCategoryChange = useCallback(async (cat) => {
    setTemplateCategory(cat);
    setLoadingTemplates(true);
    try {
      const list = await listTemplates(cat || undefined);
      setTemplates(list);
    } catch { /* ignore */ }
    setLoadingTemplates(false);
  }, []);

  // Fork conversation from a specific message
  const handleFork = useCallback(async (messageIndex) => {
    if (!conversationId) return;
    try {
      const forked = await forkConversation(conversationId, messageIndex);
      // Navigate to the new forked conversation
      window.location.hash = `#/chat/${forked._id}`;
    } catch { /* ignore */ }
  }, [conversationId]);

  const hasImages = images.length > 0;

  return (
    <div className="chat-container">
      {/* Linked escalation banner */}
      {linkedEscalation && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-3)',
          padding: 'var(--sp-2) var(--sp-5)',
          background: 'var(--bg-sunken)',
          borderBottom: '1px solid var(--line)',
          fontSize: 'var(--text-sm)',
        }}>
          <span className={`badge badge-${linkedEscalation.status === 'open' ? 'open' : linkedEscalation.status === 'in-progress' ? 'progress' : linkedEscalation.status === 'resolved' ? 'resolved' : 'escalated'}`}>
            {linkedEscalation.status}
          </span>
          <span style={{ flex: 1, color: 'var(--ink-secondary)' }}>
            Linked escalation
            {linkedEscalation.coid && <span className="mono" style={{ marginLeft: 'var(--sp-2)' }}>COID: {linkedEscalation.coid}</span>}
            {linkedEscalation.category && (
              <span className={`cat-badge cat-${linkedEscalation.category}`} style={{ marginLeft: 'var(--sp-2)', fontSize: 'var(--text-xs)' }}>
                {linkedEscalation.category.replace('-', ' ')}
              </span>
            )}
          </span>
          {linkedEscalation.status !== 'resolved' && (
            <button
              className="btn btn-sm btn-primary"
              onClick={handleResolveEscalation}
              disabled={resolvingEscalation}
              type="button"
            >
              {resolvingEscalation ? 'Resolving...' : 'Mark Resolved'}
            </button>
          )}
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => { window.location.hash = '#/dashboard'; }}
            type="button"
          >
            View
          </button>
        </div>
      )}

      {/* Messages area */}
      <div className="chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="empty-state" style={{ marginTop: 'var(--sp-10)' }}>
            <div className="empty-state-title">QBO Escalation Assistant</div>
            <div className="empty-state-desc">
              Paste an escalation screenshot (Ctrl+V) or describe the issue. Claude will help diagnose and draft a response.
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', justifyContent: 'center', marginTop: 'var(--sp-7)' }}>
              {QUICK_PROMPTS.slice(0, 2).map((qp, i) => (
                <button
                  key={i}
                  className="btn btn-secondary"
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  type="button"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Export button when conversation has messages */}
        {messages.length > 1 && !isStreaming && conversationId && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 var(--sp-2)' }}>
            <button
              className={`copy-btn${exportCopied ? ' is-copied' : ''}`}
              onClick={async () => {
                try {
                  const text = await exportConversation(conversationId);
                  await navigator.clipboard.writeText(text);
                  setExportCopied(true);
                  setTimeout(() => setExportCopied(false), 2000);
                } catch { /* ignore */ }
              }}
              type="button"
            >
              {exportCopied ? 'Copied to clipboard' : 'Copy full conversation'}
            </button>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            role={msg.role}
            content={msg.content}
            images={msg.images}
            timestamp={msg.timestamp}
            responseTimeMs={msg.responseTimeMs}
            onFork={msg.role === 'assistant' && conversationId && !isStreaming ? () => handleFork(i) : undefined}
          />
        ))}

        {/* Streaming response */}
        {isStreaming && streamingText && (
          <ChatMessage
            role="assistant"
            content={streamingText}
            isStreaming={true}
          />
        )}

        {/* Streaming but no text yet */}
        {isStreaming && !streamingText && (
          <div className="chat-bubble chat-bubble-assistant" style={{ alignSelf: 'flex-start' }}>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>Claude</div>
            <span className="spinner spinner-sm" />
            <span className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginLeft: 'var(--sp-2)' }}>
              Thinking...
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="chat-bubble chat-bubble-system" style={{ borderColor: 'var(--danger)', border: '1px solid var(--danger)' }}>
            <span className="text-danger">{error}</span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setError(null)}
              style={{ marginLeft: 'var(--sp-3)' }}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Save as Escalation action bar */}
        {showEscalationAction && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-3)',
            padding: 'var(--sp-3) var(--sp-5)',
            margin: '0 var(--sp-3)',
            background: 'var(--accent-subtle)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--accent)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)', fontWeight: 600, flex: 1 }}>
              Escalation data detected
              {detectedFields.coid && <span style={{ fontWeight: 400, marginLeft: 'var(--sp-2)' }}>(COID: {detectedFields.coid})</span>}
            </span>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => handleSaveEscalation(detectedFields)}
              disabled={savingEscalation}
              type="button"
            >
              {savingEscalation ? 'Saving...' : 'Save as Escalation'}
            </button>
          </div>
        )}

        {/* Escalation saved confirmation */}
        {savedEscalationId && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-3)',
            padding: 'var(--sp-3) var(--sp-5)',
            margin: '0 var(--sp-3)',
            background: 'var(--success-subtle, #e8f5e9)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--success, #41a466)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success, #41a466)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success, #41a466)', fontWeight: 600, flex: 1 }}>
              Escalation saved and linked to this conversation
            </span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => { window.location.hash = `#/escalations/${savedEscalationId}`; }}
              type="button"
            >
              View Escalation
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick action bar — show when images are attached */}
      {hasImages && !isStreaming && (
        <div style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-3) var(--sp-5)',
          borderTop: '1px solid var(--line-subtle)',
          overflowX: 'auto',
        }}>
          {QUICK_PROMPTS.map((qp, i) => (
            <button
              key={i}
              className="btn btn-sm btn-secondary"
              onClick={() => handleQuickPrompt(qp.prompt)}
              type="button"
              style={{ whiteSpace: 'nowrap' }}
            >
              {qp.label}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-area" style={{ flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {showUpload && (
          <ImageUpload
            images={images}
            onImagesChange={setImages}
            disabled={isStreaming}
          />
        )}

        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', width: '100%' }}>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setShowUpload(prev => !prev)}
            title="Attach images (or press Ctrl+V to paste)"
            type="button"
            aria-label="Toggle image upload"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <button
            className="btn btn-ghost btn-icon"
            onClick={openTemplatePicker}
            title="Insert a response template"
            type="button"
            aria-label="Insert template"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Describe the escalation or paste a screenshot (Ctrl+V)..."
            rows={1}
            disabled={isStreaming}
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 160,
              resize: 'none',
              background: 'var(--bg-sunken)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-base)',
              color: 'var(--ink)',
              lineHeight: 1.5,
            }}
          />

          {isStreaming ? (
            <button
              className="btn btn-danger"
              onClick={abortStream}
              type="button"
            >
              Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!input.trim() && images.length === 0}
              type="button"
            >
              Send
            </button>
          )}
        </div>

        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textAlign: 'center' }}>
          Enter to send &middot; Shift+Enter for new line &middot; Ctrl+V to paste images &middot; Ctrl+N new conversation
        </div>
      </div>

      {/* Template picker overlay */}
      {showTemplatePicker && (
        <div
          className="modal-overlay"
          onClick={() => setShowTemplatePicker(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowTemplatePicker(false); }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(600px, 90vw)',
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Insert Template</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowTemplatePicker(false)}
                type="button"
              >
                Close
              </button>
            </div>

            {/* Category filter chips */}
            <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
              {['', 'acknowledgment', 'follow-up', 'escalation-up', 'payroll', 'bank-feeds', 'reconciliation', 'general'].map(cat => (
                <button
                  key={cat}
                  className={`btn btn-sm ${templateCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleTemplateCategoryChange(cat)}
                  type="button"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  {cat ? cat.replace('-', ' ') : 'All'}
                </button>
              ))}
            </div>

            {/* Template list */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loadingTemplates ? (
                <div style={{ textAlign: 'center', padding: 'var(--sp-6)' }}>
                  <span className="spinner spinner-sm" />
                </div>
              ) : templates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--sp-6)', color: 'var(--ink-secondary)' }}>
                  No templates found.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  {templates.map(tmpl => (
                    <button
                      key={tmpl._id}
                      onClick={() => handleTemplateInsert(tmpl)}
                      type="button"
                      style={{
                        textAlign: 'left',
                        padding: 'var(--sp-3) var(--sp-4)',
                        background: 'var(--bg-sunken)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        transition: 'border-color 140ms ease',
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-1)' }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{tmpl.title}</span>
                        <span className={`cat-badge cat-${tmpl.category || 'general'}`} style={{ fontSize: 'var(--text-xs)' }}>
                          {(tmpl.category || 'general').replace('-', ' ')}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--ink-secondary)',
                        whiteSpace: 'pre-wrap',
                        maxHeight: 60,
                        overflow: 'hidden',
                        lineHeight: 1.5,
                      }}>
                        {tmpl.body}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
