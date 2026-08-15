'use strict';

const { assertReadOnlyQuestradeAdapter } = require('./adapter-contract');

function createFixtureAdapter() {
  return assertReadOnlyQuestradeAdapter({
    async getAccounts() { return [{ safeAccountId: 'margin-demo-01', type: 'Margin' }]; },
    async getBalances() { return []; },
    async getPositions() { return []; },
    async getOrders() { return []; },
    async getExecutions() { return []; },
  });
}

module.exports = { createFixtureAdapter };
