const express = require('express');
const router = express.Router();
const soilMoistureObservationController = require('../controllers/soilMoistureObservationController');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

const rateLimit = require('express-rate-limit');

// Rate limiting for sync
const syncLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per windowMs
  message: { error: 'Too many sync requests, please try again later.' }
});

router.post('/', authenticate, requireRole('admin', 'authority', 'field_team'), soilMoistureObservationController.createSoilMoistureObservation);
router.get('/', soilMoistureObservationController.getAllSoilMoistureObservations);
router.post('/sync', authenticate, syncLimiter, soilMoistureObservationController.syncSoilMoisture);

module.exports = router;
