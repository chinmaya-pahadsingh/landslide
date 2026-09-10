const express = require('express');
const router = express.Router();
const { searchLocations } = require('../controllers/geocodingController');

// GET /api/geocoding?q=Guwahati
router.get('/', searchLocations);

module.exports = router;
