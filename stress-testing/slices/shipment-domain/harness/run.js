'use strict';

const assert = require('node:assert/strict');

const Shipment = require('../../../../server/src/models/Shipment');
const shipmentTracker = require('../../../../server/src/services/shipment-tracker');
const {
  WORKSPACE_TOOL_HANDLERS,
} = require('../../../../server/src/services/workspace-tools/handler-registry');
const {
  buildSliceReport,
  createSeed,
  requestJson,
  resetHarnessStubs,
  writeReport,
} = require('../../../scripts/harness-runner-utils');
const { runWithHarness } = require('../../../scripts/fixtures/common');

const SLICE_ID = 'shipment-domain';

function cleanAlphaNumeric(value) {
  return String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
}

function digitsFromSeed(seed, length) {
  const digits = Array.from(String(seed || ''))
    .map((char) => String(char.charCodeAt(0) % 10))
    .join('');
  return digits.slice(-length).padStart(length, '0');
}

function makeUpsTracking(seed, suffix) {
  const body = cleanAlphaNumeric(`${seed}${suffix}`).slice(-16).padStart(16, '0');
  return `1Z${body}`;
}

function makeCanadaPostTracking(seed, suffix) {
  return `4005${digitsFromSeed(`${seed}${suffix}`, 12)}`;
}

function makeFedExTracking(seed, suffix) {
  const digits = digitsFromSeed(`${seed}${suffix}`, 12);
  return `6${digits.slice(1)}`;
}

function buildShipmentPayload(seed, trackingNumber, overrides = {}) {
  return {
    trackingNumber,
    orderNumber: `ORDER-${cleanAlphaNumeric(seed).slice(-12)}`,
    retailer: 'Harness Outfitters',
    items: [
      {
        name: `Harness package ${overrides.itemSuffix || 'standard'}`,
        quantity: 1,
        price: '19.99',
      },
    ],
    status: 'in-transit',
    estimatedDelivery: {
      earliest: '2026-05-05T00:00:00.000Z',
      latest: '2026-05-07T00:00:00.000Z',
    },
    shipTo: {
      name: 'Harness Recipient',
      city: 'Halifax',
      province: 'NS',
      postalCode: 'B3H 0A1',
    },
    ...overrides,
  };
}

async function cleanupCreated(trackingNumbers) {
  const uniqueTrackingNumbers = [...new Set(trackingNumbers.filter(Boolean))];
  if (uniqueTrackingNumbers.length === 0) {
    return {
      deleted: 0,
      remaining: 0,
    };
  }

  const result = await Shipment.deleteMany({
    userId: 'default',
    trackingNumber: { $in: uniqueTrackingNumbers },
  });
  const remaining = await Shipment.countDocuments({
    userId: 'default',
    trackingNumber: { $in: uniqueTrackingNumbers },
  });

  return {
    deleted: result.deletedCount || 0,
    remaining,
  };
}

function trackingNumbersFrom(shipments) {
  return (shipments || []).map((shipment) => shipment.trackingNumber);
}

async function runSlice(context = {}) {
  return runWithHarness(context, async (harness) => {
    const startedAt = new Date();
    const seed = createSeed(SLICE_ID);
    const upsTracking = makeUpsTracking(seed, 'api-ups');
    const canadaPostTracking = makeCanadaPostTracking(seed, 'api-canada-post');
    const parsedTracking = makeCanadaPostTracking(seed, 'parsed-email');
    const unknownFedExTracking = makeFedExTracking(seed, 'tool-track');
    const createdTrackingNumbers = [
      upsTracking,
      canadaPostTracking,
      parsedTracking,
      unknownFedExTracking,
    ];
    let cleanupComplete = false;

    try {
      resetHarnessStubs();
      await cleanupCreated(createdTrackingNumbers);

      const upsPayload = buildShipmentPayload(seed, upsTracking, {
        itemSuffix: 'ups',
      });
      const canadaPostPayload = buildShipmentPayload(seed, canadaPostTracking, {
        itemSuffix: 'canada-post',
      });

      const upsCreateRes = await requestJson(harness.baseUrl, '/api/workspace/shipments', {
        method: 'POST',
        json: upsPayload,
      });
      assert.equal(upsCreateRes.data.shipment.trackingNumber, upsTracking);
      assert.equal(upsCreateRes.data.shipment.carrier, 'ups');
      assert.match(upsCreateRes.data.trackingUrl, /ups\.com/i);

      const duplicateCreateRes = await requestJson(harness.baseUrl, '/api/workspace/shipments', {
        method: 'POST',
        json: {
          ...upsPayload,
          status: 'label-created',
          retailer: 'Harness Outfitters Updated',
        },
      });
      assert.equal(duplicateCreateRes.data.shipment.status, 'label-created');
      assert.equal(duplicateCreateRes.data.shipment.retailer, 'Harness Outfitters Updated');
      const duplicateCount = await Shipment.countDocuments({
        userId: 'default',
        trackingNumber: upsTracking,
      });
      assert.equal(duplicateCount, 1, 'expected duplicate create to upsert one shipment');

      const canadaPostCreateRes = await requestJson(harness.baseUrl, '/api/workspace/shipments', {
        method: 'POST',
        json: canadaPostPayload,
      });
      assert.equal(canadaPostCreateRes.data.shipment.carrier, 'canada-post');
      assert.match(canadaPostCreateRes.data.trackingUrl, /canadapost/i);

      const getUpsRes = await requestJson(harness.baseUrl, `/api/workspace/shipments/${upsTracking}`);
      assert.equal(getUpsRes.data.shipment.orderNumber, upsPayload.orderNumber);

      const allListRes = await requestJson(harness.baseUrl, '/api/workspace/shipments', {
        query: { limit: 25 },
      });
      const carrierListRes = await requestJson(harness.baseUrl, '/api/workspace/shipments', {
        query: { carrier: 'ups', limit: 25 },
      });
      const statusListRes = await requestJson(harness.baseUrl, '/api/workspace/shipments', {
        query: { status: 'label-created', limit: 25 },
      });

      const allTrackingNumbers = trackingNumbersFrom(allListRes.data.shipments);
      const carrierTrackingNumbers = trackingNumbersFrom(carrierListRes.data.shipments);
      const statusTrackingNumbers = trackingNumbersFrom(statusListRes.data.shipments);
      assert.ok(allTrackingNumbers.includes(upsTracking));
      assert.ok(allTrackingNumbers.includes(canadaPostTracking));
      assert.ok(carrierTrackingNumbers.includes(upsTracking));
      assert.ok(statusTrackingNumbers.includes(upsTracking));

      const outForDeliveryRes = await requestJson(
        harness.baseUrl,
        `/api/workspace/shipments/${upsTracking}`,
        {
          method: 'PATCH',
          json: {
            status: 'out-for-delivery',
            location: 'Halifax, NS',
            description: 'Harness package is on vehicle for delivery.',
          },
        },
      );
      assert.equal(outForDeliveryRes.data.shipment.status, 'out-for-delivery');
      assert.equal(outForDeliveryRes.data.shipment.statusHistory.at(-1).location, 'Halifax, NS');

      const deliveredRes = await requestJson(
        harness.baseUrl,
        `/api/workspace/shipments/${canadaPostTracking}`,
        {
          method: 'PATCH',
          json: {
            status: 'delivered',
            location: 'Mailbox',
            description: 'Harness package delivered.',
          },
        },
      );
      assert.equal(deliveredRes.data.shipment.status, 'delivered');
      assert.equal(deliveredRes.data.shipment.active, false);
      assert.ok(deliveredRes.data.shipment.actualDelivery, 'expected delivered shipment to set actualDelivery');

      const activeListRes = await requestJson(harness.baseUrl, '/api/workspace/shipments', {
        query: { active: 'true', limit: 50 },
      });
      const inactiveListRes = await requestJson(harness.baseUrl, '/api/workspace/shipments', {
        query: { active: 'false', limit: 50 },
      });
      const activeTrackingNumbers = trackingNumbersFrom(activeListRes.data.shipments);
      const inactiveTrackingNumbers = trackingNumbersFrom(inactiveListRes.data.shipments);
      assert.ok(activeTrackingNumbers.includes(upsTracking));
      assert.ok(!activeTrackingNumbers.includes(canadaPostTracking));
      assert.ok(inactiveTrackingNumbers.includes(canadaPostTracking));

      const parsedEmail = {
        id: `email-${seed}`,
        subject: `Your order ${seed} has shipped`,
        from: 'shipping@amazon.ca',
        snippet: `Tracking number: ${parsedTracking}`,
        body: [
          `Tracking number: ${parsedTracking}`,
          `Order #${cleanAlphaNumeric(seed).slice(-10)}`,
          'Product: Harness USB-C dock',
          'Estimated delivery: May 5 - May 7, 2026',
        ].join('\n'),
      };
      const parsed = shipmentTracker.parseShippingEmail(parsedEmail.body, {
        subject: parsedEmail.subject,
        from: parsedEmail.from,
      });
      assert.ok(parsed, 'expected parser to recognize shipping email');
      assert.equal(parsed.trackingNumber, parsedTracking);
      assert.equal(parsed.carrier, 'canada-post');
      assert.equal(parsed.retailer, 'Amazon');

      const scanRes = await shipmentTracker.scanInboxForShipments([parsedEmail], 'default');
      assert.equal(scanRes.scanned, 1);
      assert.equal(scanRes.created, 1);
      assert.equal(scanRes.shipments[0].trackingNumber, parsedTracking);

      const duplicateScanRes = await shipmentTracker.scanInboxForShipments([parsedEmail], 'default');
      assert.equal(duplicateScanRes.created, 0, 'expected sourceEmailId duplicate prevention');

      const activeShipments = await shipmentTracker.getActiveShipments('default');
      const contextText = shipmentTracker.buildShipmentContext(activeShipments);
      assert.ok(contextText.includes(upsTracking));
      assert.ok(contextText.includes(parsedTracking));
      assert.ok(!contextText.includes(canadaPostTracking));

      const toolListRes = await WORKSPACE_TOOL_HANDLERS['shipment.list']({
        active: true,
        carrier: 'ups',
      });
      assert.equal(toolListRes.ok, true);
      assert.ok(trackingNumbersFrom(toolListRes.shipments).includes(upsTracking));

      const toolGetRes = await WORKSPACE_TOOL_HANDLERS['shipment.get']({
        trackingNumber: upsTracking,
      });
      assert.equal(toolGetRes.ok, true);
      assert.equal(toolGetRes.shipment.trackingNumber, upsTracking);
      assert.match(toolGetRes.trackingUrl, /ups\.com/i);

      const toolUpdateRes = await WORKSPACE_TOOL_HANDLERS['shipment.updateStatus']({
        trackingNumber: upsTracking,
        status: 'exception',
        location: 'Depot',
        description: 'Harness exception probe.',
      });
      assert.equal(toolUpdateRes.ok, true);
      assert.equal(toolUpdateRes.shipment.status, 'exception');

      const toolMarkDeliveredRes = await WORKSPACE_TOOL_HANDLERS['shipment.markDelivered']({
        trackingNumber: upsTracking,
      });
      assert.equal(toolMarkDeliveredRes.ok, true);
      assert.equal(toolMarkDeliveredRes.shipment.active, false);

      const toolTrackUnknownRes = await WORKSPACE_TOOL_HANDLERS['shipment.track']({
        trackingNumber: unknownFedExTracking,
      });
      assert.equal(toolTrackUnknownRes.ok, true);
      assert.equal(toolTrackUnknownRes.carrier, 'fedex');
      assert.equal(toolTrackUnknownRes.shipment, null);
      assert.match(toolTrackUnknownRes.trackingUrl, /fedex/i);

      const deleteCanadaPostRes = await requestJson(
        harness.baseUrl,
        `/api/workspace/shipments/${canadaPostTracking}`,
        { method: 'DELETE' },
      );
      assert.equal(deleteCanadaPostRes.data.ok, true);

      const deletedGetRes = await requestJson(
        harness.baseUrl,
        `/api/workspace/shipments/${canadaPostTracking}`,
        { expectStatus: 404 },
      );
      assert.equal(deletedGetRes.data.code, 'NOT_FOUND');

      const missingTrackingRes = await requestJson(harness.baseUrl, '/api/workspace/shipments', {
        method: 'POST',
        expectStatus: 400,
        json: {
          retailer: 'Harness Missing Tracking',
        },
      });
      assert.equal(missingTrackingRes.data.code, 'MISSING_FIELD');

      const missingStatusRes = await requestJson(
        harness.baseUrl,
        `/api/workspace/shipments/${unknownFedExTracking}`,
        {
          method: 'PATCH',
          expectStatus: 400,
          json: {},
        },
      );
      assert.equal(missingStatusRes.data.code, 'MISSING_FIELD');

      const notFoundPatchRes = await requestJson(
        harness.baseUrl,
        `/api/workspace/shipments/${unknownFedExTracking}`,
        {
          method: 'PATCH',
          expectStatus: 404,
          json: {
            status: 'in-transit',
          },
        },
      );
      assert.equal(notFoundPatchRes.data.code, 'NOT_FOUND');

      const cleanup = await cleanupCreated(createdTrackingNumbers);
      cleanupComplete = true;
      assert.equal(cleanup.remaining, 0);

      const finishedAt = new Date();
      const report = buildSliceReport(SLICE_ID, {
        description: 'Exercises shipment tracking routes, email parsing, active-shipment context, and workspace shipment tool handlers with deterministic Mongo cleanup.',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        seed,
        baseUrl: harness.baseUrl,
        startupControls: harness.startupControls || null,
        fixtures: [
          {
            id: 'shipment-api-create-list-filter-upsert',
            kind: 'workflow',
            description: 'Create UPS and Canada Post shipments through /api/workspace/shipments, verify upsert behavior, get-by-tracking, and list filters.',
            ok: true,
            assertions: {
              upsCarrier: upsCreateRes.data.shipment.carrier,
              canadaPostCarrier: canadaPostCreateRes.data.shipment.carrier,
              duplicateCount,
              upsertedStatus: duplicateCreateRes.data.shipment.status,
              allListIncludesCreated: allTrackingNumbers.includes(upsTracking) && allTrackingNumbers.includes(canadaPostTracking),
              carrierFilterIncludesUps: carrierTrackingNumbers.includes(upsTracking),
              statusFilterIncludesUpsertedStatus: statusTrackingNumbers.includes(upsTracking),
            },
          },
          {
            id: 'shipment-status-delivery-active-filters-delete',
            kind: 'workflow',
            description: 'Patch shipment statuses, verify delivered shipments become inactive with actualDelivery, filter active/inactive lists, and delete by tracking number.',
            ok: true,
            assertions: {
              outForDeliveryStatus: outForDeliveryRes.data.shipment.status,
              deliveredStatus: deliveredRes.data.shipment.status,
              deliveredActive: deliveredRes.data.shipment.active,
              deliveredActualDeliverySet: Boolean(deliveredRes.data.shipment.actualDelivery),
              activeListIncludesUps: activeTrackingNumbers.includes(upsTracking),
              activeListExcludesDelivered: !activeTrackingNumbers.includes(canadaPostTracking),
              inactiveListIncludesDelivered: inactiveTrackingNumbers.includes(canadaPostTracking),
              deleteOk: deleteCanadaPostRes.data.ok,
              deletedGetCode: deletedGetRes.data.code,
            },
          },
          {
            id: 'shipment-email-parse-scan-context',
            kind: 'workflow',
            description: 'Parse a shipping email, scan it into a Shipment record, prevent duplicate sourceEmailId imports, and inject active shipments into workspace context.',
            ok: true,
            assertions: {
              parsedCarrier: parsed.carrier,
              parsedRetailer: parsed.retailer,
              scanCreated: scanRes.created,
              duplicateScanCreated: duplicateScanRes.created,
              contextIncludesUps: contextText.includes(upsTracking),
              contextIncludesParsed: contextText.includes(parsedTracking),
              contextExcludesDelivered: !contextText.includes(canadaPostTracking),
            },
          },
          {
            id: 'shipment-workspace-tool-handlers',
            kind: 'workflow',
            description: 'Exercise shipment.list/get/updateStatus/markDelivered/track handlers used by the workspace agent tool loop.',
            ok: true,
            assertions: {
              listIncludesUps: trackingNumbersFrom(toolListRes.shipments).includes(upsTracking),
              getCarrier: toolGetRes.shipment.carrier,
              updateStatus: toolUpdateRes.shipment.status,
              markDeliveredActive: toolMarkDeliveredRes.shipment.active,
              trackUnknownCarrier: toolTrackUnknownRes.carrier,
              trackUnknownHasShipment: Boolean(toolTrackUnknownRes.shipment),
            },
          },
          {
            id: 'shipment-validation-and-not-found',
            kind: 'validation',
            description: 'Verify missing tracking number, missing status, and not-found route failures keep stable error codes.',
            ok: true,
            assertions: {
              missingTrackingCode: missingTrackingRes.data.code,
              missingStatusCode: missingStatusRes.data.code,
              notFoundPatchCode: notFoundPatchRes.data.code,
            },
          },
          {
            id: 'seeded-shipment-data-cleanup',
            kind: 'cleanup',
            description: 'Remove all runner-created shipment records from the stress database.',
            ok: true,
            assertions: {
              deletedShipments: cleanup.deleted,
              remainingShipments: cleanup.remaining,
            },
          },
        ],
        notes: [
          `UPS tracking ${upsTracking} covered route and workspace tool mutations.`,
          `Canada Post tracking ${parsedTracking} covered email parser, inbox scan, and context injection.`,
          'Runner-created shipment data was cleaned up before writing the report.',
        ],
      });

      const paths = writeReport(SLICE_ID, report);
      report.paths = paths;
      return report;
    } finally {
      if (!cleanupComplete) {
        await cleanupCreated(createdTrackingNumbers).catch((err) => {
          console.warn(`[${SLICE_ID}] cleanup failed:`, err.message);
        });
      }
    }
  });
}

if (require.main === module) {
  runSlice().then((report) => {
    console.log(JSON.stringify({
      slice: report.slice,
      ok: report.ok,
      reportPath: report.paths.reportPath,
    }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }).catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
}

module.exports = {
  SLICE_ID,
  cleanupCreated,
  runSlice,
};
