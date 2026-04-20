export default function ChatSurfaceShell({
  threadContent,
  composeArea,
  children,
}) {
  const thread = threadContent || null;
  const compose = composeArea || null;
  const legacyChildren = (!threadContent && !composeArea) ? children : null;

  return (
    <div className="chat-input-area">
      <h2 className="sr-only">Chat</h2>
      {legacyChildren || (
        <>
          {thread}
          {compose}
        </>
      )}
    </div>
  );
}
