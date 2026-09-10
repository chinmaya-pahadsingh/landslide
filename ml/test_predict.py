import unittest
from unittest.mock import patch, MagicMock, mock_open
import json
import math
import os
from ml.predict import predict

class TestPredictOperationalReadiness(unittest.TestCase):

    def get_valid_features(self):
        return {
            'elevation_meters': 1500.5,
            'slope_degrees': 45.2,
            'rainfall_24h_mm': 120.0,
            'soil_moisture_index': 0.8
        }

    @patch('os.path.exists')
    def test_missing_model_returns_refused(self, mock_exists):
        # Artifacts missing
        mock_exists.return_value = False
        res = predict(self.get_valid_features())
        self.assertEqual(res['status'], 'prediction_refused')
        self.assertIn('Model artifact or metadata unavailable', res['reason'])
        self.assertIsNone(res['prediction'])

    @patch('os.path.exists')
    @patch('builtins.open', new_callable=mock_open, read_data="invalid json")
    def test_corrupt_invalid_model_returns_refused(self, mock_file, mock_exists):
        # Metadata corrupt
        mock_exists.return_value = True
        res = predict(self.get_valid_features())
        self.assertEqual(res['status'], 'prediction_refused')
        self.assertIn('Metadata is invalid or corrupt', res['reason'])

    @patch('os.path.exists')
    def test_missing_metadata_returns_refused(self, mock_exists):
        # Model exists, metadata missing
        def exists_side_effect(path):
            if 'model_metadata' in path:
                return False
            return True
        mock_exists.side_effect = exists_side_effect
        
        res = predict(self.get_valid_features())
        self.assertEqual(res['status'], 'prediction_refused')

    @patch('os.path.exists')
    @patch('builtins.open', new_callable=mock_open, read_data='{"model_version": "2.0.0"}')
    def test_version_mismatch_returns_refused(self, mock_file, mock_exists):
        # Metadata exists but version does not match script's MODEL_VERSION
        mock_exists.return_value = True
        res = predict(self.get_valid_features())
        self.assertEqual(res['status'], 'prediction_refused')
        self.assertIn('Model version mismatch', res['reason'])

    def test_missing_feature_rejected(self):
        features = self.get_valid_features()
        del features['elevation_meters']
        res = predict(features)
        self.assertEqual(res['status'], 'error')
        self.assertIn('Missing required feature: elevation_meters', res['reason'])

    def test_malformed_feature_rejected(self):
        features = self.get_valid_features()
        features['slope_degrees'] = "45 degrees"
        res = predict(features)
        self.assertEqual(res['status'], 'error')
        self.assertIn('must be numeric', res['reason'])

    def test_nan_infinity_rejected(self):
        features = self.get_valid_features()
        features['rainfall_24h_mm'] = math.nan
        res = predict(features)
        self.assertEqual(res['status'], 'error')
        self.assertIn('cannot be NaN or Infinite', res['reason'])

        features['rainfall_24h_mm'] = float('inf')
        res = predict(features)
        self.assertEqual(res['status'], 'error')
        self.assertIn('cannot be NaN or Infinite', res['reason'])

    def test_extra_feature_rejected(self):
        features = self.get_valid_features()
        features['unrelated_sensor'] = 123
        res = predict(features)
        self.assertEqual(res['status'], 'error')
        self.assertIn('Unexpected features provided', res['reason'])

    @patch('os.path.exists')
    @patch('builtins.open', new_callable=mock_open, read_data='{"model_version": "1.0.0", "classification_threshold": 0.5}')
    @patch('ml.predict.xgb.Booster')
    @patch('ml.predict.xgb.DMatrix')
    def test_valid_prediction_path_with_mock(self, MockDMatrix, MockBooster, mock_file, mock_exists):
        mock_exists.return_value = True
        
        # Mock the XGBoost Booster instance
        mock_booster_instance = MagicMock()
        mock_booster_instance.predict.return_value = [0.85]
        MockBooster.return_value = mock_booster_instance

        res = predict(self.get_valid_features())
        
        # Assert happy path execution without creating fake models
        self.assertEqual(res['status'], 'success')
        self.assertEqual(res['modelVersion'], '1.0.0')
        self.assertIsNotNone(res['prediction'])
        self.assertEqual(res['prediction']['probability'], 0.85)
        self.assertEqual(res['prediction']['class'], 1)
        mock_booster_instance.load_model.assert_called_once()
        mock_booster_instance.predict.assert_called_once()

    @patch('os.path.exists')
    @patch('builtins.open', new_callable=mock_open, read_data='{"model_version": "1.0.0", "classification_threshold": 0.5}')
    @patch('ml.predict.xgb.Booster')
    def test_invalid_xgboost_model_returns_refused(self, MockBooster, mock_file, mock_exists):
        # Metadata is fine, but booster fails to load model
        mock_exists.return_value = True
        mock_booster_instance = MagicMock()
        mock_booster_instance.load_model.side_effect = Exception("Corrupt XGBoost File")
        MockBooster.return_value = mock_booster_instance

        res = predict(self.get_valid_features())
        self.assertEqual(res['status'], 'prediction_refused')
        self.assertIn('Failed to load XGBoost model', res['reason'])

if __name__ == '__main__':
    unittest.main()
