const express = require('express');
const router = express.Router();
const { evaluateWarning } = require('../controllers/earlyWarningController');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

router.post('/evaluate', authenticate, requireRole('admin', 'authority'), evaluateWarning);

module.exports = router;
