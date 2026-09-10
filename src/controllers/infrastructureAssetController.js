const InfrastructureAsset = require('../models/InfrastructureAsset');
const mongoose = require('mongoose');

const createInfrastructureAsset = async (req, res) => {
  try {
    const { name, assetType, location, importance, populationServed, alternativeAvailable, status } = req.body;

    // Explicit allowlist
    const assetData = { name, assetType, location };
    if (importance !== undefined) assetData.importance = importance;
    if (populationServed !== undefined) assetData.populationServed = populationServed;
    if (alternativeAvailable !== undefined) assetData.alternativeAvailable = alternativeAvailable;
    if (status !== undefined) assetData.status = status;

    const newAsset = new InfrastructureAsset(assetData);
    const savedAsset = await newAsset.save();

    res.status(201).json(savedAsset);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error creating InfrastructureAsset:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

const { calculateDistanceKm } = require('../utils/geoUtils');

const getAllInfrastructureAssets = async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    if (lat !== undefined && lon !== undefined) {
      const parsedLat = parseFloat(lat);
      const parsedLon = parseFloat(lon);
      const searchRadiusMeters = parseFloat(radius) || 50000;

      if (isNaN(parsedLat) || isNaN(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
        return res.status(400).json({ error: 'Valid latitude [-90, 90] and longitude [-180, 180] are required.' });
      }

      const assets = await InfrastructureAsset.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates: [parsedLon, parsedLat] },
            $maxDistance: searchRadiusMeters
          }
        }
      }).lean();

      const enriched = assets.map(a => {
        const distanceKm = a.location?.latitude != null && a.location?.longitude != null
          ? calculateDistanceKm(parsedLat, parsedLon, a.location.latitude, a.location.longitude)
          : null;
        return {
          ...a,
          distanceKm
        };
      });

      return res.status(200).json(enriched);
    }

    const assets = await InfrastructureAsset.find().sort({ createdAt: -1 });
    res.status(200).json(assets);
  } catch (error) {
    console.error('Error fetching InfrastructureAssets:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

const getInfrastructureAssetById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid asset ID format.' });
    }

    const asset = await InfrastructureAsset.findById(id);

    if (!asset) {
      return res.status(404).json({ error: 'Infrastructure asset not found.' });
    }

    res.status(200).json(asset);
  } catch (error) {
    console.error('Error fetching InfrastructureAsset by ID:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

module.exports = {
  createInfrastructureAsset,
  getAllInfrastructureAssets,
  getInfrastructureAssetById,
};
