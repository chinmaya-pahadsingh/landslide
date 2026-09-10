import unittest
import tempfile
import json
import os
import sys
import subprocess
import hashlib


def make_row(timestamp, elevation, slope, rainfall, soil_moisture, target):
    """Helper to create a single valid dataset row."""
    return {
        'observation_timestamp': timestamp,
        'elevation_meters': elevation,
        'slope_degrees': slope,
        'rainfall_24h_mm': rainfall,
        'soil_moisture_index': soil_moisture,
        'landslide_occurrence': target
    }


def make_sufficient_dataset():
    """
    Creates a dataset that passes all readiness gates:
    - 1200 rows (600 positive, 600 negative)
    - Unique timestamps ensure no duplicates
    - Chronologically ordered with positives and negatives distributed across time
    """
    rows = []
    base_year = 2024
    for i in range(600):
        # Positive samples: spread across months 1-12 of 2024
        month = (i % 12) + 1
        day = (i % 28) + 1
        hour = i % 24
        ts = f"{base_year}-{month:02d}-{day:02d}T{hour:02d}:{(i % 60):02d}:00Z"
        rows.append(make_row(ts, 800 + i, 10 + (i % 50), 20 + (i % 100), 0.1 + (i % 9) * 0.1, 1))

    for i in range(600):
        # Negative samples: spread across months 1-12 of 2025
        month = (i % 12) + 1
        day = (i % 28) + 1
        hour = i % 24
        ts = f"2025-{month:02d}-{day:02d}T{hour:02d}:{(i % 60):02d}:00Z"
        rows.append(make_row(ts, 500 + i, 5 + (i % 40), 0 + (i % 30), 0.05 + (i % 8) * 0.1, 0))

    return rows


def make_mixed_chronological_dataset():
    """
    Creates a dataset where positives and negatives are interleaved chronologically
    so both train and test partitions contain both classes.
    """
    rows = []
    for i in range(1200):
        month = (i % 12) + 1
        day = (i % 28) + 1
        hour = i % 24
        minute = i % 60
        # Use 2024 for first 960 (train ~80%), 2025 for last 240 (test ~20%)
        year = 2024 if i < 960 else 2025
        ts = f"{year}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00Z"
        target = 1 if i % 3 == 0 else 0  # ~33% positive, ~67% negative
        rows.append(make_row(ts, 500 + i, 5 + (i % 60), i % 120, 0.1 + (i % 9) * 0.1, target))
    return rows


class TestTrainScript(unittest.TestCase):
    """Original Step 51B-1 validation tests (preserved)."""

    def run_train_script(self, data):
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as tmp:
            json.dump(data, tmp)
            tmp_path = tmp.name

        script_path = os.path.join('ml', 'train.py') if os.path.exists(os.path.join('ml', 'train.py')) else 'train.py'
        result = subprocess.run(
            [sys.executable, script_path, tmp_path],
            capture_output=True,
            text=True
        )
        os.remove(tmp_path)
        return result

    def test_missing_columns_rejected(self):
        data = [{"observation_timestamp": "2026-09-01T12:00:00Z", "slope_degrees": 10, "rainfall_24h_mm": 5, "soil_moisture_index": 0.5, "landslide_occurrence": 1}]
        res = self.run_train_script(data)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("missing features: ['elevation_meters']", res.stdout)

    def test_non_binary_target_rejected(self):
        data = [make_row("2026-09-01T12:00:00Z", 100, 10, 5, 0.5, 2)]
        res = self.run_train_script(data)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("must be binary 0 or 1", res.stdout)

    def test_insufficient_dataset_rejected(self):
        data = [make_row("2026-09-01T12:00:00Z", 100, 10, 5, 0.5, 1)]
        res = self.run_train_script(data)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("FAIL: sampleCount >= 1000", res.stdout)
        self.assertIn("TRAINING_REFUSED", res.stdout)

    def test_missing_feature_values_rejected(self):
        data = [{
            "observation_timestamp": "2026-09-01T12:00:00Z",
            "elevation_meters": None, "slope_degrees": 10,
            "rainfall_24h_mm": 5, "soil_moisture_index": 0.5,
            "landslide_occurrence": 1
        }]
        res = self.run_train_script(data)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("missing features: ['elevation_meters']", res.stdout)

    def test_missing_timestamp_rejected(self):
        data = [{
            "elevation_meters": 100, "slope_degrees": 10,
            "rainfall_24h_mm": 5, "soil_moisture_index": 0.5,
            "landslide_occurrence": 1
        }]
        res = self.run_train_script(data)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("missing features: ['observation_timestamp']", res.stdout)

    def test_malformed_timestamp_rejected(self):
        data = [{
            "observation_timestamp": "   ",
            "elevation_meters": 100, "slope_degrees": 10,
            "rainfall_24h_mm": 5, "soil_moisture_index": 0.5,
            "landslide_occurrence": 1
        }]
        res = self.run_train_script(data)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("must be a non-empty string", res.stdout)


class TestXGBoostTraining(unittest.TestCase):
    """Step 51B-2 XGBoost training tests."""

    def run_train_script(self, data):
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as tmp:
            json.dump(data, tmp)
            tmp_path = tmp.name

        script_path = os.path.join('ml', 'train.py') if os.path.exists(os.path.join('ml', 'train.py')) else 'train.py'
        result = subprocess.run(
            [sys.executable, script_path, tmp_path],
            capture_output=True,
            text=True
        )
        os.remove(tmp_path)
        return result

    def _cleanup_artifacts(self):
        """Remove any artifacts created during tests."""
        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists(os.path.join('ml', 'artifacts')) else 'artifacts'
        model_file = os.path.join(artifacts_dir, 'xgboost_model_v1.0.0.json')
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        if os.path.exists(model_file):
            os.remove(model_file)
        if os.path.exists(meta_file):
            os.remove(meta_file)

    def setUp(self):
        self._cleanup_artifacts()

    def tearDown(self):
        self._cleanup_artifacts()

    def test_readiness_gate_refusal_produces_no_artifact(self):
        """Insufficient data must produce TRAINING_REFUSED and no artifact."""
        data = [make_row(f"2024-01-01T{i:02d}:00:00Z", 100 + i, 10, 5, 0.5, 1) for i in range(10)]
        res = self.run_train_script(data)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("TRAINING_REFUSED", res.stdout)

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        model_file = os.path.join(artifacts_dir, 'xgboost_model_v1.0.0.json')
        self.assertFalse(os.path.exists(model_file), "No model artifact should be created on gate failure")

    def test_class_presence_refusal(self):
        """Chronological split resulting in missing class must refuse training and create no artifact."""
        # Create 1200 rows chronologically.
        # But make ALL the positive samples fall into the first 20% of the timeline,
        # so the last 20% (test set) is 100% negative.
        rows = []
        for i in range(1200):
            month = (i % 12) + 1
            day = (i % 28) + 1
            hour = i % 24
            minute = i % 60
            year = 2024 if i < 960 else 2025
            ts = f"{year}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00Z"
            target = 1 if i < 200 else 0
            rows.append(make_row(ts, 500 + i, 5 + (i % 60), i % 120, 0.1 + (i % 9) * 0.1, target))

        res = self.run_train_script(rows)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("TRAINING_REFUSED", res.stdout)
        self.assertIn("Test partition missing a class", res.stdout)

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        model_file = os.path.join(artifacts_dir, 'xgboost_model_v1.0.0.json')
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        self.assertFalse(os.path.exists(model_file), "No model artifact should be created")
        self.assertFalse(os.path.exists(meta_file), "No metadata artifact should be created")

    def test_successful_training_creates_artifacts(self):
        """Sufficient dataset must produce model and metadata artifacts."""
        data = make_mixed_chronological_dataset()
        res = self.run_train_script(data)
        self.assertEqual(res.returncode, 0, f"Training should succeed. stdout:\n{res.stdout}\nstderr:\n{res.stderr}")
        self.assertIn("TRAINING_COMPLETE", res.stdout)

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        model_file = os.path.join(artifacts_dir, 'xgboost_model_v1.0.0.json')
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        self.assertTrue(os.path.exists(model_file), "Model artifact must exist")
        self.assertTrue(os.path.exists(meta_file), "Metadata artifact must exist")

    def test_metadata_correctness(self):
        """Metadata must contain all required fields with correct types."""
        data = make_mixed_chronological_dataset()
        res = self.run_train_script(data)
        self.assertEqual(res.returncode, 0, f"stdout:\n{res.stdout}\nstderr:\n{res.stderr}")

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        with open(meta_file, 'r') as f:
            meta = json.load(f)

        # Required top-level fields
        self.assertEqual(meta['model_type'], 'XGBoost Classifier')
        self.assertEqual(meta['model_version'], '1.0.0')
        self.assertEqual(meta['feature_names'], ['elevation_meters', 'slope_degrees', 'rainfall_24h_mm', 'soil_moisture_index'])
        self.assertIn('training_timestamp', meta)
        self.assertIn('dataset_fingerprint', meta)
        self.assertEqual(len(meta['dataset_fingerprint']), 64)  # SHA-256 hex
        self.assertGreater(meta['dataset_size'], 0)
        self.assertGreater(meta['train_size'], 0)
        self.assertGreater(meta['test_size'], 0)
        self.assertIn('split_boundary_timestamp', meta)
        self.assertEqual(meta['classification_threshold'], 0.5)
        self.assertIn('not scientifically validated', meta['classification_threshold_note'])

        # Evaluation metrics
        metrics = meta['evaluation_metrics']
        for key in ['roc_auc', 'pr_auc', 'precision', 'recall', 'f1_score']:
            self.assertIn(key, metrics)
            self.assertIsInstance(metrics[key], float)
        cm = metrics['confusion_matrix']
        for key in ['true_negatives', 'false_positives', 'false_negatives', 'true_positives']:
            self.assertIn(key, cm)
            self.assertIsInstance(cm[key], int)

    def test_no_timestamp_as_feature(self):
        """observation_timestamp must NOT appear in model feature_names."""
        data = make_mixed_chronological_dataset()
        res = self.run_train_script(data)
        self.assertEqual(res.returncode, 0, f"stdout:\n{res.stdout}\nstderr:\n{res.stderr}")

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        with open(meta_file, 'r') as f:
            meta = json.load(f)

        self.assertNotIn('observation_timestamp', meta['feature_names'])
        self.assertNotIn('latitude', meta['feature_names'])
        self.assertNotIn('longitude', meta['feature_names'])

    def test_chronological_split_correctness(self):
        """All train timestamps must be <= boundary, all test timestamps must be > boundary."""
        data = make_mixed_chronological_dataset()
        res = self.run_train_script(data)
        self.assertEqual(res.returncode, 0, f"stdout:\n{res.stdout}\nstderr:\n{res.stderr}")

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        with open(meta_file, 'r') as f:
            meta = json.load(f)

        boundary = meta['split_boundary_timestamp']
        self.assertIsNotNone(boundary)
        # Verify: train_size + test_size == dataset_size
        self.assertEqual(meta['train_size'] + meta['test_size'], meta['dataset_size'])

        # Read the dataset back and verify every row's timestamp explicitly
        sorted_data = sorted(data, key=lambda x: x['observation_timestamp'])
        train_rows = sorted_data[:meta['train_size']]
        test_rows = sorted_data[meta['train_size']:]

        for r in train_rows:
            self.assertTrue(r['observation_timestamp'] <= boundary)
        for r in test_rows:
            self.assertTrue(r['observation_timestamp'] > boundary)

    def test_boundary_rule_no_timestamp_straddling(self):
        """Rows with the same timestamp must all be in the same partition."""
        # Force a straddle: 80% boundary falls inside a block of shared timestamps.
        # Total rows = 1200. Candidate index = 959 (80%).
        # Shared block is from 800 to 1000.
        rows = []
        for i in range(800):
            ts = f"2024-01-{(i % 28) + 1:02d}T{i % 24:02d}:{i % 60:02d}:00Z"
            target = 1 if i % 3 == 0 else 0
            rows.append(make_row(ts, 500 + i, 5 + (i % 60), i % 120, 0.1 + (i % 9) * 0.1, target))

        shared_ts = "2024-06-15T12:00:00Z"
        for i in range(800, 1000):
            target = 1 if i % 4 == 0 else 0
            rows.append(make_row(shared_ts, 800 + i, 20 + (i % 40), 50 + (i % 50), 0.3 + (i % 5) * 0.1, target))

        for i in range(1000, 1200):
            ts = f"2025-01-{(i % 28) + 1:02d}T{i % 24:02d}:{i % 60:02d}:00Z"
            target = 1 if i % 3 == 0 else 0
            rows.append(make_row(ts, 1300 + i, 10 + (i % 50), i % 100, 0.2 + (i % 7) * 0.1, target))

        res = self.run_train_script(rows)
        self.assertEqual(res.returncode, 0, f"stdout:\n{res.stdout}\nstderr:\n{res.stderr}")
        self.assertIn("TRAINING_COMPLETE", res.stdout)

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        with open(meta_file, 'r') as f:
            meta = json.load(f)

        # Candidate split was 959, but shared_ts extends to 999.
        # So split must advance to 999, meaning train_size becomes 1000.
        self.assertEqual(meta['train_size'], 1000)
        self.assertEqual(meta['test_size'], 200)
        self.assertEqual(meta['train_size'] + meta['test_size'], 1200)

        # Assert no straddling
        sorted_data = sorted(rows, key=lambda x: x['observation_timestamp'])
        test_rows = sorted_data[meta['train_size']:]
        for r in test_rows:
            self.assertNotEqual(r['observation_timestamp'], shared_ts, "shared_ts row leaked into test partition!")
            self.assertTrue(r['observation_timestamp'] > shared_ts, "test partition timestamp not strictly greater!")

    def test_scale_pos_weight_from_train_only(self):
        """scale_pos_weight must be computed from training partition only."""
        data = make_mixed_chronological_dataset()
        res = self.run_train_script(data)
        self.assertEqual(res.returncode, 0, f"stdout:\n{res.stdout}\nstderr:\n{res.stderr}")

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        with open(meta_file, 'r') as f:
            meta = json.load(f)

        train_pos = meta['positive_count_train']
        train_neg = meta['negative_count_train']
        expected_spw = round(train_neg / train_pos, 6) if train_pos > 0 else 1.0
        self.assertEqual(meta['scale_pos_weight'], expected_spw)

    def test_dataset_fingerprint_deterministic(self):
        """Same dataset must produce the same fingerprint."""
        data = make_mixed_chronological_dataset()
        canonical = json.dumps(data, sort_keys=True, separators=(',', ':'))
        expected_fp = hashlib.sha256(canonical.encode('utf-8')).hexdigest()

        res = self.run_train_script(data)
        self.assertEqual(res.returncode, 0, f"stdout:\n{res.stdout}\nstderr:\n{res.stderr}")

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        with open(meta_file, 'r') as f:
            meta = json.load(f)

        self.assertEqual(meta['dataset_fingerprint'], expected_fp)

    def test_exact_feature_contract(self):
        """Model must use exactly the 4 agreed predictive features."""
        data = make_mixed_chronological_dataset()
        res = self.run_train_script(data)
        self.assertEqual(res.returncode, 0, f"stdout:\n{res.stdout}\nstderr:\n{res.stderr}")

        artifacts_dir = os.path.join('ml', 'artifacts') if os.path.exists('ml') else 'artifacts'
        meta_file = os.path.join(artifacts_dir, 'model_metadata_v1.0.0.json')
        with open(meta_file, 'r') as f:
            meta = json.load(f)

        self.assertEqual(len(meta['feature_names']), 4)
        self.assertEqual(set(meta['feature_names']), {'elevation_meters', 'slope_degrees', 'rainfall_24h_mm', 'soil_moisture_index'})


if __name__ == '__main__':
    unittest.main()
