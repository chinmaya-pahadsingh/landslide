/**
 * Satellite Controller
 *
 * Exposes satellite-derived environmental telemetry endpoints.
 */

const { satelliteLandCoverService } = require('../services/satelliteLandCoverService');

/**
 * GET /api/satellite/land-cover
 * Query params: lat, lon
 * Returns normalized satellite land cover classification.
 */
async function getLandCover(req, res) {
  try {
    const { lat, lon } = req.query;

    if (lat === undefined || lon === undefined || lat === '' || lon === '') {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameters: lat and lon are required.'
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        success: false,
        error: 'Latitude and longitude query parameters must be valid finite numbers.'
      });
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        error: 'Coordinates out of bounds. Latitude must be in [-90, 90] and longitude in [-180, 180].'
      });
    }

    const result = await satelliteLandCoverService.getLandCover(latitude, longitude);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('Error in satellite getLandCover controller:', err);
    return res.status(500).json({
      success: false,
      error: 'An unexpected internal error occurred while processing satellite land cover request.'
    });
  }
}

module.exports = {
  getLandCover
};
