const soilMoistureService = require('../services/soilMoistureService');
const soilMoistureIngestionService = require('../services/soilMoistureIngestionService');

const createSoilMoistureObservation = async (req, res) => {
  try {
    const savedObservation = await soilMoistureService.processAndStoreSoilMoisture(req.body);
    res.status(201).json(savedObservation);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error creating SoilMoistureObservation:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

const getAllSoilMoistureObservations = async (req, res) => {
  try {
    const observations = await soilMoistureService.getAllSoilMoisture();
    res.status(200).json(observations);
  } catch (error) {
    console.error('Error fetching SoilMoistureObservations:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

const syncSoilMoisture = async (req, res) => {
  try {
    const { lat, lon, demo } = req.body;
    
    if (lat === undefined || lon === undefined) {
      return res.status(400).json({ error: 'lat and lon are required parameters' });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    
    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ error: 'lat and lon must be numbers' });
    }
    
    const isSimulation = demo === 'extreme';
    
    const result = await soilMoistureIngestionService.syncSoilMoisture(latitude, longitude, isSimulation);
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in syncSoilMoisture:', error);
    res.status(500).json({ error: 'An unexpected server error occurred during sync.' });
  }
};

module.exports = {
  createSoilMoistureObservation,
  getAllSoilMoistureObservations,
  syncSoilMoisture
};
