'use strict';

const workspaceMonitor = require('../workspace-monitor');

async function subscribe({ sendEvent }) {
  return workspaceMonitor.subscribe((eventName, data) => {
    sendEvent(eventName, data);
  });
}

module.exports = {
  subscribe,
};
