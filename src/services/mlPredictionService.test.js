/**
 * Standalone Node.js Test Suite for mlPredictionService.js
 * 
 * Verifies:
 * 1. Successful susceptibility prediction
 * 2. Successful trigger prediction
 * 3. Probability range validation ([0, 1])
 * 4. Missing feature rejection (no zero substitution)
 * 5. NaN/Infinity/non-numeric rejection
 * 6. Model-load failure handling
 * 7. Metadata feature-order enforcement
 * 8. Model independence (one model failure does not break the other)
 * 
 * Runs deterministically with node test conventions.
 */

const assert = require('assert');
const path = require('path');
const {
  predictSusceptibility,
  predictTrigger,
  predictBoth,
  getModelStatus,
  validateFeatures,
  executePythonBridge,
  reloadMetadata,
  DEFAULT_CONFIG
} = require('./mlPredictionService');
const { getStatus, predict } = require('../controllers/mlPredictionController');
const mlRouter = require('../routes/mlRoutes');
const { authenticate } = require('../middleware/authMiddleware');

let passed = 0;
let failed = 0;

function report(condition, testName, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  FAIL: ${testName} ${detail ? `-> ${detail}` : ''}`);
  }
}

async function runTests() {
  console.log('=== ML Prediction Service Test Suite ===\n');

  // Ground truth inputs from actual NER terrain and rainfall distributions
  const validSusceptibilityInput = {
    elevation_m: 1450.0,
    slope_deg: 28.5,
    latitude: 27.35,
    longitude: 88.62
  };

  const validTriggerInput = {
    elevation_m: 1450.0,
    slope_deg: 28.5,
    latitude: 27.35,
    longitude: 88.62,
    precipitation_event_day_mm: 55.4,
    precipitation_prev_24h_mm: 62.1,
    precipitation_prev_3d_mm: 145.0,
    precipitation_prev_7d_mm: 230.5,
    precipitation_prev_30d_mm: 512.0
  };

  // Test 1: Successful susceptibility prediction
  console.log('--- Test 1: Successful Susceptibility Prediction ---');
  try {
    const res = await predictSusceptibility(validSusceptibilityInput);
    report(
      res.status === 'success' && res.model === 'xgboost_susceptibility',
      'Susceptibility prediction returns success status and correct model name'
    );
    report(
      typeof res.probability === 'number',
      'Susceptibility prediction returns numeric probability',
      `got ${typeof res.probability} (${res.probability})`
    );
  } catch (err) {
    report(false, 'Susceptibility prediction threw unexpected error', err.message);
  }

  // Test 2: Successful trigger prediction
  console.log('\n--- Test 2: Successful Trigger Prediction ---');
  try {
    const res = await predictTrigger(validTriggerInput);
    report(
      res.status === 'success' && res.model === 'xgboost_trigger',
      'Trigger prediction returns success status and correct model name'
    );
    report(
      typeof res.probability === 'number',
      'Trigger prediction returns numeric probability',
      `got ${typeof res.probability} (${res.probability})`
    );
  } catch (err) {
    report(false, 'Trigger prediction threw unexpected error', err.message);
  }

  // Test 3: Probability range validation [0, 1]
  console.log('\n--- Test 3: Probability Range Validation ---');
  try {
    const resSusc = await predictSusceptibility(validSusceptibilityInput);
    const resTrig = await predictTrigger(validTriggerInput);

    report(
      resSusc.probability >= 0.0 && resSusc.probability <= 1.0,
      'Susceptibility probability is strictly within [0, 1]',
      `probability: ${resSusc.probability}`
    );
    report(
      resTrig.probability >= 0.0 && resTrig.probability <= 1.0,
      'Trigger probability is strictly within [0, 1]',
      `probability: ${resTrig.probability}`
    );
  } catch (err) {
    report(false, 'Probability range check threw error', err.message);
  }

  // Test 4: Missing feature rejection (no silent zero conversion)
  console.log('\n--- Test 4: Missing Feature Rejection ---');
  try {
    // Missing slope_deg in susceptibility
    const missingSlope = { elevation_m: 1450.0, latitude: 27.35, longitude: 88.62 };
    const resMissingSlope = await predictSusceptibility(missingSlope);
    report(
      resMissingSlope.status === 'validation_error' && resMissingSlope.probability === null,
      'Susceptibility model rejects missing slope_deg without defaulting to zero'
    );
    report(
      resMissingSlope.reason.includes('Missing required features') && resMissingSlope.reason.includes('slope_deg'),
      'Susceptibility error message explicitly names missing slope_deg'
    );

    // Missing precipitation_prev_30d_mm in trigger
    const missing30d = { ...validTriggerInput };
    delete missing30d.precipitation_prev_30d_mm;
    const resMissing30d = await predictTrigger(missing30d);
    report(
      resMissing30d.status === 'validation_error' && resMissing30d.probability === null,
      'Trigger model rejects missing 30-day antecedent rainfall'
    );
    report(
      resMissing30d.reason.includes('precipitation_prev_30d_mm'),
      'Trigger error message explicitly specifies missing feature'
    );

    // Null values must NOT be treated as zero
    const nullVal = { ...validSusceptibilityInput, slope_deg: null };
    const resNull = await predictSusceptibility(nullVal);
    report(
      resNull.status === 'validation_error' && resNull.reason.includes('null or undefined'),
      'Null feature is explicitly rejected and not converted to zero'
    );
  } catch (err) {
    report(false, 'Missing feature rejection threw unexpected error', err.message);
  }

  // Test 5: NaN / Infinity / Non-numeric rejection
  console.log('\n--- Test 5: NaN / Infinity / Non-numeric Rejection ---');
  try {
    const nanInput = { ...validSusceptibilityInput, elevation_m: NaN };
    const resNaN = await predictSusceptibility(nanInput);
    report(
      resNaN.status === 'validation_error' && resNaN.reason.includes('NaN'),
      'Rejects NaN elevation with explicit validation error'
    );

    const infInput = { ...validTriggerInput, precipitation_event_day_mm: Infinity };
    const resInf = await predictTrigger(infInput);
    report(
      resInf.status === 'validation_error' && resInf.reason.includes('Infinite'),
      'Rejects Infinite rainfall value with explicit validation error'
    );

    const strInput = { ...validSusceptibilityInput, slope_deg: 'very_steep' };
    const resStr = await predictSusceptibility(strInput);
    report(
      resStr.status === 'validation_error' && resStr.reason.includes('must be numeric'),
      'Rejects string value where numeric is required'
    );

    const boolInput = { ...validSusceptibilityInput, slope_deg: true };
    const resBool = await predictSusceptibility(boolInput);
    report(
      resBool.status === 'validation_error' && resBool.reason.includes('must be numeric'),
      'Rejects boolean value where numeric is required'
    );
  } catch (err) {
    report(false, 'NaN/Inf rejection threw unexpected error', err.message);
  }

  // Test 6: Model-load failure handling
  console.log('\n--- Test 6: Model-Load Failure Handling ---');
  try {
    const missingModelPath = path.join(__dirname, 'non_existent_model_file.json');
    const resMissing = await predictSusceptibility(validSusceptibilityInput, {
      susceptibilityModelPath: missingModelPath
    });
    report(
      resMissing.status === 'unavailable' && resMissing.probability === null,
      'Returns clean unavailable status when model file is missing'
    );
    report(
      resMissing.reason.includes('missing') || resMissing.reason.includes('not found'),
      'Failure reason accurately describes missing model artifact'
    );
  } catch (err) {
    report(false, 'Model-load failure check threw error', err.message);
  }

  // Test 7: Metadata feature-order enforcement
  console.log('\n--- Test 7: Metadata Feature-Order Enforcement ---');
  try {
    const status = getModelStatus();
    report(
      status.models.susceptibility.features.length === 4,
      'Susceptibility model has exactly 4 ordered features in metadata'
    );
    report(
      status.models.trigger.features.length === 9,
      'Trigger model has exactly 9 ordered features in metadata'
    );

    // Verify ordering: even if object keys are provided in reverse order, validation orders them strictly
    const reversedKeys = {
      longitude: 88.62,
      latitude: 27.35,
      slope_deg: 28.5,
      elevation_m: 1450.0
    };
    const validated = validateFeatures(reversedKeys, status.models.susceptibility.features);
    report(
      validated.valid === true,
      'Reversed object keys are valid'
    );
    report(
      validated.orderedValues[0] === 1450.0 && validated.orderedValues[1] === 28.5 &&
      validated.orderedValues[2] === 27.35 && validated.orderedValues[3] === 88.62,
      'Feature values are ordered strictly by metadata order: [elevation_m, slope_deg, latitude, longitude]',
      `got: ${JSON.stringify(validated.orderedValues)}`
    );
  } catch (err) {
    report(false, 'Feature-order enforcement check threw error', err.message);
  }

  // Test 8: One-model failure not unnecessarily breaking the other
  console.log('\n--- Test 8: Independent Model Isolation ---');
  try {
    const brokenSuscConfig = {
      susceptibilityModelPath: path.join(__dirname, 'ghost_susceptibility.json')
    };

    const bothRes = await predictBoth(
      {
        susceptibility: validSusceptibilityInput,
        trigger: validTriggerInput
      },
      brokenSuscConfig
    );

    report(
      bothRes.susceptibility.status === 'unavailable',
      'Susceptibility model fails gracefully with unavailable status'
    );
    report(
      bothRes.trigger.status === 'success' && typeof bothRes.trigger.probability === 'number',
      'Trigger model remains fully functional and succeeds despite Susceptibility failure',
      `trigger prob: ${bothRes.trigger.probability}`
    );
    report(
      bothRes.susceptibility.probability === null && bothRes.trigger.probability !== null,
      'Failure of one model does not corrupt output of the other'
    );
  } catch (err) {
    report(false, 'Model isolation test threw error', err.message);
  }

  // Test 9: Sanitized Health Status (no sensitive filesystem paths)
  console.log('\n--- Test 9: Sanitized Health Status ---');
  try {
    const health = getModelStatus();
    report(
      health.status === 'operational',
      'Overall service status reports operational'
    );
    report(
      health.models.susceptibility.loaded === true && health.models.trigger.loaded === true,
      'Both susceptibility and trigger models report loaded in status'
    );
    
    // Ensure no absolute path leakage
    const healthStr = JSON.stringify(health);
    const hasDriveLetter = /[A-Za-z]:[\\\/]/.test(healthStr);
    report(
      !hasDriveLetter,
      'Health status does not leak local drive letters or server directory paths'
    );
  } catch (err) {
    report(false, 'Health status check threw error', err.message);
  }

  // Test 10: Controller getStatus handler
  console.log('\n--- Test 10: Controller getStatus Handler ---');
  try {
    const mockRes = {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.body = d; return this; }
    };
    await getStatus({}, mockRes);
    report(
      mockRes.statusCode === 200 && mockRes.body.status === 'operational',
      'mlPredictionController.getStatus returns 200 operational'
    );
  } catch (err) {
    report(false, 'Controller getStatus check threw error', err.message);
  }

  // Test 11: Controller predict validation and execution
  console.log('\n--- Test 11: Controller predict Handler ---');
  try {
    const mockResBad = {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.body = d; return this; }
    };
    await predict({ body: 'not-an-object' }, mockResBad);
    report(
      mockResBad.statusCode === 400 && mockResBad.body.error.includes('Invalid payload'),
      'mlPredictionController.predict returns 400 for non-object body'
    );

    const mockResGood = {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.body = d; return this; }
    };
    await predict({ body: validTriggerInput }, mockResGood);
    report(
      mockResGood.statusCode === 200 && mockResGood.body.susceptibility.status === 'success',
      'mlPredictionController.predict returns 200 with susceptibility prediction'
    );
    report(
      mockResGood.body.trigger.status === 'success' && mockResGood.body.modelVersion === '1.0.0',
      'mlPredictionController.predict returns 200 with trigger prediction and modelVersion'
    );
  } catch (err) {
    report(false, 'Controller predict check threw error', err.message);
  }

  // Test 12: Bounded Execution & Timeout Safety
  console.log('\n--- Test 12: Bounded Execution & Timeout Safety ---');
  try {
    const timeoutConfig = {
      timeoutMs: 1 // Extremely low timeout (1ms) to force bounded timeout handling
    };
    const resTimeout = await predictSusceptibility(validSusceptibilityInput, timeoutConfig);
    report(
      resTimeout.status === 'error' && resTimeout.reason.includes('timed out'),
      'Python bridge times out cleanly without hanging child processes',
      `reason: ${resTimeout.reason}`
    );
  } catch (err) {
    report(false, 'Bounded execution check threw error', err.message);
  }

  // Test 13: Route Authorization Policy Enforcement
  console.log('\n--- Test 13: Route Authorization Policy Enforcement ---');
  try {
    // Extract exact route stacks from mlRouter
    const predictLayer = mlRouter.stack.find(s => s.route?.path === '/predict');
    const statusLayer = mlRouter.stack.find(s => s.route?.path === '/status');

    // In /predict: layer 0 is limiter, layer 1 is authenticate, layer 2 is requireRole
    const predictAuthFn = predictLayer.route.stack[1].handle;
    const predictRoleFn = predictLayer.route.stack[2].handle;

    // In /status: layer 0 is authenticate, layer 1 is requireRole
    const statusAuthFn = statusLayer.route.stack[0].handle;
    const statusRoleFn = statusLayer.route.stack[1].handle;

    // Helper for testing middleware
    const runMiddleware = async (fn, req) => {
      let nextCalled = false;
      const res = {
        statusCode: null,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(d) { this.body = d; return this; }
      };
      await fn(req, res, () => { nextCalled = true; });
      return { nextCalled, statusCode: res.statusCode, body: res.body };
    };

    // 1. Unauthenticated requests are rejected (401)
    const unauthPredict = await runMiddleware(predictAuthFn, { headers: {} });
    report(
      !unauthPredict.nextCalled && unauthPredict.statusCode === 401,
      'Unauthenticated request to POST /predict is rejected with 401'
    );

    const unauthStatus = await runMiddleware(statusAuthFn, { headers: {} });
    report(
      !unauthStatus.nextCalled && unauthStatus.statusCode === 401,
      'Unauthenticated request to GET /status is rejected with 401'
    );

    // 2. Admin can access both endpoints
    const adminPredict = await runMiddleware(predictRoleFn, { user: { role: 'admin' } });
    report(adminPredict.nextCalled === true, 'Admin role is allowed access to POST /predict');

    const adminStatus = await runMiddleware(statusRoleFn, { user: { role: 'admin' } });
    report(adminStatus.nextCalled === true, 'Admin role is allowed access to GET /status');

    // 3. Authority can access both endpoints
    const authPredict = await runMiddleware(predictRoleFn, { user: { role: 'authority' } });
    report(authPredict.nextCalled === true, 'Authority role is allowed access to POST /predict');

    const authStatus = await runMiddleware(statusRoleFn, { user: { role: 'authority' } });
    report(authStatus.nextCalled === true, 'Authority role is allowed access to GET /status');

    // 4. Field team is rejected from both endpoints (403)
    const fieldPredict = await runMiddleware(predictRoleFn, { user: { role: 'field_team' } });
    report(
      !fieldPredict.nextCalled && fieldPredict.statusCode === 403 && fieldPredict.body.error.includes('Access denied'),
      'field_team is rejected from POST /predict with 403 Access Denied'
    );

    const fieldStatus = await runMiddleware(statusRoleFn, { user: { role: 'field_team' } });
    report(
      !fieldStatus.nextCalled && fieldStatus.statusCode === 403 && fieldStatus.body.error.includes('Access denied'),
      'field_team is rejected from GET /status with 403 Access Denied'
    );

    // 5. Citizen is rejected from both endpoints (403)
    const citizenPredict = await runMiddleware(predictRoleFn, { user: { role: 'citizen' } });
    report(
      !citizenPredict.nextCalled && citizenPredict.statusCode === 403 && citizenPredict.body.error.includes('Access denied'),
      'citizen is rejected from POST /predict with 403 Access Denied'
    );

    const citizenStatus = await runMiddleware(statusRoleFn, { user: { role: 'citizen' } });
    report(
      !citizenStatus.nextCalled && citizenStatus.statusCode === 403 && citizenStatus.body.error.includes('Access denied'),
      'citizen is rejected from GET /status with 403 Access Denied'
    );
  } catch (err) {
    report(false, 'Route authorization policy test threw unexpected error', err.message);
  }

  console.log(`\n========================================`);
  console.log(`Test Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  return { passed, failed };
}

if (typeof describe === 'function') {
  describe('mlPredictionService Test Suite', () => {
    test('all ML prediction service verification tests pass', async () => {
      const result = await runTests();
      assert.strictEqual(result.failed, 0, `${result.failed} test(s) failed`);
    }, 60000);
  });
} else {
  runTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  }).catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  });
}

