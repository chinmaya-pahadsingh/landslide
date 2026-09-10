const { predictRisk, checkDataSufficiency, trainModel } = require('./mlRiskModelService');
const child_process = require('child_process');

jest.mock('child_process');

describe('ML Risk Model Service - predictRisk', () => {
  const validFeatures = {
    elevation_meters: 1000,
    slope_degrees: 30,
    rainfall_24h_mm: 50,
    soil_moisture_index: 0.8
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('1. should return success and prediction data when Python script returns success', async () => {
    child_process.execFile.mockImplementation((file, args, options, callback) => {
      callback(null, JSON.stringify({
        status: 'success',
        modelVersion: '1.0.0',
        prediction: {
          probability: 0.85,
          class: 1
        },
        limitations: ['test'],
        generatedAt: '2026-09-01T12:00:00Z'
      }), '');
    });

    const result = await predictRisk(validFeatures);
    expect(result.status).toBe('success');
    expect(result.prediction.probability).toBe(0.85);
    expect(result.prediction.class).toBe(1);
    expect(result.modelVersion).toBe('1.0.0');
    // Ensure riskLevel is NOT present
    expect(result.riskLevel).toBeUndefined();
  });

  it('2. should return prediction_refused when model is missing (Python returns refused)', async () => {
    child_process.execFile.mockImplementation((file, args, options, callback) => {
      callback(null, JSON.stringify({
        status: 'prediction_refused',
        reason: 'Model artifact not found'
      }), '');
    });

    const result = await predictRisk(validFeatures);
    expect(result.status).toBe('prediction_refused');
    expect(result.reason).toContain('Model artifact not found');
  });

  it('3. should refuse if elevation is missing (no zero substitution)', async () => {
    const features = { ...validFeatures, elevation_meters: null };
    const result = await predictRisk(features);
    expect(result.status).toBe('prediction_refused');
    expect(child_process.execFile).not.toHaveBeenCalled();
  });

  it('4. should refuse if rainfall is missing (no zero substitution)', async () => {
    const features = { ...validFeatures, rainfall_24h_mm: undefined };
    const result = await predictRisk(features);
    expect(result.status).toBe('prediction_refused');
    expect(child_process.execFile).not.toHaveBeenCalled();
  });

  it('5. should refuse if soil moisture is missing (no zero substitution)', async () => {
    const features = { ...validFeatures };
    delete features.soil_moisture_index;
    const result = await predictRisk(features);
    expect(result.status).toBe('prediction_refused');
    expect(child_process.execFile).not.toHaveBeenCalled();
  });

  it('6. should refuse if slope is NaN/Infinity', async () => {
    const features = { ...validFeatures, slope_degrees: NaN };
    const result = await predictRisk(features);
    expect(result.status).toBe('prediction_refused');

    const featuresInf = { ...validFeatures, slope_degrees: Infinity };
    const resultInf = await predictRisk(featuresInf);
    expect(resultInf.status).toBe('prediction_refused');
    expect(child_process.execFile).not.toHaveBeenCalled();
  });

  it('7. should handle malformed JSON from Python script cleanly', async () => {
    child_process.execFile.mockImplementation((file, args, options, callback) => {
      callback(null, 'Some weird python error or print statement', '');
    });

    const result = await predictRisk(validFeatures);
    expect(result.status).toBe('prediction_refused');
    expect(result.reason).toContain('Malformed JSON');
  });

  it('8. should isolate Python process failure / non-zero exit', async () => {
    child_process.execFile.mockImplementation((file, args, options, callback) => {
      callback(new Error('Command failed'), '', 'Python stack trace');
    });

    const result = await predictRisk(validFeatures);
    expect(result.status).toBe('prediction_refused');
    expect(result.reason).toContain('ML execution error');
  });

  it('9. should handle Python timeout cleanly', async () => {
    child_process.execFile.mockImplementation((file, args, options, callback) => {
      const err = new Error('Command failed');
      err.killed = true; // timeout killed the process
      callback(err, '', '');
    });

    const result = await predictRisk(validFeatures);
    expect(result.status).toBe('prediction_refused');
    expect(result.reason).toContain('ML process timed out');
  });
});
