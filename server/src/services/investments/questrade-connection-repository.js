'use strict';

const QuestradeConnection = require('../../models/QuestradeConnection');

const SECRET_SELECTION = [
  '+accessToken',
  '+refreshToken',
  '+tokenExpiresAt',
  '+apiServer',
  '+accounts.accountNumber',
].join(' ');

function createQuestradeConnectionRepository(options = {}) {
  const model = options.model || QuestradeConnection;

  async function find({ includeSecrets = false } = {}) {
    let query = model.findOne({ provider: 'questrade' });
    if (includeSecrets) query = query.select(SECRET_SELECTION);
    return query.lean().exec();
  }

  async function update(changes, options = {}) {
    const updateDocument = { $set: changes, $setOnInsert: { provider: 'questrade' } };
    const unsetFields = Array.isArray(options.unset) ? options.unset.filter(Boolean) : [];
    if (unsetFields.length > 0) {
      updateDocument.$unset = Object.fromEntries(unsetFields.map((field) => [field, 1]));
    }
    return model.findOneAndUpdate(
      { provider: 'questrade' },
      updateDocument,
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean().exec();
  }

  async function appendAudit(event) {
    await model.updateOne(
      { provider: 'questrade' },
      {
        $setOnInsert: { provider: 'questrade' },
        $push: { auditEvents: { $each: [event], $slice: -50 } },
      },
      { upsert: true, setDefaultsOnInsert: true },
    ).exec();
  }

  async function remove() {
    await model.deleteOne({ provider: 'questrade' }).exec();
  }

  return { appendAudit, find, remove, update };
}

module.exports = { SECRET_SELECTION, createQuestradeConnectionRepository };
