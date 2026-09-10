const RainfallObservation = require('../models/RainfallObservation');

/**
 * Process and store a new rainfall observation.
 * @param {Object} data - Normalized rainfall data
 * @returns {Promise<Object>} The saved observation
 */
const processAndStoreRainfall = async (data) => {
  const observation = new RainfallObservation(data);
  // Mongoose schema inherently handles validations for:
  // - latitude (-90 to 90)
  // - longitude (-180 to 180)
  // - rainfall (numeric, >= 0)
  // - recordedAt (valid date parsing)
  // - source (allowed enum values)
  
  const savedObservation = await observation.save();
  return savedObservation;
};

const getAllRainfall = async () => {
  return await RainfallObservation.find().sort({ recordedAt: -1 });
};

module.exports = {
  processAndStoreRainfall,
  getAllRainfall
};
