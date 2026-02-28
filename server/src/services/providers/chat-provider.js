function createContractError(providerId, detail) {
  const err = new Error(`Invalid chat adapter contract for provider "${providerId}": ${detail}`);
  err.code = 'INVALID_CHAT_ADAPTER';
  return err;
}

function ensureArray(value, fieldName, providerId) {
  if (!Array.isArray(value)) {
    throw createContractError(providerId, `${fieldName} must be an array`);
  }
}

function ensureString(value, fieldName, providerId) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    throw createContractError(providerId, `${fieldName} must be a string`);
  }
}

function ensureFunction(value, fieldName, providerId) {
  if (typeof value !== 'function') {
    throw createContractError(providerId, `${fieldName} must be a function`);
  }
}

function validateChatRequest(providerId, opts) {
  if (!opts || typeof opts !== 'object') {
    throw createContractError(providerId, 'chat() options object is required');
  }

  ensureArray(opts.messages, 'messages', providerId);
  ensureArray(opts.images || [], 'images', providerId);
  ensureString(opts.systemPrompt, 'systemPrompt', providerId);
  ensureFunction(opts.onChunk, 'onChunk', providerId);
  ensureFunction(opts.onDone, 'onDone', providerId);
  ensureFunction(opts.onError, 'onError', providerId);

  if (opts.timeoutMs !== undefined && (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0)) {
    throw createContractError(providerId, 'timeoutMs must be a positive number when provided');
  }
}

function createChatAdapter(providerId, chatImpl) {
  if (typeof chatImpl !== 'function') {
    throw createContractError(providerId, 'chat implementation must be a function');
  }

  return function chat(opts) {
    validateChatRequest(providerId, opts);
    const cleanup = chatImpl(opts);
    if (cleanup === undefined || cleanup === null) return () => {};
    if (typeof cleanup !== 'function') {
      throw createContractError(providerId, 'chat implementation must return a cleanup function');
    }
    return cleanup;
  };
}

module.exports = {
  createChatAdapter,
  validateChatRequest,
};
