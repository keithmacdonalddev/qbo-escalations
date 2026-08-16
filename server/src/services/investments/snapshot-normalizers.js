'use strict';

const { decimalString } = require('./money');

function cleanText(value, max = 80) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text && text.length <= max ? text : '';
}

function currencyCode(value) {
  const code = cleanText(value, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('A balance currency is missing or invalid.');
  return code;
}

function nullableBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function normalizeAccount(source = {}) {
  const accountType = cleanText(source.accountType || source.type, 40);
  if (!accountType) throw new Error('The account type is missing.');
  return {
    accountType,
    label: cleanText(source.label, 80) || `${accountType} account`,
  };
}

function normalizeBalances(payload = {}) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.perCurrencyBalances)
      ? payload.perCurrencyBalances
      : [];
  if (source.length === 0) throw new Error('Questrade returned no per-currency balances.');
  const seen = new Set();
  const balances = source.map((balance, index) => {
    const currency = currencyCode(balance?.currency);
    if (seen.has(currency)) throw new Error(`Questrade returned duplicate ${currency} balances.`);
    seen.add(currency);
    return {
      currency,
      cash: decimalString(balance?.cash, { field: `balances[${index}].cash` }),
      marketValue: decimalString(balance?.marketValue, { field: `balances[${index}].marketValue` }),
      totalEquity: decimalString(balance?.totalEquity, { field: `balances[${index}].totalEquity` }),
      buyingPower: decimalString(balance?.buyingPower, { field: `balances[${index}].buyingPower` }),
      maintenanceExcess: decimalString(balance?.maintenanceExcess, { field: `balances[${index}].maintenanceExcess` }),
      realTime: nullableBoolean(balance?.isRealTime),
    };
  });
  balances.sort((left, right) => left.currency.localeCompare(right.currency));
  return balances;
}

function normalizePositions(payload = {}) {
  const source = Array.isArray(payload) ? payload : payload.positions;
  if (!Array.isArray(source)) throw new Error('Questrade returned an incomplete positions section.');
  return source.map((position, index) => {
    const symbol = cleanText(position?.symbol, 40);
    if (!symbol) throw new Error(`positions[${index}].symbol is required.`);
    return {
      symbol,
      symbolId: position?.symbolId === null || position?.symbolId === undefined
        ? null
        : cleanText(String(position.symbolId), 40) || null,
      quantity: decimalString(position?.openQuantity ?? position?.quantity, { field: `positions[${index}].quantity` }),
      averagePrice: decimalString(position?.averageEntryPrice ?? position?.averagePrice, { field: `positions[${index}].averagePrice` }),
      currentPrice: decimalString(position?.currentPrice, { field: `positions[${index}].currentPrice` }),
      marketValue: decimalString(position?.currentMarketValue ?? position?.marketValue, { field: `positions[${index}].marketValue` }),
      totalCost: decimalString(position?.totalCost, { field: `positions[${index}].totalCost` }),
      openPnl: decimalString(position?.openPnl, { field: `positions[${index}].openPnl` }),
      closedPnl: decimalString(position?.closedPnl, { field: `positions[${index}].closedPnl` }),
      dayPnl: decimalString(position?.dayPnl, { field: `positions[${index}].dayPnl` }),
      realTime: nullableBoolean(position?.isRealTime),
      underReorganization: nullableBoolean(position?.isUnderReorg ?? position?.underReorganization),
    };
  }).sort((left, right) => left.symbol.localeCompare(right.symbol));
}

module.exports = { normalizeAccount, normalizeBalances, normalizePositions };
