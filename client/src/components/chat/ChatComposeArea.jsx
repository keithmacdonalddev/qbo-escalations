import { AnimatePresence, motion } from 'framer-motion';
import Tooltip from '../Tooltip.jsx';
import WebcamCapture from '../WebcamCapture.jsx';
import ChatComposeControls from './ChatComposeControls.jsx';
import ImageParserPopup from './ImageParserPopup.jsx';
import { transitions } from '../../utils/motion.js';
import './ImageParserPopup.css';

function ParsedEscalationPreviewCard({ preview, onClear }) {
  if (!preview) return null;

  const metaChips = [
    ...(Array.isArray(preview.ids) ? preview.ids : []),
    preview.client && preview.client !== 'Unknown' ? `Client ${preview.client}` : '',
    preview.agent && preview.agent !== 'Unknown' ? `Agent ${preview.agent}` : '',
    preview.category ? `Category ${preview.category}` : '',
  ].filter(Boolean);

  const detailRows = [
    preview.attemptingTo ? { label: 'Attempting', value: preview.attemptingTo } : null,
    preview.expectedOutcome ? { label: 'Expected', value: preview.expectedOutcome } : null,
    preview.actualOutcome ? { label: 'Actual', value: preview.actualOutcome } : null,
    preview.tsSteps ? { label: 'TS steps', value: preview.tsSteps } : null,
  ].filter(Boolean);

  return (
    <div className={`compose-preview-card${preview.mode === 'fallback' ? ' is-warning' : ''}`}>
      <div className="compose-preview-head">
        <div className="compose-preview-title-wrap">
          <span className="compose-preview-kicker">Parsed Escalation</span>
          {(preview.severity || preview.category) && (
            <span className="compose-preview-severity">
              {[preview.severity, preview.category].filter(Boolean).join(' ')}
            </span>
          )}
        </div>
        <button
          type="button"
          className="compose-preview-clear"
          onClick={onClear}
          aria-label="Clear parsed escalation preview"
          title="Clear parsed escalation preview"
        >
          Clear
        </button>
      </div>

      {preview.summary && (
        <div className="compose-preview-summary">{preview.summary}</div>
      )}

      {metaChips.length > 0 && (
        <div className="compose-preview-chips">
          {metaChips.map((chip) => (
            <span key={chip} className="compose-preview-chip">{chip}</span>
          ))}
        </div>
      )}

      {detailRows.length > 0 && (
        <div className="compose-preview-grid">
          {detailRows.map((row) => (
            <div key={row.label} className="compose-preview-field">
              <div className="compose-preview-label">{row.label}</div>
              <div className="compose-preview-value">{row.value}</div>
            </div>
          ))}
        </div>
      )}

      {preview.action && (
        <div className="compose-preview-action">
          <strong>Immediate next step:</strong> {preview.action}
        </div>
      )}
    </div>
  );
}

export default function ChatComposeArea({
  providerPopoverRef,
  provider,
  mode,
  fallbackProvider,
  model,
  fallbackModel,
  reasoningEffort,
  parallelProviders,
  showProviderPopover,
  setShowProviderPopover,
  setProvider,
  setMode,
  setFallbackProvider,
  setModel,
  setFallbackModel,
  setReasoningEffort,
  setParallelProviders,
  composeFocused,
  handleComposeFocus,
  handleComposeBlur,
  isComposeDragOver,
  handleComposeDragEnter,
  handleComposeDragOver,
  handleComposeDragLeave,
  handleComposeDrop,
  input,
  textareaRef,
  handleComposeInputChange,
  handleKeyDown,
  handlePaste,
  isStreaming,
  images,
  imageInputRef,
  handleAttachClick,
  handleFilePickerChange,
  showWebcam,
  setShowWebcam,
  showImageParser,
  setShowImageParser,
  imageParserSeed,
  setImageParserSeed,
  handleWebcamCapture,
  openTemplatePicker,
  removeImage,
  effectiveMode,
  abortStream,
  handleSubmit,
  slashMenuOpen,
  filteredSlashCommands,
  slashMenuIndex,
  activateSlashCommand,
  parsedEscalationPreview,
  onClearParsedEscalationPreview,
  composeStatusNotice,
  onImageParsed,
}) {
  const sendDisabled = (!input.trim())
    || (effectiveMode === 'parallel' && (parallelProviders.length < 2 || parallelProviders.length > 4));
  const composePlaceholder = parsedEscalationPreview
    ? 'Add a follow-up after the main chat replies, if needed.'
    : "What's the escalation? Type / for commands.";

  return (
    <>
      <div className="compose-card-shell">
        <div
          className={`compose-card${composeFocused ? ' is-focused' : ''}${isComposeDragOver ? ' is-dragover' : ''}`}
          onDragEnter={handleComposeDragEnter}
          onDragOver={handleComposeDragOver}
          onDragLeave={handleComposeDragLeave}
          onDrop={handleComposeDrop}
        >
          <ChatComposeControls
            providerPopoverRef={providerPopoverRef}
            provider={provider}
            mode={mode}
            fallbackProvider={fallbackProvider}
            model={model}
            fallbackModel={fallbackModel}
            reasoningEffort={reasoningEffort}
            parallelProviders={parallelProviders}
            showProviderPopover={showProviderPopover}
            setShowProviderPopover={setShowProviderPopover}
            setProvider={setProvider}
            setMode={setMode}
            setFallbackProvider={setFallbackProvider}
            setModel={setModel}
            setFallbackModel={setFallbackModel}
            setReasoningEffort={setReasoningEffort}
            setParallelProviders={setParallelProviders}
          />

          <div className="compose-body" style={{ position: 'relative' }}>
            {parsedEscalationPreview && (
              <ParsedEscalationPreviewCard
                preview={parsedEscalationPreview}
                onClear={onClearParsedEscalationPreview}
              />
            )}
            {composeStatusNotice && (
              <div className={`compose-status-notice is-${composeStatusNotice.tone || 'info'}`} role="status" aria-live="polite">
                {composeStatusNotice.text}
              </div>
            )}
            <div className="compose-body-inner">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleComposeInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={handleComposeFocus}
                onBlur={handleComposeBlur}
                placeholder={composePlaceholder}
                rows={1}
                disabled={isStreaming}
                aria-label="Chat message input"
              />
            </div>
            {slashMenuOpen && (
              <div className="slash-command-menu" role="listbox" aria-label="Slash commands">
                <div className="slash-command-menu-head">
                  <span>Slash Commands</span>
                  <span>Enter runs, Tab completes</span>
                </div>
                {filteredSlashCommands.length > 0 ? (
                  <div className="slash-command-list">
                    {filteredSlashCommands.map((command, index) => (
                      <button
                        key={command.id}
                        type="button"
                        className={`slash-command-item${index === slashMenuIndex ? ' is-active' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => activateSlashCommand(command)}
                        role="option"
                        aria-selected={index === slashMenuIndex}
                      >
                        <div className="slash-command-item-row">
                          <span className="slash-command-name">{command.command}</span>
                          <span className="slash-command-desc">{command.description}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="slash-command-empty">
                    No matching slash commands. Use <code>//</code> to send a literal slash.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="compose-footer">
            <div className="compose-actions">
              <Tooltip text="Load a screenshot into the image parser (Ctrl+V)" level="low">
                <button
                  className={`compose-action-btn${images.length > 0 ? ' is-active' : ''}`}
                  onClick={handleAttachClick}
                  type="button"
                  aria-label="Parse image from file"
                  disabled={isStreaming}
                >
                  <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
              </Tooltip>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleFilePickerChange}
                style={{ display: 'none' }}
                tabIndex={-1}
                aria-hidden="true"
              />

              <Tooltip text="Capture a photo for the image parser" level="low">
                <button
                  className={`compose-action-btn${showWebcam ? ' is-active' : ''}`}
                  onClick={() => setShowWebcam(true)}
                  type="button"
                  aria-label="Open webcam for image parser"
                  disabled={isStreaming}
                >
                  <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="13" r="4" />
                    <path d="M9 2L7.17 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2h-3.17L15 2H9z" />
                  </svg>
                </button>
              </Tooltip>

              <Tooltip text="Insert a response template" level="medium">
                <button
                  className="compose-action-btn"
                  onClick={openTemplatePicker}
                  type="button"
                  aria-label="Insert template"
                  disabled={isStreaming}
                >
                  <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </button>
              </Tooltip>

              <Tooltip text="Open the image parser" level="medium">
                <button
                  className={`compose-action-btn${showImageParser ? ' is-active' : ''}`}
                  onClick={() => setShowImageParser(true)}
                  type="button"
                  aria-label="Parse screenshot"
                  disabled={isStreaming}
                >
                  <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                    <rect x="7" y="7" width="10" height="10" rx="1" />
                  </svg>
                </button>
              </Tooltip>

              {images.length > 0 && (
                <div
                  className="compose-attachments-inline"
                  aria-live="polite"
                  aria-label={`${images.length} image${images.length === 1 ? '' : 's'} attached`}
                >
                  <span className="compose-attachments-title">
                    {images.length} upload{images.length === 1 ? '' : 's'}
                  </span>
                  <div className="compose-attachments-list">
                    <AnimatePresence>
                      {images.map((image, i) => (
                        <motion.div
                          key={image.hash || image.metaKey || `img-${i}`}
                          className="compose-attachment"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={transitions.springSnappy}
                          layout
                        >
                          <img src={image.src} alt={`Attachment ${i + 1}`} />
                          <button
                            type="button"
                            className="compose-attachment-remove"
                            onClick={() => removeImage(i)}
                            aria-label={`Remove attached image ${i + 1}`}
                            title="Remove image"
                          >
                            x
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>

            <span className="compose-footer-hint">
              {slashMenuOpen
                ? 'Enter runs the command. Tab completes it. Type // to send a literal slash.'
                : parsedEscalationPreview
                  ? 'The compact preview above was already sent to the main chat. Use this box only for follow-up messages.'
                  : 'Drop a screenshot to parse it into text, use webcam, or type / for commands'}
            </span>

            <span className="compose-char-count">{input.length} chars</span>

            <AnimatePresence mode="wait" initial={false}>
              {isStreaming ? (
                <motion.button
                  key="stop"
                  className="compose-send-btn is-danger"
                  onClick={abortStream}
                  type="button"
                  aria-label="Stop generating"
                  title="Stop generating"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={transitions.springSnappy}
                >
                  <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </motion.button>
              ) : (
                <motion.button
                  key="send"
                  className="compose-send-btn"
                  onClick={handleSubmit}
                  disabled={sendDisabled}
                  type="button"
                  aria-label="Send message"
                  title="Send message"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={transitions.springSnappy}
                >
                  <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {showWebcam && (
        <WebcamCapture
          onCapture={handleWebcamCapture}
          onClose={() => setShowWebcam(false)}
        />
      )}

      <ImageParserPopup
        open={showImageParser}
        seedImage={imageParserSeed}
        onClose={() => {
          setShowImageParser(false);
          setImageParserSeed(null);
        }}
        onParsed={onImageParsed}
      />
    </>
  );
}
