const { createFieldReport } = require('../controllers/fieldReportController');
const FieldReport = require('../models/FieldReport');

// Mock Mongoose Model
const dbStorage = new Map();

FieldReport.prototype.save = async function() {
  if (this.idempotencyKey && dbStorage.has(this.idempotencyKey)) {
    const error = new Error('Duplicate key error');
    error.code = 11000;
    error.keyPattern = { idempotencyKey: 1 };
    throw error;
  }
  
  const savedDoc = { ...this.toObject(), _id: 'fake-id-' + Date.now() + '-' + Math.random() };
  if (this.idempotencyKey) {
    dbStorage.set(this.idempotencyKey, savedDoc);
  }
  return savedDoc;
};

FieldReport.findOne = async function(query) {
  if (query.idempotencyKey && dbStorage.has(query.idempotencyKey)) {
    return dbStorage.get(query.idempotencyKey);
  }
  return null;
};

const mockRequest = (body, headers = {}) => ({ body, headers });

const mockResponse = () => {
  const res = { statusCode: 0, jsonData: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.jsonData = data; return res; };
  return res;
};

const runTests = async () => {
  let passed = 0;
  let failed = 0;

  const assert = (condition, label) => {
    if (condition) {
      console.log(`  PASS  ${label}`);
      passed++;
    } else {
      console.log(`  FAIL  ${label}`);
      failed++;
    }
  };

  console.log('=== Backend Idempotency Controller — Verification ===\n');

  const validReportData = {
    location: { latitude: 25, longitude: 90 },
    reportType: 'landslide',
    source: 'citizen'
  };

  // A. FIRST REQUEST
  const res1 = mockResponse();
  await createFieldReport(mockRequest(validReportData, { 'x-idempotency-key': 'key-1' }), res1);
  assert(res1.statusCode === 201, 'A. FIRST REQUEST: Creates exactly one Field Report with idempotency key (201)');

  // B. REPEATED REQUEST / C. RESPONSE-LOSS SCENARIO
  const res2 = mockResponse();
  await createFieldReport(mockRequest(validReportData, { 'x-idempotency-key': 'key-1' }), res2);
  assert(res2.statusCode === 200, 'B. REPEATED REQUEST / C. RESPONSE-LOSS: Same idempotency key safely returns existing report (200)');
  assert(res1.jsonData._id === res2.jsonData._id, 'Returned exactly the same document ID');

  // E. DIFFERENT KEYS
  const res3 = mockResponse();
  await createFieldReport(mockRequest(validReportData, { 'x-idempotency-key': 'key-2' }), res3);
  assert(res3.statusCode === 201, 'E. DIFFERENT KEYS: Creates distinct reports for distinct keys (201)');
  assert(res1.jsonData._id !== res3.jsonData._id, 'Distinct documents for distinct keys');

  // F. MISSING KEY
  const res4 = mockResponse();
  await createFieldReport(mockRequest(validReportData), res4);
  assert(res4.statusCode === 201, 'F. MISSING KEY: Preserves backward compatibility (creates successfully without key)');

  // G. INVALID KEY
  const res5 = mockResponse();
  await createFieldReport(mockRequest(validReportData, { 'x-idempotency-key': { invalid: true } }), res5);
  assert(res5.statusCode === 400, 'G. INVALID KEY: Gracefully rejects invalid formats (400)');
  assert(res5.jsonData.error && res5.jsonData.error.includes('format'), 'Returns appropriate invalid format error');

  console.log(`\n=== Total Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
};

runTests();
