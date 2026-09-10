import sys
import json
import os
import hashlib
from datetime import datetime

EXPECTED_FEATURES = [
    'observation_timestamp',
    'elevation_meters',
    'slope_degrees',
    'rainfall_24h_mm',
    'soil_moisture_index'
]
PREDICTIVE_FEATURES = [
    'elevation_meters',
    'slope_degrees',
    'rainfall_24h_mm',
    'soil_moisture_index'
]
TARGET_FEATURE = 'landslide_occurrence'
MODEL_VERSION = '1.0.0'
ARTIFACTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'artifacts')


def compute_dataset_fingerprint(data):
    """Compute a SHA-256 fingerprint of the sorted dataset JSON for traceability."""
    canonical = json.dumps(data, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def validate_dataset(data):
    """
    Validates the dataset against the strict readiness gates.
    Returns (valid_rows, report_dict) where valid_rows is the list of validated rows
    and report_dict contains counts and any failure reasons.
    """
    sample_count = len(data)
    positive_count = 0
    negative_count = 0
    invalid_sample_count = 0
    valid_rows = []

    unique_rows = set()

    for idx, row in enumerate(data):
        # Check required columns
        missing_cols = [f for f in EXPECTED_FEATURES if f not in row or row[f] is None]
        if missing_cols:
            print(f"Error: Row {idx} missing features: {missing_cols}")
            invalid_sample_count += 1
            continue

        if TARGET_FEATURE not in row or row[TARGET_FEATURE] is None:
            print(f"Error: Row {idx} missing target: {TARGET_FEATURE}")
            invalid_sample_count += 1
            continue

        # Check numeric types for everything except timestamp
        is_invalid = False
        for f in EXPECTED_FEATURES:
            if f == 'observation_timestamp':
                if not isinstance(row[f], str) or not row[f].strip():
                    print(f"Error: Row {idx} feature '{f}' must be a non-empty string timestamp.")
                    is_invalid = True
                    break
                continue

            if not isinstance(row[f], (int, float)):
                print(f"Error: Row {idx} feature '{f}' must be numeric.")
                is_invalid = True
                break

        if is_invalid:
            invalid_sample_count += 1
            continue

        target_val = row[TARGET_FEATURE]
        if target_val not in (0, 1):
            print(f"Error: Row {idx} target '{TARGET_FEATURE}' must be binary 0 or 1. Got: {target_val}")
            invalid_sample_count += 1
            continue

        # Deduplication check
        row_tuple = tuple(row[f] for f in EXPECTED_FEATURES)
        if row_tuple in unique_rows:
            pass
        unique_rows.add(row_tuple)

        if target_val == 1:
            positive_count += 1
        else:
            negative_count += 1

        valid_rows.append(row)

    duplicate_count = sample_count - len(unique_rows)

    report = {
        'sample_count': sample_count,
        'positive_count': positive_count,
        'negative_count': negative_count,
        'invalid_sample_count': invalid_sample_count,
        'duplicate_count': duplicate_count,
    }

    print("--- Dataset Readiness Report ---")
    print(f"Total Samples: {sample_count}")
    print(f"Positive Samples: {positive_count}")
    print(f"Negative Samples: {negative_count}")
    print(f"Invalid Samples: {invalid_sample_count}")
    print(f"Duplicate Features: {duplicate_count}")

    # Strong Training Gates
    failures = []
    if sample_count < 1000:
        failures.append("FAIL: sampleCount >= 1000")
    if positive_count < 200:
        failures.append("FAIL: positiveCount >= 200")
    if negative_count < 200:
        failures.append("FAIL: negativeCount >= 200")
    if duplicate_count > 0:
        failures.append("FAIL: duplicateCount == 0")
    if invalid_sample_count > 0:
        failures.append("FAIL: invalidSampleCount == 0")

    report['failures'] = failures
    return valid_rows, report


def chronological_split(data, train_ratio=0.8):
    """
    Splits data chronologically by observation_timestamp.
    Enforces the strict boundary rule: rows sharing the exact same timestamp
    are never split between train and test.

    Returns (train_data, test_data, boundary_timestamp).
    """
    # Sort by observation_timestamp ascending
    sorted_data = sorted(data, key=lambda r: r['observation_timestamp'])

    n = len(sorted_data)
    if n == 0:
        return [], [], None

    # Candidate split index at the 80% mark
    candidate_idx = int(n * train_ratio) - 1
    if candidate_idx < 0:
        candidate_idx = 0

    # Get the timestamp at the candidate boundary
    boundary_ts = sorted_data[candidate_idx]['observation_timestamp']

    # Advance the boundary forward: include ALL rows sharing the boundary timestamp in training
    split_idx = candidate_idx
    while split_idx + 1 < n and sorted_data[split_idx + 1]['observation_timestamp'] == boundary_ts:
        split_idx += 1

    # Train = [0, split_idx], Test = [split_idx+1, n-1]
    train_data = sorted_data[:split_idx + 1]
    test_data = sorted_data[split_idx + 1:]

    return train_data, test_data, boundary_ts


def validate_class_presence(train_data, test_data):
    """
    Validates that both partitions contain at least one positive and one negative sample.
    Returns (is_valid, reason).
    """
    train_pos = sum(1 for r in train_data if r[TARGET_FEATURE] == 1)
    train_neg = sum(1 for r in train_data if r[TARGET_FEATURE] == 0)
    test_pos = sum(1 for r in test_data if r[TARGET_FEATURE] == 1)
    test_neg = sum(1 for r in test_data if r[TARGET_FEATURE] == 0)

    if train_pos == 0 or train_neg == 0:
        return False, f"Train partition missing a class (pos={train_pos}, neg={train_neg})."
    if test_pos == 0 or test_neg == 0:
        return False, f"Test partition missing a class (pos={test_pos}, neg={test_neg})."

    return True, None


def train_xgboost(dataset_path):
    """
    Full training pipeline:
    1. Load and validate dataset
    2. Compute dataset fingerprint
    3. Chronological split with boundary rule
    4. Class-presence validation
    5. Train XGBoost with scale_pos_weight from train partition
    6. Evaluate on test set
    7. Save versioned artifacts
    """
    # --- Load ---
    if not os.path.exists(dataset_path):
        print(f"Error: Dataset file '{dataset_path}' not found.")
        print("TRAINING_REFUSED")
        sys.exit(1)

    try:
        with open(dataset_path, 'r') as f:
            data = json.load(f)
    except json.JSONDecodeError:
        print(f"Error: Dataset file '{dataset_path}' is not valid JSON.")
        print("TRAINING_REFUSED")
        sys.exit(1)

    # Handle wrapped format from mlDatasetService
    if isinstance(data, dict) and 'dataset' in data:
        data = data['dataset']

    if not isinstance(data, list):
        print("Error: Dataset must be a JSON array of feature rows.")
        print("TRAINING_REFUSED")
        sys.exit(1)

    # --- Validate ---
    valid_rows, report = validate_dataset(data)

    if report['failures']:
        for f in report['failures']:
            print(f)
        print("TRAINING_REFUSED")
        sys.exit(1)

    print("SUCCESS: Dataset is ready for training.")

    # --- Fingerprint ---
    fingerprint = compute_dataset_fingerprint(valid_rows)
    print(f"Dataset Fingerprint (SHA-256): {fingerprint}")

    # --- Chronological Split ---
    train_data, test_data, boundary_ts = chronological_split(valid_rows)

    if len(test_data) == 0:
        print("Error: Chronological split produced an empty test partition.")
        print("TRAINING_REFUSED")
        sys.exit(1)

    print(f"Chronological Split: train={len(train_data)}, test={len(test_data)}, boundary={boundary_ts}")

    # --- Class Presence ---
    class_valid, class_reason = validate_class_presence(train_data, test_data)
    if not class_valid:
        print(f"Error: {class_reason}")
        print("Chronological split produced a partition missing a required class. Training cannot proceed without modifying the split strategy, which is not permitted.")
        print("TRAINING_REFUSED")
        sys.exit(1)

    # --- Prepare Features ---
    # Import ML libraries only after validation passes (fail-fast for gate violations)
    try:
        import numpy as np
        import xgboost as xgb
        from sklearn.metrics import (
            roc_auc_score, average_precision_score,
            precision_score, recall_score, f1_score,
            confusion_matrix
        )
    except ImportError as e:
        print(f"Error: Required ML library not installed: {e}")
        print("TRAINING_REFUSED")
        sys.exit(1)

    def extract_features_and_target(rows):
        X = np.array([[r[f] for f in PREDICTIVE_FEATURES] for r in rows])
        y = np.array([r[TARGET_FEATURE] for r in rows])
        return X, y

    X_train, y_train = extract_features_and_target(train_data)
    X_test, y_test = extract_features_and_target(test_data)

    # --- Class Imbalance (from train partition only) ---
    train_pos = int(np.sum(y_train == 1))
    train_neg = int(np.sum(y_train == 0))
    scale_pos_weight = train_neg / train_pos if train_pos > 0 else 1.0

    print(f"Class Imbalance: train_pos={train_pos}, train_neg={train_neg}, scale_pos_weight={scale_pos_weight:.4f}")

    # --- Train ---
    model = xgb.XGBClassifier(
        objective='binary:logistic',
        eval_metric=['logloss', 'aucpr'],
        max_depth=4,
        learning_rate=0.1,
        n_estimators=100,
        scale_pos_weight=scale_pos_weight,
        random_state=42,
        seed=42
    )

    model.fit(X_train, y_train, verbose=False)

    # --- Evaluate ---
    y_pred_proba = model.predict_proba(X_test)[:, 1]
    y_pred = (y_pred_proba >= 0.5).astype(int)

    roc_auc = float(roc_auc_score(y_test, y_pred_proba))
    pr_auc = float(average_precision_score(y_test, y_pred_proba))
    precision = float(precision_score(y_test, y_pred, zero_division=0))
    recall = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    cm = confusion_matrix(y_test, y_pred)

    tn, fp, fn, tp = int(cm[0][0]), int(cm[0][1]), int(cm[1][0]), int(cm[1][1])

    print("--- Test Set Evaluation ---")
    print(f"ROC-AUC: {roc_auc:.4f}")
    print(f"PR-AUC (Average Precision): {pr_auc:.4f}")
    print(f"Precision (at 0.5): {precision:.4f}")
    print(f"Recall (at 0.5): {recall:.4f}")
    print(f"F1-Score (at 0.5): {f1:.4f}")
    print(f"Confusion Matrix: TP={tp}, FP={fp}, TN={tn}, FN={fn}")

    # --- Save Artifacts ---
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    model_path = os.path.join(ARTIFACTS_DIR, f'xgboost_model_v{MODEL_VERSION}.json')
    metadata_path = os.path.join(ARTIFACTS_DIR, f'model_metadata_v{MODEL_VERSION}.json')

    model.save_model(model_path)

    test_pos = int(np.sum(y_test == 1))
    test_neg = int(np.sum(y_test == 0))

    metadata = {
        'model_type': 'XGBoost Classifier',
        'model_version': MODEL_VERSION,
        'feature_names': PREDICTIVE_FEATURES,
        'training_timestamp': datetime.utcnow().isoformat() + 'Z',
        'dataset_fingerprint': fingerprint,
        'dataset_size': len(valid_rows),
        'train_size': len(train_data),
        'test_size': len(test_data),
        'positive_count_train': train_pos,
        'negative_count_train': train_neg,
        'positive_count_test': test_pos,
        'negative_count_test': test_neg,
        'scale_pos_weight': round(scale_pos_weight, 6),
        'split_boundary_timestamp': boundary_ts,
        'classification_threshold': 0.5,
        'classification_threshold_note': 'Initial technical threshold; not scientifically validated or operationally optimized.',
        'evaluation_metrics': {
            'roc_auc': round(roc_auc, 6),
            'pr_auc': round(pr_auc, 6),
            'precision': round(precision, 6),
            'recall': round(recall, 6),
            'f1_score': round(f1, 6),
            'confusion_matrix': {
                'true_negatives': tn,
                'false_positives': fp,
                'false_negatives': fn,
                'true_positives': tp
            }
        },
        'xgboost_params': {
            'objective': 'binary:logistic',
            'eval_metric': ['logloss', 'aucpr'],
            'max_depth': 4,
            'learning_rate': 0.1,
            'n_estimators': 100,
            'seed': 42
        },
        'limitations': [
            'This is a first baseline model and has not been scientifically validated.',
            'The 0.5 classification threshold is a technical default, not an optimized decision boundary.',
            'The model is not connected to any production API.',
            'Timestamps are never fabricated; all samples use truthful source timestamps.'
        ]
    }

    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"Model saved: {model_path}")
    print(f"Metadata saved: {metadata_path}")
    print("TRAINING_COMPLETE")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python train.py <path_to_dataset.json>")
        sys.exit(1)

    dataset_path = sys.argv[1]
    train_xgboost(dataset_path)
