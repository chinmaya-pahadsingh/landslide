/**
 * Satellite Land Cover Service & Integration Tests
 *
 * Covers:
 *   1. Valid coordinate normalization & land cover mapping
 *   2. Support for Sentinel-2 10m and ESA WorldCover class codes
 *   3. Invalid coordinate rejection (out of bounds, non-numeric, null/missing)
 *   4. Successful provider response handling
 *   5. Provider unavailable / network error resilience
 *   6. Timeout handling (isTimeout flag, safe failure)
 *   7. HTTP 429 rate limit handling (isRateLimited flag, safe failure)
 *   8. Strict data safety: unavailable/unknown data NEVER converted to a safe category or zero
 *   9. Truthful confidence: confidence is strictly null (never fabricated)
 *  10. Bounded cache behavior: hits, TTL, and clearCache
 *  11. In-flight request deduplication
 *  12. Controller handling for valid/invalid parameters
 *  13. Zero real external API calls executed during tests
 */

const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const { SatelliteLandCoverService } = require('./satelliteLandCoverService');
const {
  normalizeClass,
  CLASS_DEFINITIONS,
  fetchLandCover
} = require('./satelliteProviders/sentinel2LandCoverProvider');
const { getLandCover: getLandCoverController } = require('../controllers/satelliteController');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, testFn) {
  try {
    testFn();
    console.log(`  ✓ ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${testName}:`, err.message);
    failedTests++;
  }
}

async function runAsyncTest(testName, testFn) {
  try {
    await testFn();
    console.log(`  ✓ ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${testName}:`, err.message);
    failedTests++;
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('RUNNING STEP 54B SATELLITE LAND-COVER FOUNDATION TESTS');
  console.log('======================================================\n');

  // --- SUITE 1: Class Normalization & Category Mapping ---
  console.log('--- Suite 1: Satellite Land-Cover Classification Mapping ---');

  runTest('Maps Sentinel-2 Trees (code 2) to category "vegetation"', () => {
    const res = normalizeClass(2);
    assert.strictEqual(res.classCode, 2);
    assert.strictEqual(res.className, 'Trees');
    assert.strictEqual(res.category, 'vegetation');
  });

  runTest('Maps Sentinel-2 Bare Ground (code 8) to category "bare"', () => {
    const res = normalizeClass(8);
    assert.strictEqual(res.classCode, 8);
    assert.strictEqual(res.className, 'Bare Ground');
    assert.strictEqual(res.category, 'bare');
  });

  runTest('Maps Sentinel-2 Water (code 1) to category "water"', () => {
    const res = normalizeClass(1);
    assert.strictEqual(res.classCode, 1);
    assert.strictEqual(res.className, 'Water');
    assert.strictEqual(res.category, 'water');
  });

  runTest('Maps Sentinel-2 Crops (code 5) to category "cropland"', () => {
    const res = normalizeClass(5);
    assert.strictEqual(res.classCode, 5);
    assert.strictEqual(res.className, 'Crops');
    assert.strictEqual(res.category, 'cropland');
  });

  runTest('Maps Sentinel-2 Built Area (code 7) to category "built_up"', () => {
    const res = normalizeClass(7);
    assert.strictEqual(res.classCode, 7);
    assert.strictEqual(res.className, 'Built Area');
    assert.strictEqual(res.category, 'built_up');
  });

  runTest('Maps Sentinel-2 Clouds (code 10) to category "unknown"', () => {
    const res = normalizeClass(10);
    assert.strictEqual(res.classCode, 10);
    assert.strictEqual(res.className, 'Clouds');
    assert.strictEqual(res.category, 'unknown');
  });

  runTest('Maps ESA WorldCover Bare / Sparse (code 60) to category "bare"', () => {
    const res = normalizeClass(60);
    assert.strictEqual(res.classCode, 60);
    assert.strictEqual(res.category, 'bare');
  });

  runTest('Maps ESA WorldCover Grassland (code 30) to category "vegetation"', () => {
    const res = normalizeClass(30);
    assert.strictEqual(res.classCode, 30);
    assert.strictEqual(res.category, 'vegetation');
  });

  runTest('Unrecognized class code maps strictly to "unknown" category and null classCode', () => {
    const res = normalizeClass(999);
    assert.strictEqual(res.classCode, null);
    assert.strictEqual(res.category, 'unknown');
  });

  runTest('Empty or non-numeric class maps strictly to "unknown"', () => {
    const res = normalizeClass('NoData');
    assert.strictEqual(res.classCode, null);
    assert.strictEqual(res.category, 'unknown');
  });

  // --- SUITE 2: Coordinate Validation ---
  console.log('\n--- Suite 2: Coordinate Validation ---');

  const testService = new SatelliteLandCoverService();

  runTest('Rejects null or undefined coordinates', () => {
    const r1 = testService.validateCoordinates(null, 92.5);
    assert.strictEqual(r1.valid, false);
    const r2 = testService.validateCoordinates(26.1, undefined);
    assert.strictEqual(r2.valid, false);
  });

  runTest('Rejects non-numeric coordinate strings and NaN', () => {
    const r1 = testService.validateCoordinates('abc', 92.5);
    assert.strictEqual(r1.valid, false);
    const r2 = testService.validateCoordinates(26.1, NaN);
    assert.strictEqual(r2.valid, false);
  });

  runTest('Rejects out-of-range latitude (> 90 or < -90)', () => {
    const r1 = testService.validateCoordinates(91.5, 92.5);
    assert.strictEqual(r1.valid, false);
    const r2 = testService.validateCoordinates(-95.0, 92.5);
    assert.strictEqual(r2.valid, false);
  });

  runTest('Rejects out-of-range longitude (> 180 or < -180)', () => {
    const r1 = testService.validateCoordinates(26.1, 185.0);
    assert.strictEqual(r1.valid, false);
    const r2 = testService.validateCoordinates(26.1, -190.0);
    assert.strictEqual(r2.valid, false);
  });

  runTest('Accepts valid boundary coordinates', () => {
    const r1 = testService.validateCoordinates(90, 180);
    assert.strictEqual(r1.valid, true);
    const r2 = testService.validateCoordinates(-90, -180);
    assert.strictEqual(r2.valid, true);
    const r3 = testService.validateCoordinates(26.2005, 92.9376);
    assert.strictEqual(r3.valid, true);
  });

  // --- SUITE 3: Provider Fail-Safe & Normalization Behavior ---
  console.log('\n--- Suite 3: Provider Fail-Safe & Normalization Behavior ---');

  await runAsyncTest('Valid coordinate with successful provider returns normalized land-cover', async () => {
    const mockProvider = {
      fetchLandCover: async (lat, lon) => ({
        available: true,
        source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
        classCode: 2,
        className: 'Trees',
        category: 'vegetation',
        confidence: null,
        retrievedAt: new Date().toISOString()
      })
    };

    const service = new SatelliteLandCoverService(mockProvider);
    const result = await service.getLandCover(26.2, 92.93);

    assert.strictEqual(result.available, true);
    assert.strictEqual(result.classCode, 2);
    assert.strictEqual(result.className, 'Trees');
    assert.strictEqual(result.category, 'vegetation');
    assert.strictEqual(result.confidence, null);
    assert.ok(result.retrievedAt);
  });

  await runAsyncTest('Provider failure returns available: false and category: "unknown"', async () => {
    const mockProvider = {
      fetchLandCover: async () => ({
        available: false,
        source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
        classCode: null,
        className: null,
        category: 'unknown',
        confidence: null,
        retrievedAt: new Date().toISOString(),
        error: 'Network connection refused'
      })
    };

    const service = new SatelliteLandCoverService(mockProvider);
    const result = await service.getLandCover(26.2, 92.93);

    assert.strictEqual(result.available, false);
    assert.strictEqual(result.classCode, null);
    assert.strictEqual(result.className, null);
    assert.strictEqual(result.category, 'unknown');
    assert.strictEqual(result.confidence, null);
    assert.ok(result.error);
  });

  await runAsyncTest('Provider timeout returns isTimeout: true and category: "unknown"', async () => {
    const mockProvider = {
      fetchLandCover: async () => ({
        available: false,
        source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
        classCode: null,
        className: null,
        category: 'unknown',
        confidence: null,
        retrievedAt: new Date().toISOString(),
        error: 'Satellite provider request timed out',
        isTimeout: true
      })
    };

    const service = new SatelliteLandCoverService(mockProvider);
    const result = await service.getLandCover(26.2, 92.93);

    assert.strictEqual(result.available, false);
    assert.strictEqual(result.isTimeout, true);
    assert.strictEqual(result.category, 'unknown');
  });

  await runAsyncTest('HTTP 429 rate limit returns isRateLimited: true and category: "unknown"', async () => {
    const mockProvider = {
      fetchLandCover: async () => ({
        available: false,
        source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
        classCode: null,
        className: null,
        category: 'unknown',
        confidence: null,
        retrievedAt: new Date().toISOString(),
        error: 'Satellite provider rate limit exceeded (HTTP 429)',
        isRateLimited: true
      })
    };

    const service = new SatelliteLandCoverService(mockProvider);
    const result = await service.getLandCover(26.2, 92.93);

    assert.strictEqual(result.available, false);
    assert.strictEqual(result.isRateLimited, true);
    assert.strictEqual(result.category, 'unknown');
  });

  await runAsyncTest('DATA SAFETY: Missing or failed satellite data is NEVER converted to a safe category', async () => {
    const mockProvider = {
      fetchLandCover: async () => {
        throw new Error('Upstream satellite imagery offline');
      }
    };

    const service = new SatelliteLandCoverService(mockProvider);
    const result = await service.getLandCover(26.2, 92.93);

    assert.strictEqual(result.available, false);
    assert.strictEqual(result.category, 'unknown');
    assert.notStrictEqual(result.category, 'vegetation');
    assert.notStrictEqual(result.category, 'cropland');
    assert.strictEqual(result.classCode, null);
  });

  await runAsyncTest('DATA TRUTH: Confidence score is strictly null (never fabricated)', async () => {
    const mockProvider = {
      fetchLandCover: async () => ({
        available: true,
        source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
        classCode: 8,
        className: 'Bare Ground',
        category: 'bare',
        confidence: null,
        retrievedAt: new Date().toISOString()
      })
    };

    const service = new SatelliteLandCoverService(mockProvider);
    const result = await service.getLandCover(26.2, 92.93);

    assert.strictEqual(result.confidence, null);
    assert.strictEqual(typeof result.confidence, 'object'); // null is type object
  });

  // --- SUITE 4: Caching & Deduplication ---
  console.log('\n--- Suite 4: Caching & Request Deduplication ---');

  await runAsyncTest('In-memory cache returns cached response for repeated queries', async () => {
    let callCount = 0;
    const mockProvider = {
      fetchLandCover: async (lat, lon) => {
        callCount++;
        return {
          available: true,
          source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
          classCode: 2,
          className: 'Trees',
          category: 'vegetation',
          confidence: null,
          retrievedAt: new Date().toISOString()
        };
      }
    };

    const service = new SatelliteLandCoverService(mockProvider);

    // Call 1
    const res1 = await service.getLandCover(26.2001, 92.9301);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(res1.cached, undefined);

    // Call 2 with identical 4-decimal rounded coordinates
    const res2 = await service.getLandCover(26.2001, 92.9301);
    assert.strictEqual(callCount, 1); // Provider not called again
    assert.strictEqual(res2.cached, true);
    assert.strictEqual(res2.className, 'Trees');

    // Call 3 after clearCache
    service.clearCache();
    const res3 = await service.getLandCover(26.2001, 92.9301);
    assert.strictEqual(callCount, 2);
    assert.strictEqual(res3.cached, undefined);
  });

  await runAsyncTest('Concurrent requests for same coordinates are deduplicated to single provider call', async () => {
    let callCount = 0;
    const mockProvider = {
      fetchLandCover: async (lat, lon) => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          available: true,
          source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
          classCode: 8,
          className: 'Bare Ground',
          category: 'bare',
          confidence: null,
          retrievedAt: new Date().toISOString()
        };
      }
    };

    const service = new SatelliteLandCoverService(mockProvider);

    // Fire 3 simultaneous promises
    const [p1, p2, p3] = await Promise.all([
      service.getLandCover(27.1234, 88.5678),
      service.getLandCover(27.1234, 88.5678),
      service.getLandCover(27.1234, 88.5678)
    ]);

    assert.strictEqual(callCount, 1); // Exact deduplication
    assert.strictEqual(p1.className, 'Bare Ground');
    assert.strictEqual(p2.className, 'Bare Ground');
    assert.strictEqual(p3.className, 'Bare Ground');
  });

  // --- SUITE 5: Controller & API Validation ---
  console.log('\n--- Suite 5: Controller HTTP Handling ---');

  await runAsyncTest('Controller rejects missing query parameters with HTTP 400', async () => {
    const req = { query: {} };
    let responseStatus = null;
    let responseJson = null;

    const res = {
      status: (code) => {
        responseStatus = code;
        return res;
      },
      json: (data) => {
        responseJson = data;
        return res;
      }
    };

    await getLandCoverController(req, res);

    assert.strictEqual(responseStatus, 400);
    assert.strictEqual(responseJson.success, false);
    assert.ok(/required/i.test(responseJson.error));
  });

  await runAsyncTest('Controller rejects out-of-bounds coordinates with HTTP 400', async () => {
    const req = { query: { lat: '120.5', lon: '92.0' } };
    let responseStatus = null;
    let responseJson = null;

    const res = {
      status: (code) => {
        responseStatus = code;
        return res;
      },
      json: (data) => {
        responseJson = data;
        return res;
      }
    };

    await getLandCoverController(req, res);

    assert.strictEqual(responseStatus, 400);
    assert.strictEqual(responseJson.success, false);
    assert.ok(/out of bounds/i.test(responseJson.error));
  });

  await runAsyncTest('Controller handles valid coordinates and returns HTTP 200 with data', async () => {
    const req = { query: { lat: '26.20', lon: '92.93' } };
    let responseStatus = null;
    let responseJson = null;

    const res = {
      status: (code) => {
        responseStatus = code;
        return res;
      },
      json: (data) => {
        responseJson = data;
        return res;
      }
    };

    await getLandCoverController(req, res);

    assert.strictEqual(responseStatus, 200);
    assert.strictEqual(responseJson.success, true);
    assert.ok(responseJson.data);
    assert.strictEqual(typeof responseJson.data.available, 'boolean');
    assert.strictEqual(responseJson.data.confidence, null);
  });

  // --- SUITE 6: HTTP Route Authentication & Authorization ---
  console.log('\n--- Suite 6: HTTP Route Authentication & Access Protection ---');

  await runAsyncTest('GET /api/satellite/land-cover without token returns HTTP 401', async () => {
    const res = await request(app).get('/api/satellite/land-cover?lat=26.20&lon=92.93');
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error);
    assert.ok(/authentication required/i.test(res.body.error));
  });

  await runAsyncTest('GET /api/satellite/land-cover with malformed Bearer token returns HTTP 401', async () => {
    const res = await request(app)
      .get('/api/satellite/land-cover?lat=26.20&lon=92.93')
      .set('Authorization', 'Bearer invalid-token-signature');
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error);
    assert.ok(/invalid token/i.test(res.body.error));
  });

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: Total: ${passedTests + failedTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('Zero real external API calls were made in mock/resilience tests.');
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
