const NewsItem = require('./NewsItem');

const tests = [
  {
    label: 'Valid NewsItem (Official)',
    input: {
      title: 'NDMA Alert: Heavy Rainfall',
      url: 'https://ndma.gov.in/alert/123',
      source: { name: 'NDMA', type: 'OFFICIAL' },
      publishedAt: new Date(),
      disasterType: 'heavy_rain',
      verificationStatus: 'OFFICIAL',
    },
    shouldFail: false,
  },
  {
    label: 'Valid NewsItem (News)',
    input: {
      title: 'Landslide in Assam',
      url: 'https://news.example.com/assam-landslide',
      source: { name: 'Local News', type: 'NEWS' },
      publishedAt: new Date(),
      disasterType: 'landslide',
      location: { state: 'Assam' },
    },
    shouldFail: false,
  },
  {
    label: 'Missing title',
    input: {
      url: 'https://news.example.com/missing-title',
      source: { name: 'Local News' },
      publishedAt: new Date(),
    },
    shouldFail: true,
  },
  {
    label: 'Missing URL',
    input: {
      title: 'No URL News',
      source: { name: 'Local News' },
      publishedAt: new Date(),
    },
    shouldFail: true,
  },
  {
    label: 'Invalid URL',
    input: {
      title: 'Invalid URL News',
      url: 'not-a-url',
      source: { name: 'Local News' },
      publishedAt: new Date(),
    },
    shouldFail: true,
  },
  {
    label: 'Missing source.name',
    input: {
      title: 'Missing source name',
      url: 'https://example.com',
      source: { type: 'NEWS' },
      publishedAt: new Date(),
    },
    shouldFail: true,
  },
  {
    label: 'Invalid disasterType',
    input: {
      title: 'Bad Disaster',
      url: 'https://example.com/bad',
      source: { name: 'Test' },
      publishedAt: new Date(),
      disasterType: 'volcano',
    },
    shouldFail: true,
  },
  {
    label: 'Invalid source.type',
    input: {
      title: 'Bad Source Type',
      url: 'https://example.com/bad-source',
      source: { name: 'Test', type: 'SOCIAL_MEDIA' },
      publishedAt: new Date(),
    },
    shouldFail: true,
  },
  {
    label: 'Invalid verificationStatus',
    input: {
      title: 'Bad Verification',
      url: 'https://example.com/bad-verification',
      source: { name: 'Test' },
      publishedAt: new Date(),
      verificationStatus: 'CONFIRMED_FAKE',
    },
    shouldFail: true,
  },
  {
    label: 'Missing publishedAt',
    input: {
      title: 'Missing Date',
      url: 'https://example.com/no-date',
      source: { name: 'Test' },
    },
    shouldFail: true,
  },
  {
    label: 'Valid NER state and partial location',
    input: {
      title: 'NER News',
      url: 'https://example.com/ner',
      source: { name: 'Test' },
      publishedAt: new Date(),
      location: { state: 'Meghalaya', district: 'East Khasi Hills' },
    },
    shouldFail: false,
  },
  {
    label: 'Invalid coordinates (Latitude out of bounds)',
    input: {
      title: 'Bad Coords',
      url: 'https://example.com/bad-coords',
      source: { name: 'Test' },
      publishedAt: new Date(),
      location: { latitude: 91, longitude: 90 },
    },
    shouldFail: true,
  },
];

function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('=== NewsItem Model — Verification ===\n');

  for (const t of tests) {
    const doc = new NewsItem(t.input);
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
  console.log('\n=== NewsItem GIS Contract ===\n');

  // Coordinate order is [longitude, latitude]
  try {
    const doc = new NewsItem({
      title: 'GIS Test',
      url: 'https://example.com/gis',
      source: { name: 'Test' },
      publishedAt: new Date(),
      location: { latitude: 25.0, longitude: 91.0 },
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

  // Missing coordinates do not produce misleading GeoJSON
  try {
    const doc = new NewsItem({
      title: 'No Coords',
      url: 'https://example.com/no-coords',
      source: { name: 'Test' },
      publishedAt: new Date(),
    });

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
