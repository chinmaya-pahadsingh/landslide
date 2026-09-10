#!/usr/bin/env python3
"""
Python Prediction Bridge for Trained XGBoost Models.
Loads native XGBoost JSON models and evaluates predictions for Node.js backend.
Strictly isolated, deterministic, and fail-safe.
"""

import sys
import json
import os
import math

try:
    import xgboost as xgb
    import numpy as np
except ImportError as e:
    xgb = None
    np = None
    _import_err = str(e)
else:
    _import_err = None

# Default paths relative to project root
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA_ML_DIR = os.path.join(BASE_DIR, 'data', 'ml')

DEFAULT_PATHS = {
    'susceptibility': os.path.join(DATA_ML_DIR, 'xgboost_susceptibility_model.json'),
    'trigger': os.path.join(DATA_ML_DIR, 'xgboost_trigger_model.json')
}

def predict_single(model_type, feature_values, model_path=None):
    if xgb is None or np is None:
        return {
            'status': 'error',
            'model': f'xgboost_{model_type}',
            'probability': None,
            'reason': f'XGBoost or NumPy library unavailable in Python environment: {_import_err}'
        }

    target_path = model_path or DEFAULT_PATHS.get(model_type)
    if not target_path or not os.path.exists(target_path):
        return {
            'status': 'error',
            'model': f'xgboost_{model_type}',
            'probability': None,
            'reason': f'Model artifact not found at {target_path}'
        }

    # Validate feature values array
    if not isinstance(feature_values, (list, tuple)):
        return {
            'status': 'error',
            'model': f'xgboost_{model_type}',
            'probability': None,
            'reason': f'Features must be a list of numeric values. Got {type(feature_values).__name__}'
        }

    for i, val in enumerate(feature_values):
        if val is None or not isinstance(val, (int, float)) or isinstance(val, bool):
            return {
                'status': 'error',
                'model': f'xgboost_{model_type}',
                'probability': None,
                'reason': f'Feature at index {i} is not a valid numeric value: {val}'
            }
        if math.isnan(val) or math.isinf(val):
            return {
                'status': 'error',
                'model': f'xgboost_{model_type}',
                'probability': None,
                'reason': f'Feature at index {i} is NaN or Infinite: {val}'
            }

    try:
        booster = xgb.Booster()
        booster.load_model(target_path)
    except Exception as err:
        return {
            'status': 'error',
            'model': f'xgboost_{model_type}',
            'probability': None,
            'reason': f'Failed to load XGBoost model from {target_path}: {str(err)}'
        }

    try:
        x_arr = np.array([feature_values], dtype=np.float32)
        dmatrix = xgb.DMatrix(x_arr)
        preds = booster.predict(dmatrix)
        raw_prob = float(preds[0])
        
        # Validate probability in [0, 1]
        if math.isnan(raw_prob) or math.isinf(raw_prob) or raw_prob < 0.0 or raw_prob > 1.0:
            return {
                'status': 'error',
                'model': f'xgboost_{model_type}',
                'probability': None,
                'reason': f'Model generated out-of-bounds probability: {raw_prob}'
            }

        return {
            'status': 'success',
            'model': f'xgboost_{model_type}',
            'probability': round(raw_prob, 6)
        }
    except Exception as err:
        return {
            'status': 'error',
            'model': f'xgboost_{model_type}',
            'probability': None,
            'reason': f'Inference execution error: {str(err)}'
        }

def check_status(susceptibility_path=None, trigger_path=None):
    s_path = susceptibility_path or DEFAULT_PATHS['susceptibility']
    t_path = trigger_path or DEFAULT_PATHS['trigger']

    res = {
        'status': 'success',
        'xgboost_available': (xgb is not None),
        'susceptibility': {'exists': os.path.exists(s_path), 'loadable': False, 'error': None},
        'trigger': {'exists': os.path.exists(t_path), 'loadable': False, 'error': None}
    }

    if xgb is not None:
        if res['susceptibility']['exists']:
            try:
                b1 = xgb.Booster()
                b1.load_model(s_path)
                res['susceptibility']['loadable'] = True
            except Exception as e:
                res['susceptibility']['error'] = str(e)
        if res['trigger']['exists']:
            try:
                b2 = xgb.Booster()
                b2.load_model(t_path)
                res['trigger']['loadable'] = True
            except Exception as e:
                res['trigger']['error'] = str(e)

    return res

def main():
    raw_input = None
    if len(sys.argv) > 1 and sys.argv[1] != '-':
        raw_input = sys.argv[1]
    else:
        raw_input = sys.stdin.read()

    if not raw_input or not raw_input.strip():
        output = {
            'status': 'error',
            'reason': 'Empty input payload provided to prediction bridge.'
        }
        print(json.dumps(output))
        sys.stdout.flush()
        sys.exit(0)

    try:
        req = json.loads(raw_input.strip())
    except Exception as e:
        output = {
            'status': 'error',
            'reason': f'Malformed JSON input to prediction bridge: {str(e)}'
        }
        print(json.dumps(output))
        sys.stdout.flush()
        sys.exit(0)

    action = req.get('action', 'predict')

    if action == 'status':
        result = check_status(
            susceptibility_path=req.get('susceptibility_path'),
            trigger_path=req.get('trigger_path')
        )
    elif action == 'predict':
        model_type = req.get('model', 'susceptibility')
        feature_values = req.get('features', [])
        model_path = req.get('model_path')
        result = predict_single(model_type, feature_values, model_path)
    elif action == 'predict_batch':
        # Batch of predictions
        requests = req.get('requests', [])
        results = []
        for r in requests:
            m_type = r.get('model', 'susceptibility')
            f_vals = r.get('features', [])
            m_path = r.get('model_path')
            results.append(predict_single(m_type, f_vals, m_path))
        result = {'status': 'success', 'results': results}
    else:
        result = {
            'status': 'error',
            'reason': f'Unknown action requested: {action}'
        }

    print(json.dumps(result))
    sys.stdout.flush()
    sys.exit(0)

if __name__ == '__main__':
    main()
