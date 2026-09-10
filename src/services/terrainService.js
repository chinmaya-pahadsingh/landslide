/**
 * Terrain Service Foundation
 * 
 * Retrieves terrain elevation and calculates slope.
 * 
 * - Terrain data is static/cached.
 * - Uses Open-Meteo Elevation API (Copernicus DEM GLO-90).
 * - Approximately 90 m DEM resolution.
 * - Slope is an estimate derived from central finite differences from ~90m samples.
 * - The 3-decimal cell key is a cache partition strategy, not an exact physical DEM cell.
 * - Missing terrain remains explicitly unavailable (null).
 */

const TerrainCache = require('../models/TerrainCache');
const { generateTerrainCellKey } = require('../utils/terrainUtils');
const { fetchElevations } = require('./terrainProviders/openMeteoElevationProvider');

// Distance between samples for slope calculation (~90m DEM physical resolution)
const SAMPLE_DISTANCE_METERS = 90;
const METERS_PER_DEGREE_LATITUDE = 111320;

// Promise deduplication map keyed by cellKey
const pendingRequests = new Map();

/**
 * Validates whether a value is a finite number
 */
const isFiniteNumber = (val) => typeof val === 'number' && isFinite(val);

/**
 * Normalizes longitude to handle wrap-around at the anti-meridian (-180 to 180)
 */
const wrapLongitude = (lon) => {
  let wrapped = lon % 360;
  if (wrapped > 180) wrapped -= 360;
  if (wrapped < -180) wrapped += 360;
  return wrapped;
};

/**
 * Calculates physical degree offsets for the 90m spacing.
 * Uses geodesically reasonable conversion.
 */
const getNeighborCoordinates = (latitude, longitude) => {
  const latOffset = SAMPLE_DISTANCE_METERS / METERS_PER_DEGREE_LATITUDE;
  
  // Meters per degree longitude depends on latitude
  const metersPerDegreeLon = METERS_PER_DEGREE_LATITUDE * Math.cos(latitude * Math.PI / 180);
  
  // If at poles, longitude doesn't make sense, offset is 0.
  const lonOffset = Math.abs(metersPerDegreeLon) > 1e-6 ? SAMPLE_DISTANCE_METERS / metersPerDegreeLon : 0;

  // Clamp latitude to [-90, 90]
  const clampLat = (lat) => Math.max(-90, Math.min(90, lat));

  return {
    center: { latitude, longitude },
    north: { latitude: clampLat(latitude + latOffset), longitude },
    south: { latitude: clampLat(latitude - latOffset), longitude },
    east: { latitude, longitude: wrapLongitude(longitude + Math.abs(lonOffset)) },
    west: { latitude, longitude: wrapLongitude(longitude - Math.abs(lonOffset)) },
    dy: SAMPLE_DISTANCE_METERS,
    dx: SAMPLE_DISTANCE_METERS
  };
};

/**
 * Calculates slope in degrees using central finite difference gradient.
 */
const calculateSlopeDegrees = (elevCenter, elevNorth, elevSouth, elevEast, elevWest, dx, dy) => {
  if (
    !isFiniteNumber(elevCenter) || 
    !isFiniteNumber(elevNorth) || 
    !isFiniteNumber(elevSouth) || 
    !isFiniteNumber(elevEast) || 
    !isFiniteNumber(elevWest)
  ) {
    return null;
  }
  
  // Central finite-difference gradient
  const dzdx = (elevEast - elevWest) / (2 * dx);
  const dzdy = (elevNorth - elevSouth) / (2 * dy);
  
  const gradientMagnitude = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
  const slopeRadians = Math.atan(gradientMagnitude);
  const slopeDegrees = slopeRadians * 180 / Math.PI;
  
  if (!isFiniteNumber(slopeDegrees) || slopeDegrees < 0 || slopeDegrees > 90) {
    return null;
  }
  
  return slopeDegrees;
};

/**
 * Core workflow to fetch, calculate and cache terrain
 */
const fetchAndCacheTerrain = async (latitude, longitude, cellKey) => {
  const coords = getNeighborCoordinates(latitude, longitude);
  
  // We use the exact array order as returned by provider to map coords, 
  // but explicitly verify lat/lon to satisfy requirement 11.
  const requestPoints = [
    coords.center, 
    coords.north, 
    coords.south, 
    coords.east, 
    coords.west
  ];
  
  const providerResult = await fetchElevations(requestPoints);
  
  if (providerResult.status === 'error' || !providerResult.data) {
    return {
      elevation: null,
      slope: null,
      source: "unavailable",
      cellKey
    };
  }

  // Explicitly map each requested coordinate to its returned elevation
  const elevMap = new Map();
  for (const res of providerResult.data) {
    const key = `${res.latitude}_${res.longitude}`;
    elevMap.set(key, res.elevation);
  }

  const getElev = (pt) => elevMap.get(`${pt.latitude}_${pt.longitude}`);
  
  const elevCenter = getElev(coords.center);
  const elevNorth = getElev(coords.north);
  const elevSouth = getElev(coords.south);
  const elevEast = getElev(coords.east);
  const elevWest = getElev(coords.west);

  // If center is missing, return explicitly unavailable
  if (elevCenter === null || elevCenter === undefined || !isFiniteNumber(elevCenter)) {
    return {
      elevation: null,
      slope: null,
      source: "unavailable",
      cellKey
    };
  }

  // Calculate slope; handles missing neighbors internally (returns null)
  const slope = calculateSlopeDegrees(elevCenter, elevNorth, elevSouth, elevEast, elevWest, coords.dx, coords.dy);
  
  const result = {
    elevation: elevCenter,
    slope: slope,
    source: "open-meteo",
    cellKey
  };

  // Cache writes (only valid numeric data is stored)
  try {
    // UPSERT safely using findOneAndUpdate to avoid duplicate key errors
    await TerrainCache.findOneAndUpdate(
      { cellKey },
      {
        cellKey,
        elevation: elevCenter,
        slope: slope, // might be null, which is valid to store
        cachedAt: new Date()
      },
      { upsert: true, new: true, runValidators: true }
    );
  } catch (dbError) {
    console.error('TerrainCache save error:', dbError);
    // Even if cache save fails, return the valid data we just fetched
  }

  return result;
};


/**
 * Retrieves terrain features for a given latitude and longitude.
 * 
 * @param {number} latitude 
 * @param {number} longitude 
 * @returns {Promise<{ elevation: number | null, slope: number | null, source: string, cellKey: string }>}
 */
const getTerrainFeaturesForLocation = async (latitude, longitude) => {
  // 1. Validate and generate deterministic cell key (throws if invalid)
  const cellKey = generateTerrainCellKey(latitude, longitude);

  // 2. Cache-first lookup exactly on the generated cellKey
  try {
    const cached = await TerrainCache.findOne({ cellKey });
    if (cached) {
      // Validate cached data integrity
      const validElev = cached.elevation === null || isFiniteNumber(cached.elevation);
      const validSlope = cached.slope === null || isFiniteNumber(cached.slope);
      
      if (validElev && validSlope) {
        return {
          elevation: cached.elevation,
          slope: cached.slope,
          source: "cache",
          cellKey
        };
      }
    }
  } catch (dbError) {
    console.error('TerrainCache lookup error:', dbError);
    // Ignore DB error and fallback to fetching
  }

  // 3. Concurrent request deduplication
  if (pendingRequests.has(cellKey)) {
    return pendingRequests.get(cellKey);
  }

  // 4. Fetch, compute, cache
  const fetchPromise = fetchAndCacheTerrain(latitude, longitude, cellKey)
    .finally(() => {
      // Always remove from map on completion (including failure)
      pendingRequests.delete(cellKey);
    });

  pendingRequests.set(cellKey, fetchPromise);
  return fetchPromise;
};

module.exports = {
  getTerrainFeaturesForLocation,
  // Exported for testing only
  getNeighborCoordinates,
  calculateSlopeDegrees
};
