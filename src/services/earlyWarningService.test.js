const { evaluateEarlyWarning, WARNING_LEVELS, DATA_STATUS } = require('./earlyWarningService');

let passed = 0;
let failed = 0;

const assert = (condition, label, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
};

const runTests = () => {
  console.log('=== Early Warning Service — Verification ===\n');

  const loc = { latitude: 25.0, longitude: 91.0 };

  // 1. Missing data tests
  {
    const resAllMissing = evaluateEarlyWarning({ location: loc });
    assert(resAllMissing.dataStatus === DATA_STATUS.INSUFFICIENT, '1. All evidence unavailable -> insufficient data');
    assert(resAllMissing.environmentalRisk === null, '1b. Missing rainfall and soil -> no environmental score');
    assert(resAllMissing.limitations.some(l => l.includes('does NOT imply zero rainfall')), '1c. No missing-to-zero conversion (rainfall)');
    assert(resAllMissing.limitations.some(l => l.includes('does NOT imply dry conditions')), '1d. No missing-to-zero conversion (soil)');

    const resMissingSoil = evaluateEarlyWarning({
      location: loc,
      evidence: { rainfall: { latestValue: 120, isRecent: true } }
    });
    assert(resMissingSoil.environmentalRisk === null, '1e. Missing soil moisture -> no environmental score');

    // Stale rainfall
    const resStaleRain = evaluateEarlyWarning({
      location: loc,
      evidence: { 
        rainfall: { latestValue: 200, isRecent: false, freshness: 'stale' },
        soilMoisture: { latestValue: 70, isRecent: true }
      }
    });
    assert(resStaleRain.environmentalRisk === null, '1g. Stale rainfall -> baseline excluded, environmentalRisk is null');
    assert(resStaleRain.limitations.some(l => l.includes('stale/not recent')), '1h. Stale rainfall noted in limitations');

    // Stale soil moisture
    const resStaleSoil = evaluateEarlyWarning({
      location: loc,
      evidence: { 
        rainfall: { latestValue: 200, isRecent: true },
        soilMoisture: { latestValue: 70, freshness: 'stale' }
      }
    });
    assert(resStaleSoil.environmentalRisk === null, '1i. Stale soil moisture -> baseline excluded, environmentalRisk is null');
    assert(resStaleSoil.limitations.some(l => l.includes('stale/not recent')), '1j. Stale soil moisture noted in limitations');
  }

  // 2. Deterministic baseline tests
  {
    const res = evaluateEarlyWarning({
      location: loc,
      evidence: { 
        rainfall: { latestValue: 200, isRecent: true },
        soilMoisture: { latestValue: 70, isRecent: true }
      }
    });
    // rainfall 200 -> score 40, soil 70 -> score 28. total 68 -> high -> WATCH
    assert(res.environmentalRisk !== null && res.environmentalRisk.level === 'high', '2. Rainfall + soil available -> deterministic baseline (high)');
    assert(res.warningLevel === WARNING_LEVELS.WATCH, '2b. Baseline high -> WATCH');
  }

  // 3. Escalations
  {
    // Baseline + Terrain
    const resTerrain = evaluateEarlyWarning({
      location: loc,
      evidence: { 
        rainfall: { latestValue: 200, isRecent: true },
        soilMoisture: { latestValue: 70, isRecent: true },
        terrain: { slope: 35 }
      }
    });
    assert(resTerrain.warningLevel === WARNING_LEVELS.WARNING, '3a. Environmental baseline + terrain escalation -> WARNING');

    // Baseline + ML success
    const resML = evaluateEarlyWarning({
      location: loc,
      evidence: { 
        rainfall: { latestValue: 200, isRecent: true },
        soilMoisture: { latestValue: 70, isRecent: true },
        mlPrediction: { class: 1, probability: 0.85 }
      }
    });
    assert(resML.warningLevel === WARNING_LEVELS.WARNING, '3b. Environmental baseline + ML success -> WARNING');
  }

  // 4. Specific isolated sources
  {
    // ML Refused
    const resMLRefused = evaluateEarlyWarning({
      location: loc,
      evidence: { mlPrediction: null }
    });
    assert(resMLRefused.limitations.some(l => l.includes('No machine learning prediction')), '4a. ML prediction_refused handled safely');

    // Field report only
    const resField = evaluateEarlyWarning({
      location: loc,
      evidence: { fieldReports: { recentCount: 2 } }
    });
    assert(resField.reasoning.some(r => r.includes('unverified evidence')), '4b. Field report remains observational/unverified');

    // Historical only
    const resHist = evaluateEarlyWarning({
      location: loc,
      evidence: { historical: { eventCount: 5 } }
    });
    assert(resHist.warningLevel === WARNING_LEVELS.ADVISORY, '4c. Historical evidence does not independently trigger active warning');
  }

  // 5. System stability, infrastructure exposure, and formatting
  {
    // Evidence source failure does not crash system
    const resCrashTest = evaluateEarlyWarning({
      location: loc,
      evidence: { terrain: { slope: null }, rainfall: { latestValue: undefined } }
    });
    assert(resCrashTest.decisionStatus === 'success', '5a. Evidence source failure does not crash system');

    // Malformed input handled safely
    const resNull = evaluateEarlyWarning(null);
    assert(resNull.decisionStatus === 'error', '5b. Null input handled safely without throwing');

    const resNonObject = evaluateEarlyWarning('invalid string');
    assert(resNonObject.decisionStatus === 'error', '5c. Non-object input handled safely without throwing');

    // Identical inputs produce identical decisions
    const input = {
      location: loc,
      evidence: { rainfall: { latestValue: 60, isRecent: true }, soilMoisture: { latestValue: 45, isRecent: true } },
      referenceTime: new Date('2026-01-01T00:00:00.000Z')
    };
    const res1 = evaluateEarlyWarning(input);
    const res2 = evaluateEarlyWarning(input);
    assert(JSON.stringify(res1) === JSON.stringify(res2), '5d. Identical inputs produce identical decisions');

    // Infrastructure exposure with elevated risk
    const resInfra = evaluateEarlyWarning({
      location: loc,
      evidence: { 
        rainfall: { latestValue: 200, isRecent: true },
        soilMoisture: { latestValue: 70, isRecent: true }
      },
      infrastructure: { status: 'calculated', score: 85 }
    });
    assert(resInfra.warningLevel === WARNING_LEVELS.WARNING, '5e. Infrastructure exposure escalates WATCH to WARNING');

    // Infrastructure exposure with NO_WARNING does not escalate
    const resInfraNoWarning = evaluateEarlyWarning({
      location: loc,
      evidence: {
        rainfall: { latestValue: 0, isRecent: true },
        soilMoisture: { latestValue: 0, isRecent: true },
        terrain: { slope: 5 }
      },
      infrastructure: { status: 'calculated', score: 95 }
    });
    assert(resInfraNoWarning.warningLevel === WARNING_LEVELS.NO_WARNING, '5f. Infrastructure exposure does not escalate NO_WARNING');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
};

runTests();
