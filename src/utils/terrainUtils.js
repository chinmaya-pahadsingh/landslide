/**
 * Utility for terrain cache key generation
 */

function formatCoord(coord) {
  // Math.round to 3 decimal places
  let rounded = Math.round(coord * 1000) / 1000;
  // Convert -0 to 0
  if (rounded === -0) {
    rounded = 0;
  }
  return rounded.toFixed(3);
}

const generateTerrainCellKey = (latitude, longitude) => {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    throw new Error('Coordinates missing');
  }

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('Coordinates must be numeric');
  }

  if (isNaN(latitude) || isNaN(longitude)) {
    throw new Error('Coordinates must be valid numbers (not NaN)');
  }

  if (!isFinite(latitude) || !isFinite(longitude)) {
    throw new Error('Coordinates must be finite numbers');
  }

  if (latitude < -90 || latitude > 90) {
    throw new Error('Latitude out of bounds');
  }

  if (longitude < -180 || longitude > 180) {
    throw new Error('Longitude out of bounds');
  }

  const latStr = formatCoord(latitude);
  const lonStr = formatCoord(longitude);

  return `cell_${latStr}_${lonStr}`;
};

module.exports = {
  generateTerrainCellKey
};
