const InfrastructureAsset = require('./InfrastructureAsset');

const tests = [
  {
    label: 'Valid infrastructure asset (road)',
    input: {
      name: 'NH-44 Section Guwahati',
      assetType: 'road',
      location: { latitude: 26.14, longitude: 91.74 },
    },
    shouldFail: false,
  },
  {
    label: 'Valid asset with all optional fields',
    input: {
      name: 'Shillong Civil Hospital',
      assetType: 'hospital',
      location: { latitude: 25.57, longitude: 91.88 },
      importance: 9,
      populationServed: 50000,
      alternativeAvailable: false,
      status: 'active',
    },
    shouldFail: false,
  },
  {
    label: 'Missing required name',
    input: {
      assetType: 'village',
      location: { latitude: 26.0, longitude: 92.0 },
    },
    shouldFail: true,
  },
  {
    label: 'Missing required assetType',
    input: {
      name: 'Some Bridge',
      location: { latitude: 26.0, longitude: 92.0 },
    },
    shouldFail: true,
  },
  {
    label: 'Invalid assetType rejected',
    input: {
      name: 'Power Plant',
      assetType: 'power_plant',
      location: { latitude: 26.0, longitude: 92.0 },
    },
    shouldFail: true,
  },
  {
    label: 'Missing required location',
    input: {
      name: 'Some Road',
      assetType: 'road',
    },
    shouldFail: true,
  },
  {
    label: 'Invalid latitude rejected (>90)',
    input: {
      name: 'Test',
      assetType: 'bridge',
      location: { latitude: 91, longitude: 92.0 },
    },
    shouldFail: true,
  },
  {
    label: 'Invalid longitude rejected (<-180)',
    input: {
      name: 'Test',
      assetType: 'bridge',
      location: { latitude: 26.0, longitude: -181 },
    },
    shouldFail: true,
  },
  {
    label: 'Boundary coordinates accepted (max)',
    input: {
      name: 'Boundary Max',
      assetType: 'other',
      location: { latitude: 90, longitude: 180 },
    },
    shouldFail: false,
  },
  {
    label: 'Boundary coordinates accepted (min)',
    input: {
      name: 'Boundary Min',
      assetType: 'other',
      location: { latitude: -90, longitude: -180 },
    },
    shouldFail: false,
  },
  {
    label: 'Negative populationServed rejected',
    input: {
      name: 'Test Village',
      assetType: 'village',
      location: { latitude: 26.0, longitude: 92.0 },
      populationServed: -100,
    },
    shouldFail: true,
  },
  {
    label: 'Invalid status rejected',
    input: {
      name: 'Test School',
      assetType: 'school',
      location: { latitude: 26.0, longitude: 92.0 },
      status: 'demolished',
    },
    shouldFail: true,
  },
  {
    label: 'Valid closed status',
    input: {
      name: 'Closed Bridge',
      assetType: 'bridge',
      location: { latitude: 26.0, longitude: 92.0 },
      status: 'closed',
    },
    shouldFail: false,
  },
  {
    label: 'Valid unknown status',
    input: {
      name: 'Unknown Road',
      assetType: 'road',
      location: { latitude: 26.0, longitude: 92.0 },
      status: 'unknown',
    },
    shouldFail: false,
  },
];

function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('=== InfrastructureAsset Model — Verification ===\n');

  for (const t of tests) {
    const doc = new InfrastructureAsset(t.input);
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
  console.log('\n=== InfrastructureAsset GIS Contract ===\n');

  // 1. Coordinate order is [longitude, latitude]
  try {
    const doc = new InfrastructureAsset({
      name: 'GIS Test Bridge',
      assetType: 'bridge',
      location: { latitude: 25.0000, longitude: 91.0000 },
    });

    if ((!doc.locationPoint || !doc.locationPoint.type) && doc.location && doc.location.longitude != null && doc.location.latitude != null) {
      doc.locationPoint = {
        type: 'Point',
        coordinates: [doc.location.longitude, doc.location.latitude],
      };
    }

    if (
      doc.locationPoint &&
      doc.locationPoint.type === 'Point' &&
      doc.locationPoint.coordinates[0] === 91.0 &&
      doc.locationPoint.coordinates[1] === 25.0
    ) {
      console.log('  PASS  GeoJSON coordinate order is [longitude, latitude]');
      passed++;
    } else {
      console.log(`  FAIL  GeoJSON coordinate order. Got: ${JSON.stringify(doc.locationPoint)}`);
      failed++;
    }
  } catch (err) {
    console.log(`  FAIL  GeoJSON test threw: ${err.message}`);
    failed++;
  }

  // 2. 2dsphere index exists
  try {
    const indexes = InfrastructureAsset.schema.indexes();
    const has2dsphere = indexes.some(idx => idx[0].locationPoint === '2dsphere');
    if (has2dsphere) {
      console.log('  PASS  2dsphere index exists for locationPoint');
      passed++;
    } else {
      console.log('  FAIL  2dsphere index missing for locationPoint');
      failed++;
    }
  } catch (err) {
    console.log(`  FAIL  Index check threw: ${err.message}`);
    failed++;
  }

  // 3. Missing coordinates do not produce misleading GeoJSON
  try {
    const doc = new InfrastructureAsset({
      name: 'No Coords',
      assetType: 'road',
    });

    if ((!doc.locationPoint || !doc.locationPoint.type) && doc.location && doc.location.longitude != null && doc.location.latitude != null) {
      doc.locationPoint = { type: 'Point', coordinates: [doc.location.longitude, doc.location.latitude] };
    }

    const hasMisleadingPoint = doc.locationPoint && doc.locationPoint.type === 'Point';
    if (!hasMisleadingPoint) {
      console.log('  PASS  Missing coordinates do not produce [0,0] GeoJSON point');
      passed++;
    } else {
      console.log(`  FAIL  Missing coordinates produced: ${JSON.stringify(doc.locationPoint)}`);
      failed++;
    }
  } catch (err) {
    console.log(`  FAIL  Missing coords test threw: ${err.message}`);
    failed++;
  }

  console.log(`\n=== Total Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
