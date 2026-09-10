const express = require('express');
const router = express.Router();
const { createRainfallObservation, getAllRainfallObservations } = require('../controllers/rainfallObservationController');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

router.post('/', authenticate, requireRole('admin', 'authority', 'field_team'), createRainfallObservation);
router.get('/', getAllRainfallObservations);

module.exports = router;
