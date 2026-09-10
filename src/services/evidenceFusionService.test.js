const {
  fuseEvidence,
  validateCoordinates,
  validateTimestamp,
  isRecent,
  buildTerrainEvidence,
  buildRainfallEvidence,
  buildSoilMoistureEvidence,
  buildHistoricalEvidence,
  buildFieldReportEvidence,
  buildMlPredictionEvidence,
} = require('./evidenceFusionService');

const NOW = new Date('2026-09-04T06:00:00.000Z');
const RECENT_DATE = new Date('2026-09-03T12:00:00.000Z');  // 18h ago
const OLD_DATE = new Date('2026-08-30T00:00:00.000Z');       // >72h ago

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return true;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    return false;
  }
}

function runTests() {
  let passed = 0;
  let failed = 0;

  const check = (cond, label, detail) => {
    if (assert(cond, label, detail)) passed++; else failed++;
  };

  console.log('=== Evidence Fusion Service — Verification ===\n');

  // -----------------------------------------------------------------------
  // 1. All evidence unavailable
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      referenceTime: NOW
    });
    check(result.overallStatus === 'insufficient_data',
      '1. All evidence unavailable → insufficient_data');
    check(result.availableSourceCount === 0,
      '1b. Available source count is 0');
    check(result.limitations.length > 0,
      '1c. Limitations are listed');
  }

  // -----------------------------------------------------------------------
  // 2. Terrain evidence available
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      terrain: { elevation: 1500, slope: 35 },
      referenceTime: NOW
    });
    check(result.evidenceAvailability.terrain === true,
      '2. Terrain evidence marked available');
    check(result.evidence.terrain.elevation === 1500,
      '2b. Elevation value preserved');
    check(result.evidence.terrain.slope === 35,
      '2c. Slope value preserved');
    check(result.overallStatus === 'available',
      '2d. Overall status is available');
  }

  // -----------------------------------------------------------------------
  // 3. Rainfall evidence available
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      rainfallObservations: [
        { rainfall: 45.2, recordedAt: RECENT_DATE },
        { rainfall: 30.0, recordedAt: OLD_DATE }
      ],
      referenceTime: NOW
    });
    check(result.evidenceAvailability.rainfall === true,
      '3. Rainfall evidence marked available');
    check(result.evidence.rainfall.observationCount === 2,
      '3b. Observation count is 2');
    check(result.evidence.rainfall.latestValue === 45.2,
      '3c. Latest value is 45.2');
    check(result.evidence.rainfall.isRecent === true,
      '3d. Latest observation is recent');
  }

  // -----------------------------------------------------------------------
  // 4. Soil moisture evidence available
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      soilMoistureObservations: [
        { soilMoisture: 72, recordedAt: RECENT_DATE }
      ],
      referenceTime: NOW
    });
    check(result.evidenceAvailability.soilMoisture === true,
      '4. Soil moisture evidence marked available');
    check(result.evidence.soilMoisture.latestValue === 72,
      '4b. Latest value is 72');
  }

  // -----------------------------------------------------------------------
  // 5. Historical evidence available
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      historicalEvents: [
        { severity: 'high' },
        { severity: 'low' },
        { severity: 'high' },
        {}  // missing severity → unknown
      ],
      referenceTime: NOW
    });
    check(result.evidenceAvailability.historical === true,
      '5. Historical evidence marked available');
    check(result.evidence.historical.eventCount === 4,
      '5b. Event count is 4');
    check(result.evidence.historical.severityCounts.high === 2,
      '5c. High severity count is 2');
    check(result.evidence.historical.severityCounts.unknown === 1,
      '5d. Unknown severity count is 1');
    // Verify historical reasoning is explicit about temporal distinction
    check(result.reasoning.some(r => r.includes('do not represent current')),
      '5e. Historical reasoning contains temporal distinction');
  }

  // -----------------------------------------------------------------------
  // 6. Field report evidence available
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      fieldReports: [
        { reportType: 'road_blockage', status: 'submitted', reportedAt: RECENT_DATE },
        { reportType: 'crack', status: 'reviewed', reportedAt: OLD_DATE }
      ],
      referenceTime: NOW
    });
    check(result.evidenceAvailability.fieldReports === true,
      '6. Field report evidence marked available');
    check(result.evidence.fieldReports.reportCount === 2,
      '6b. Report count is 2');
    check(result.evidence.fieldReports.recentCount === 1,
      '6c. Recent count is 1');
    check(result.evidence.fieldReports.typeCounts.road_blockage === 1,
      '6d. Road blockage type count is 1');
    // Field reports should never become scientific probability
    check(result.reasoning.some(r => r.includes('unverified')),
      '6e. Reasoning explicitly notes unverified nature');
  }

  // -----------------------------------------------------------------------
  // 7. ML prediction unavailable
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      mlPrediction: { status: 'prediction_refused', reason: 'Model unavailable. Falling back to baseline.' },
      referenceTime: NOW
    });
    check(result.evidenceAvailability.mlPrediction === false,
      '7. ML prediction marked unavailable when refused');
    check(!result.evidence.mlPrediction,
      '7b. No ML data in evidence block');
    check(result.reasoning.some(r => r.includes('Model unavailable')),
      '7c. Reasoning explains model unavailability');
  }

  // -----------------------------------------------------------------------
  // 8. Mixed evidence availability
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      terrain: { elevation: 800, slope: 15 },
      rainfallObservations: [{ rainfall: 120, recordedAt: RECENT_DATE }],
      // soil moisture: deliberately absent
      historicalEvents: [{ severity: 'medium' }],
      // field reports: deliberately absent
      // ML: deliberately absent
      referenceTime: NOW
    });
    check(result.overallStatus === 'available',
      '8. Mixed evidence → available');
    check(result.availableSourceCount === 3,
      '8b. Available count is 3 (terrain, rainfall, historical)');
    check(result.evidenceAvailability.soilMoisture === false,
      '8c. Soil moisture unavailable');
    check(result.evidenceAvailability.fieldReports === false,
      '8d. Field reports unavailable');
    check(result.evidenceAvailability.mlPrediction === false,
      '8e. ML prediction unavailable');
  }

  // -----------------------------------------------------------------------
  // 9. Missing evidence is NOT converted to zero
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      referenceTime: NOW
    });
    check(result.evidence.rainfall === undefined,
      '9. Missing rainfall is NOT in evidence (not zero)');
    check(result.evidence.soilMoisture === undefined,
      '9b. Missing soil moisture is NOT in evidence (not zero)');
    check(result.evidence.mlPrediction === undefined,
      '9c. Missing ML prediction is NOT in evidence (not zero)');
    check(result.limitations.some(r => r.includes('does NOT imply low rainfall')),
      '9d. Limitation explicitly says missing ≠ low rainfall');
    check(result.limitations.some(r => r.includes('does NOT imply dry')),
      '9e. Limitation explicitly says missing ≠ dry conditions');
  }

  // -----------------------------------------------------------------------
  // 10. Invalid coordinates
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 91, longitude: 92.0 }
    });
    check(result.overallStatus === 'error',
      '10. Invalid latitude → error status');

    const result2 = fuseEvidence({
      location: { latitude: 26.0, longitude: -181 }
    });
    check(result2.overallStatus === 'error',
      '10b. Invalid longitude → error status');

    const result3 = fuseEvidence({});
    check(result3.overallStatus === 'error',
      '10c. Missing location → error status');

    const result4 = fuseEvidence({ location: { latitude: NaN, longitude: 92 } });
    check(result4.overallStatus === 'error',
      '10d. NaN latitude → error status');

    const result5 = fuseEvidence({ location: { latitude: 26, longitude: Infinity } });
    check(result5.overallStatus === 'error',
      '10e. Infinity longitude → error status');
  }

  // -----------------------------------------------------------------------
  // 11. Invalid timestamps handled gracefully
  // -----------------------------------------------------------------------
  {
    const tsValid = validateTimestamp('2026-09-01T00:00:00.000Z');
    check(tsValid.valid === true, '11. Valid timestamp accepted');

    const tsNull = validateTimestamp(null);
    check(tsNull.valid === false, '11b. Null timestamp rejected');

    const tsBad = validateTimestamp('not-a-date');
    check(tsBad.valid === false, '11c. Invalid string timestamp rejected');

    const tsUndef = validateTimestamp(undefined);
    check(tsUndef.valid === false, '11d. Undefined timestamp rejected');
  }

  // -----------------------------------------------------------------------
  // 12. Historical evidence remains temporally distinct
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      historicalEvents: [
        { severity: 'critical', eventDate: '2015-06-01' },
        { severity: 'high', eventDate: '2018-07-15' }
      ],
      referenceTime: NOW
    });
    // Historical events must NOT be treated as current hazards
    check(result.evidence.historical !== undefined,
      '12. Historical evidence is present');
    check(result.overallStatus !== 'critical_evidence',
      '12b. Historical events do not escalate overall to critical');
    check(result.reasoning.some(r => r.includes('do not represent current')),
      '12c. Reasoning preserves temporal distinction');
  }

  // -----------------------------------------------------------------------
  // 13. Unverified field report ≠ scientific probability
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      fieldReports: [
        { reportType: 'landslide', status: 'submitted', reportedAt: RECENT_DATE }
      ],
      referenceTime: NOW
    });
    // Must NOT contain probability, riskLevel, or similar derived fields
    check(result.evidence.fieldReports.probability === undefined,
      '13. Field reports do not produce a probability');
    check(result.evidence.fieldReports.riskLevel === undefined,
      '13b. Field reports do not produce a riskLevel');
    check(result.reasoning.some(r => r.includes('unverified')),
      '13c. Field report reasoning notes unverified status');
  }

  // -----------------------------------------------------------------------
  // 14. Deterministic output for identical input
  // -----------------------------------------------------------------------
  {
    const input = {
      location: { latitude: 26.0, longitude: 92.0 },
      terrain: { elevation: 1200, slope: 40 },
      rainfallObservations: [{ rainfall: 80, recordedAt: RECENT_DATE }],
      referenceTime: NOW
    };
    const r1 = fuseEvidence(input);
    const r2 = fuseEvidence(input);
    check(JSON.stringify(r1) === JSON.stringify(r2),
      '14. Identical input produces identical output (deterministic)');
  }

  // -----------------------------------------------------------------------
  // 15. No fabricated probability or accuracy
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      terrain: { elevation: 1200, slope: 40 },
      rainfallObservations: [{ rainfall: 250, recordedAt: RECENT_DATE }],
      soilMoistureObservations: [{ soilMoisture: 85, recordedAt: RECENT_DATE }],
      historicalEvents: [{ severity: 'critical' }],
      fieldReports: [{ reportType: 'landslide', status: 'submitted', reportedAt: RECENT_DATE }],
      // ML not provided
      referenceTime: NOW
    });
    // Even with all non-ML sources present, no probability should appear
    check(result.evidence.mlPrediction === undefined,
      '15. No fabricated ML probability when model is absent');
    // No top-level probability or accuracy field
    check(result.probability === undefined,
      '15b. No top-level probability field');
    check(result.accuracy === undefined,
      '15c. No top-level accuracy field');
    check(result.overallStatus === 'available',
      '15d. Status remains conservative "available"');
  }

  // -----------------------------------------------------------------------
  // 16. Coordinate validation helpers
  // -----------------------------------------------------------------------
  {
    check(validateCoordinates(26, 92).valid === true,
      '16. Valid coordinates accepted');
    check(validateCoordinates(-90, -180).valid === true,
      '16b. Boundary coordinates accepted');
    check(validateCoordinates(90, 180).valid === true,
      '16c. Max boundary coordinates accepted');
    check(validateCoordinates(null, 92).valid === false,
      '16d. Null latitude rejected');
    check(validateCoordinates(26, undefined).valid === false,
      '16e. Undefined longitude rejected');
    check(validateCoordinates('a', 92).valid === false,
      '16f. String latitude rejected');
  }

  // -----------------------------------------------------------------------
  // 17. isRecent helper
  // -----------------------------------------------------------------------
  {
    check(isRecent(RECENT_DATE, 72, NOW) === true,
      '17. Recent date within 72h window');
    check(isRecent(OLD_DATE, 72, NOW) === false,
      '17b. Old date outside 72h window');
    check(isRecent(null, 72, NOW) === false,
      '17c. Null date returns false');
    check(isRecent(new Date('invalid'), 72, NOW) === false,
      '17d. Invalid date returns false');
  }

  // -----------------------------------------------------------------------
  // 18. Rainfall with only old observations
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      rainfallObservations: [
        { rainfall: 50, recordedAt: OLD_DATE }
      ],
      referenceTime: NOW
    });
    check(result.evidenceAvailability.rainfall === true,
      '18. Old rainfall still available (not discarded)');
    check(result.evidence.rainfall.isRecent === false,
      '18b. Old rainfall is flagged as not recent');
    check(result.limitations.some(r => r.includes('not recent')),
      '18c. Staleness limitation is noted');
  }

  // -----------------------------------------------------------------------
  // 19. Empty arrays treated as unavailable
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      rainfallObservations: [],
      soilMoistureObservations: [],
      historicalEvents: [],
      fieldReports: [],
      referenceTime: NOW
    });
    check(result.evidenceAvailability.rainfall === false,
      '19. Empty rainfall array → unavailable');
    check(result.evidenceAvailability.soilMoisture === false,
      '19b. Empty soil moisture array → unavailable');
    check(result.evidenceAvailability.historical === false,
      '19c. Empty historical array → unavailable');
    check(result.evidenceAvailability.fieldReports === false,
      '19d. Empty field reports array → unavailable');
  }

  // -----------------------------------------------------------------------
  // 20. ML prediction success path
  // -----------------------------------------------------------------------
  {
    const result = fuseEvidence({
      location: { latitude: 26.0, longitude: 92.0 },
      mlPrediction: {
        status: 'success',
        prediction: {
          probability: 0.65,
          class: 1
        },
        modelVersion: '1.0.0',
        limitations: ['test']
      },
      referenceTime: NOW
    });
    check(result.evidenceAvailability.mlPrediction === true,
      '20. Successful ML prediction marked available');
    check(result.evidence.mlPrediction.probability === 0.65,
      '20b. ML probability preserved exactly');
    check(result.evidence.mlPrediction.modelVersion === '1.0.0',
      '20c. ML model version preserved');
    check(result.evidence.mlPrediction.class === 1,
      '20d. ML class preserved');
  }

  // -----------------------------------------------------------------------
  // 21. Terrain with only elevation (partial)
  // -----------------------------------------------------------------------
  {
    const result = buildTerrainEvidence({ elevation: 2000 });
    check(result.available === true,
      '21. Partial terrain (elevation only) is available');
    check(result.data.slope === undefined,
      '21b. Missing slope is not fabricated');
  }

  // -----------------------------------------------------------------------
  // 22. Terrain with invalid slope
  // -----------------------------------------------------------------------
  {
    const result = buildTerrainEvidence({ slope: 91 });
    check(result.available === false,
      '22. Terrain with invalid slope (91) → unavailable');
  }

  // -----------------------------------------------------------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
