function getDefaultDockTabForRoute(view) {
  if (view === 'workspace') return 'workspace';
  return 'chat';
}

function normalizeWorkspaceView(rawView) {
  switch (String(rawView || '').toLowerCase()) {
    case '':
    case 'overview':
      return 'overview';
    case 'inbox':
    case 'gmail':
      return 'inbox';
    case 'calendar':
      return 'calendar';
    case 'tasks':
      return 'tasks';
    case 'projects':
      return 'projects';
    default:
      return 'overview';
  }
}

function parseHashRoute(hash = window.location.hash || '#/chat') {
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryIndex = normalized.indexOf('?');
  const path = queryIndex >= 0 ? normalized.slice(0, queryIndex) : normalized;
  const query = new URLSearchParams(queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '');

  if (path.startsWith('/chat/')) {
    return { view: 'chat', conversationId: path.slice(6) };
  }
  if (path === '/chat' || path === '/' || path === '') {
    return { view: 'chat', conversationId: null };
  }
  if (path.startsWith('/escalations/')) {
    return { view: 'escalation-detail', escalationId: path.slice(13) };
  }
  if (path === '/dashboard' || path === '/escalations') return { view: 'dashboard' };
  if (path === '/playbook') return { view: 'playbook' };
  if (path === '/agents') return { view: 'agents', agentId: null };
  if (path.startsWith('/agents/')) return { view: 'agents', agentId: path.slice('/agents/'.length) };
  if (path === '/templates') return { view: 'templates' };
  if (path === '/analytics') return { view: 'analytics' };
  if (path === '/gallery') return { view: 'gallery' };
  if (path === '/usage') {
    return {
      view: 'usage',
      usageTab: query.get('tab') === 'traces' ? 'traces' : 'usage',
      traceConversationId: query.get('conversationId') || '',
      traceId: query.get('traceId') || '',
    };
  }
  if (path === '/workspace') {
    return { view: 'workspace', workspaceView: 'overview' };
  }
  if (path.startsWith('/workspace/')) {
    return {
      view: 'workspace',
      workspaceView: normalizeWorkspaceView(path.slice('/workspace/'.length)),
    };
  }
  if (path === '/gmail') return { view: 'workspace', workspaceView: 'inbox' };
  if (path === '/calendar') return { view: 'workspace', workspaceView: 'calendar' };
  if (path === '/investigations') return { view: 'investigations' };
  if (path === '/settings') return { view: 'settings' };
  if (path === '/rooms') return { view: 'rooms', roomId: null };
  if (path.startsWith('/rooms/')) return { view: 'rooms', roomId: path.slice(7) };
  return { view: 'chat', conversationId: null };
}

function getSidebarCurrentRoute(route) {
  if (!route || typeof route !== 'object') {
    return '#/chat';
  }

  if (route.view === 'chat' && route.conversationId) {
    return `#/chat/${route.conversationId}`;
  }

  if (route.view === 'workspace') {
    return route.workspaceView && route.workspaceView !== 'overview'
      ? `#/workspace/${route.workspaceView}`
      : '#/workspace';
  }

  if (route.view === 'rooms') {
    return route.roomId ? `#/rooms/${route.roomId}` : '#/rooms';
  }

  if (route.view === 'agents') {
    return route.agentId ? `#/agents/${route.agentId}` : '#/agents';
  }

  return `#/${route.view || 'chat'}`;
}

export {
  getDefaultDockTabForRoute,
  getSidebarCurrentRoute,
  normalizeWorkspaceView,
  parseHashRoute,
};
