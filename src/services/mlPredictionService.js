/**
 * Isolated Backend Prediction Service for Trained XGBoost Models.
 * 
 * Responsible for:
 * 1. Managing metadata and feature ordering for Susceptibility and Trigger models.
 * 2. Strict input validation (no missing features, no NaNs/Infs, no fake zero conversions).
 * 3. Bounded, fail-safe invocation of native XGBoost via Python bridge.
 * 4. Model failure isolation (one model failing does not break the other).
 * 5. Sanitized health/status reporting (no sensitive filesystem paths exposed).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DATA_ML_DIR = path.join(PROJECT_ROOT, 'data', 'ml');

const DEFAULT_CONFIG = {
  susceptibilityModelPath: path.join(DATA_ML_DIR, 'xgboost_susceptibility_model.json'),
  susceptibilityMetadataPath: path.join(DATA_ML_DIR, 'susceptibility_model_metadata.json'),
  triggerModelPath: path.join(DATA_ML_DIR, 'xgboost_trigger_model.json'),
  triggerMetadataPath: path.join(DATA_ML_DIR, 'trigger_model_metadata.json'),
  bridgeScriptPath: path.join(__dirname, 'mlPredictBridge.py'),
  pythonBin: process.env.PYTHON_BIN || 'python',
  timeoutMs: 5000,
  maxBuffer: 1024 * 1024 // 1 MB
};

// Internal Singleton Cache for Metadata
let cachedMetadata = {
  susceptibility: null,
  trigger: null,
  loadedAt: null
};

/**
 * Loads and caches metadata from disk.
 * Authoritative source for feature definitions and feature ordering.
 */
function loadMetadata(config = DEFAULT_CONFIG) {
  const result = {
    susceptibility: null,
    trigger: null,
    errors: {}
  };

  // 1. Susceptibility metadata
  try {
    if (fs.existsSync(config.susceptibilityMetadataPath)) {
      const raw = fs.readFileSync(config.susceptibilityMetadataPath, 'utf-8');
      const parsed = JSON.parse(raw);
      result.susceptibility = {
        modelType: parsed.model_type,
        task: parsed.task,
        features: parsed.feature_order || parsed.features || [],
        featureCount: (parsed.feature_order || parsed.features || []).length,
        version: parsed.version || '1.0.0',
        available: true
      };
    } else {
      result.errors.susceptibility = 'Metadata file not found';
    }
  } catch (err) {
    result.errors.susceptibility = `Metadata parse error: ${err.message}`;
  }

  // 2. Trigger metadata
  try {
    if (fs.existsSync(config.triggerMetadataPath)) {
      const raw = fs.readFileSync(config.triggerMetadataPath, 'utf-8');
      const parsed = JSON.parse(raw);
      result.trigger = {
        modelType: parsed.model_type,
        task: parsed.task,
        features: parsed.feature_order || parsed.features || [],
        featureCount: (parsed.feature_order || parsed.features || []).length,
        version: parsed.version || '1.0.0',
        available: true
      };
    } else {
      result.errors.trigger = 'Metadata file not found';
    }
  } catch (err) {
    result.errors.trigger = `Metadata parse error: ${err.message}`;
  }

  cachedMetadata = {
    susceptibility: result.susceptibility,
    trigger: result.trigger,
    errors: result.errors,
    loadedAt: new Date().toISOString()
  };

  return cachedMetadata;
}

/**
 * Returns metadata cache, lazily initializing if not yet loaded.
 */
function getMetadata(config = DEFAULT_CONFIG) {
  if (!cachedMetadata.loadedAt) {
    return loadMetadata(config);
  }
  return cachedMetadata;
}

/**
 * Validates features against authoritative metadata feature order.
 * Strictly enforces:
 * - Object structure
 * - Presence of every required feature
 * - Finite numeric values
 * - Rejection of NaN, Infinity, null, undefined, strings, booleans
 * - NO zero substitution for missing data
 */
function validateFeatures(input, requiredFeatures) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      reason: 'Feature input must be a valid key-value object'
    };
  }

  if (!Array.isArray(requiredFeatures) || requiredFeatures.length === 0) {
    return {
      valid: false,
      reason: 'Model metadata has no required features defined'
    };
  }

  const orderedValues = [];
  const missing = [];
  const invalid = [];

  for (const feat of requiredFeatures) {
    if (!(feat in input)) {
      missing.push(feat);
      continue;
    }

    const val = input[feat];

    if (val === null || val === undefined) {
      invalid.push(`${feat} is null or undefined (zero-substitution is prohibited)`);
      continue;
    }

    if (typeof val !== 'number' || typeof val === 'boolean') {
      invalid.push(`${feat} must be numeric, got ${typeof val} (${val})`);
      continue;
    }

    if (Number.isNaN(val)) {
      invalid.push(`${feat} is NaN`);
      continue;
    }

    if (!Number.isFinite(val)) {
      invalid.push(`${feat} is Infinite`);
      continue;
    }

    orderedValues.push(val);
  }

  if (missing.length > 0) {
    return {
      valid: false,
      reason: `Missing required features: ${missing.join(', ')}`
    };
  }

  if (invalid.length > 0) {
    return {
      valid: false,
      reason: `Invalid feature values: ${invalid.join('; ')}`
    };
  }

  return {
    valid: true,
    orderedValues
  };
}

/**
 * Executes the Python bridge safely with bounded resources and clean process termination.
 */
function executePythonBridge(payload, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };

  return new Promise((resolve) => {
    const pythonBin = config.pythonBin;
    const scriptPath = config.bridgeScriptPath;
    const timeoutMs = config.timeoutMs || 5000;

    let timedOut = false;
    let timer = null;

    let child = null;
    try {
      child = spawn(pythonBin, [scriptPath, '-'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (spawnErr) {
      return resolve({
        status: 'error',
        reason: `Failed to spawn Python process: ${spawnErr.message}`
      });
    }

    let stdoutData = '';
    let stderrData = '';

    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch (e) {
        // Process might have already terminated
      }
      return resolve({
        status: 'error',
        reason: `ML prediction execution timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      if (stdoutData.length > config.maxBuffer) {
        try { child.kill('SIGKILL'); } catch (e) {}
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      return resolve({
        status: 'error',
        reason: `Python process error: ${err.message}`
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      if (code !== 0 && !stdoutData.trim()) {
        return resolve({
          status: 'error',
          reason: `Python process exited with code ${code}: ${stderrData.trim() || 'Unknown error'}`
        });
      }

      try {
        const parsed = JSON.parse(stdoutData.trim());
        return resolve(parsed);
      } catch (err) {
        return resolve({
          status: 'error',
          reason: `Failed to parse Python bridge output: ${err.message}. Raw: ${stdoutData.substring(0, 200)}`
        });
      }
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (writeErr) {
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch (e) {}
      return resolve({
        status: 'error',
        reason: `Failed to write payload to child process stdin: ${writeErr.message}`
      });
    }
  });
}

/**
 * Predicts static landslide susceptibility.
 * 
 * @param {Object} features - Must contain elevation_m, slope_deg, latitude, longitude
 * @param {Object} [options] - Optional configuration overrides
 * @returns {Promise<Object>} { probability, model: 'xgboost_susceptibility', status, reason? }
 */
async function predictSusceptibility(features, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const metadata = getMetadata(config);

  if (!metadata.susceptibility || !metadata.susceptibility.available) {
    return {
      probability: null,
      model: 'xgboost_susceptibility',
      status: 'unavailable',
      reason: metadata.errors?.susceptibility || 'Susceptibility model metadata is unavailable'
    };
  }

  // Model file existence check
  if (!fs.existsSync(config.susceptibilityModelPath)) {
    return {
      probability: null,
      model: 'xgboost_susceptibility',
      status: 'unavailable',
      reason: 'Susceptibility model artifact file is missing'
    };
  }

  const validation = validateFeatures(features, metadata.susceptibility.features);
  if (!validation.valid) {
    return {
      probability: null,
      model: 'xgboost_susceptibility',
      status: 'validation_error',
      reason: validation.reason
    };
  }

  const payload = {
    action: 'predict',
    model: 'susceptibility',
    features: validation.orderedValues,
    model_path: config.susceptibilityModelPath
  };

  const response = await executePythonBridge(payload, config);

  if (response.status === 'success') {
    const prob = response.probability;
    if (typeof prob !== 'number' || Number.isNaN(prob) || prob < 0.0 || prob > 1.0) {
      return {
        probability: null,
        model: 'xgboost_susceptibility',
        status: 'error',
        reason: `Model returned out-of-bounds probability: ${prob}`
      };
    }
    return {
      probability: prob,
      model: 'xgboost_susceptibility',
      status: 'success'
    };
  }

  return {
    probability: null,
    model: 'xgboost_susceptibility',
    status: response.status === 'error' ? 'error' : 'unavailable',
    reason: response.reason || 'Unknown inference failure'
  };
}

/**
 * Predicts dynamic landslide meteorological trigger.
 * 
 * @param {Object} features - Must contain 9 terrain & antecedent rainfall features
 * @param {Object} [options] - Optional configuration overrides
 * @returns {Promise<Object>} { probability, model: 'xgboost_trigger', status, reason? }
 */
async function predictTrigger(features, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const metadata = getMetadata(config);

  if (!metadata.trigger || !metadata.trigger.available) {
    return {
      probability: null,
      model: 'xgboost_trigger',
      status: 'unavailable',
      reason: metadata.errors?.trigger || 'Trigger model metadata is unavailable'
    };
  }

  // Model file existence check
  if (!fs.existsSync(config.triggerModelPath)) {
    return {
      probability: null,
      model: 'xgboost_trigger',
      status: 'unavailable',
      reason: 'Trigger model artifact file is missing'
    };
  }

  const validation = validateFeatures(features, metadata.trigger.features);
  if (!validation.valid) {
    return {
      probability: null,
      model: 'xgboost_trigger',
      status: 'validation_error',
      reason: validation.reason
    };
  }

  const payload = {
    action: 'predict',
    model: 'trigger',
    features: validation.orderedValues,
    model_path: config.triggerModelPath
  };

  const response = await executePythonBridge(payload, config);

  if (response.status === 'success') {
    const prob = response.probability;
    if (typeof prob !== 'number' || Number.isNaN(prob) || prob < 0.0 || prob > 1.0) {
      return {
        probability: null,
        model: 'xgboost_trigger',
        status: 'error',
        reason: `Model returned out-of-bounds probability: ${prob}`
      };
    }
    return {
      probability: prob,
      model: 'xgboost_trigger',
      status: 'success'
    };
  }

  return {
    probability: null,
    model: 'xgboost_trigger',
    status: response.status === 'error' ? 'error' : 'unavailable',
    reason: response.reason || 'Unknown inference failure'
  };
}

/**
 * Evaluates both models simultaneously without letting failure of one break the other.
 */
async function predictBoth(inputs, options = {}) {
  const susceptibilityInput = inputs?.susceptibility || inputs;
  const triggerInput = inputs?.trigger || inputs;

  const [susceptibility, trigger] = await Promise.all([
    predictSusceptibility(susceptibilityInput, options),
    predictTrigger(triggerInput, options)
  ]);

  return {
    susceptibility,
    trigger,
    generatedAt: new Date().toISOString(),
    modelVersion: '1.0.0'
  };
}

/**
 * Health and status reporting function.
 * Does NOT expose raw local filesystem paths.
 */
function getModelStatus(config = DEFAULT_CONFIG) {
  const metadata = getMetadata(config);

  const susceptibilityFileExists = fs.existsSync(config.susceptibilityModelPath);
  const triggerFileExists = fs.existsSync(config.triggerModelPath);

  return {
    service: 'ml_prediction_service',
    status: (susceptibilityFileExists && triggerFileExists) ? 'operational' : 'degraded',
    models: {
      susceptibility: {
        modelName: 'xgboost_susceptibility',
        loaded: susceptibilityFileExists && !!metadata.susceptibility?.available,
        available: susceptibilityFileExists,
        metadataAvailable: !!metadata.susceptibility?.available,
        featureCount: metadata.susceptibility?.featureCount || 0,
        features: metadata.susceptibility?.features || [],
        relativeModelPath: 'data/ml/xgboost_susceptibility_model.json'
      },
      trigger: {
        modelName: 'xgboost_trigger',
        loaded: triggerFileExists && !!metadata.trigger?.available,
        available: triggerFileExists,
        metadataAvailable: !!metadata.trigger?.available,
        featureCount: metadata.trigger?.featureCount || 0,
        features: metadata.trigger?.features || [],
        relativeModelPath: 'data/ml/xgboost_trigger_model.json'
      }
    },
    metadataLoadedAt: metadata.loadedAt
  };
}

/**
 * Force metadata cache reload (for testing or configuration change).
 */
function reloadMetadata(config = DEFAULT_CONFIG) {
  return loadMetadata(config);
}

module.exports = {
  predictSusceptibility,
  predictTrigger,
  predictBoth,
  getModelStatus,
  reloadMetadata,
  validateFeatures,
  executePythonBridge,
  DEFAULT_CONFIG
};
