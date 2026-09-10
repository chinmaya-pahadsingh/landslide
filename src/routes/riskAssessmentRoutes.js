const express = require('express');
const router = express.Router();
const { calculateRisk } = require('../controllers/riskAssessmentController');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

router.post('/', authenticate, requireRole('admin', 'authority', 'field_team'), calculateRisk);

module.exports = router;
