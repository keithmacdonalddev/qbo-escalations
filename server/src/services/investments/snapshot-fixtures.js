'use strict';

const FIXED_OBSERVED_AT = '2026-08-15T12:00:00.000Z';

const BASE_BALANCES = [
  { currency: 'CAD', cash: '1250.25', marketValue: '10920.75', totalEquity: '12171.00', buyingPower: '24342.00', maintenanceExcess: '8940.50', isRealTime: true },
  { currency: 'USD', cash: '410.10', marketValue: '5420.20', totalEquity: '5830.30', buyingPower: '11660.60', maintenanceExcess: '4011.40', isRealTime: false },
];

const BASE_POSITIONS = [
  { symbol: 'FIXTURE-A', symbolId: 'fixture-101', openQuantity: '12.5', averageEntryPrice: '101.20', currentPrice: '108.40', currentMarketValue: '1355.00', totalCost: '1265.00', openPnl: '90.00', dayPnl: '12.50', isRealTime: true, isUnderReorg: false },
  { symbol: 'FIXTURE-B', symbolId: 'fixture-202', openQuantity: '8', averageEntryPrice: '50.125', currentPrice: '52.75', currentMarketValue: '422.00', totalCost: '401.00', openPnl: '21.00', dayPnl: null, isRealTime: false, isUnderReorg: false },
  { symbol: 'FIXTURE-C', symbolId: 'fixture-303', openQuantity: '3', averageEntryPrice: null, currentPrice: null, currentMarketValue: null, totalCost: null, openPnl: null, dayPnl: null, isRealTime: null, isUnderReorg: true },
];

const SNAPSHOT_SCENARIOS = Object.freeze({
  'healthy-margin-cad-usd': {
    label: 'Healthy Margin · CAD and USD',
    account: { sourceRef: 'fixture-margin-primary', accountType: 'Margin', label: 'Margin account' },
    observedAt: FIXED_OBSERVED_AT,
    balances: { perCurrencyBalances: BASE_BALANCES },
    positions: { positions: BASE_POSITIONS },
  },
  'short-position-and-negative-cash': {
    label: 'Short position and negative cash',
    account: { sourceRef: 'fixture-margin-primary', accountType: 'Margin', label: 'Margin account' },
    observedAt: FIXED_OBSERVED_AT,
    balances: {
      perCurrencyBalances: [
        { ...BASE_BALANCES[0], cash: '-425.75', totalEquity: '10110.25', maintenanceExcess: '7020.10' },
        BASE_BALANCES[1],
      ],
    },
    positions: {
      positions: [
        { ...BASE_POSITIONS[0], symbol: 'FIXTURE-SHORT', symbolId: 'fixture-404', openQuantity: '-7.25', currentMarketValue: '-785.25', totalCost: '-742.125', openPnl: '-43.125' },
        BASE_POSITIONS[2],
      ],
    },
  },
  'partial-positions-response': {
    label: 'Incomplete positions response',
    account: { sourceRef: 'fixture-margin-primary', accountType: 'Margin', label: 'Margin account' },
    observedAt: FIXED_OBSERVED_AT,
    balances: { perCurrencyBalances: BASE_BALANCES },
    errorSection: 'positions',
    errorCode: 'QUESTRADE_POSITIONS_INCOMPLETE',
  },
  'provider-unavailable': {
    label: 'Provider unavailable',
    account: { sourceRef: 'fixture-margin-primary', accountType: 'Margin', label: 'Margin account' },
    observedAt: FIXED_OBSERVED_AT,
    errorSection: 'balances',
    errorCode: 'QUESTRADE_OFFLINE',
  },
  'token-expired-refresh-failure': {
    label: 'Authorization expired',
    account: { sourceRef: 'fixture-margin-primary', accountType: 'Margin', label: 'Margin account' },
    observedAt: FIXED_OBSERVED_AT,
    errorSection: 'account',
    errorCode: 'QUESTRADE_AUTHORIZATION_REQUIRED',
  },
  'finalization-failure': {
    label: 'Finalization recovery',
    account: { sourceRef: 'fixture-margin-primary', accountType: 'Margin', label: 'Margin account' },
    observedAt: FIXED_OBSERVED_AT,
    balances: { perCurrencyBalances: BASE_BALANCES },
    positions: { positions: BASE_POSITIONS },
    failFinalizationOnce: true,
  },
});

function listSnapshotScenarios() {
  return Object.entries(SNAPSHOT_SCENARIOS).map(([id, scenario]) => ({ id, label: scenario.label }));
}

function createFixtureSnapshotSource(scenarioId = 'healthy-margin-cad-usd') {
  const fixture = SNAPSHOT_SCENARIOS[scenarioId];
  if (!fixture) throw Object.assign(new Error('Choose an available snapshot verification case.'), { code: 'INVALID_SNAPSHOT_SCENARIO', status: 400 });
  const maybeFail = (section) => {
    if (fixture.errorSection !== section) return;
    throw Object.assign(new Error('The simulated section did not complete.'), { code: fixture.errorCode, section });
  };
  return {
    provider: 'questrade',
    sourceMode: 'simulated',
    sourceRef: fixture.account.sourceRef,
    accountType: fixture.account.accountType,
    label: fixture.account.label,
    observedAt: fixture.observedAt,
    failFinalizationOnce: fixture.failFinalizationOnce === true,
    async getAccount() { maybeFail('account'); return fixture.account; },
    async getBalances() { maybeFail('balances'); return fixture.balances; },
    async getPositions() { maybeFail('positions'); return fixture.positions; },
  };
}

module.exports = { SNAPSHOT_SCENARIOS, createFixtureSnapshotSource, listSnapshotScenarios };
