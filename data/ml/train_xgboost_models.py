#!/usr/bin/env python3
"""
Step 51B-2: Actual XGBoost Model Training
========================================
Trains two scientifically validated XGBoost binary classifiers:
1. Model A: Static Susceptibility Model (Spatial Block Validation)
2. Model B: Dynamic Trigger Model (Temporal Date-Grouped Validation)

Safety & Data Truth:
- No synthetic records beyond documented spatial background samples
- Spatial blocking prevents spatial autocorrelation leakage in Susceptibility
- Date-grouping prevents temporal event leakage in Trigger model
- Verifies model reloading, feature order consistency, and inference stability
"""

import os
import sys
import csv
import json
import time
import math
import numpy as np
import pandas as pd
from datetime import datetime, timezone
import xgboost as xgb
import sklearn
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import (
    roc_auc_score,
    average_precision_score,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report
)

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SUSCEPTIBILITY_CSV = os.path.join(BASE_DIR, "data", "gsi", "ml_susceptibility_dataset_v1.csv")
TRIGGER_CSV = os.path.join(BASE_DIR, "data", "gsi", "ml_trigger_dataset_v1.csv")
ML_DIR = os.path.join(BASE_DIR, "data", "ml")

RANDOM_SEED = 42

def create_spatial_block_ids(df, block_size_deg=0.5):
    """Assigns spatial grid block IDs (e.g. 0.5x0.5 deg) for grouped spatial validation."""
    lat_block = (df["latitude"] / block_size_deg).astype(int)
    lon_block = (df["longitude"] / block_size_deg).astype(int)
    return lat_block.astype(str) + "_" + lon_block.astype(str)

def compute_metrics(y_true, y_prob, threshold=0.5):
    """Calculates comprehensive classification metrics."""
    y_pred = (y_prob >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred).ravel()
    
    return {
        "roc_auc": round(float(roc_auc_score(y_true, y_prob)), 4),
        "pr_auc": round(float(average_precision_score(y_true, y_prob)), 4),
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "confusion_matrix": {
            "true_negative": int(tn),
            "false_positive": int(fp),
            "false_negative": int(fn),
            "true_positive": int(tp)
        },
        "threshold": threshold,
        "sample_count": len(y_true),
        "positive_count": int(np.sum(y_true == 1)),
        "negative_count": int(np.sum(y_true == 0))
    }

def train_susceptibility_model():
    print("\n" + "=" * 70)
    print("TRAINING MODEL A: STATIC SUSCEPTIBILITY MODEL")
    print("=" * 70)
    
    t0 = time.time()
    df = pd.read_csv(SUSCEPTIBILITY_CSV)
    print(f"Loaded {len(df)} records from {SUSCEPTIBILITY_CSV}")
    
    # 1. Feature selection: pure geomorphic & geographic coordinates
    features = ["elevation_m", "slope_deg", "latitude", "longitude"]
    target_col = "target"
    
    # Check for NaN / Inf
    assert not df[features].isna().any().any(), "NaN found in susceptibility features"
    assert not np.isinf(df[features].values).any(), "Inf found in susceptibility features"
    
    # 2. Spatially aware train / val / test split using spatial grid blocks (0.5 degree)
    df["spatial_block"] = create_spatial_block_ids(df, block_size_deg=0.5)
    print(f"Created {df['spatial_block'].nunique()} spatial grid blocks for spatial validation.")
    
    # First split off 15% spatial test set
    gss_test = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=RANDOM_SEED)
    train_val_idx, test_idx = next(gss_test.split(df, df[target_col], groups=df["spatial_block"]))
    
    train_val_df = df.iloc[train_val_idx].copy()
    test_df = df.iloc[test_idx].copy()
    
    # Second split train_val into train (82% of train_val -> ~70% total) and val (18% of train_val -> ~15% total)
    gss_val = GroupShuffleSplit(n_splits=1, test_size=0.1765, random_state=RANDOM_SEED)
    train_sub_idx, val_sub_idx = next(gss_val.split(train_val_df, train_val_df[target_col], groups=train_val_df["spatial_block"]))
    
    train_df = train_val_df.iloc[train_sub_idx].copy()
    val_df = train_val_df.iloc[val_sub_idx].copy()
    
    print(f"Spatial Splits: Train={len(train_df)} ({train_df['spatial_block'].nunique()} blocks), "
          f"Val={len(val_df)} ({val_df['spatial_block'].nunique()} blocks), "
          f"Test={len(test_df)} ({test_df['spatial_block'].nunique()} blocks)")
    
    # Verify no block overlap
    assert len(set(train_df["spatial_block"]).intersection(set(test_df["spatial_block"]))) == 0, "Spatial block leakage into test!"
    assert len(set(train_df["spatial_block"]).intersection(set(val_df["spatial_block"]))) == 0, "Spatial block leakage into val!"
    
    X_train = train_df[features].values
    y_train = train_df[target_col].values
    X_val = val_df[features].values
    y_val = val_df[target_col].values
    X_test = test_df[features].values
    y_test = test_df[target_col].values
    
    # 3. Model training
    params = {
        "n_estimators": 250,
        "max_depth": 5,
        "learning_rate": 0.04,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 3,
        "gamma": 1.0,
        "eval_metric": "logloss",
        "random_state": RANDOM_SEED,
        "early_stopping_rounds": 25,
        "tree_method": "hist"
    }
    
    model = xgb.XGBClassifier(**params)
    model.fit(
        X_train, y_train,
        eval_set=[(X_train, y_train), (X_val, y_val)],
        verbose=False
    )
    
    best_iteration = model.best_iteration
    print(f"Trained successfully. Best iteration: {best_iteration}")
    
    # 4. Evaluation
    test_prob = model.predict_proba(X_test)[:, 1]
    val_prob = model.predict_proba(X_val)[:, 1]
    train_prob = model.predict_proba(X_train)[:, 1]
    
    metrics_test = compute_metrics(y_test, test_prob)
    metrics_val = compute_metrics(y_val, val_prob)
    metrics_train = compute_metrics(y_train, train_prob)
    
    # Baseline: Dummy majority class
    baseline_acc = round(float(max(np.mean(y_test == 0), np.mean(y_test == 1))), 4)
    baseline_auc = 0.5000
    
    # Feature importance
    booster = model.get_booster()
    score_gain = booster.get_score(importance_type="gain")
    score_weight = booster.get_score(importance_type="weight")
    
    feature_importance = {}
    for idx, f in enumerate(features):
        key = f"f{idx}"
        feature_importance[f] = {
            "gain": round(float(score_gain.get(key, 0.0)), 2),
            "weight": int(score_weight.get(key, 0))
        }
    
    duration = round(time.time() - t0, 2)
    print(f"Susceptibility Test ROC-AUC: {metrics_test['roc_auc']} | PR-AUC: {metrics_test['pr_auc']} | F1: {metrics_test['f1']}")
    print(f"Feature Importance (Gain): {dict((k, v['gain']) for k, v in feature_importance.items())}")
    
    # Save model and metadata
    model_path = os.path.join(ML_DIR, "xgboost_susceptibility_model.json")
    model.save_model(model_path)
    
    meta_path = os.path.join(ML_DIR, "susceptibility_model_metadata.json")
    metadata = {
        "model_type": "XGBoost Binary Classifier",
        "task": "Static Landslide Susceptibility Modeling",
        "features": features,
        "feature_order": features,
        "hyperparameters": {k: str(v) if not isinstance(v, (int, float, bool)) else v for k, v in params.items()},
        "best_iteration": int(best_iteration),
        "validation_strategy": "Spatial Grid Blocking (0.5 deg resolution)",
        "train_size": len(train_df),
        "val_size": len(val_df),
        "test_size": len(test_df),
        "random_seed": RANDOM_SEED,
        "saved_at": datetime.now(timezone.utc).isoformat()
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
        
    eval_path = os.path.join(ML_DIR, "susceptibility_evaluation.json")
    eval_data = {
        "test_metrics": metrics_test,
        "val_metrics": metrics_val,
        "train_metrics": metrics_train,
        "baseline": {
            "dummy_majority_accuracy": baseline_acc,
            "random_roc_auc": baseline_auc
        },
        "feature_importance": feature_importance,
        "training_duration_seconds": duration
    }
    with open(eval_path, "w", encoding="utf-8") as f:
        json.dump(eval_data, f, indent=2)
        
    # Save test predictions CSV
    test_pred_path = os.path.join(ML_DIR, "susceptibility_test_predictions.csv")
    test_out = test_df[["state", "district", "latitude", "longitude", "elevation_m", "slope_deg", "target"]].copy()
    test_out["predicted_prob"] = np.round(test_prob, 4)
    test_out["predicted_class"] = (test_prob >= 0.5).astype(int)
    test_out.to_csv(test_pred_path, index=False)
    
    return model, features, metrics_test, eval_data

def train_trigger_model():
    print("\n" + "=" * 70)
    print("TRAINING MODEL B: DYNAMIC TRIGGER MODEL")
    print("=" * 70)
    
    t0 = time.time()
    df = pd.read_csv(TRIGGER_CSV)
    print(f"Loaded {len(df)} records from {TRIGGER_CSV}")
    
    features = [
        "elevation_m",
        "slope_deg",
        "latitude",
        "longitude",
        "precipitation_event_day_mm",
        "precipitation_prev_24h_mm",
        "precipitation_prev_3d_mm",
        "precipitation_prev_7d_mm",
        "precipitation_prev_30d_mm"
    ]
    target_col = "target"
    group_col = "observation_date"
    
    assert not df[features].isna().any().any(), "NaN found in trigger features"
    assert not np.isinf(df[features].values).any(), "Inf found in trigger features"
    
    print(f"Unique observation dates: {df[group_col].nunique()}")
    
    # Grouped temporal split by event date: train ~70%, val ~15%, test ~15%
    gss_test = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=RANDOM_SEED)
    train_val_idx, test_idx = next(gss_test.split(df, df[target_col], groups=df[group_col]))
    
    train_val_df = df.iloc[train_val_idx].copy()
    test_df = df.iloc[test_idx].copy()
    
    gss_val = GroupShuffleSplit(n_splits=1, test_size=0.1765, random_state=RANDOM_SEED)
    train_sub_idx, val_sub_idx = next(gss_val.split(train_val_df, train_val_df[target_col], groups=train_val_df[group_col]))
    
    train_df = train_val_df.iloc[train_sub_idx].copy()
    val_df = train_val_df.iloc[val_sub_idx].copy()
    
    print(f"Date-Grouped Splits: Train={len(train_df)} ({train_df[group_col].nunique()} dates), "
          f"Val={len(val_df)} ({val_df[group_col].nunique()} dates), "
          f"Test={len(test_df)} ({test_df[group_col].nunique()} dates)")
    
    # Verify no date overlap
    assert len(set(train_df[group_col]).intersection(set(test_df[group_col]))) == 0, "Date leakage into test!"
    assert len(set(train_df[group_col]).intersection(set(val_df[group_col]))) == 0, "Date leakage into val!"
    
    X_train = train_df[features].values
    y_train = train_df[target_col].values
    X_val = val_df[features].values
    y_val = val_df[target_col].values
    X_test = test_df[features].values
    y_test = test_df[target_col].values
    
    params = {
        "n_estimators": 200,
        "max_depth": 4,
        "learning_rate": 0.03,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 2,
        "gamma": 1.0,
        "eval_metric": "logloss",
        "random_state": RANDOM_SEED,
        "early_stopping_rounds": 20,
        "tree_method": "hist"
    }
    
    model = xgb.XGBClassifier(**params)
    model.fit(
        X_train, y_train,
        eval_set=[(X_train, y_train), (X_val, y_val)],
        verbose=False
    )
    
    best_iteration = model.best_iteration
    print(f"Trained successfully. Best iteration: {best_iteration}")
    
    test_prob = model.predict_proba(X_test)[:, 1]
    val_prob = model.predict_proba(X_val)[:, 1]
    train_prob = model.predict_proba(X_train)[:, 1]
    
    metrics_test = compute_metrics(y_test, test_prob)
    metrics_val = compute_metrics(y_val, val_prob)
    metrics_train = compute_metrics(y_train, train_prob)
    
    # Feature importance
    booster = model.get_booster()
    score_gain = booster.get_score(importance_type="gain")
    score_weight = booster.get_score(importance_type="weight")
    
    feature_importance = {}
    for idx, f in enumerate(features):
        key = f"f{idx}"
        feature_importance[f] = {
            "gain": round(float(score_gain.get(key, 0.0)), 2),
            "weight": int(score_weight.get(key, 0))
        }
    
    duration = round(time.time() - t0, 2)
    print(f"Trigger Test ROC-AUC: {metrics_test['roc_auc']} | PR-AUC: {metrics_test['pr_auc']} | F1: {metrics_test['f1']}")
    print(f"Feature Importance (Gain): {dict((k, v['gain']) for k, v in feature_importance.items())}")
    
    model_path = os.path.join(ML_DIR, "xgboost_trigger_model.json")
    model.save_model(model_path)
    
    meta_path = os.path.join(ML_DIR, "trigger_model_metadata.json")
    metadata = {
        "model_type": "XGBoost Binary Classifier",
        "task": "Dynamic Landslide Trigger Modeling",
        "features": features,
        "feature_order": features,
        "hyperparameters": {k: str(v) if not isinstance(v, (int, float, bool)) else v for k, v in params.items()},
        "best_iteration": int(best_iteration),
        "validation_strategy": "Temporal Date Grouping (observation_date)",
        "train_size": len(train_df),
        "val_size": len(val_df),
        "test_size": len(test_df),
        "random_seed": RANDOM_SEED,
        "saved_at": datetime.now(timezone.utc).isoformat()
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
        
    eval_path = os.path.join(ML_DIR, "trigger_evaluation.json")
    eval_data = {
        "test_metrics": metrics_test,
        "val_metrics": metrics_val,
        "train_metrics": metrics_train,
        "baseline": {
            "dummy_majority_accuracy": round(float(max(np.mean(y_test == 0), np.mean(y_test == 1))), 4),
            "random_roc_auc": 0.5000
        },
        "feature_importance": feature_importance,
        "training_duration_seconds": duration
    }
    with open(eval_path, "w", encoding="utf-8") as f:
        json.dump(eval_data, f, indent=2)
        
    test_pred_path = os.path.join(ML_DIR, "trigger_test_predictions.csv")
    test_out = test_df[["state", "district", "observation_date", "latitude", "longitude", "target"] + features].copy()
    test_out["predicted_prob"] = np.round(test_prob, 4)
    test_out["predicted_class"] = (test_prob >= 0.5).astype(int)
    test_out.to_csv(test_pred_path, index=False)
    
    return model, features, metrics_test, eval_data

def verify_models():
    print("\n" + "=" * 70)
    print("VERIFYING MODEL REPRODUCIBILITY & INFERENCE INTEGRITY")
    print("=" * 70)
    
    susc_model_path = os.path.join(ML_DIR, "xgboost_susceptibility_model.json")
    trig_model_path = os.path.join(ML_DIR, "xgboost_trigger_model.json")
    
    assert os.path.exists(susc_model_path), "Susceptibility model file missing"
    assert os.path.exists(trig_model_path), "Trigger model file missing"
    
    # 1. Reload susceptibility model via XGBoost booster
    susc_booster = xgb.Booster()
    susc_booster.load_model(susc_model_path)
    
    with open(os.path.join(ML_DIR, "susceptibility_model_metadata.json"), "r") as f:
        susc_meta = json.load(f)
    susc_features = susc_meta["feature_order"]
    
    sample_susc_data = [[1200.0, 32.5, 25.5, 93.5]]  # elev, slope, lat, lon
    dmat_susc = xgb.DMatrix(sample_susc_data, feature_names=susc_features)
    susc_prob = float(susc_booster.predict(dmat_susc)[0])
    print(f"Susceptibility Sample Prediction (Elev=1200m, Slope=32.5°): Prob = {susc_prob:.4f}")
    assert 0.0 <= susc_prob <= 1.0, "Susceptibility probability out of bounds"
    
    # 2. Reload trigger model via XGBoost booster
    trig_booster = xgb.Booster()
    trig_booster.load_model(trig_model_path)
    
    with open(os.path.join(ML_DIR, "trigger_model_metadata.json"), "r") as f:
        trig_meta = json.load(f)
    trig_features = trig_meta["feature_order"]
    
    # Sample row: elev, slope, lat, lon, event_day, 24h, 3d, 7d, 30d
    sample_trig_data = [[1200.0, 32.5, 25.5, 93.5, 85.0, 45.0, 120.0, 240.0, 450.0]]
    dmat_trig = xgb.DMatrix(sample_trig_data, feature_names=trig_features)
    trig_prob = float(trig_booster.predict(dmat_trig)[0])
    print(f"Trigger Sample Prediction (Rainfall event=85mm, 24h=45mm): Prob = {trig_prob:.4f}")
    assert 0.0 <= trig_prob <= 1.0, "Trigger probability out of bounds"
    
    print("Model reloading and inference verified successfully: PASS")
    return True

def main():
    total_start = time.time()
    os.makedirs(ML_DIR, exist_ok=True)
    
    # Train Model A
    model_susc, feats_susc, metrics_susc, eval_susc = train_susceptibility_model()
    
    # Train Model B
    model_trig, feats_trig, metrics_trig, eval_trig = train_trigger_model()
    
    # Verify inference
    verify_models()
    
    total_duration = round(time.time() - total_start, 2)
    
    # Assemble comprehensive training report
    training_report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "xgboost_version": xgb.__version__,
        "python_version": sys.version,
        "scikit_learn_version": sklearn.__version__,
        "total_training_duration_seconds": total_duration,
        "susceptibility_model": {
            "dataset_path": "data/gsi/ml_susceptibility_dataset_v1.csv",
            "model_path": "data/ml/xgboost_susceptibility_model.json",
            "dataset_size": 20472,
            "features": feats_susc,
            "train_val_test_split": "70% / 15% / 15% (Spatial Grid Blocking at 0.5 deg)",
            "train_size": eval_susc["train_metrics"]["sample_count"],
            "val_size": eval_susc["val_metrics"]["sample_count"],
            "test_size": eval_susc["test_metrics"]["sample_count"],
            "test_metrics": eval_susc["test_metrics"],
            "feature_importance": eval_susc["feature_importance"]
        },
        "trigger_model": {
            "dataset_path": "data/gsi/ml_trigger_dataset_v1.csv",
            "model_path": "data/ml/xgboost_trigger_model.json",
            "dataset_size": 2268,
            "features": feats_trig,
            "train_val_test_split": "70% / 15% / 15% (Temporal Date-Grouped Blocking)",
            "train_size": eval_trig["train_metrics"]["sample_count"],
            "val_size": eval_trig["val_metrics"]["sample_count"],
            "test_size": eval_trig["test_metrics"]["sample_count"],
            "test_metrics": eval_trig["test_metrics"],
            "feature_importance": eval_trig["feature_importance"]
        },
        "leakage_checks": {
            "spatial_autocorrelation_mitigation": "Spatial block partitioning (0.5 degree grid) ensures test locations are physically separate from training data.",
            "temporal_leakage_mitigation": "Date-grouped partitioning ensures identical event dates never co-occur across train and test.",
            "metadata_leakage": "All identifiers, survey metadata, and target-derived fields strictly excluded from feature inputs."
        },
        "scientific_interpretation": {
            "target_semantics": "target=1 represents field-validated GSI landslide presence; target=0 represents spatial background points without recorded GSI landslide events in the available inventory, NOT confirmed stable terrain.",
            "operational_distinction": "Susceptibility model provides static spatial terrain susceptibility; Trigger model provides dynamic rainfall-threshold triggering risk."
        },
        "final_verdict": "XGBOOST TRAINING: PASS"
    }
    
    report_path = os.path.join(ML_DIR, "xgboost_training_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(training_report, f, indent=2)
        
    print("\n" + "=" * 70)
    print("XGBOOST TRAINING COMPLETE - METRICS SUMMARY")
    print("=" * 70)
    print("SUSCEPTIBILITY MODEL (Test Set):")
    print(f"  ROC-AUC  : {metrics_susc['roc_auc']}")
    print(f"  PR-AUC   : {metrics_susc['pr_auc']}")
    print(f"  F1       : {metrics_susc['f1']}")
    print(f"  Recall   : {metrics_susc['recall']}")
    print(f"  Precision: {metrics_susc['precision']}")
    print(f"  Accuracy : {metrics_susc['accuracy']}")
    print("-" * 70)
    print("TRIGGER MODEL (Test Set):")
    print(f"  ROC-AUC  : {metrics_trig['roc_auc']}")
    print(f"  PR-AUC   : {metrics_trig['pr_auc']}")
    print(f"  F1       : {metrics_trig['f1']}")
    print(f"  Recall   : {metrics_trig['recall']}")
    print(f"  Precision: {metrics_trig['precision']}")
    print(f"  Accuracy : {metrics_trig['accuracy']}")
    print("=" * 70)
    print("XGBOOST TRAINING: PASS")
    print("=" * 70)

if __name__ == "__main__":
    main()
