const express = require('express');
const router = express.Router();
const { getAllLandslideEvents, createLandslideEvent, getLandslideEventById } = require('../controllers/landslideEventController');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

router.get('/', getAllLandslideEvents);
router.get('/:id', getLandslideEventById);
router.post('/', authenticate, requireRole('admin', 'authority', 'field_team'), createLandslideEvent);

module.exports = router;
