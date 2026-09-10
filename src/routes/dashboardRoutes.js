const express = require('express');
const router = express.Router();
const { getDashboardIntelligence } = require('../controllers/dashboardIntelligenceController');

// Public route for location-aware Dashboard Intelligence
router.get('/intelligence', getDashboardIntelligence);

module.exports = router;
