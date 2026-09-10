const express = require('express');
const router = express.Router();
const {
  createInfrastructureAsset,
  getAllInfrastructureAssets,
  getInfrastructureAssetById,
} = require('../controllers/infrastructureAssetController');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

router.post('/', authenticate, requireRole('admin', 'authority'), createInfrastructureAsset);
router.get('/', getAllInfrastructureAssets);
router.get('/:id', getInfrastructureAssetById);

module.exports = router;
