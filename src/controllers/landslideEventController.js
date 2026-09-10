const mongoose = require('mongoose');
const LandslideEvent = require('../models/LandslideEvent');
const { calculateRiskScore } = require('../services/riskScoreService');
const { calculateDistanceKm } = require('../utils/geoUtils');

const getAllLandslideEvents = async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    if (lat !== undefined && lon !== undefined) {
      const parsedLat = parseFloat(lat);
      const parsedLon = parseFloat(lon);
      const searchRadiusMeters = parseFloat(radius) || 50000;

      if (isNaN(parsedLat) || isNaN(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
        return res.status(400).json({ error: 'Valid latitude [-90, 90] and longitude [-180, 180] are required.' });
      }

      const events = await LandslideEvent.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates: [parsedLon, parsedLat] },
            $maxDistance: searchRadiusMeters
          }
        }
      }).lean();

      const enriched = events.map(e => {
        const distanceKm = e.location?.latitude != null && e.location?.longitude != null
          ? calculateDistanceKm(parsedLat, parsedLon, e.location.latitude, e.location.longitude)
          : null;
        return {
          ...e,
          distanceKm
        };
      });

      return res.status(200).json(enriched);
    }

    const filter = {};
    const { source, region, isHistorical, state } = req.query;

    if (source) {
      filter.source = new RegExp(`^${source}$`, 'i');
    }

    if (region) {
      const reg = region.toUpperCase();
      if (reg === 'NER') {
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [
            { region: 'NER' },
            { source: 'GSI' },
            { 'provenance.sourceName': 'GSI' },
            {
              'location.latitude': { $gte: 21.9, $lte: 29.5 },
              'location.longitude': { $gte: 87.5, $lte: 97.5 }
            }
          ]
        });
        filter.$and.push({
          source: { $nin: ['NASA', 'nasa'] }
        });
      } else {
        filter.region = new RegExp(`^${region}$`, 'i');
      }
    }

    if (isHistorical !== undefined) {
      filter.isHistorical = isHistorical === 'true' || isHistorical === true;
    }

    if (state) {
      filter.state = new RegExp(`^${state}$`, 'i');
    }

    const events = await LandslideEvent.find(filter).sort({ reportedAt: -1 }).lean();
    res.status(200).json(events);
  } catch (error) {
    console.error('Error fetching LandslideEvents:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

const createLandslideEvent = async (req, res) => {
  try {
    const newEvent = new LandslideEvent(req.body);
    const savedEvent = await newEvent.save();

    const riskAssessment = calculateRiskScore({
      rainfall: req.body.rainfall,
      soilMoisture: req.body.soilMoisture
    });

    const responsePayload = {
      ...savedEvent.toJSON(),
      riskAssessment
    };

    res.status(201).json(responsePayload);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error creating LandslideEvent:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

const getLandslideEventById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid event ID format.' });
    }

    const event = await LandslideEvent.findById(id);

    if (!event) {
      return res.status(404).json({ error: 'Landslide event not found.' });
    }

    res.status(200).json(event);
  } catch (error) {
    console.error('Error fetching LandslideEvent by ID:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

module.exports = {
  getAllLandslideEvents,
  createLandslideEvent,
  getLandslideEventById,
};
