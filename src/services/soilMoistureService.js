const SoilMoistureObservation = require('../models/SoilMoistureObservation');

/**
 * Process and store a new soil moisture observation.
 * @param {Object} data - Normalized soil moisture data
 * @returns {Promise<Object>} The saved observation
 */
const processAndStoreSoilMoisture = async (data) => {
  const observation = new SoilMoistureObservation(data);
  // Mongoose schema inherently handles validations for:
  // - latitude (-90 to 90)
  // - longitude (-180 to 180)
  // - soilMoisture (numeric, >= 0)
  // - recordedAt (valid date parsing)
  // - source (allowed enum values)
  
  const savedObservation = await observation.save();
  return savedObservation;
};

const getAllSoilMoisture = async () => {
  return await SoilMoistureObservation.find().sort({ recordedAt: -1 });
};

module.exports = {
  processAndStoreSoilMoisture,
  getAllSoilMoisture
};
