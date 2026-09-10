/**
 * Internal ML Prediction Routes.
 * Protected with authentication, role-based access, and rate limiting.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const mlPredictionController = require('../controllers/mlPredictionController');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

// Rate limiting: 60 requests per minute per IP
const mlPredictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'Too many ML prediction requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Protected internal prediction endpoint
router.post(
  '/predict',
  mlPredictLimiter,
  authenticate,
  requireRole('admin', 'authority'),
  mlPredictionController.predict
);

// Health / status endpoint (restricted to admin and authority)
router.get(
  '/status',
  authenticate,
  requireRole('admin', 'authority'),
  mlPredictionController.getStatus
);

module.exports = router;
