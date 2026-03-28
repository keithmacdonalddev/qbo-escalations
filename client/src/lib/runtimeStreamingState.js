const RUNTIME_STREAMING_STATE_KEY = '__qboStreaming';

function getGlobalState() {
  return globalThis;
}

function isRuntimeStreaming() {
  return Boolean(getGlobalState()[RUNTIME_STREAMING_STATE_KEY]);
}

function setRuntimeStreamingState(isStreaming) {
  getGlobalState()[RUNTIME_STREAMING_STATE_KEY] = Boolean(isStreaming);
}

export {
  isRuntimeStreaming,
  setRuntimeStreamingState,
};
