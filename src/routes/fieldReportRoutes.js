const express = require('express');
const router = express.Router();
const { createFieldReport, getAllFieldReports, getFieldReportById } = require('../controllers/fieldReportController');
const { authenticate } = require('../middleware/authMiddleware');

router.post('/', authenticate, createFieldReport);
router.get('/', getAllFieldReports);
router.get('/:id', getFieldReportById);

module.exports = router;
