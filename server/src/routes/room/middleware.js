'use strict';

const mongoose = require('mongoose');

/**
 * Express middleware — validates that `req.params.id` is a valid Mongoose ObjectId.
 * Returns 400 with `{ ok: false, code: 'INVALID_ID', error }` on failure.
 */
function requireValidId(req, res, next) {
  if (typeof req.params.id !== 'string' || !mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_ID',
      error: 'Room ID must be a valid ObjectId',
    });
  }
  return next();
}

module.exports = { requireValidId };
