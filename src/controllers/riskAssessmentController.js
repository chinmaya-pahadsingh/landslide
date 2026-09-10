const {
  calculateRiskScore,
  calculateRiskScoreWithML
} = require('../services/riskScoreService');
const terrainService = require('../services/terrainService');

/**
 * POST /api/risk-assessment
 * Calculates baseline environmental risk and safely enriches with XGBoost ML evidence
 * using live or provided terrain and meteorological features.
 */
const calculateRisk = async (req, res) => {
  try {
    const { rainfall, soilMoisture } = req.body;

    if (typeof rainfall !== 'number' || isNaN(rainfall)) {
      return res.status(400).json({ error: 'Invalid or missing input: rainfall must be a number.' });
    }

    if (typeof soilMoisture !== 'number' || isNaN(soilMoisture)) {
      return res.status(400).json({ error: 'Invalid or missing input: soilMoisture must be a number.' });
    }

    const payload = { ...req.body };

    // If coordinates are provided but terrain elevation/slope are missing, attempt safe live terrain resolution
    const lat = payload.latitude ?? payload.lat;
    const lon = payload.longitude ?? payload.lon ?? payload.lng;

    if (
      typeof lat === 'number' && isFinite(lat) &&
      typeof lon === 'number' && isFinite(lon) &&
      (payload.elevation_m === undefined || payload.slope_deg === undefined)
    ) {
      try {
        const terrain = await terrainService.getTerrainFeaturesForLocation(lat, lon);
        if (terrain && typeof terrain.elevation === 'number' && typeof terrain.slope === 'number') {
          payload.elevation_m = payload.elevation_m ?? terrain.elevation;
          payload.slope_deg = payload.slope_deg ?? terrain.slope;
          payload.terrainSource = terrain.source;
        }
      } catch (terrainErr) {
        console.warn('Live terrain resolution skipped due to provider failure/timeout:', terrainErr.message);
        // Do not crash, proceed with whatever features are available
      }
    }

    let riskAssessment;
    try {
      riskAssessment = await calculateRiskScoreWithML(payload);
    } catch (mlErr) {
      console.warn('ML enrichment failed, falling back to baseline risk scoring:', mlErr.message);
      riskAssessment = calculateRiskScore({ rainfall, soilMoisture });
    }

    res.status(200).json({ riskAssessment });
  } catch (error) {
    console.error('Error calculating risk assessment:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

module.exports = {
  calculateRisk,
};
