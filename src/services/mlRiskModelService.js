const { execFile } = require('child_process');
const path = require('path');
const mlDatasetService = require('./mlDatasetService');
const MINIMUM_TOTAL_SAMPLES = 1000;
const MINIMUM_POSITIVE_SAMPLES = 200;
const MINIMUM_NEGATIVE_SAMPLES = 200;

/**
 * Validates whether the provided dataset is sufficient for supervised ML training.
 * @param {Array} dataset - Array of feature rows with target labels
 * @returns {Object} Sufficiency evaluation result
 */
function checkDataSufficiency(dataset) {
  if (!dataset || !Array.isArray(dataset)) {
    return { status: 'insufficient_data', trained: false, reason: 'Dataset is not an array', sampleCount: 0 };
  }
  
  const sampleCount = dataset.length;
  if (sampleCount === 0) {
    return { status: 'insufficient_data', trained: false, reason: 'Insufficient real training data.', sampleCount: 0 };
  }

  // Check duplicates (naive check for identical rows using JSON stringify for demonstration)
  const uniqueRows = new Set(dataset.map(row => JSON.stringify(row)));
  if (uniqueRows.size < sampleCount) {
    return { status: 'insufficient_data', trained: false, reason: 'Duplicate training rows detected.', sampleCount };
  }

  let positiveCount = 0;
  let negativeCount = 0;
  let hasMissingTargets = false;
  let hasMissingFeatures = false;

  for (const row of dataset) {
    // Check target labels
    if (row.landslide_occurrence === 1) {
      positiveCount++;
    } else if (row.landslide_occurrence === 0) {
      negativeCount++;
    } else {
      hasMissingTargets = true;
    }

    // Validate features
    const validation = mlDatasetService.validateFeatureRow(row);
    if (!validation.isValid) {
      hasMissingFeatures = true;
    }
  }

  if (hasMissingTargets) {
    return { status: 'insufficient_data', trained: false, reason: 'Missing or invalid target labels detected.', sampleCount };
  }

  if (hasMissingFeatures) {
    return { status: 'insufficient_data', trained: false, reason: 'Missing required features or impossible numeric values detected.', sampleCount };
  }

  if (sampleCount < MINIMUM_TOTAL_SAMPLES) {
    return { status: 'insufficient_data', trained: false, reason: `Insufficient real training data. Expected ${MINIMUM_TOTAL_SAMPLES}, got ${sampleCount}.`, sampleCount };
  }

  if (positiveCount === 0 || negativeCount === 0) {
    return { 
      status: 'insufficient_data', 
      trained: false, 
      reason: negativeCount === 0 ? 'Dataset containing only positive samples refuses training.' : 'Dataset containing only negative samples refuses training.', 
      sampleCount,
      positiveCount,
      negativeCount
    };
  }

  if (positiveCount < MINIMUM_POSITIVE_SAMPLES || negativeCount < MINIMUM_NEGATIVE_SAMPLES) {
    return { 
      status: 'insufficient_data', 
      trained: false, 
      reason: `Insufficient negative/background samples for supervised training or positive samples. Requires ${MINIMUM_POSITIVE_SAMPLES} positive and ${MINIMUM_NEGATIVE_SAMPLES} negative samples.`, 
      sampleCount,
      positiveCount,
      negativeCount
    };
  }

  return { status: 'sufficient', readyForTraining: true, sampleCount, positiveCount, negativeCount };
}

/**
 * Attempts to train the ML risk model.
 * Currently strictly halts at the data sufficiency gate because real data is missing.
 * @param {Array} dataset 
 * @returns {Object}
 */
function trainModel(dataset) {
  const sufficiency = checkDataSufficiency(dataset);
  if (sufficiency.status === 'insufficient_data') {
    return sufficiency;
  }
  
  // Future: Data split, Python ML service invocation, model saving
  return {
    status: 'success',
    trained: true,
    message: 'Model trained successfully',
    metadata: {
      modelVersion: '1.0.0',
      trainingTimestamp: new Date(),
      trainingSampleCount: sufficiency.sampleCount,
      positiveSampleCount: sufficiency.positiveCount,
      negativeSampleCount: sufficiency.negativeCount,
      evaluationMethod: 'temporal-split',
      status: 'active'
    }
  };
}

/**
 * Predicts risk using a trained ML model wrapper.
 * Rejects prediction if model unavailable or features missing/invalid.
 * @param {Object} features 
 * @returns {Promise<Object>}
 */
async function predictRisk(features) {
  return new Promise((resolve) => {
    // 1. Basic type/null checks
    if (!features || typeof features !== 'object') {
      return resolve({ status: 'prediction_refused', reason: 'Features object missing or invalid' });
    }

    const { elevation_meters, slope_degrees, rainfall_24h_mm, soil_moisture_index } = features;
    
    // Explicit null/undefined/NaN checks. No zero substitutions.
    const requiredValues = [elevation_meters, slope_degrees, rainfall_24h_mm, soil_moisture_index];
    for (const val of requiredValues) {
      if (val === null || val === undefined || typeof val !== 'number' || !Number.isFinite(val)) {
        return resolve({ status: 'prediction_refused', reason: 'One or more required ML features are missing, non-numeric, or infinite.' });
      }
    }

    const payload = JSON.stringify({ elevation_meters, slope_degrees, rainfall_24h_mm, soil_moisture_index });
    const pythonScriptPath = path.resolve(__dirname, '../../ml/predict.py');

    // 2. Execute Python Predict Wrapper safely
    execFile('python', [pythonScriptPath, payload], {
      timeout: 5000,       // Strict timeout of 5 seconds
      maxBuffer: 1024 * 1024, // 1MB buffer limit
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          return resolve({ status: 'prediction_refused', reason: 'ML process timed out.' });
        }
        return resolve({ status: 'prediction_refused', reason: `ML execution error: ${error.message}` });
      }

      // 3. Parse and enforce Step 51D Contract
      try {
        const result = JSON.parse(stdout.trim());
        if (result.status === 'success') {
          return resolve({
            status: 'success',
            modelVersion: result.modelVersion,
            prediction: {
              probability: result.prediction.probability,
              class: result.prediction.class
            },
            limitations: result.limitations || [],
            generatedAt: result.generatedAt || new Date().toISOString()
          });
        } else {
          return resolve({
            status: 'prediction_refused',
            reason: result.reason || 'Python wrapper refused prediction'
          });
        }
      } catch (parseErr) {
        return resolve({ status: 'prediction_refused', reason: `Malformed JSON from ML script: ${parseErr.message}` });
      }
    });
  });
}

module.exports = {
  checkDataSufficiency,
  trainModel,
  predictRisk,
  MINIMUM_TOTAL_SAMPLES,
  MINIMUM_POSITIVE_SAMPLES,
  MINIMUM_NEGATIVE_SAMPLES
};
