/**
 * Verification Suite for riskScoreService.js
 * 
 * Verifies:
 * 1. All existing baseline rule-based risk calculations (backward compatibility)
 * 2. Normal risk assessment with ML evidence
 * 3. Susceptibility-only case (terrain only)
 * 4. Susceptibility + Trigger case (full fusion)
 * 5. Missing rainfall -> trigger skipped safely (no fabrication)
 * 6. ML model unavailable -> fallback to baseline calculation
 * 7. Bounded range enforcement ([0, 100]) under extreme inputs
 * 8. ML evidence and contribution response structure
 * 9. Controller integration verification
 */

const path = require('path');
const {
  calculateRiskScore,
  calculateRiskScoreWithML,
  getRiskLevel
} = require('./riskScoreService');
const { calculateRisk } = require('../controllers/riskAssessmentController');

const baselineTests = [
  // --- Low-risk inputs ---
  { label: 'Low risk (light rain, dry soil)',        input: { rainfall: 30,  soilMoisture: 10  }, expectLevel: 'low'      },
  { label: 'Low risk (no rain, no moisture)',         input: { rainfall: 0,   soilMoisture: 0   }, expectLevel: 'low'      },

  // --- Medium-risk inputs ---
  { label: 'Medium risk (moderate rain & moisture)',  input: { rainfall: 120, soilMoisture: 40  }, expectLevel: 'medium'   },
  { label: 'Medium risk (some rain, wet soil)',       input: { rainfall: 80,  soilMoisture: 60  }, expectLevel: 'medium'   },

  // --- High-risk inputs ---
  { label: 'High risk (heavy rain, wet soil)',        input: { rainfall: 200, soilMoisture: 70  }, expectLevel: 'high'     },
  { label: 'High risk (very heavy rain, dry soil)',   input: { rainfall: 250, soilMoisture: 30  }, expectLevel: 'high'     },

  // --- Critical-risk inputs ---
  { label: 'Critical risk (extreme rain & moisture)', input: { rainfall: 300, soilMoisture: 100 }, expectLevel: 'critical' },
  { label: 'Critical risk (max rain, high moisture)', input: { rainfall: 300, soilMoisture: 80  }, expectLevel: 'critical' },

  // --- Missing / invalid inputs ---
  { label: 'Missing both inputs',                     input: {},                                   expectLevel: 'low'      },
  { label: 'Undefined input',                         input: undefined,                            expectLevel: 'low'      },
  { label: 'Non-numeric rainfall',                    input: { rainfall: 'heavy', soilMoisture: 50 }, expectLevel: 'low'    },
  { label: 'Negative values (clamped to 0)',          input: { rainfall: -50, soilMoisture: -20 }, expectLevel: 'low'      },
  { label: 'Values above caps (clamped to max)',      input: { rainfall: 500, soilMoisture: 200 }, expectLevel: 'critical' },
];

let passed = 0;
let failed = 0;

function report(condition, label, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function runAllTests() {
  console.log('=== Part 1: Baseline Rule-Based Risk Calculations ===\n');

  for (const t of baselineTests) {
    const result = calculateRiskScore(t.input);
    const ok = result.level === t.expectLevel && result.score >= 0 && result.score <= 100;
    report(ok, t.label);
  }

  console.log('\n=== Part 2: ML Evidence Integration Tests ===\n');

  const validTerrain = {
    elevation_m: 1450.0,
    slope_deg: 28.5,
    latitude: 27.35,
    longitude: 88.62
  };

  const validRainfallSeries = {
    precipitation_event_day_mm: 55.4,
    precipitation_prev_24h_mm: 62.1,
    precipitation_prev_3d_mm: 145.0,
    precipitation_prev_7d_mm: 230.5,
    precipitation_prev_30d_mm: 512.0
  };

  // Test 14: Susceptibility-only case (terrain available, dynamic rainfall missing)
  try {
    const suscOnlyInput = {
      rainfall: 120,
      soilMoisture: 40,
      ...validTerrain
    };
    const res = await calculateRiskScoreWithML(suscOnlyInput);
    report(
      res.mlEvidence.integrated === true && res.mlEvidence.strategy === 'bounded_weighted_fusion_susceptibility_only',
      'Susceptibility-only case activates bounded susceptibility fusion'
    );
    report(
      res.mlEvidence.weights.baseline === 0.65 && res.mlEvidence.weights.susceptibility === 0.35,
      'Susceptibility-only case applies correct weights (65% baseline / 35% susceptibility)'
    );
    report(
      res.mlEvidence.trigger.status === 'skipped',
      'Dynamic trigger model is skipped safely when rainfall history is missing'
    );
    report(
      res.score >= 0 && res.score <= 100,
      'Susceptibility-only score is within [0, 100]',
      `score: ${res.score}`
    );
  } catch (err) {
    report(false, 'Susceptibility-only test threw unexpected error', err.message);
  }

  // Test 15: Full Fusion (Susceptibility + Dynamic Trigger)
  try {
    const fullInput = {
      rainfall: 150,
      soilMoisture: 50,
      ...validTerrain,
      ...validRainfallSeries
    };
    const res = await calculateRiskScoreWithML(fullInput);
    report(
      res.mlEvidence.integrated === true && res.mlEvidence.strategy === 'bounded_weighted_fusion_full',
      'Full fusion case activates bounded full fusion strategy'
    );
    report(
      res.mlEvidence.weights.baseline === 0.40 &&
      res.mlEvidence.weights.susceptibility === 0.30 &&
      res.mlEvidence.weights.trigger === 0.30,
      'Full fusion applies correct 40/30/30 weights'
    );
    report(
      typeof res.mlEvidence.susceptibility.contributionPoints === 'number' &&
      typeof res.mlEvidence.trigger.contributionPoints === 'number',
      'Both susceptibility and trigger contribution points are explicitly quantified'
    );
    report(
      res.score >= 0 && res.score <= 100,
      'Full fusion score is within [0, 100]',
      `score: ${res.score}`
    );
  } catch (err) {
    report(false, 'Full fusion test threw unexpected error', err.message);
  }

  // Test 16: Missing rainfall -> trigger skipped safely (no zero substitution)
  try {
    const incompleteRainfall = {
      rainfall: 100,
      soilMoisture: 30,
      ...validTerrain,
      precipitation_event_day_mm: 55.4,
      // Missing prev_24h, prev_3d, prev_7d, prev_30d
    };
    const res = await calculateRiskScoreWithML(incompleteRainfall);
    report(
      res.mlEvidence.trigger.status === 'skipped',
      'Trigger model safely skipped when partial rainfall history is missing'
    );
    report(
      res.mlEvidence.trigger.reason.includes('incomplete') || res.mlEvidence.trigger.reason.includes('Missing'),
      'Trigger explanation clearly states data is incomplete and was NOT fabricated'
    );
    report(
      res.mlEvidence.susceptibility.status === 'success',
      'Susceptibility model continues to function even when trigger is skipped'
    );
  } catch (err) {
    report(false, 'Missing rainfall test threw unexpected error', err.message);
  }

  // Test 17: ML model unavailable -> existing risk engine still works
  try {
    const brokenConfig = {
      susceptibilityModelPath: path.join(__dirname, 'non_existent_susc.json'),
      triggerModelPath: path.join(__dirname, 'non_existent_trig.json')
    };
    const inputWithBrokenML = {
      rainfall: 200,
      soilMoisture: 70,
      ...validTerrain,
      ...validRainfallSeries
    };
    const res = await calculateRiskScoreWithML(inputWithBrokenML, brokenConfig);
    report(
      res.score === 68 && res.level === 'high',
      'Fallback to baseline calculation succeeds when ML models are unavailable (expected 68, high)',
      `got score: ${res.score}, level: ${res.level}`
    );
    report(
      res.mlEvidence.integrated === false,
      'mlEvidence reflects integrated: false when models are unavailable'
    );
  } catch (err) {
    report(false, 'Model unavailable fallback test threw error', err.message);
  }

  // Test 18: Score bounds verification under extreme inputs
  try {
    // Ultra-high inputs
    const extremeHigh = {
      rainfall: 9999,
      soilMoisture: 9999,
      ...validTerrain,
      ...validRainfallSeries
    };
    const resHigh = await calculateRiskScoreWithML(extremeHigh);
    report(
      resHigh.score <= 100 && resHigh.score >= 0,
      'Extreme high inputs clamped strictly to [0, 100]',
      `got: ${resHigh.score}`
    );

    // Negative inputs
    const extremeLow = {
      rainfall: -500,
      soilMoisture: -200,
      elevation_m: -10,
      slope_deg: 0,
      latitude: 27.35,
      longitude: 88.62,
      precipitation_event_day_mm: 0,
      precipitation_prev_24h_mm: 0,
      precipitation_prev_3d_mm: 0,
      precipitation_prev_7d_mm: 0,
      precipitation_prev_30d_mm: 0
    };
    const resLow = await calculateRiskScoreWithML(extremeLow);
    report(
      resLow.score >= 0 && resLow.score <= 100,
      'Extreme low/negative inputs clamped strictly to [0, 100]',
      `got: ${resLow.score}`
    );
  } catch (err) {
    report(false, 'Score bounds test threw error', err.message);
  }

  // Test 19: Response contains ML evidence and human explanation
  try {
    const input = {
      rainfall: 100,
      soilMoisture: 30,
      ...validTerrain,
      ...validRainfallSeries
    };
    const res = await calculateRiskScoreWithML(input);
    report(
      res.baselineScore !== undefined && typeof res.baselineScore === 'number',
      'Response explicitly exposes baselineScore'
    );
    report(
      typeof res.mlEvidence.explanation === 'string' && res.mlEvidence.explanation.length > 10,
      'Response provides clear human-readable explanation of fusion'
    );
  } catch (err) {
    report(false, 'Response schema check threw error', err.message);
  }

  // Test 20: Controller integration (HTTP handler contract)
  try {
    const mockRes = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    const mockReq = {
      body: {
        rainfall: 120,
        soilMoisture: 40,
        ...validTerrain
      }
    };
    await calculateRisk(mockReq, mockRes);
    report(
      mockRes.statusCode === 200 && mockRes.body?.riskAssessment?.mlEvidence?.integrated === true,
      'riskAssessmentController.calculateRisk returns 200 with enriched riskAssessment'
    );
  } catch (err) {
    report(false, 'Controller integration test threw error', err.message);
  }

  console.log(`\n========================================`);
  console.log(`Test Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
