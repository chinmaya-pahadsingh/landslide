import sys
import json
import os
import math
from datetime import datetime, timezone

try:
    import xgboost as xgb
    import numpy as np
except ImportError:
    xgb = None
    np = None

EXPECTED_FEATURES = [
    'elevation_meters',
    'slope_degrees',
    'rainfall_24h_mm',
    'soil_moisture_index'
]
MODEL_VERSION = '1.0.0'
ARTIFACTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'artifacts')

def get_refused_response(reason):
    return {
        "status": "prediction_refused",
        "reason": reason,
        "modelVersion": None,
        "prediction": None,
        "limitations": [
            "Prediction cannot be made because the model is unavailable or invalid."
        ],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    }

def get_error_response(reason):
    return {
        "status": "error",
        "reason": reason,
        "modelVersion": None,
        "prediction": None,
        "limitations": [
            "An error occurred during prediction validation or execution."
        ],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    }

def predict(features_dict):
    """
    Validates features and loads the ML model to perform a prediction.
    Strictly enforcing data integrity and artifact verification without synthetic data.
    """
    # 1. Feature validation
    if not isinstance(features_dict, dict):
        return get_error_response("Features must be a dictionary.")

    for f in EXPECTED_FEATURES:
        if f not in features_dict:
            return get_error_response(f"Missing required feature: {f}")
        
        val = features_dict[f]
        if not isinstance(val, (int, float)):
            return get_error_response(f"Feature {f} must be numeric. Got: {type(val).__name__}")
        
        if math.isnan(val) or math.isinf(val):
            return get_error_response(f"Feature {f} cannot be NaN or Infinite.")

    # Reject any extra features
    extra_features = [k for k in features_dict.keys() if k not in EXPECTED_FEATURES]
    if extra_features:
        return get_error_response(f"Unexpected features provided: {extra_features}")

    # 2. Artifact discovery & validation
    model_path = os.path.join(ARTIFACTS_DIR, f'xgboost_model_v{MODEL_VERSION}.json')
    metadata_path = os.path.join(ARTIFACTS_DIR, f'model_metadata_v{MODEL_VERSION}.json')

    if not os.path.exists(model_path) or not os.path.exists(metadata_path):
        return get_refused_response("Model artifact or metadata unavailable.")

    try:
        with open(metadata_path, 'r') as mf:
            metadata = json.load(mf)
    except Exception as e:
        return get_refused_response(f"Metadata is invalid or corrupt: {str(e)}")

    if metadata.get('model_version') != MODEL_VERSION:
        return get_refused_response(f"Model version mismatch in metadata. Expected {MODEL_VERSION}.")

    if xgb is None:
        return get_refused_response("Required ML libraries missing.")

    # Load Model
    try:
        booster = xgb.Booster()
        booster.load_model(model_path)
    except Exception as e:
        return get_refused_response(f"Failed to load XGBoost model: {str(e)}")

    # 3. Predict
    # Construct feature array strictly in EXPECTED_FEATURES order
    X = np.array([[features_dict[f] for f in EXPECTED_FEATURES]])
    dmatrix = xgb.DMatrix(X, feature_names=EXPECTED_FEATURES)

    try:
        pred_prob = float(booster.predict(dmatrix)[0])
    except Exception as e:
        return get_error_response(f"Error during prediction computation: {str(e)}")

    threshold = metadata.get('classification_threshold', 0.5)
    pred_class = 1 if pred_prob >= threshold else 0

    return {
        "status": "success",
        "modelVersion": MODEL_VERSION,
        "prediction": {
            "probability": round(pred_prob, 6),
            "class": pred_class
        },
        "limitations": metadata.get('limitations', []),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    }

if __name__ == '__main__':
    # CLI entry point to pass features as JSON
    if len(sys.argv) < 2:
        print(json.dumps(get_error_response("Missing features JSON argument.")))
        sys.exit(1)
    
    try:
        features = json.loads(sys.argv[1])
        result = predict(features)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps(get_error_response(f"Unhandled execution error: {str(e)}")))
        sys.exit(1)
