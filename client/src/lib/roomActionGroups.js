export function normalizeRoomActionResult(result) {
  if (!result || typeof result !== 'object') {
    return {
      tool: 'unknown',
      status: 'unknown',
      value: result,
    };
  }

  return {
    ...result,
    status: result.status || (result.error ? 'error' : (result.result !== undefined ? 'success' : 'unknown')),
  };
}

export function normalizeRoomActionGroups(actions, fallbackIteration = 1) {
  if (!Array.isArray(actions) || actions.length === 0) return [];

  const hasGroupedShape = actions.every((entry) => entry && typeof entry === 'object' && Array.isArray(entry.results));
  if (hasGroupedShape) {
    return actions.map((group, index) => ({
      iteration: Number.isFinite(group.iteration) && group.iteration > 0 ? group.iteration : index + 1,
      results: Array.isArray(group.results) ? group.results.map(normalizeRoomActionResult) : [],
    }));
  }

  return [{
    iteration: Number.isFinite(fallbackIteration) && fallbackIteration > 0 ? fallbackIteration : 1,
    results: actions.map(normalizeRoomActionResult),
  }];
}

export function normalizeRoomMessage(message) {
  if (!message || typeof message !== 'object') return message;
  const actionGroups = normalizeRoomActionGroups(message.actions, message.iterations);
  return {
    ...message,
    actions: actionGroups.length > 0 ? actionGroups : undefined,
  };
}
