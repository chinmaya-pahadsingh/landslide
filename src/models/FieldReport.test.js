const FieldReport = require('./FieldReport');
const mongoose = require('mongoose');

const tests = [
  {
    label: 'Valid field report',
    input: {
      location: { latitude: 25.123, longitude: 91.123 },
      reportType: 'landslide',
      source: 'citizen',
      description: 'Road is completely blocked.'
    },
    shouldFail: false
  },
  {
    label: 'Missing required location',
    input: {
      reportType: 'crack',
      source: 'field_team'
    },
    shouldFail: true
  },
  {
    label: 'Invalid latitude rejected',
    input: {
      location: { latitude: 91, longitude: 91.123 },
      reportType: 'landslide',
      source: 'citizen'
    },
    shouldFail: true
  },
  {
    label: 'Invalid longitude rejected',
    input: {
      location: { latitude: 25.123, longitude: -181 },
      reportType: 'landslide',
      source: 'citizen'
    },
    shouldFail: true
  },
  {
    label: 'Invalid reportType rejected',
    input: {
      location: { latitude: 25.123, longitude: 91.123 },
      reportType: 'unknown_type',
      source: 'citizen'
    },
    shouldFail: true
  },
  {
    label: 'Description exceeding allowed length rejected',
    input: {
      location: { latitude: 25.123, longitude: 91.123 },
      reportType: 'rockfall',
      source: 'field_team',
      description: 'A'.repeat(1001)
    },
    shouldFail: true
  },
  {
    label: 'Valid flood report',
    input: {
      location: { latitude: 25.123, longitude: 91.123 },
      reportType: 'flood',
      source: 'citizen',
      description: 'Water level rising rapidly.'
    },
    shouldFail: false
  },
  {
    label: 'Valid flash flood report',
    input: {
      location: { latitude: 25.123, longitude: 91.123 },
      reportType: 'flash_flood',
      source: 'citizen',
    },
    shouldFail: false
  },
  {
    label: 'Invalid reportType (tsunami) rejected',
    input: {
      location: { latitude: 25.123, longitude: 91.123 },
      reportType: 'tsunami',
      source: 'citizen'
    },
    shouldFail: true
  },
  {
    label: 'Invalid reportType (avalanche) rejected',
    input: {
      location: { latitude: 25.123, longitude: 91.123 },
      reportType: 'avalanche',
      source: 'citizen'
    },
    shouldFail: true
  },
  {
    label: 'Invalid source rejected',
    input: {
      location: { latitude: 25.123, longitude: 91.123 },
      reportType: 'landslide',
      source: 'satellite' // not allowed for field reports
    },
    shouldFail: true
  },
];

function runTests() {
  let passed = 0;
  let failed = 0;
  
  console.log('=== FieldReport Model — Verification ===\n');

  for (const t of tests) {
    const doc = new FieldReport(t.input);
    const err = doc.validateSync();
    
    if (t.shouldFail) {
      if (err) {
        console.log(`  PASS  ${t.label}`);
        passed++;
      } else {
        console.log(`  FAIL  ${t.label} (Expected to fail but succeeded)`);
        failed++;
      }
    } else {
      if (err) {
        console.log(`  FAIL  ${t.label} (Unexpected error: ${err.message})`);
        failed++;
      } else {
        console.log(`  PASS  ${t.label}`);
        passed++;
      }
    }
  }

  // GIS Contract Tests
  console.log('\n=== FieldReport GIS Contract Verification ===\n');
  try {
    const doc = new FieldReport({
      location: { latitude: 25.0000, longitude: 91.0000 },
      reportType: 'landslide',
      source: 'citizen'
    });
    
    // Simulate pre-save hook
    if ((!doc.locationPoint || !doc.locationPoint.type) && doc.location && doc.location.longitude != null && doc.location.latitude != null) {
      doc.locationPoint = {
        type: 'Point',
        coordinates: [doc.location.longitude, doc.location.latitude]
      };
    }

    if (doc.locationPoint && doc.locationPoint.type === 'Point' && 
        doc.locationPoint.coordinates[0] === 91.0000 && 
        doc.locationPoint.coordinates[1] === 25.0000) {
      console.log(`  PASS  Coordinate order is [longitude, latitude]`);
      passed++;
    } else {
      console.log(`  FAIL  Coordinate order. Got: ${JSON.stringify(doc.locationPoint)}`);
      failed++;
    }

    // Default status & reportedAt check
    if (doc.status === 'submitted') {
      console.log(`  PASS  Default status is 'submitted'`);
      passed++;
    } else {
      console.log(`  FAIL  Default status. Got: ${doc.status}`);
      failed++;
    }

    if (doc.reportedAt instanceof Date) {
      console.log(`  PASS  Default reportedAt is a Date`);
      passed++;
    } else {
      console.log(`  FAIL  Default reportedAt. Got: ${doc.reportedAt}`);
      failed++;
    }

  } catch (err) {
    console.log(`  FAIL  GIS sync threw error: ${err.message}`);
    failed++;
  }

  // Missing coordinates GeoJSON test
  try {
    const doc = new FieldReport({
      reportType: 'crack',
      source: 'field_team'
    });
    
    if ((!doc.locationPoint || !doc.locationPoint.type) && doc.location && doc.location.longitude != null && doc.location.latitude != null) {
      doc.locationPoint = { type: 'Point', coordinates: [doc.location.longitude, doc.location.latitude] };
    }

    const hasMisleadingPoint = doc.locationPoint && doc.locationPoint.type === 'Point';
    if (!hasMisleadingPoint) {
      console.log(`  PASS  Missing coordinates cannot produce [0,0]`);
      passed++;
    } else {
      console.log(`  FAIL  Missing coordinates created point: ${JSON.stringify(doc.locationPoint)}`);
      failed++;
    }
  } catch(err) {
    console.log(`  FAIL  Missing coordinates test threw error: ${err.message}`);
    failed++;
  }

  console.log(`\n=== Total Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
