/**
 * Internal ML Prediction Controller.
 * Exposes endpoints for static susceptibility and dynamic trigger inference.
 */

const {
  predictSusceptibility,
  predictTrigger,
  predictBoth,
  getModelStatus
} = require('../services/mlPredictionService');

/**
 * POST /api/ml/predict
 * Internal prediction endpoint.
 * Accepts:
 * {
 *   susceptibility?: { elevation_m, slope_deg, latitude, longitude },
 *   trigger?: { elevation_m, slope_deg, latitude, longitude, ... rainfall features }
 * }
 * OR flat input with both sets of features.
 */
async function predict(req, res) {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({
        error: 'Invalid payload. Expected a JSON object with model features.'
      });
    }

    // Support either explicitly nested { susceptibility, trigger } or flat payload
    const result = await predictBoth(payload);

    return res.status(200).json(result);
  } catch (error) {
    console.error('ML prediction endpoint error:', error);
    return res.status(500).json({
      error: 'An internal error occurred during ML prediction processing.'
    });
  }
}

/**
 * GET /api/ml/status
 * Reports operational status and feature configurations without exposing server paths.
 */
async function getStatus(req, res) {
  try {
    const status = getModelStatus();
    return res.status(200).json(status);
  } catch (error) {
    console.error('ML status check error:', error);
    return res.status(500).json({
      error: 'Failed to retrieve ML service status.'
    });
  }
}

module.exports = {
  predict,
  getStatus
};
