const rainfallService = require('../services/rainfallService');

const createRainfallObservation = async (req, res) => {
  try {
    const savedObservation = await rainfallService.processAndStoreRainfall(req.body);
    res.status(201).json(savedObservation);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error creating RainfallObservation:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

const getAllRainfallObservations = async (req, res) => {
  try {
    const observations = await rainfallService.getAllRainfall();
    res.status(200).json(observations);
  } catch (error) {
    console.error('Error fetching RainfallObservations:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

module.exports = {
  createRainfallObservation,
  getAllRainfallObservations
};
