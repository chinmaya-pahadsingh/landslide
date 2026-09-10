const express = require('express');
const router = express.Router();
const { getAreaIntelligence } = require('../controllers/areaIntelligenceController');
const { authenticate } = require('../middleware/authMiddleware');

// Route requires authentication but not a specific role
router.get('/', authenticate, getAreaIntelligence);

module.exports = router;
