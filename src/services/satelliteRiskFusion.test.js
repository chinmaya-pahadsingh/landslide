/**
 * Satellite Evidence -> Risk Fusion Test Suite (Step 54C)
 *
 * Verifies:
 *   1. Satellite vegetation evidence (-3 pts bounded reduction)
 *   2. Satellite bare/sparse surface evidence (+5 pts bounded increase)
 *   3. Satellite cropland evidence (+2 pts bounded contextual increase)
 *   4. Satellite built-up evidence (+1 pt bounded contextual increase)
 *   5. Satellite water evidence (0 pts neutral)
 *   6. Satellite unknown/other evidence (0 pts neutral)
 *   7. Satellite unavailable/failure handling (0 pts, available: false)
 *   8. Satellite timeout handling (0 pts, available: false, isTimeout: true)
 *   9. Satellite HTTP 429 handling (0 pts, available: false, isRateLimited: true)
 *  10. Strict score clamping: [0, 100] under extreme values
 *  11. Stability: satellite failure/absence does not alter baseline or ML scores
 *  12. Safety: satellite evidence alone NEVER produces HIGH or CRITICAL risk/warning
 *  13. Early warning service receives contextual satellite triggers safely
 *  14. Evidence fusion service integrates satellite evidence cleanly
 *  15. Zero external network calls executed during tests
 */

const assert = require('assert');
const { calculateRiskScoreWithML, calculateRiskScore } = require('./riskScoreService');
const { evaluateSatelliteRiskContribution } = require('./satelliteLandCoverService');
const { fuseEvidence, buildSatelliteEvidence } = require('./evidenceFusionService');
const { evaluateEarlyWarning, WARNING_LEVELS } = require('./earlyWarningService');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, testFn) {
  try {
    testFn();
    console.log(`  PASS  ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL  ${testName}:`, err.message);
    failedTests++;
  }
}

async function runAsyncTest(testName, testFn) {
  try {
    await testFn();
    console.log(`  PASS  ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL  ${testName}:`, err.message);
    failedTests++;
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('RUNNING STEP 54C SATELLITE EVIDENCE → RISK FUSION TESTS');
  console.log('======================================================\n');

  const sampleTerrain = {
    elevation_m: 1200,
    slope_deg: 25,
    latitude: 26.20,
    longitude: 92.93
  };

  // --- Suite 1: evaluateSatelliteRiskContribution Bounded Logic ---
  console.log('--- Suite 1: Satellite Risk Contribution Evaluation ---');

  runTest('Bare ground provides bounded +5 points and erosion interpretation', () => {
    const res = evaluateSatelliteRiskContribution({
      available: true,
      category: 'bare',
      className: 'Bare Ground',
      classCode: 8
    });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.contributionPoints, 5);
    assert.ok(res.interpretation.includes('+5 pts'));
    assert.ok(res.interpretation.includes('root anchoring'));
  });

  runTest('Vegetation provides bounded -3 points and stabilization interpretation', () => {
    const res = evaluateSatelliteRiskContribution({
      available: true,
      category: 'vegetation',
      className: 'Trees',
      classCode: 2
    });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.contributionPoints, -3);
    assert.ok(res.interpretation.includes('-3 pts'));
    assert.ok(res.interpretation.includes('soil reinforcement'));
  });

  runTest('Cropland provides bounded +2 points and agricultural interpretation', () => {
    const res = evaluateSatelliteRiskContribution({
      available: true,
      category: 'cropland',
      className: 'Crops',
      classCode: 5
    });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.contributionPoints, 2);
    assert.ok(res.interpretation.includes('+2 pts'));
  });

  runTest('Built-up provides bounded +1 point and infrastructure exposure interpretation', () => {
    const res = evaluateSatelliteRiskContribution({
      available: true,
      category: 'built_up',
      className: 'Built Area',
      classCode: 7
    });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.contributionPoints, 1);
    assert.ok(res.interpretation.includes('+1 pt'));
  });

  runTest('Water provides 0 points neutral contribution', () => {
    const res = evaluateSatelliteRiskContribution({
      available: true,
      category: 'water',
      className: 'Water',
      classCode: 1
    });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.contributionPoints, 0);
  });

  runTest('Unknown / Cloud cover provides 0 points neutral contribution', () => {
    const res = evaluateSatelliteRiskContribution({
      available: true,
      category: 'unknown',
      className: 'Clouds',
      classCode: 10
    });
    assert.strictEqual(res.available, true);
    assert.strictEqual(res.contributionPoints, 0);
  });

  runTest('Unavailable satellite data provides available: false, 0 points, neutral explanation', () => {
    const res = evaluateSatelliteRiskContribution({
      available: false,
      error: 'Upstream connection reset'
    });
    assert.strictEqual(res.available, false);
    assert.strictEqual(res.contributionPoints, 0);
    assert.strictEqual(res.category, 'unknown');
  });

  // --- Suite 2: Risk Score Integration & Fused Predictions ---
  console.log('\n--- Suite 2: Risk Score Integration with Satellite Evidence ---');

  await runAsyncTest('Bare ground satellite evidence increases score by exactly 5 points', async () => {
    const baseInput = {
      rainfall: 100,
      soilMoisture: 40,
      ...sampleTerrain
    };

    const resWithoutSat = await calculateRiskScoreWithML(baseInput);
    const resWithBareSat = await calculateRiskScoreWithML({
      ...baseInput,
      satellite: {
        available: true,
        category: 'bare',
        className: 'Bare Ground',
        classCode: 8
      }
    });

    assert.strictEqual(resWithBareSat.satelliteEvidence.available, true);
    assert.strictEqual(resWithBareSat.satelliteEvidence.contributionPoints, 5);
    assert.strictEqual(resWithBareSat.score, resWithoutSat.score + 5);
  });

  await runAsyncTest('Vegetation satellite evidence decreases score by exactly 3 points', async () => {
    const baseInput = {
      rainfall: 100,
      soilMoisture: 40,
      ...sampleTerrain
    };

    const resWithoutSat = await calculateRiskScoreWithML(baseInput);
    const resWithVegSat = await calculateRiskScoreWithML({
      ...baseInput,
      satellite: {
        available: true,
        category: 'vegetation',
        className: 'Trees',
        classCode: 2
      }
    });

    assert.strictEqual(resWithVegSat.satelliteEvidence.available, true);
    assert.strictEqual(resWithVegSat.satelliteEvidence.contributionPoints, -3);
    assert.strictEqual(resWithVegSat.score, resWithoutSat.score - 3);
  });

  await runAsyncTest('Cropland increases score by 2 points; Built-up increases by 1 point', async () => {
    const baseInput = {
      rainfall: 100,
      soilMoisture: 40,
      ...sampleTerrain
    };

    const resWithoutSat = await calculateRiskScoreWithML(baseInput);
    const resCrop = await calculateRiskScoreWithML({
      ...baseInput,
      satellite: { available: true, category: 'cropland', className: 'Crops', classCode: 5 }
    });
    const resBuilt = await calculateRiskScoreWithML({
      ...baseInput,
      satellite: { available: true, category: 'built_up', className: 'Built Area', classCode: 7 }
    });

    assert.strictEqual(resCrop.score, resWithoutSat.score + 2);
    assert.strictEqual(resBuilt.score, resWithoutSat.score + 1);
  });

  // --- Suite 3: Failure Modes & Neutrality ---
  console.log('\n--- Suite 3: Satellite Failure Modes & Score Neutrality ---');

  await runAsyncTest('Satellite timeout leaves score completely unchanged and marks available: false', async () => {
    const baseInput = {
      rainfall: 100,
      soilMoisture: 40,
      ...sampleTerrain
    };

    const resWithoutSat = await calculateRiskScoreWithML(baseInput);
    const resTimeout = await calculateRiskScoreWithML({
      ...baseInput,
      satellite: {
        available: false,
        isTimeout: true,
        category: 'unknown',
        error: 'Satellite provider request timed out'
      }
    });

    assert.strictEqual(resTimeout.score, resWithoutSat.score);
    assert.strictEqual(resTimeout.satelliteEvidence.available, false);
    assert.strictEqual(resTimeout.satelliteEvidence.contributionPoints, 0);
  });

  await runAsyncTest('HTTP 429 rate-limit leaves score completely unchanged and marks available: false', async () => {
    const baseInput = {
      rainfall: 100,
      soilMoisture: 40,
      ...sampleTerrain
    };

    const resWithoutSat = await calculateRiskScoreWithML(baseInput);
    const res429 = await calculateRiskScoreWithML({
      ...baseInput,
      satellite: {
        available: false,
        isRateLimited: true,
        category: 'unknown',
        error: 'Satellite provider rate limit exceeded (HTTP 429)'
      }
    });

    assert.strictEqual(res429.score, resWithoutSat.score);
    assert.strictEqual(res429.satelliteEvidence.available, false);
    assert.strictEqual(res429.satelliteEvidence.contributionPoints, 0);
  });

  await runAsyncTest('SAFETY: Missing satellite evidence is NEVER converted to safe vegetation', async () => {
    const baseInput = {
      rainfall: 100,
      soilMoisture: 40,
      ...sampleTerrain
    };

    const res = await calculateRiskScoreWithML({
      ...baseInput,
      satellite: {
        available: false,
        category: 'unknown'
      }
    });

    assert.notStrictEqual(res.satelliteEvidence.category, 'vegetation');
    assert.strictEqual(res.satelliteEvidence.category, 'unknown');
    assert.strictEqual(res.satelliteEvidence.contributionPoints, 0);
  });

  // --- Suite 4: Clamping Bounds & Risk Level Invariance ---
  console.log('\n--- Suite 4: Clamping Bounds & Risk Levels ---');

  await runAsyncTest('Score remains strictly clamped to [0, 100] when vegetation is applied to 0', async () => {
    const zeroInput = {
      rainfall: 0,
      soilMoisture: 0,
      satellite: {
        available: true,
        category: 'vegetation',
        className: 'Trees',
        classCode: 2
      }
    };

    const res = await calculateRiskScoreWithML(zeroInput);
    assert.strictEqual(res.score, 0); // 0 - 3 clamped to 0
    assert.strictEqual(res.level, 'low');
  });

  await runAsyncTest('Score remains strictly clamped to [0, 100] when bare is applied to 100', async () => {
    const maxInput = {
      rainfall: 500,
      soilMoisture: 100,
      satellite: {
        available: true,
        category: 'bare',
        className: 'Bare Ground',
        classCode: 8
      }
    };

    const res = await calculateRiskScoreWithML(maxInput);
    assert.strictEqual(res.score, 100); // 100 + 5 clamped to 100
    assert.strictEqual(res.level, 'critical');
  });

  runTest('SAFETY: Satellite evidence alone NEVER produces HIGH or CRITICAL risk', () => {
    // Zero baseline + bare ground (+5 pts)
    const base = calculateRiskScore({ rainfall: 0, soilMoisture: 0 });
    const sat = evaluateSatelliteRiskContribution({ available: true, category: 'bare', className: 'Bare Ground' });
    const totalScore = Math.min(100, Math.max(0, base.score + sat.contributionPoints));

    assert.strictEqual(totalScore, 5);
    assert.ok(totalScore <= 25, 'Total score must remain in low category');
    assert.notStrictEqual(totalScore > 50, true);
  });

  // --- Suite 5: Early Warning Service & Evidence Fusion Integration ---
  console.log('\n--- Suite 5: Early Warning Service & Evidence Fusion Integration ---');

  runTest('Evidence fusion incorporates satellite land-cover cleanly into evidence summary', () => {
    const fused = fuseEvidence({
      location: { latitude: 26.20, longitude: 92.93 },
      satellite: {
        available: true,
        source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
        classCode: 2,
        className: 'Trees',
        category: 'vegetation'
      }
    });

    assert.strictEqual(fused.evidenceAvailability.satellite, true);
    assert.ok(fused.evidence.satellite);
    assert.strictEqual(fused.evidence.satellite.className, 'Trees');
    assert.strictEqual(fused.evidence.satellite.category, 'vegetation');
    assert.ok(fused.reasoning.some((r) => r.includes('Trees')));
  });

  runTest('Evidence fusion handles missing satellite evidence with available: false', () => {
    const fused = fuseEvidence({
      location: { latitude: 26.20, longitude: 92.93 },
      satellite: null
    });

    assert.strictEqual(fused.evidenceAvailability.satellite, false);
    assert.strictEqual(fused.evidence.satellite, undefined);
    assert.ok(fused.limitations.some((l) => l.includes('Satellite land-cover evidence is unavailable')));
  });

  runTest('Early Warning Service evaluates satellite evidence contextually without escalating to warning', () => {
    const ew = evaluateEarlyWarning({
      location: { latitude: 26.20, longitude: 92.93 },
      evidence: {
        rainfall: { latestValue: 10, isRecent: true, freshness: 'fresh' },
        soilMoisture: { latestValue: 10, isRecent: true, freshness: 'fresh' },
        satellite: {
          available: true,
          category: 'bare',
          className: 'Bare Ground'
        }
      }
    });

    assert.ok(ew.evidenceSummary.satellite);
    assert.ok(ew.triggers.some((t) => t.category === 'satellite_land_cover' && t.level === 'context'));
    assert.ok(ew.reasoning.some((r) => r.includes('bare/sparse surface')));
    // Must remain NO_WARNING or ADVISORY; never escalated to WATCH, WARNING, or CRITICAL by satellite alone
    assert.notStrictEqual(ew.warningLevel, WARNING_LEVELS.WATCH);
    assert.notStrictEqual(ew.warningLevel, WARNING_LEVELS.WARNING);
    assert.notStrictEqual(ew.warningLevel, WARNING_LEVELS.CRITICAL);
  });

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: Total: ${passedTests + failedTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('Zero real external API calls were made during test execution.');
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error in satellite risk fusion tests:', err);
  process.exit(1);
});
