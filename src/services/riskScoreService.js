/**
 * Risk Score Service
 *
 * Provides deterministic rule-based baseline scoring and safely extends
 * it with trained XGBoost machine learning predictions (Susceptibility & Trigger).
 */

const {
  predictSusceptibility,
  predictTrigger
} = require('./mlPredictionService');
const {
  evaluateSatelliteRiskContribution,
  satelliteLandCoverService
} = require('./satelliteLandCoverService');

/**
 * Calculates a baseline heuristic risk score and level from rainfall and soil moisture.
 *
 * Scoring logic:
 *   - Rainfall contributes up to 60 points (capped at 300 mm).
 *   - Soil moisture contributes up to 40 points (capped at 100 %).
 *   - Both inputs are clamped to [0, cap] before scoring.
 *   - Missing or non-numeric inputs are treated as 0.
 *
 * Level thresholds:
 *   score  0–25  → "low"
 *   score 26–50  → "medium"
 *   score 51–75  → "high"
 *   score 76–100 → "critical"
 *
 * @param {Object} params
 * @param {number} [params.rainfall]     - Rainfall in millimetres.
 * @param {number} [params.soilMoisture] - Soil moisture as a percentage (0-100).
 * @returns {{ score: number, level: string }}
 */
const calculateRiskScore = ({ rainfall, soilMoisture } = {}) => {
  // --- 1. Sanitise inputs ------------------------------------------------
  const safeRainfall = typeof rainfall === 'number' && isFinite(rainfall)
    ? rainfall
    : 0;

  const safeSoilMoisture = typeof soilMoisture === 'number' && isFinite(soilMoisture)
    ? soilMoisture
    : 0;

  // --- 2. Clamp values to their valid ranges -----------------------------
  const RAINFALL_CAP = 300;      // mm  – max value that contributes to score
  const SOIL_MOISTURE_CAP = 100; // %   – max value that contributes to score

  const clampedRainfall = Math.min(Math.max(safeRainfall, 0), RAINFALL_CAP);
  const clampedSoilMoisture = Math.min(Math.max(safeSoilMoisture, 0), SOIL_MOISTURE_CAP);

  // --- 3. Calculate component scores -------------------------------------
  // Rainfall: 0–300 mm  →  0–60 points
  const rainfallScore = (clampedRainfall / RAINFALL_CAP) * 60;

  // Soil moisture: 0–100 %  →  0–40 points
  const soilMoistureScore = (clampedSoilMoisture / SOIL_MOISTURE_CAP) * 40;

  // --- 4. Combine into a total score (0–100) -----------------------------
  const score = Math.round(rainfallScore + soilMoistureScore);

  // --- 5. Map score to a risk level --------------------------------------
  let level;
  if (score <= 25) {
    level = 'low';
  } else if (score <= 50) {
    level = 'medium';
  } else if (score <= 75) {
    level = 'high';
  } else {
    level = 'critical';
  }

  return { score, level };
};

/**
 * Maps any score (0-100) to standard categorical risk levels.
 */
function getRiskLevel(score) {
  if (score <= 25) return 'low';
  if (score <= 50) return 'medium';
  if (score <= 75) return 'high';
  return 'critical';
}

/**
 * Safely extracts a finite numeric property from candidates.
 * Returns null if missing or non-numeric (zero-substitution prohibited).
 */
function extractNumeric(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'number' && Number.isFinite(val) && !Number.isNaN(val)) {
      return val;
    }
  }
  return null;
}

/**
 * Calculates risk score with bounded XGBoost ML evidence integration.
 * 
 * Fuses heuristic baseline with:
 * - XGBoost Susceptibility Model (Static terrain predisposition)
 * - XGBoost Trigger Model (Dynamic meteorological priming)
 * 
 * Guaranteed:
 * - When ML data is missing/unavailable, falls back cleanly to baseline.
 * - Missing values are never silently substituted with zero.
 * - Score strictly bounded in [0, 100].
 * - Failures in ML never crash risk assessment.
 * 
 * @param {Object} params - Input parameters including rainfall, soilMoisture, terrain, and weather
 * @param {Object} [options] - Options for prediction bridge (timeouts, custom paths)
 * @returns {Promise<Object>} { score, level, baselineScore, mlEvidence }
 */
async function calculateRiskScoreWithML(params = {}, options = {}) {
  // 1. Calculate rule-based baseline
  const baseline = calculateRiskScore({
    rainfall: params.rainfall,
    soilMoisture: params.soilMoisture
  });

  const baselineScore = baseline.score;

  // 2. Extract terrain & spatial candidates for Susceptibility Model
  const elevation = extractNumeric(params, 'elevation_m', 'elevation', 'elevation_meters');
  const slope = extractNumeric(params, 'slope_deg', 'slope', 'slope_degrees');
  const latitude = extractNumeric(params, 'latitude', 'lat');
  const longitude = extractNumeric(params, 'longitude', 'lon', 'lng');

  const hasSusceptibilityFeatures = (
    elevation !== null &&
    slope !== null &&
    latitude !== null &&
    longitude !== null
  );

  // 3. Extract multi-scale rainfall candidates for Trigger Model
  const rainEventDay = extractNumeric(params, 'precipitation_event_day_mm', 'rain_event_day_mm', 'precipitation_event_day');
  const rainPrev24h = extractNumeric(params, 'precipitation_prev_24h_mm', 'rain_prev_24h_mm', 'precipitation_prev_24h');
  const rainPrev3d = extractNumeric(params, 'precipitation_prev_3d_mm', 'rain_prev_3d_mm', 'precipitation_prev_3d');
  const rainPrev7d = extractNumeric(params, 'precipitation_prev_7d_mm', 'rain_prev_7d_mm', 'precipitation_prev_7d');
  const rainPrev30d = extractNumeric(params, 'precipitation_prev_30d_mm', 'rain_prev_30d_mm', 'precipitation_prev_30d');

  const hasTriggerRainfallFeatures = (
    rainEventDay !== null &&
    rainPrev24h !== null &&
    rainPrev3d !== null &&
    rainPrev7d !== null &&
    rainPrev30d !== null
  );

  const hasTriggerFeatures = hasSusceptibilityFeatures && hasTriggerRainfallFeatures;

  // 4. Invoke ML models with fail-safe boundaries
  let suscResult = { status: 'skipped', reason: 'Missing required terrain or spatial coordinates (elevation, slope, lat, lon).' };
  let trigResult = { status: 'skipped', reason: 'Missing required multi-scale antecedent rainfall features.' };

  try {
    if (hasSusceptibilityFeatures) {
      suscResult = await predictSusceptibility({
        elevation_m: elevation,
        slope_deg: slope,
        latitude,
        longitude
      }, options);
    }
  } catch (err) {
    suscResult = {
      status: 'error',
      model: 'xgboost_susceptibility',
      reason: `Susceptibility model invocation error: ${err.message}`
    };
  }

  try {
    if (hasTriggerFeatures) {
      trigResult = await predictTrigger({
        elevation_m: elevation,
        slope_deg: slope,
        latitude,
        longitude,
        precipitation_event_day_mm: rainEventDay,
        precipitation_prev_24h_mm: rainPrev24h,
        precipitation_prev_3d_mm: rainPrev3d,
        precipitation_prev_7d_mm: rainPrev7d,
        precipitation_prev_30d_mm: rainPrev30d
      }, options);
    } else if (hasSusceptibilityFeatures && !hasTriggerRainfallFeatures) {
      trigResult = {
        status: 'skipped',
        model: 'xgboost_trigger',
        reason: 'Required antecedent rainfall time-series is incomplete; trigger prediction skipped without fabricating data.'
      };
    }
  } catch (err) {
    trigResult = {
      status: 'error',
      model: 'xgboost_trigger',
      reason: `Trigger model invocation error: ${err.message}`
    };
  }

  // 5. Bounded Fusion Strategy
  const suscSuccess = (suscResult.status === 'success' && typeof suscResult.probability === 'number');
  const trigSuccess = (trigResult.status === 'success' && typeof trigResult.probability === 'number');

  let finalScore = baselineScore;
  let weights = { baseline: 1.0, susceptibility: 0.0, trigger: 0.0 };
  let strategy = 'heuristic_baseline_only';
  let explanation = `Risk score evaluated using rule-based environmental baseline (${baselineScore}/100).`;

  if (suscSuccess && trigSuccess) {
    // Strategy A: Full Evidence Fusion (Baseline 40%, Susceptibility 30%, Trigger 30%)
    weights = { baseline: 0.40, susceptibility: 0.30, trigger: 0.30 };
    strategy = 'bounded_weighted_fusion_full';

    const suscContribution = weights.susceptibility * (suscResult.probability * 100);
    const trigContribution = weights.trigger * (trigResult.probability * 100);
    const baseContribution = weights.baseline * baselineScore;

    const rawFused = baseContribution + suscContribution + trigContribution;
    finalScore = Math.round(Math.min(Math.max(rawFused, 0), 100));

    suscResult.contributionPoints = Math.round(suscContribution * 10) / 10;
    trigResult.contributionPoints = Math.round(trigContribution * 10) / 10;

    explanation = `Fused baseline heuristic (${baselineScore}/100 @ 40%) with XGBoost susceptibility (${(suscResult.probability * 100).toFixed(1)}% @ 30%) and dynamic trigger (${(trigResult.probability * 100).toFixed(1)}% @ 30%).`;
  } else if (suscSuccess) {
    // Strategy B: Terrain Susceptibility Fusion (Baseline 65%, Susceptibility 35%)
    weights = { baseline: 0.65, susceptibility: 0.35, trigger: 0.0 };
    strategy = 'bounded_weighted_fusion_susceptibility_only';

    const suscContribution = weights.susceptibility * (suscResult.probability * 100);
    const baseContribution = weights.baseline * baselineScore;

    const rawFused = baseContribution + suscContribution;
    finalScore = Math.round(Math.min(Math.max(rawFused, 0), 100));

    suscResult.contributionPoints = Math.round(suscContribution * 10) / 10;

    explanation = `Fused baseline heuristic (${baselineScore}/100 @ 65%) with XGBoost terrain susceptibility (${(suscResult.probability * 100).toFixed(1)}% @ 35%). Dynamic trigger skipped.`;
  } else if (trigSuccess) {
    // Strategy C: Trigger Only Fusion (Baseline 65%, Trigger 35%)
    weights = { baseline: 0.65, susceptibility: 0.0, trigger: 0.35 };
    strategy = 'bounded_weighted_fusion_trigger_only';

    const trigContribution = weights.trigger * (trigResult.probability * 100);
    const baseContribution = weights.baseline * baselineScore;

    const rawFused = baseContribution + trigContribution;
    finalScore = Math.round(Math.min(Math.max(rawFused, 0), 100));

    trigResult.contributionPoints = Math.round(trigContribution * 10) / 10;

    explanation = `Fused baseline heuristic (${baselineScore}/100 @ 65%) with XGBoost dynamic meteorological trigger (${(trigResult.probability * 100).toFixed(1)}% @ 35%).`;
  } else {
    // Strategy D: Fallback to Heuristic Baseline
    if (suscResult.status === 'unavailable' || trigResult.status === 'unavailable') {
      explanation = `ML model artifact unavailable; safely fell back to rule-based environmental baseline (${baselineScore}/100).`;
    } else if (suscResult.status === 'error' || trigResult.status === 'error') {
      explanation = `ML execution error; safely fell back to rule-based environmental baseline (${baselineScore}/100).`;
    }
  }

  // 6. Contextual Satellite Land-Cover Evidence Fusion
  let satelliteResult = params.satellite || params.satelliteLandCover || null;

  if (!satelliteResult && (options.resolveSatellite === true || params.resolveSatellite === true) && latitude !== null && longitude !== null) {
    try {
      const satService = options.satelliteService || satelliteLandCoverService;
      satelliteResult = await satService.getLandCover(latitude, longitude, options);
    } catch (satErr) {
      satelliteResult = {
        available: false,
        category: 'unknown',
        error: satErr.message || 'Failed to query satellite land cover'
      };
    }
  }

  const satelliteEvidence = evaluateSatelliteRiskContribution(satelliteResult);
  const satContribution = satelliteEvidence.contributionPoints || 0;

  // Apply bounded satellite contribution to final score, clamped strictly to [0, 100]
  finalScore = Math.round(Math.min(Math.max(finalScore + satContribution, 0), 100));
  const finalLevel = getRiskLevel(finalScore);

  return {
    score: finalScore,
    level: finalLevel,
    baselineScore,
    mlEvidence: {
      integrated: suscSuccess || trigSuccess,
      strategy,
      weights,
      susceptibility: suscResult,
      trigger: trigResult,
      explanation
    },
    satelliteEvidence
  };
}

module.exports = {
  calculateRiskScore,
  calculateRiskScoreWithML,
  getRiskLevel
};
