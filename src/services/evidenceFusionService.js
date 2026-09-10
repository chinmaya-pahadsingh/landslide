/**
 * Evidence Fusion Service
 *
 * Combines independently available evidence sources into a transparent,
 * deterministic situational-awareness summary.
 *
 * This service does NOT predict landslides. It aggregates whatever evidence
 * is currently available and explicitly tracks what is missing.
 *
 * Evidence sources:
 *   1. Terrain     – elevation, slope
 *   2. Rainfall    – recent rainfall observations
 *   3. Soil Moisture – recent soil-moisture observations
 *   4. Historical  – past recorded landslide events
 *   5. Field Reports – citizen / field-team observations
 *   6. ML Prediction – only if a genuinely trained model is available
 *
 * Design principles:
 *   - Missing evidence is NEVER treated as negative (safe) evidence.
 *   - Missing rainfall ≠ rainfall = 0.
 *   - Missing ML prediction ≠ probability = 0.
 *   - The service is deterministic and makes no network requests.
 *   - It accepts structured evidence as input; callers are responsible
 *     for fetching data from the database or APIs.
 */

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validates geographic coordinates.
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{ valid: boolean, reason?: string }}
 */
const validateCoordinates = (latitude, longitude) => {
  if (latitude == null || longitude == null) {
    return { valid: false, reason: 'Coordinates are missing.' };
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { valid: false, reason: 'Coordinates must be numbers.' };
  }
  if (!isFinite(latitude) || !isFinite(longitude)) {
    return { valid: false, reason: 'Coordinates must be finite numbers.' };
  }
  if (latitude < -90 || latitude > 90) {
    return { valid: false, reason: 'Latitude must be between -90 and 90.' };
  }
  if (longitude < -180 || longitude > 180) {
    return { valid: false, reason: 'Longitude must be between -180 and 180.' };
  }
  return { valid: true };
};

/**
 * Validates whether a timestamp is a usable Date.
 * @param {*} value
 * @returns {{ valid: boolean, date?: Date, reason?: string }}
 */
const validateTimestamp = (value) => {
  if (value == null) {
    return { valid: false, reason: 'Timestamp is missing.' };
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) {
    return { valid: false, reason: 'Timestamp is not a valid date.' };
  }
  return { valid: true, date: d };
};

/**
 * Determines whether a date falls within a recency window.
 * @param {Date} date
 * @param {number} windowHours – recency window in hours (default 72)
 * @param {Date}   now         – reference time (default Date.now)
 * @returns {boolean}
 */
const isRecent = (date, windowHours = 72, now = new Date()) => {
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  return date >= cutoff;
};

// ---------------------------------------------------------------------------
// Evidence builders – one per source
// ---------------------------------------------------------------------------

/**
 * Builds terrain evidence from optional elevation/slope values.
 * @param {{ elevation?: number, slope?: number }} terrain
 * @returns {Object}
 */
const buildTerrainEvidence = (terrain) => {
  if (!terrain) {
    return { available: false, reason: 'No terrain data provided.' };
  }

  const hasElevation = typeof terrain.elevation === 'number' && isFinite(terrain.elevation);
  const hasSlope = typeof terrain.slope === 'number' && isFinite(terrain.slope)
    && terrain.slope >= 0 && terrain.slope <= 90;

  if (!hasElevation && !hasSlope) {
    return { available: false, reason: 'No usable terrain features (elevation/slope) available.' };
  }

  const reasoning = [];
  const data = {};

  if (hasElevation) {
    data.elevation = terrain.elevation;
    reasoning.push(`Elevation data available: ${terrain.elevation} m.`);
  }
  if (hasSlope) {
    data.slope = terrain.slope;
    reasoning.push(`Slope data available: ${terrain.slope}°.`);
    if (terrain.slope >= 30) {
      reasoning.push('High slope value noted (≥30°).');
    }
  }

  return { available: true, data, reasoning };
};

/**
 * Builds rainfall evidence from an array of observation records.
 * @param {Array} observations – rainfall observation documents
 * @param {Date}  now          – reference time
 * @returns {Object}
 */
const buildRainfallEvidence = (observations, now = new Date()) => {
  if (!observations || !Array.isArray(observations) || observations.length === 0) {
    return { available: false, reason: 'No rainfall observations available.' };
  }

  const valid = observations.filter(
    o => typeof o.rainfall === 'number' && isFinite(o.rainfall)
  );

  if (valid.length === 0) {
    return { available: false, reason: 'No valid rainfall observations available.' };
  }

  const latest = valid.reduce((a, b) => {
    const da = new Date(a.recordedAt);
    const db = new Date(b.recordedAt);
    return da > db ? a : b;
  });

  const latestDate = new Date(latest.recordedAt);
  const isOlderThan72h = !isRecent(latestDate, 72, now);
  const isMarkedStale = latest.freshness === 'stale' || latest.isStale === true;
  const recent = !isOlderThan72h && !isMarkedStale;

  const reasoning = [
    `${valid.length} rainfall observation(s) available.`,
    `Latest observation: ${latest.rainfall} mm recorded at ${latestDate.toISOString()}.`
  ];

  if (isMarkedStale) {
    reasoning.push('Latest rainfall observation is marked stale due to upstream provider failure.');
  } else if (isOlderThan72h) {
    reasoning.push('Latest rainfall observation is older than 72 hours.');
  }

  return {
    available: true,
    data: {
      observationCount: valid.length,
      latestValue: latest.rainfall,
      rainfall24h: typeof latest.rainfall24h === 'number' && !isNaN(latest.rainfall24h) ? latest.rainfall24h : null,
      currentIntervalPrecipitation: typeof latest.currentIntervalPrecipitation === 'number' && !isNaN(latest.currentIntervalPrecipitation) ? latest.currentIntervalPrecipitation : null,
      latestRecordedAt: latestDate.toISOString(),
      isRecent: recent,
      freshness: isMarkedStale ? 'stale' : (latest.freshness || (recent ? 'fresh' : 'stale')),
      dataMode: latest.dataMode || (isMarkedStale ? 'cached' : 'live'),
      upstreamStatus: latest.upstreamStatus || (isMarkedStale ? 'failed_upstream' : 'success')
    },
    reasoning
  };
};

/**
 * Builds soil-moisture evidence from an array of observation records.
 * @param {Array} observations – soil-moisture observation documents
 * @param {Date}  now          – reference time
 * @returns {Object}
 */
const buildSoilMoistureEvidence = (observations, now = new Date()) => {
  if (!observations || !Array.isArray(observations) || observations.length === 0) {
    return { available: false, reason: 'No soil-moisture observations available.' };
  }

  const valid = observations.filter(
    o => typeof o.soilMoisture === 'number' && isFinite(o.soilMoisture)
  );

  if (valid.length === 0) {
    return { available: false, reason: 'No valid soil-moisture observations available.' };
  }

  const latest = valid.reduce((a, b) => {
    const da = new Date(a.recordedAt);
    const db = new Date(b.recordedAt);
    return da > db ? a : b;
  });

  const latestDate = new Date(latest.recordedAt);
  const isOlderThan72h = !isRecent(latestDate, 72, now);
  const isMarkedStale = latest.freshness === 'stale' || latest.isStale === true;
  const recent = !isOlderThan72h && !isMarkedStale;

  const reasoning = [
    `${valid.length} soil-moisture observation(s) available.`,
    `Latest observation: ${latest.soilMoisture}% recorded at ${latestDate.toISOString()}.`
  ];

  if (isMarkedStale) {
    reasoning.push('Latest soil-moisture observation is marked stale due to upstream provider failure.');
  } else if (isOlderThan72h) {
    reasoning.push('Latest soil-moisture observation is older than 72 hours.');
  }

  return {
    available: true,
    data: {
      observationCount: valid.length,
      latestValue: latest.soilMoisture,
      latestRecordedAt: latestDate.toISOString(),
      isRecent: recent,
      freshness: isMarkedStale ? 'stale' : (latest.freshness || (recent ? 'fresh' : 'stale')),
      dataMode: latest.dataMode || (isMarkedStale ? 'cached' : 'live'),
      upstreamStatus: latest.upstreamStatus || (isMarkedStale ? 'failed_upstream' : 'success')
    },
    reasoning
  };
};

/**
 * Builds historical-landslide evidence from an array of LandslideEvent records.
 * Historical events inform situational awareness but are NOT current hazards.
 * @param {Array} events
 * @returns {Object}
 */
const buildHistoricalEvidence = (events) => {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return { available: false, reason: 'No historical landslide events available.' };
  }

  const severityCounts = { low: 0, medium: 0, high: 0, critical: 0, unknown: 0 };
  for (const event of events) {
    const sev = event.severity || 'unknown';
    if (sev in severityCounts) {
      severityCounts[sev]++;
    } else {
      severityCounts.unknown++;
    }
  }

  const reasoning = [
    `${events.length} historical landslide event(s) recorded in this area.`,
    'Historical events provide contextual awareness but do not represent current active hazards.'
  ];

  return {
    available: true,
    data: {
      eventCount: events.length,
      severityCounts,
    },
    reasoning
  };
};

/**
 * Builds field-report evidence from an array of FieldReport records.
 * Field reports are observational and unverified unless status is 'reviewed'.
 * @param {Array} reports
 * @param {Date}  now – reference time
 * @returns {Object}
 */
const buildFieldReportEvidence = (reports, now = new Date()) => {
  if (!reports || !Array.isArray(reports) || reports.length === 0) {
    return { available: false, reason: 'No field reports available.' };
  }

  const typeCounts = {};
  const statusCounts = { submitted: 0, reviewed: 0, resolved: 0 };
  let recentCount = 0;

  for (const report of reports) {
    const rt = report.reportType || 'other';
    typeCounts[rt] = (typeCounts[rt] || 0) + 1;

    const st = report.status || 'submitted';
    if (st in statusCounts) statusCounts[st]++;

    const d = new Date(report.reportedAt);
    if (isRecent(d, 72, now)) recentCount++;
  }

  const reasoning = [
    `${reports.length} field report(s) available.`,
    `${recentCount} report(s) within the last 72 hours.`,
    'Field reports are observational evidence and may be unverified.'
  ];

  return {
    available: true,
    data: {
      reportCount: reports.length,
      recentCount,
      typeCounts,
      statusCounts,
    },
    reasoning
  };
};

/**
 * Builds ML-prediction evidence.
 * Only includes prediction if a genuinely trained model supplied it.
 * @param {Object|null} mlResult – result from mlRiskModelService.predictRisk()
 * @returns {Object}
 */
const buildMlPredictionEvidence = (mlResult) => {
  if (!mlResult) {
    return { available: false, reason: 'No ML prediction was provided.' };
  }

  if (mlResult.status === 'prediction_refused' || mlResult.status !== 'success') {
    return {
      available: false,
      reason: mlResult.reason || 'ML model is not currently available for prediction.',
    };
  }

  // Only expose prediction data if the model genuinely succeeded
  const reasoning = [
    `ML prediction available from model version ${mlResult.modelVersion || 'unknown'}.`,
  ];

  return {
    available: true,
    data: {
      probability: mlResult.prediction.probability,
      class: mlResult.prediction.class,
      modelVersion: mlResult.modelVersion,
      limitations: mlResult.limitations
    },
    reasoning
  };
};

/**
 * Builds satellite land-cover evidence.
 * @param {Object|null} satelliteInput – normalized satellite object from satelliteLandCoverService
 * @returns {Object}
 */
const buildSatelliteEvidence = (satelliteInput) => {
  if (!satelliteInput) {
    return { available: false, reason: 'No satellite land-cover evidence was provided.' };
  }

  if (!satelliteInput.available) {
    return {
      available: false,
      reason: satelliteInput.error || 'Satellite land-cover evidence is unavailable.',
    };
  }

  const className = satelliteInput.className || 'Unknown';
  const category = satelliteInput.category || 'unknown';
  const source = satelliteInput.source || 'Sentinel-2 10m Land Cover';

  const reasoning = [
    `Satellite land-cover classified as "${className}" (${category}) from ${source}.`
  ];

  return {
    available: true,
    data: {
      source,
      classCode: satelliteInput.classCode != null ? satelliteInput.classCode : null,
      className,
      category,
      retrievedAt: satelliteInput.retrievedAt || new Date().toISOString()
    },
    reasoning
  };
};

// ---------------------------------------------------------------------------
// Main fusion function
// ---------------------------------------------------------------------------

/**
 * Fuses all available evidence into a single transparent summary.
 *
 * @param {Object} input
 * @param {{ latitude: number, longitude: number }} input.location
 * @param {{ elevation?: number, slope?: number }}   [input.terrain]
 * @param {Array}  [input.rainfallObservations]
 * @param {Array}  [input.soilMoistureObservations]
 * @param {Array}  [input.historicalEvents]
 * @param {Array}  [input.fieldReports]
 * @param {Object} [input.mlPrediction]
 * @param {Date}   [input.referenceTime]
 * @returns {Object} Fusion result
 */
const fuseEvidence = (input = {}) => {
  // 1. Validate location
  const locationCheck = validateCoordinates(
    input.location?.latitude,
    input.location?.longitude
  );
  if (!locationCheck.valid) {
    return {
      overallStatus: 'error',
      error: locationCheck.reason,
      evidenceAvailability: {},
      evidence: {},
      reasoning: [],
      limitations: ['Cannot produce an evidence summary without valid coordinates.']
    };
  }

  const now = input.referenceTime instanceof Date ? input.referenceTime : new Date();

  // 2. Build each evidence source independently
  const terrain = buildTerrainEvidence(input.terrain);
  const rainfall = buildRainfallEvidence(input.rainfallObservations, now);
  const soilMoisture = buildSoilMoistureEvidence(input.soilMoistureObservations, now);
  const historical = buildHistoricalEvidence(input.historicalEvents);
  const fieldReports = buildFieldReportEvidence(input.fieldReports, now);
  const mlPrediction = buildMlPredictionEvidence(input.mlPrediction);
  const satellite = buildSatelliteEvidence(input.satellite || input.satelliteLandCover);

  // 3. Summarise availability
  const evidenceAvailability = {
    terrain: terrain.available,
    rainfall: rainfall.available,
    soilMoisture: soilMoisture.available,
    historical: historical.available,
    fieldReports: fieldReports.available,
    mlPrediction: mlPrediction.available,
    satellite: satellite.available
  };

  const availableCount = Object.values(evidenceAvailability).filter(Boolean).length;

  // 4. Determine overall status (conservative)
  let overallStatus;
  if (availableCount === 0) {
    overallStatus = 'insufficient_data';
  } else {
    overallStatus = 'available';
  }

  // 5. Aggregate reasoning
  const reasoning = [];
  const addReasoning = (source) => {
    if (source.reasoning) reasoning.push(...source.reasoning);
    if (!source.available && source.reason) reasoning.push(source.reason);
  };

  addReasoning(terrain);
  addReasoning(rainfall);
  addReasoning(soilMoisture);
  addReasoning(historical);
  addReasoning(fieldReports);
  addReasoning(mlPrediction);
  addReasoning(satellite);

  // 6. Collect limitations
  const limitations = [];
  if (!terrain.available) limitations.push('Terrain data is unavailable.');
  if (!rainfall.available) limitations.push('Rainfall data is unavailable; this does NOT imply low rainfall.');
  if (!soilMoisture.available) limitations.push('Soil-moisture data is unavailable; this does NOT imply dry conditions.');
  if (!mlPrediction.available) limitations.push('No trained ML prediction is currently available.');
  if (!satellite.available) limitations.push('Satellite land-cover evidence is unavailable.');
  if (rainfall.available && rainfall.data && !rainfall.data.isRecent) {
    limitations.push('Rainfall data is not recent (older than 72 hours or stale upstream).');
  }
  if (soilMoisture.available && soilMoisture.data && !soilMoisture.data.isRecent) {
    limitations.push('Soil-moisture data is not recent (older than 72 hours or stale upstream).');
  }

  // 7. Build evidence block (only populated sources)
  const evidence = {};
  if (terrain.available) evidence.terrain = terrain.data;
  if (rainfall.available) evidence.rainfall = rainfall.data;
  if (soilMoisture.available) evidence.soilMoisture = soilMoisture.data;
  if (historical.available) evidence.historical = historical.data;
  if (fieldReports.available) evidence.fieldReports = fieldReports.data;
  if (mlPrediction.available) evidence.mlPrediction = mlPrediction.data;
  if (satellite.available) evidence.satellite = satellite.data;

  return {
    overallStatus,
    location: { latitude: input.location.latitude, longitude: input.location.longitude },
    evidenceAvailability,
    availableSourceCount: availableCount,
    totalSourceCount: 7,
    evidence,
    reasoning,
    limitations,
    generatedAt: now.toISOString()
  };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  fuseEvidence,
  validateCoordinates,
  validateTimestamp,
  isRecent,
  // Individual builders exported for targeted testing
  buildTerrainEvidence,
  buildRainfallEvidence,
  buildSoilMoistureEvidence,
  buildHistoricalEvidence,
  buildFieldReportEvidence,
  buildMlPredictionEvidence,
  buildSatelliteEvidence,
};
