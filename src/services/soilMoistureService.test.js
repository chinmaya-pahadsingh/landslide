const { processAndStoreSoilMoisture } = require('./soilMoistureService');
const SoilMoistureObservation = require('../models/SoilMoistureObservation');

// Mock save to prevent real DB connection during unit tests
const originalSave = SoilMoistureObservation.prototype.save;
SoilMoistureObservation.prototype.save = async function() {
  const err = this.validateSync();
  if (err) throw err;
  this._id = 'mocked_id_123';
  return this;
};

const tests = [
  {
    label: 'Valid soil moisture observation',
    input: { location: { latitude: 34, longitude: -118 }, soilMoisture: 45, source: 'satellite' },
    shouldFail: false
  },
  {
    label: 'Negative soil moisture rejected',
    input: { location: { latitude: 34, longitude: -118 }, soilMoisture: -10, source: 'satellite' },
    shouldFail: true
  },
  {
    label: 'Invalid latitude rejected',
    input: { location: { latitude: 91, longitude: -118 }, soilMoisture: 45, source: 'satellite' },
    shouldFail: true
  },
  {
    label: 'Invalid longitude rejected',
    input: { location: { latitude: 34, longitude: -181 }, soilMoisture: 45, source: 'satellite' },
    shouldFail: true
  },
  {
    label: 'Invalid soil moisture rejected (non-numeric)',
    input: { location: { latitude: 34, longitude: -118 }, soilMoisture: 'wet', source: 'satellite' },
    shouldFail: true
  },
  {
    label: 'Invalid recordedAt rejected',
    input: { location: { latitude: 34, longitude: -118 }, soilMoisture: 45, source: 'satellite', recordedAt: 'invalid-date-string' },
    shouldFail: true
  },
  {
    label: 'Invalid source rejected',
    input: { location: { latitude: 34, longitude: -118 }, soilMoisture: 45, source: 'unauthorized_api' },
    shouldFail: true
  }
];

async function runTests() {
  let passed = 0;
  let failed = 0;
  
  console.log('=== Soil Moisture Service — Verification ===\n');

  for (const t of tests) {
    try {
      await processAndStoreSoilMoisture(t.input);
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
  SoilMoistureObservation.prototype.save = originalSave;
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
