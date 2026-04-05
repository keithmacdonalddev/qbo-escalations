'use strict';

const { Router } = require('express');
const crudRouter = require('./crud');
const sendRouter = require('./send');

const roomRouter = Router();
// CRUD router first (contains /agents static route before /:id param routes)
roomRouter.use(crudRouter);
// Send router for POST /:id/send
roomRouter.use(sendRouter);

module.exports = roomRouter;
