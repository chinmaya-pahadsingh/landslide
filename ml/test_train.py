import unittest
import tempfile
import json
import os
import sys
import subprocess

class TestTrainScript(unittest.TestCase):
    def run_train_script(self, data):
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as tmp:
            json.dump(data, tmp)
            tmp_path = tmp.name
        
        # Use sys.executable to ensure we use the same Python interpreter
        result = subprocess.run(
            [sys.executable, 'ml/train.py', tmp_path] if os.path.exists('ml/train.py') else [sys.executable, 'train.py', tmp_path],
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
        data = [{
            "observation_timestamp": "2026-09-01T12:00:00Z",
            "elevation_meters": 100, "slope_degrees": 10, 
            "rainfall_24h_mm": 5, "soil_moisture_index": 0.5, 
            "landslide_occurrence": 2
        }]
        res = self.run_train_script(data)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("must be binary 0 or 1", res.stdout)

    def test_insufficient_dataset_rejected(self):
        # Valid row but not enough of them
        data = [{
            "observation_timestamp": "2026-09-01T12:00:00Z",
            "elevation_meters": 100, "slope_degrees": 10, 
            "rainfall_24h_mm": 5, "soil_moisture_index": 0.5, 
            "landslide_occurrence": 1
        }]
        res = self.run_train_script(data)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("FAIL: sampleCount >= 1000", res.stdout)

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

    def test_valid_schema_accepted_at_schema_level(self):
        # We can't actually pass the 1000 threshold without generating a massive fixture.
        # But we can verify it fails *only* on the threshold and not on schema validation.
        data = [{
            "observation_timestamp": "2026-09-01T12:00:00Z",
            "elevation_meters": 100, "slope_degrees": 10, 
            "rainfall_24h_mm": 5, "soil_moisture_index": 0.5, 
            "landslide_occurrence": 1
        }]
        res = self.run_train_script(data)
        self.assertIn("Invalid Samples: 0", res.stdout)
        self.assertIn("Duplicate Features: 0", res.stdout)
        self.assertIn("FAIL: sampleCount >= 1000", res.stdout) # Stopped securely at the dataset size gate

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

if __name__ == '__main__':
    unittest.main()
