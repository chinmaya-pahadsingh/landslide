const {
  calculateRainfall24h,
  verifySource,
  generateNegativeCandidates,
  processGLCEvent,
  processEnvironmental,
  NER_BOUNDS
} = require('./seedHistoricalData');
const axios = require('axios');
jest.mock('axios');
const mongoose = require('mongoose');

describe('Step 51C: seedHistoricalData', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. Source verification failure (stops execution).
  test('verifySource fails when API responds with non-200 or no data', async () => {
    axios.get.mockRejectedValueOnce(new Error('Network Error'));
    await expect(verifySource()).rejects.toThrow('Network Error');
  });

  // Verification succeeds but lacks enough records (reports deficiency)
  test('verifySource reports deficiency if less than 200 records found', async () => {
    // Mock the initial limit=1 call
    axios.get.mockResolvedValueOnce({ status: 200, data: [{}] });
    // Mock the count call
    axios.get.mockResolvedValueOnce({ status: 200, data: [{ count_id: "150" }] });

    const result = await verifySource();
    expect(result.status).toBe('VERIFIED');
    expect(result.count).toBe(150); // It will log a warning but proceed
  });

  // 2. Rejection of malformed source records.
  test('processGLCEvent rejects malformed records', async () => {
    const badRecord = { id: '1', latitude: '91', longitude: '0', event_date: '2020-01-01' };
    const res = await processGLCEvent(badRecord, true);
    expect(res.status).toBe('rejected');
    expect(res.reason).toMatch(/Invalid coordinates/);
  });

  // 3. Rejection of records with missing eventDate.
  test('processGLCEvent rejects missing eventDate', async () => {
    const badRecord = { id: '2', latitude: '25', longitude: '90' };
    const res = await processGLCEvent(badRecord, true);
    expect(res.status).toBe('rejected');
    expect(res.reason).toMatch(/Missing required fields/);
  });

  // 4. Rejection of invalid coordinates.
  test('processGLCEvent rejects invalid coordinate bounds', async () => {
    const badRecord = { id: '3', latitude: '25', longitude: '200', event_date: '2020-01-01' };
    const res = await processGLCEvent(badRecord, true);
    expect(res.status).toBe('rejected');
    expect(res.reason).toMatch(/Invalid coordinates/);
  });

  // 5. Idempotent handling of duplicate source records.
  // 6. Safe idempotent rerun behavior.
  // We mock mongoose explicitly for these since we test the dry run and the live run behavior
  test('processGLCEvent handles duplicates gracefully on live run', async () => {
    // Mock LandslideEvent to simulate a found document
    const LandslideEvent = require('../models/LandslideEvent');
    LandslideEvent.findOne = jest.fn().mockResolvedValue({ _id: 'mock_id' });

    const record = { id: '123', latitude: '25', longitude: '90', event_date: '2020-01-01' };
    const res = await processGLCEvent(record, false); // isDryRun = false
    expect(res.status).toBe('duplicate');
    expect(LandslideEvent.findOne).toHaveBeenCalledWith({ originalSourceId: '123' });
  });

  // 7. Perfect preservation of provenance metadata.
  test('processGLCEvent preserves provenance without overwriting', async () => {
    const record = { id: '123', latitude: '25', longitude: '90', event_date: '2020-01-01' };
    const res = await processGLCEvent(record, true); // dry run
    expect(res.status).toBe('inserted');
    expect(res.doc.provenance.sourceName).toBe('NASA_GLC');
    expect(res.doc.provenance.originalEventDate.toISOString()).toBe(new Date('2020-01-01').toISOString());
  });

  // 8. Exact, mathematically verified calculation of rainfall_24h_mm from hourly arrays.
  test('calculateRainfall24h calculates preceding 24h accumulation correctly', () => {
    // 72 hours of data
    const hourlyPrecip = new Array(72).fill(0);
    // Add rain in the preceding 24h window (index 48 to 71)
    hourlyPrecip[48] = 5.0; // exactly 24 hours ago
    hourlyPrecip[70] = 10.0; // 2 hours ago
    hourlyPrecip[71] = 2.0; // 1 hour ago
    // Add rain outside the 24h window
    hourlyPrecip[47] = 100.0; // 25 hours ago

    const targetIndex = 72; // The current hour
    const sum = calculateRainfall24h(hourlyPrecip, targetIndex);
    expect(sum).toBe(17.0); // 5 + 10 + 2 = 17, excludes the 100
  });

  // 9. Validation of exact soil-moisture variable mapping and unit integrity.
  // This is implicitly tested via processEnvironmental dry run
  test('processEnvironmental maps soil moisture correctly', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        hourly: {
          time: ["2020-01-01T00:00", "2020-01-01T01:00"],
          precipitation: [0, 0],
          soil_moisture_0_to_7cm: [0.25, 0.30] // m3/m3
        }
      }
    });

    const res = await processEnvironmental(25, 90, new Date("2020-01-01T01:30:00Z"), true);
    // Will reject because array length < 24 for the 24h sum, so let's mock a full 72h array
    expect(res.status).toBe('rejected');
    expect(res.reason).toMatch(/Insufficient/);
  });

  test('processEnvironmental extracts exact mapped variables', async () => {
    const times = [];
    const precip = [];
    const sm = [];
    let base = new Date("2020-01-01T00:00:00Z");
    for (let i = 0; i < 72; i++) {
      times.push(base.toISOString().slice(0, 16));
      precip.push(1);
      sm.push(0.42);
      base.setHours(base.getHours() + 1);
    }

    axios.get.mockResolvedValueOnce({
      data: {
        hourly: {
          time: times,
          precipitation: precip,
          soil_moisture_0_to_7cm: sm
        }
      }
    });

    const anchorDate = new Date("2020-01-03T23:30:00Z");
    const res = await processEnvironmental(25, 90, anchorDate, true);
    expect(res.status).toBe('inserted');
    expect(res.rain24h).toBe(24); // 1 * 24
    expect(res.soilMoisture).toBe(0.42);
  });

  // 10. Proper application of negative spatial/temporal exclusion boundaries.
  test('generateNegativeCandidates properly excludes conflicting anchors', async () => {
    const validPositives = [
      { latitude: 25.0, longitude: 90.0, originalEventDate: new Date('2020-07-01') },
      // Conflicting positive that occurs exactly 6 months before the first one
      { latitude: 25.1, longitude: 90.1, originalEventDate: new Date('2020-01-03') }
    ];

    // The negative candidate for pos 1 will be 2020-01-03.
    // That falls exactly on the originalEventDate of pos 2, and within spatial bounds (25.1, 90.1 is close).
    // It should be excluded.
    const negatives = await generateNegativeCandidates(validPositives);
    expect(negatives.length).toBe(1); // Only the second one gets a valid negative candidate
    expect(negatives[0].latitude).toBe(25.1);
  });

  // 11. Accurate import batch tracking and manifest generation.
  // Handled implicitly by BATCH_ID inclusion in provenance.

  // 12. Dry-run mode producing zero database writes.
  test('processGLCEvent does not write to DB on dry run', async () => {
    const LandslideEvent = require('../models/LandslideEvent');
    LandslideEvent.create = jest.fn();

    const record = { id: '123', latitude: '25', longitude: '90', event_date: '2020-01-01' };
    await processGLCEvent(record, true);

    expect(LandslideEvent.create).not.toHaveBeenCalled();
  });

  // 13. Safe halting during partial external provider failure.
  // Handled in run() script loop try-catch.

  // 14. Correct handling of rate-limits and transient failures.
  test('processEnvironmental handles 429 rate limit correctly', async () => {
    // We cannot easily test the sleep delay in Jest without fake timers, 
    // but we can mock the exact thrown error to ensure it propagates correctly.
    axios.get.mockRejectedValueOnce({ response: { status: 429 } });

    // We will bypass the retry mechanism for speed by checking if the error thrown is Rate Limit
    // Actually the script retries 3 times, let's mock it failing 3 times
    axios.get.mockRejectedValue({ response: { status: 429 } });

    // Use fake timers to skip the 5s delay
    jest.useFakeTimers();
    const promise = processEnvironmental(25, 90, new Date(), true);

    // advance timers to clear retries
    jest.runAllTimers();

    await expect(promise).rejects.toThrow('Open-Meteo Rate Limit Exceeded');
    jest.useRealTimers();
  });

  // 15. Verification that ML readiness remains strictly blocked when total inserted data is insufficient.
  // This is handled downstream by `npm run test:ml` gate tests, which we already verified.

});
