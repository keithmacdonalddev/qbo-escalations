'use strict';

const imageIntakeAndParse = require('../slices/image-intake-and-parse/harness/run');
const escalationDomain = require('../slices/escalation-domain/harness/run');
const shipmentDomain = require('../slices/shipment-domain/harness/run');
const mainChat = require('../slices/main-chat/harness/run');
const workspaceAssistant = require('../slices/workspace-assistant/harness/run');
const roomOrchestration = require('../slices/room-orchestration/harness/run');
const connectedServices = require('../slices/connected-services/harness/run');
const runtimeAndObservability = require('../slices/runtime-and-observability/harness/run');
const clientSurfaces = require('../slices/client-surfaces/harness/run');

const RUNNERS = Object.freeze({
  [escalationDomain.SLICE_ID]: escalationDomain,
  [shipmentDomain.SLICE_ID]: shipmentDomain,
  [imageIntakeAndParse.SLICE_ID]: imageIntakeAndParse,
  [mainChat.SLICE_ID]: mainChat,
  [workspaceAssistant.SLICE_ID]: workspaceAssistant,
  [roomOrchestration.SLICE_ID]: roomOrchestration,
  [connectedServices.SLICE_ID]: connectedServices,
  [runtimeAndObservability.SLICE_ID]: runtimeAndObservability,
  [clientSurfaces.SLICE_ID]: clientSurfaces,
});

function listRunnerIds() {
  return Object.keys(RUNNERS);
}

function getRunner(sliceId) {
  return RUNNERS[sliceId] || null;
}

module.exports = {
  RUNNERS,
  getRunner,
  listRunnerIds,
};
