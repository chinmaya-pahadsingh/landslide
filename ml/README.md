# Landslide Risk Monitoring - ML Training Pipeline

## Purpose
This directory (`ml/`) isolates the Python-based Machine Learning environment from the Node.js backend system. It is strictly dedicated to dataset validation, model training (XGBoost), and model artifact generation.

## Dataset Contract
The Python pipeline expects a strictly structured JSON dataset from the Node.js backend (`mlDatasetService.js`) with the following features:
- `observation_timestamp` (ISO 8601 String) - A truthful source timestamp preserved for temporal validation. Never fabricated. **Not used as a predictive feature.**
- `elevation_meters` (Numeric)
- `slope_degrees` (Numeric, 0-90)
- `rainfall_24h_mm` (Numeric)
- `soil_moisture_index` (Numeric)

**Target Variable:**
- `landslide_occurrence` (Binary: 0 or 1)

**Strict Feature Exclusions:**
- `observation_timestamp` is used only for temporal ordering and the chronological train/test split. It is dropped before training.
- `latitude` and `longitude` remain metadata and are never used as predictive features.

## Training Readiness Gate
The pipeline strictly enforces the following readiness conditions before ANY training begins:
- **`sampleCount >= 1000`**
- **`positiveCount >= 200`**
- **`negativeCount >= 200`**
- **`duplicateCount === 0`**
- **`invalidSampleCount === 0`**
- No missing values or schema deviations.

If any gate fails, training is refused with status `TRAINING_REFUSED` and **no model artifact is created**.

## Temporal Split Strategy (Step 51B-2)
- The dataset is sorted chronologically by `observation_timestamp`.
- The first ~80% of rows form the **training set**; the remaining ~20% form the **test set**.
- **Strict Boundary Rule:** Rows sharing the exact same `observation_timestamp` are never split between train and test. All rows with the boundary timestamp are placed entirely in the training set.
- **Class-Presence Validation:** Both train and test partitions must contain at least one positive and one negative sample. If the chronological split cannot satisfy this, training is refused — the split strategy is never changed to accommodate this (no random fallback, no stratification).
- Random splitting is never used.

## Class Imbalance
- `scale_pos_weight` is computed from the **training partition only** as `count(negative_train) / count(positive_train)`.
- The test set distribution never influences training configuration.

## XGBoost Model Configuration
| Parameter | Value |
|-----------|-------|
| `objective` | `binary:logistic` |
| `eval_metric` | `['logloss', 'aucpr']` |
| `max_depth` | 4 |
| `learning_rate` | 0.1 |
| `n_estimators` | 100 |
| `seed` | 42 |

## Evaluation Metrics (Test Set)
- **ROC-AUC** (threshold-independent)
- **PR-AUC / Average Precision** (threshold-independent)
- **Precision, Recall, F1-Score** (at threshold=0.5)
- **Confusion Matrix** (TP, FP, TN, FN)

The 0.5 classification threshold is an initial technical default and has **not** been scientifically validated or operationally optimized.

## Artifacts
After successful training, two versioned files are created in `ml/artifacts/`:
- `xgboost_model_v1.0.0.json` — Serialized XGBoost model.
- `model_metadata_v1.0.0.json` — Training provenance, evaluation results, dataset fingerprint (SHA-256), and explicit limitations.

The dataset fingerprint (SHA-256 of the sorted JSON) ensures exact traceability of the dataset used for training.

## Usage
```bash
# Validate dataset and train model
python ml/train.py <path_to_dataset.json>

# Run tests
python ml/test_train.py          # Step 51B-1 validation tests
python ml/test_train_model.py    # Step 51B-2 training tests
```

## Status (Step 51B-2)
- Step 51B-2 implements the first real XGBoost model training pipeline.
- Real historical and environmental data is strictly required.
- The pipeline will never fabricate, invent, or synthetically inflate the dataset.
- The `observation_timestamp` must be a truthful historical timestamp (e.g. event time or sensor observation time).
- The trained model is **NOT** connected to any production API. The deterministic riskScoreService fallback remains the active production risk scorer.
- Model integration into the production system will occur in a later, separately approved step.

## Limitations
- This is a first baseline model and has not been scientifically validated.
- The 0.5 classification threshold is a technical default, not an optimized decision boundary.
- Temporal validation (temporal cross-validation, concept drift detection) is planned for future steps.
- No hyperparameter tuning has been performed.
- The model is not connected to any production API.
