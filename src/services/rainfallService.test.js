const { processAndStoreRainfall } = require('./rainfallService');
const RainfallObservation = require('../models/RainfallObservation');

// Mock save to prevent real DB connection during unit tests
const originalSave = RainfallObservation.prototype.save;
RainfallObservation.prototype.save = async function() {
  const err = this.validateSync();
  if (err) throw err;
  this._id = 'mocked_id_123';
  return this;
};

const tests = [
  {
    label: 'Valid rainfall observation',
    input: { location: { latitude: 34, longitude: -118 }, rainfall: 50, source: 'sensor' },
    shouldFail: false
  },
  {
    label: 'Negative rainfall rejected',
    input: { location: { latitude: 34, longitude: -118 }, rainfall: -10, source: 'sensor' },
    shouldFail: true
  },
  {
    label: 'Invalid latitude rejected',
    input: { location: { latitude: 91, longitude: -118 }, rainfall: 50, source: 'sensor' },
    shouldFail: true
  },
  {
    label: 'Invalid longitude rejected',
    input: { location: { latitude: 34, longitude: -181 }, rainfall: 50, source: 'sensor' },
    shouldFail: true
  },
  {
    label: 'Invalid rainfall rejected',
    input: { location: { latitude: 34, longitude: -118 }, rainfall: 'heavy', source: 'sensor' },
    shouldFail: true
  },
  {
    label: 'Invalid recordedAt rejected',
    input: { location: { latitude: 34, longitude: -118 }, rainfall: 50, source: 'sensor', recordedAt: 'invalid-date-string' },
    shouldFail: true
  },
  {
    label: 'Invalid source rejected',
    input: { location: { latitude: 34, longitude: -118 }, rainfall: 50, source: 'unauthorized_api' },
    shouldFail: true
  }
];

async function runTests() {
  let passed = 0;
  let failed = 0;
  
  console.log('=== Rainfall Service — Verification ===\n');

  for (const t of tests) {
    try {
      await processAndStoreRainfall(t.input);
      if (t.shouldFail) {
        console.log(`  FAIL  ${t.label} (Expected to fail but succeeded)`);
        failed++;
      } else {
        console.log(`  PASS  ${t.label}`);
        passed++;
      }
    } catch (err) {
      if (t.shouldFail && err.name === 'ValidationError') {
        console.log(`  PASS  ${t.label}`);
        passed++;
      } else {
        console.log(`  FAIL  ${t.label} (Unexpected error: ${err.message})`);
        failed++;
      }
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  
  // Restore original save
  RainfallObservation.prototype.save = originalSave;
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
