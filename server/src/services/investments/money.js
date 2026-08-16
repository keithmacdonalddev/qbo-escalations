'use strict';

const Big = require('big.js');

function decimalString(value, { required = false, field = 'value' } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${field} must be a decimal value.`);
  }
  const text = String(value).trim();
  if (!text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    throw new Error(`${field} must be a finite decimal value.`);
  }
  try {
    return new Big(text).toFixed();
  } catch {
    throw new Error(`${field} must be a finite decimal value.`);
  }
}

function addDecimalStrings(values) {
  return values.reduce((total, value) => (
    value === null || value === undefined ? total : total.plus(value)
  ), new Big(0)).toFixed();
}

module.exports = { addDecimalStrings, decimalString };
