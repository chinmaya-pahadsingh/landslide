/**
 * Early Warning Decision Service
 *
 * This service acts as an orchestration/decision layer. It evaluates available
 * environmental evidence, field reports, and infrastructure priority to
 * determine an OPERATIONAL WARNING LEVEL.
 *
 * IMPORTANT:
 * - This service does NOT calculate scientific landslide probabilities.
 * - Missing evidence is NEVER treated as "zero risk" or "safe".
 * - Historical data provides context but does not automatically trigger warnings.
 * - Infrastructure priority affects operational response but does not increase
 *   hazard probability.
 */

const WARNING_LEVELS = {
  NO_WARNING: 'no_warning',
  ADVISORY: 'advisory',
  WATCH: 'watch',
  WARNING: 'warning',
  CRITICAL: 'critical'
};

const DATA_STATUS = {
  SUFFICIENT: 'sufficient',
  PARTIAL: 'partial',
  INSUFFICIENT: 'insufficient'
};

const TRIGGER_STATUS = {
  AVAILABLE: 'available',
  PARTIAL: 'partial',
  UNAVAILABLE: 'unavailable'
};

// Configurable operational thresholds (transparent, not scientifically derived)
const THRESHOLDS = {
  rainfall_high: 100, // mm
  rainfall_moderate: 50,
  soilMoisture_high: 70, // %
  soilMoisture_moderate: 40,
  terrain_slope: 30, // degrees
  infrastructure_high: 70, // score out of 100
};

const validateCoordinates = (latitude, longitude) => {
  if (latitude == null || longitude == null) return { valid: false, reason: 'Coordinates are missing.' };
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return { valid: false, reason: 'Coordinates must be numbers.' };
  if (!isFinite(latitude) || !isFinite(longitude)) return { valid: false, reason: 'Coordinates must be finite numbers.' };
  if (latitude < -90 || latitude > 90) return { valid: false, reason: 'Latitude must be between -90 and 90.' };
  if (longitude < -180 || longitude > 180) return { valid: false, reason: 'Longitude must be between -180 and 180.' };
  return { valid: true };
};

const { calculateRiskScore } = require('./riskScoreService');

/**
 * Evaluates available evidence and infrastructure data to generate an early warning decision.
 *
 * @param {Object} input
 * @param {Object} input.location - { latitude, longitude }
 * @param {Object} [input.evidence] - Structured evidence (e.g., from evidenceFusionService)
 * @param {Object} [input.infrastructure] - Structured infrastructure priority (e.g., from infrastructurePriorityService)
 * @param {Date} [input.referenceTime] - Current evaluation time
 * @returns {Object} Structured early warning decision
 */
const evaluateEarlyWarning = (input = {}) => {
  if (!input || typeof input !== 'object') {
    return {
      decisionStatus: 'error',
      error: 'Invalid input. Expected an object.',
      location: null,
      warningLevel: WARNING_LEVELS.NO_WARNING,
      dataStatus: DATA_STATUS.INSUFFICIENT,
      triggers: [],
      evidenceSummary: {},
      reasoning: ['Cannot evaluate warning without valid input.'],
      recommendedActions: [],
      limitations: ['Invalid input.'],
      generatedAt: new Date().toISOString()
    };
  }

  const locCheck = validateCoordinates(input.location?.latitude, input.location?.longitude);
  if (!locCheck.valid) {
    return {
      decisionStatus: 'error',
      error: locCheck.reason,
      location: null,
      warningLevel: WARNING_LEVELS.NO_WARNING,
      dataStatus: DATA_STATUS.INSUFFICIENT,
      triggers: [],
      evidenceSummary: {},
      reasoning: ['Cannot evaluate warning without valid coordinates.'],
      recommendedActions: [],
      limitations: ['Missing coordinates.'],
      generatedAt: new Date().toISOString()
    };
  }

  const now = input.referenceTime instanceof Date && !isNaN(input.referenceTime.getTime()) 
    ? input.referenceTime 
    : new Date();
  
  const evidence = input.evidence || {};
  const infra = input.infrastructure || {};

  const triggers = [];
  const reasoning = [];
  const limitations = [];
  const recommendedActions = new Set();
  const evidenceSummary = {};

  let availableCount = 0;
  
  // --- 1. Environmental Baseline ---
  let envBaseline = null;
  const isRainfallStale = evidence.rainfall?.isRecent === false || 
                          evidence.rainfall?.freshness === 'stale' || 
                          evidence.rainfall?.isStale === true;
  const hasRainfall = evidence.rainfall && !isRainfallStale && 
                      typeof evidence.rainfall.latestValue === 'number' && 
                      isFinite(evidence.rainfall.latestValue);

  const isSoilStale = evidence.soilMoisture?.isRecent === false || 
                      evidence.soilMoisture?.freshness === 'stale' || 
                      evidence.soilMoisture?.isStale === true;
  const hasSoil = evidence.soilMoisture && !isSoilStale && 
                  typeof evidence.soilMoisture.latestValue === 'number' && 
                  isFinite(evidence.soilMoisture.latestValue);

  if (evidence.rainfall) evidenceSummary.rainfall = evidence.rainfall;
  if (evidence.soilMoisture) evidenceSummary.soilMoisture = evidence.soilMoisture;

  if (hasRainfall && hasSoil) {
    envBaseline = calculateRiskScore({
      rainfall: evidence.rainfall.latestValue,
      soilMoisture: evidence.soilMoisture.latestValue
    });
    availableCount += 2;
    evidenceSummary.environmentalBaseline = envBaseline;
    triggers.push({ category: 'environmental_baseline', level: envBaseline.level, detail: `Baseline risk score ${envBaseline.score}/100` });
    reasoning.push(`Environmental baseline indicates ${envBaseline.level} risk (score: ${envBaseline.score}).`);
  } else {
    limitations.push('Environmental baseline (rainfall and soil moisture) is unavailable or incomplete.');
    if (!evidence.rainfall) {
      limitations.push('Rainfall data is unavailable; this does NOT imply zero rainfall.');
    } else if (isRainfallStale) {
      limitations.push('Rainfall data is stale/not recent; this does NOT imply zero rainfall.');
      reasoning.push('Rainfall data is stale and was excluded from baseline calculation.');
    }
    
    if (!evidence.soilMoisture) {
      limitations.push('Soil moisture data is unavailable; this does NOT imply dry conditions.');
    } else if (isSoilStale) {
      limitations.push('Soil moisture data is stale/not recent; this does NOT imply dry conditions.');
      reasoning.push('Soil moisture data is stale and was excluded from baseline calculation.');
    }
  }

  // --- Evaluate Other Triggers ---

  // 2. Terrain
  let terrainHigh = false;
  if (evidence.terrain) {
    availableCount++;
    evidenceSummary.terrain = evidence.terrain;
    if (evidence.terrain.slope != null) {
      if (evidence.terrain.slope >= THRESHOLDS.terrain_slope) {
        terrainHigh = true;
        triggers.push({ category: 'terrain', level: 'high', detail: `Steep slope detected (>= ${THRESHOLDS.terrain_slope}°)` });
        reasoning.push('Terrain susceptibility is high due to steep slope.');
      } else {
        triggers.push({ category: 'terrain', level: 'low', detail: 'Slope is below concerning threshold.' });
      }
    } else {
      limitations.push('Terrain evidence is missing slope information.');
    }
  } else {
    limitations.push('Terrain information is unavailable; cannot rule out steep slopes.');
  }

  // 3. ML Prediction
  let mlHigh = false;
  let mlModerate = false;
  if (evidence.mlPrediction) {
    availableCount++;
    evidenceSummary.mlPrediction = evidence.mlPrediction;
    const prob = evidence.mlPrediction.probability;
    const predictedClass = evidence.mlPrediction.class;
    
    if (predictedClass === 1 && prob >= 0.8) {
      mlHigh = true;
      triggers.push({ category: 'ml_prediction', level: 'high', detail: `ML model predicted landslide likely (prob: ${(prob*100).toFixed(1)}%).` });
      reasoning.push(`Machine learning model strongly indicates a landslide hazard (prob: ${prob.toFixed(3)}).`);
    } else if (predictedClass === 1) {
      mlModerate = true;
      triggers.push({ category: 'ml_prediction', level: 'moderate', detail: `ML model predicted potential hazard (prob: ${(prob*100).toFixed(1)}%).` });
      reasoning.push(`Machine learning model indicates a potential hazard.`);
    } else {
      triggers.push({ category: 'ml_prediction', level: 'low', detail: `ML model predicted no immediate hazard (prob: ${(prob*100).toFixed(1)}%).` });
    }
  } else {
    limitations.push('No machine learning prediction is available.');
  }

  // 4. Field Reports
  let fieldReportHigh = false;
  if (evidence.fieldReports) {
    if (evidence.fieldReports.recentCount > 0) {
      availableCount++;
      evidenceSummary.fieldReports = evidence.fieldReports;
      fieldReportHigh = true;
      triggers.push({ category: 'field_reports', level: 'high', detail: `${evidence.fieldReports.recentCount} recent field report(s) found.` });
      reasoning.push('Recent field reports indicate observable concern, though these remain unverified evidence.');
    } else {
      evidenceSummary.fieldReports = evidence.fieldReports;
      triggers.push({ category: 'field_reports', level: 'low', detail: 'No recent field reports.' });
    }
  }

  // 5. Historical Data (Contextual only)
  if (evidence.historical && evidence.historical.eventCount > 0) {
    evidenceSummary.historical = evidence.historical;
    triggers.push({ category: 'historical_evidence', level: 'context', detail: `${evidence.historical.eventCount} historical events in area.` });
    reasoning.push('Historical landslide events are present in this area, providing context but not active hazard.');
  }

  // 6. Infrastructure Priority
  let infraHigh = false;
  if (infra.status === 'calculated' && infra.score != null) {
    evidenceSummary.infrastructure_exposure = infra;
    if (infra.score >= THRESHOLDS.infrastructure_high) {
      infraHigh = true;
      triggers.push({ category: 'infrastructure_exposure', level: 'high', detail: `High operational priority score: ${infra.score}.` });
      reasoning.push('Infrastructure exposure is high in this location (influences operational priority, not scientific hazard).');
    } else {
      triggers.push({ category: 'infrastructure_exposure', level: 'low', detail: `Moderate/low operational priority score: ${infra.score}.` });
    }
  }

  // 7. Satellite Land Cover (Contextual only - NEVER triggers HIGH/CRITICAL warning alone)
  if (evidence.satellite && (evidence.satellite.available || evidence.satellite.category)) {
    evidenceSummary.satellite = evidence.satellite;
    const cat = evidence.satellite.category;
    const name = evidence.satellite.className || cat;
    if (cat === 'bare') {
      triggers.push({
        category: 'satellite_land_cover',
        level: 'context',
        detail: `Bare/sparse surface (${name}) detected via satellite imagery; lack of vegetative root anchoring.`
      });
      reasoning.push('Satellite imagery indicates bare/sparse surface, adding contextual vulnerability concern.');
    } else if (cat === 'vegetation') {
      triggers.push({
        category: 'satellite_land_cover',
        level: 'context',
        detail: `Vegetative cover (${name}) detected via satellite imagery; provides contextual root anchoring.`
      });
      reasoning.push('Satellite imagery confirms vegetative cover providing contextual topsoil reinforcement.');
    } else {
      triggers.push({
        category: 'satellite_land_cover',
        level: 'context',
        detail: `Land cover (${name}) detected via satellite imagery.`
      });
    }
  }

  // --- Determine Data Status ---
  let dataStatus = DATA_STATUS.INSUFFICIENT;
  // Robust sources: rainfall, soil moisture, terrain, ml, field reports
  if (availableCount >= 3) {
    dataStatus = DATA_STATUS.SUFFICIENT;
  } else if (availableCount >= 1) {
    dataStatus = DATA_STATUS.PARTIAL;
  }

  // --- Determine Warning Level ---
  let warningLevel = WARNING_LEVELS.NO_WARNING;
  
  if (dataStatus === DATA_STATUS.INSUFFICIENT) {
    // Cannot make a confident safe call with no data
    warningLevel = WARNING_LEVELS.ADVISORY;
    reasoning.push('Insufficient data to assess hazard. Issuing ADVISORY due to unknown conditions.');
    recommendedActions.add('Deploy sensors to gather environmental data.');
  } else {
    // Map baseline level to starting warning level
    if (envBaseline) {
      if (envBaseline.level === 'critical') warningLevel = WARNING_LEVELS.WARNING;
      else if (envBaseline.level === 'high') warningLevel = WARNING_LEVELS.WATCH;
      else if (envBaseline.level === 'medium') warningLevel = WARNING_LEVELS.ADVISORY;
      else warningLevel = WARNING_LEVELS.NO_WARNING;
    } else {
      // No baseline, rely on other evidence if any
      warningLevel = WARNING_LEVELS.ADVISORY;
    }

    // Escalations based on other evidence (bump up by one level)
    let escalationPoints = 0;
    if (terrainHigh) escalationPoints += 1;
    if (mlHigh) escalationPoints += 2;
    else if (mlModerate) escalationPoints += 1;
    if (fieldReportHigh) escalationPoints += 1;

    if (escalationPoints >= 3) {
      warningLevel = WARNING_LEVELS.WARNING;
      reasoning.push('Warning level escalated due to multiple high-risk corroborating factors.');
    } else if (escalationPoints >= 1) {
      // Bump up one level
      if (warningLevel === WARNING_LEVELS.NO_WARNING) warningLevel = WARNING_LEVELS.ADVISORY;
      else if (warningLevel === WARNING_LEVELS.ADVISORY) warningLevel = WARNING_LEVELS.WATCH;
      else if (warningLevel === WARNING_LEVELS.WATCH) warningLevel = WARNING_LEVELS.WARNING;
      // warning level doesn't go to critical until infra pushes it
    }

    // Infrastructure Exposure Escalation
    if (infraHigh && warningLevel !== WARNING_LEVELS.NO_WARNING) {
      reasoning.push('Warning level escalated due to high-priority infrastructure exposure.');
      if (warningLevel === WARNING_LEVELS.WARNING) warningLevel = WARNING_LEVELS.CRITICAL;
      else if (warningLevel === WARNING_LEVELS.WATCH) warningLevel = WARNING_LEVELS.WARNING;
      else if (warningLevel === WARNING_LEVELS.ADVISORY) warningLevel = WARNING_LEVELS.WATCH;
    }
  }

  // Default recommendations
  if (warningLevel === WARNING_LEVELS.NO_WARNING) {
    reasoning.push('Available evidence does not currently indicate elevated risk.');
    recommendedActions.add('Continue routine monitoring.');
  } else if (warningLevel === WARNING_LEVELS.ADVISORY) {
    recommendedActions.add('Monitor local weather reports.');
    recommendedActions.add('Verify sensor operation.');
  } else if (warningLevel === WARNING_LEVELS.WATCH) {
    recommendedActions.add('Inspect vulnerable slopes.');
    if (fieldReportHigh) recommendedActions.add('Verify field reports.');
    recommendedActions.add('Prepare local response teams on standby.');
  } else if (warningLevel === WARNING_LEVELS.WARNING) {
    recommendedActions.add('Issue public advisory for affected area.');
    recommendedActions.add('Check road connectivity and plan alternative routes.');
    recommendedActions.add('Deploy response teams to critical infrastructure.');
  } else if (warningLevel === WARNING_LEVELS.CRITICAL) {
    recommendedActions.add('Evacuate highly vulnerable zones.');
    recommendedActions.add('Close high-risk infrastructure immediately.');
    recommendedActions.add('Issue emergency public alerts.');
  }

  if (infraHigh) {
    recommendedActions.add('Prioritize inspections and response for exposed critical infrastructure.');
  }

  return {
    decisionStatus: 'success',
    dataStatus,
    warningLevel,
    environmentalRisk: envBaseline || null,
    location: input.location,
    triggers,
    evidenceSummary,
    reasoning,
    recommendedActions: Array.from(recommendedActions),
    limitations,
    generatedAt: now.toISOString()
  };
};

module.exports = {
  WARNING_LEVELS,
  DATA_STATUS,
  TRIGGER_STATUS,
  evaluateEarlyWarning
};
