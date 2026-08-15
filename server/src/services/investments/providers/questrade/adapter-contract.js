'use strict';

const REQUIRED_READ_METHODS = Object.freeze([
  'getAccounts',
  'getBalances',
  'getPositions',
  'getOrders',
  'getExecutions',
]);

function assertReadOnlyQuestradeAdapter(adapter) {
  for (const method of REQUIRED_READ_METHODS) {
    if (typeof adapter?.[method] !== 'function') throw new Error(`Questrade adapter is missing ${method}().`);
  }
  for (const forbidden of ['placeOrder', 'replaceOrder', 'cancelOrder']) {
    if (typeof adapter?.[forbidden] === 'function') throw new Error(`Read-only Questrade adapters cannot expose ${forbidden}().`);
  }
  return adapter;
}

module.exports = { REQUIRED_READ_METHODS, assertReadOnlyQuestradeAdapter };
