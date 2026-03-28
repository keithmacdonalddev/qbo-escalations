'use strict';

const express = require('express');
const chatRouter = express.Router();
const conversationsRouter = require('./conversations');
const imageArchiveRouter = require('./image-archive');
const parseRouter = require('./parse');
const parallelRouter = require('./parallel');
const sendRouter = require('./send');

chatRouter.use(imageArchiveRouter);
chatRouter.use(parseRouter);
chatRouter.use(parallelRouter);
chatRouter.use(sendRouter);

module.exports = { chatRouter, conversationsRouter };
