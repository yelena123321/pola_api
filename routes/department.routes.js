/**
 * Department Routes
 * CRUD operations for departments
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { authenticateToken } = deps;
  const controller = require('../controllers/department.controller')(deps);

  router.get('/departments', authenticateToken, controller.getAll);
  router.get('/departments/:id', authenticateToken, controller.getById);
  router.post('/departments', authenticateToken, controller.create);
  router.put('/departments/:id', authenticateToken, controller.update);
  router.delete('/departments/:id', authenticateToken, controller.remove);

  return router;
};
