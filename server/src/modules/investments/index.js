'use strict';

const { createInvestmentsRouter } = require('../../routes/investments');

function createInvestmentsModule(options = {}) {
  return Object.freeze({
    id: 'investments',
    apiBasePath: '/api/investments',
    router: createInvestmentsRouter(options),
  });
}

module.exports = { createInvestmentsModule };
