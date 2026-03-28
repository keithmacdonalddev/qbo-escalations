const CHAT_MESSAGES_SNAPSHOT_KEY = '__qboChatMessages';

function getGlobalState() {
  return globalThis;
}

function readChatMessagesSnapshot() {
  const snapshot = getGlobalState()[CHAT_MESSAGES_SNAPSHOT_KEY];
  return Array.isArray(snapshot) ? snapshot : [];
}

function writeChatMessagesSnapshot(messages) {
  getGlobalState()[CHAT_MESSAGES_SNAPSHOT_KEY] = Array.isArray(messages) ? messages : [];
}

export {
  readChatMessagesSnapshot,
  writeChatMessagesSnapshot,
};
