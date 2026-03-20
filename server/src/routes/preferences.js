'use strict';

const express = require('express');
const router = express.Router();
const UserPreferences = require('../models/UserPreferences');

// GET /api/preferences — return current defaults
router.get('/', async (req, res) => {
  const prefs = await UserPreferences.get();
  res.json({
    ok: true,
    defaultGmailAccount: prefs.defaultGmailAccount || '',
    defaultCalendarAccount: prefs.defaultCalendarAccount || '',
  });
});

// PUT /api/preferences — update defaults (partial updates supported)
router.put('/', async (req, res) => {
  const { defaultGmailAccount, defaultCalendarAccount } = req.body;
  const prefs = await UserPreferences.upsert({ defaultGmailAccount, defaultCalendarAccount });
  res.json({
    ok: true,
    defaultGmailAccount: prefs.defaultGmailAccount || '',
    defaultCalendarAccount: prefs.defaultCalendarAccount || '',
  });
});

module.exports = router;
