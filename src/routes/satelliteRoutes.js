/**
 * Satellite Routes
 *
 * Exposes satellite-derived environmental telemetry endpoints.
 * Protected with JWT authentication and rate limiting.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { getLandCover } = require('../controllers/satelliteController');
const { authenticate } = require('../middleware/authMiddleware');

// Rate limiting: 60 requests per minute per IP
const satelliteLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'Too many satellite telemetry requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});

// GET /api/satellite/land-cover?lat=<lat>&lon=<lon>
router.get(
  '/land-cover',
  satelliteLimiter,
  authenticate,
  getLandCover
);

module.exports = router;
