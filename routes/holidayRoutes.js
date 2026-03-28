/**
 * Holiday Routes
 * RESTful API endpoints for holiday management
 */

const express = require('express');
const router = express.Router();
const {
  getHolidays,
  getHolidayById,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  getCantons,
  getUpcomingHolidays
} = require('../controllers/holidayController');

// Static routes (must come before /:id to avoid conflicts)
router.get('/cantons', getCantons);
router.get('/upcoming', getUpcomingHolidays);

// CRUD routes
router.get('/', getHolidays);
router.get('/:id', getHolidayById);
router.post('/', createHoliday);
router.put('/:id', updateHoliday);
router.delete('/:id', deleteHoliday);

module.exports = router;
