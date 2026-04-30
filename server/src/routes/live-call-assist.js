'use strict';

const express = require('express');
const { getLiveCallAssistStatus } = require('../services/live-call-assist-server');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json(getLiveCallAssistStatus());
});

module.exports = router;
