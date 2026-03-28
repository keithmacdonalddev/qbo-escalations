'use strict';

const gmail = require('../gmail');
const calendar = require('../calendar');

const WORKSPACE_TOOL_HANDLERS = {
  'gmail.search': async (params) => {
    return gmail.listMessages({ q: params.q, maxResults: params.maxResults || 100, accountEmail: params.account || undefined });
  },
  'gmail.send': async (params) => {
    return gmail.sendMessage({
      to: params.to,
      subject: params.subject,
      body: params.body,
      cc: params.cc,
      bcc: params.bcc,
      threadId: params.threadId,
      inReplyTo: params.inReplyTo,
      references: params.references,
      accountEmail: params.account || undefined,
    });
  },
  'gmail.archive': async (params) => {
    const result = await gmail.modifyMessage(params.messageId, {
      removeLabelIds: ['INBOX'],
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      messageId: params.messageId,
      account: params.account || null,
      removeLabelIds: ['INBOX'],
    };
  },
  'gmail.trash': async (params) => {
    const result = await gmail.trashMessage(params.messageId, params.account || undefined);
    return {
      ...result,
      messageId: params.messageId,
      account: params.account || null,
      deleted: true,
    };
  },
  'gmail.star': async (params) => {
    const result = await gmail.modifyMessage(params.messageId, {
      addLabelIds: ['STARRED'],
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      messageId: params.messageId,
      account: params.account || null,
      addLabelIds: ['STARRED'],
    };
  },
  'gmail.unstar': async (params) => {
    const result = await gmail.modifyMessage(params.messageId, {
      removeLabelIds: ['STARRED'],
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      messageId: params.messageId,
      account: params.account || null,
      removeLabelIds: ['STARRED'],
    };
  },
  'gmail.markRead': async (params) => {
    const result = await gmail.modifyMessage(params.messageId, {
      removeLabelIds: ['UNREAD'],
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      messageId: params.messageId,
      account: params.account || null,
      removeLabelIds: ['UNREAD'],
    };
  },
  'gmail.markUnread': async (params) => {
    const result = await gmail.modifyMessage(params.messageId, {
      addLabelIds: ['UNREAD'],
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      messageId: params.messageId,
      account: params.account || null,
      addLabelIds: ['UNREAD'],
    };
  },
  'gmail.label': async (params) => {
    const result = await gmail.modifyMessage(params.messageId, {
      addLabelIds: [params.labelId],
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      messageId: params.messageId,
      account: params.account || null,
      addLabelIds: [params.labelId],
      labelId: params.labelId,
      labelName: params.labelName || null,
      labelsCreated: params._labelsCreated || [],
    };
  },
  'gmail.removeLabel': async (params) => {
    const result = await gmail.modifyMessage(params.messageId, {
      removeLabelIds: [params.labelId],
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      messageId: params.messageId,
      account: params.account || null,
      removeLabelIds: [params.labelId],
      labelId: params.labelId,
      labelName: params.labelName || null,
    };
  },
  'gmail.draft': async (params) => {
    return gmail.createDraft({
      to: params.to,
      subject: params.subject,
      body: params.body,
      cc: params.cc,
      bcc: params.bcc,
      accountEmail: params.account || undefined,
    });
  },
  'gmail.getMessage': async (params) => {
    return gmail.getMessage(params.messageId, params.account || undefined);
  },
  'gmail.listLabels': async (params) => {
    return gmail.listLabels(params.account || undefined);
  },
  'gmail.createLabel': async (params) => {
    return gmail.createLabel(params.name, {
      labelListVisibility: params.labelListVisibility,
      messageListVisibility: params.messageListVisibility,
    }, params.account || undefined);
  },
  'gmail.createFilter': async (params) => {
    return gmail.createFilter({
      criteria: params.criteria || {},
      action: params.action || {},
      accountEmail: params.account || undefined,
    });
  },
  'gmail.listFilters': async (params) => {
    return gmail.listFilters(params.account || undefined);
  },
  'gmail.deleteFilter': async (params) => {
    return gmail.deleteFilter(params.filterId, params.account || undefined);
  },
  'gmail.batchModify': async (params) => {
    const result = await gmail.batchModify(params.messageIds, {
      addLabelIds: params.addLabelIds,
      removeLabelIds: params.removeLabelIds,
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      messageIds: params.messageIds || [],
      account: params.account || null,
      addLabelIds: params.addLabelIds || [],
      removeLabelIds: params.removeLabelIds || [],
      addLabelNames: params.addLabelNames || [],
      removeLabelNames: params.removeLabelNames || [],
      labelsCreated: params._labelsCreated || [],
    };
  },
  'calendar.listEvents': async (params) => {
    return calendar.listEvents({
      calendarId: params.calendarId || 'primary',
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      q: params.q,
      maxResults: params.maxResults || 50,
      account: params.account || undefined,
    });
  },
  'calendar.createEvent': async (params) => {
    return calendar.createEvent(params.calendarId || 'primary', {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: params.start,
      end: params.end,
      allDay: params.allDay,
      timeZone: params.timeZone,
      attendees: params.attendees,
      reminders: params.reminders,
    }, params.account || undefined);
  },
  'calendar.updateEvent': async (params) => {
    const { eventId, calendarId, account, ...updates } = params;
    return calendar.updateEvent(calendarId || 'primary', eventId, updates, account || undefined);
  },
  'calendar.deleteEvent': async (params) => {
    return calendar.deleteEvent(params.calendarId || 'primary', params.eventId, params.account || undefined);
  },
  'calendar.freeTime': async (params) => {
    return calendar.findFreeTime(
      params.calendarIds || ['primary'],
      params.timeMin,
      params.timeMax,
      params.timeZone,
      params.account || undefined,
    );
  },
  'memory.save': async (params) => {
    const workspaceMemory = require('../workspace-memory');
    return workspaceMemory.saveMemory(params);
  },
  'memory.list': async (params) => {
    const workspaceMemory = require('../workspace-memory');
    if (params.type) return workspaceMemory.getByType(params.type);
    return workspaceMemory.getRelevantMemories(params.query || '', params.limit || 10);
  },
  'memory.delete': async (params) => {
    const workspaceMemory = require('../workspace-memory');
    return workspaceMemory.deleteMemory(params.key);
  },
  'autoAction.createRule': async (params) => {
    const WorkspaceAutoRule = require('../../models/WorkspaceAutoRule');
    const autoActions = require('../workspace-auto-actions');
    const { name, tier, conditionType, conditionValue, actionType, actionValue } = params;
    if (!name || !conditionType || !conditionValue || !actionType) {
      return { ok: false, error: 'name, conditionType, conditionValue, and actionType are required' };
    }
    const ruleId = `learned-${conditionType}-${conditionValue.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30)}-${actionType}`;
    const rule = await WorkspaceAutoRule.findOneAndUpdate(
      { ruleId },
      { name, tier: tier || 'notify', conditionType, conditionValue, actionType, actionValue: actionValue || '', createdBy: 'agent', active: true },
      { upsert: true, returnDocument: 'after', lean: true, setDefaultsOnInsert: true },
    );
    autoActions.invalidateCache();
    return { ok: true, rule };
  },
  'autoAction.approve': async (params) => {
    const autoActions = require('../workspace-auto-actions');
    const result = await autoActions.recordApproval(params.ruleId);
    if (!result) return { ok: false, error: 'Rule not found' };
    return { ok: true, promoted: result.promoted, newTier: result.promoted ? result.newTier : result.rule.tier };
  },
  'shipment.list': async (params) => {
    const shipmentTracker = require('../shipment-tracker');
    const options = {};
    if (params.active !== undefined) options.active = params.active;
    if (params.carrier) options.carrier = params.carrier;
    if (params.status) options.status = params.status;
    const shipments = await shipmentTracker.getAllShipments('default', options);
    return { ok: true, shipments, count: shipments.length };
  },
  'shipment.get': async (params) => {
    const shipmentTracker = require('../shipment-tracker');
    const shipment = await shipmentTracker.getShipment(params.trackingNumber);
    if (!shipment) return { ok: false, error: 'Shipment not found' };
    const trackingUrl = shipmentTracker.getTrackingUrl(shipment.carrier, shipment.trackingNumber);
    return { ok: true, shipment, trackingUrl };
  },
  'shipment.updateStatus': async (params) => {
    const shipmentTracker = require('../shipment-tracker');
    const updated = await shipmentTracker.updateShipmentStatus(params.trackingNumber, {
      status: params.status,
      location: params.location,
      description: params.description,
    });
    if (!updated) return { ok: false, error: 'Shipment not found' };
    return { ok: true, shipment: updated };
  },
  'shipment.markDelivered': async (params) => {
    const shipmentTracker = require('../shipment-tracker');
    const updated = await shipmentTracker.markDelivered(params.trackingNumber);
    if (!updated) return { ok: false, error: 'Shipment not found' };
    return { ok: true, shipment: updated };
  },
  'shipment.track': async (params) => {
    const shipmentTracker = require('../shipment-tracker');
    const shipment = await shipmentTracker.getShipment(params.trackingNumber);
    if (!shipment) {
      const { carrier, name } = shipmentTracker.detectCarrier(params.trackingNumber);
      const trackingUrl = shipmentTracker.getTrackingUrl(carrier, params.trackingNumber);
      return { ok: true, trackingNumber: params.trackingNumber, carrier, carrierName: name, trackingUrl, shipment: null };
    }
    const trackingUrl = shipmentTracker.getTrackingUrl(shipment.carrier, shipment.trackingNumber);
    return { ok: true, ...shipment, trackingUrl };
  },
};

module.exports = { WORKSPACE_TOOL_HANDLERS };
