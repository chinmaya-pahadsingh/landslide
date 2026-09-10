/**
 * Sentinel-2 10m Land Cover Provider
 *
 * Fetches real, satellite-derived Land Use / Land Cover (LULC) data from the
 * Sentinel-2 10m Land Cover service (Impact Observatory / Esri Living Atlas).
 *
 * Satellite Source: European Space Agency (ESA) Sentinel-2 MSI constellation.
 * Resolution: 10 meters per pixel, global coverage.
 *
 * Classes (Impact Observatory / Sentinel-2 10m):
 *   1:  Water               -> 'water'
 *   2:  Trees               -> 'vegetation'
 *   4:  Flooded Vegetation  -> 'vegetation'
 *   5:  Crops               -> 'cropland'
 *   7:  Built Area          -> 'built_up'
 *   8:  Bare Ground         -> 'bare'
 *   9:  Snow/Ice            -> 'other'
 *   10: Clouds              -> 'unknown'
 *   11: Rangeland           -> 'vegetation'
 *
 * Standard ESA WorldCover 10m fallback mappings:
 *   10: Tree cover          -> 'vegetation'
 *   20: Shrubland           -> 'vegetation'
 *   30: Grassland           -> 'vegetation'
 *   40: Cropland            -> 'cropland'
 *   50: Built-up            -> 'built_up'
 *   60: Bare / sparse       -> 'bare'
 *   70: Snow and ice        -> 'other'
 *   80: Permanent water     -> 'water'
 *   90: Herbaceous wetland  -> 'vegetation'
 *   95: Mangroves           -> 'vegetation'
 *   100: Moss and lichen    -> 'vegetation'
 */

const axios = require('axios');

const SENTINEL2_IMAGE_SERVER_URL = 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/identify';

// Normalized classification dictionary
const CLASS_DEFINITIONS = {
  // Sentinel-2 10m LULC (Impact Observatory)
  1: { name: 'Water', category: 'water' },
  2: { name: 'Trees', category: 'vegetation' },
  4: { name: 'Flooded Vegetation', category: 'vegetation' },
  5: { name: 'Crops', category: 'cropland' },
  7: { name: 'Built Area', category: 'built_up' },
  8: { name: 'Bare Ground', category: 'bare' },
  9: { name: 'Snow/Ice', category: 'other' },
  10: { name: 'Clouds', category: 'unknown' },
  11: { name: 'Rangeland', category: 'vegetation' },

  // ESA WorldCover 10m class codes (standard interoperability)
  20: { name: 'Shrubland', category: 'vegetation' },
  30: { name: 'Grassland', category: 'vegetation' },
  40: { name: 'Cropland', category: 'cropland' },
  50: { name: 'Built-up', category: 'built_up' },
  60: { name: 'Bare / Sparse Vegetation', category: 'bare' },
  70: { name: 'Snow and Ice', category: 'other' },
  80: { name: 'Permanent Water Bodies', category: 'water' },
  90: { name: 'Herbaceous Wetland', category: 'vegetation' },
  95: { name: 'Mangroves', category: 'vegetation' },
  100: { name: 'Moss and Lichen', category: 'vegetation' }
};

/**
 * Normalizes a raw class code into a structured land-cover object.
 * NEVER invents confidence or maps unknown/error into a safe category.
 *
 * @param {number|string} rawValue
 * @returns {{ classCode: number|null, className: string, category: string }}
 */
function normalizeClass(rawValue) {
  const code = parseInt(rawValue, 10);
  if (Number.isFinite(code) && CLASS_DEFINITIONS[code]) {
    return {
      classCode: code,
      className: CLASS_DEFINITIONS[code].name,
      category: CLASS_DEFINITIONS[code].category
    };
  }

  return {
    classCode: null,
    className: 'Unknown / Unclassified',
    category: 'unknown'
  };
}

/**
 * Fetches satellite land-cover classification for a specific coordinate.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {Object} [options]
 * @param {number} [options.timeout=10000] - Request timeout in ms
 * @returns {Promise<Object>} Normalized land-cover response
 */
async function fetchLandCover(latitude, longitude, options = {}) {
  const timeout = options.timeout || 10000;
  const retrievedAt = new Date().toISOString();
  const sourceName = 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)';

  try {
    const geometry = JSON.stringify({
      x: longitude,
      y: latitude,
      spatialReference: { wkid: 4326 }
    });

    const response = await axios.get(SENTINEL2_IMAGE_SERVER_URL, {
      params: {
        geometry,
        geometryType: 'esriGeometryPoint',
        sr: 4326,
        returnPixelValues: true,
        f: 'json'
      },
      headers: {
        'User-Agent': 'LandslideMonitoringPlatform/1.0 (Hackathon Disaster Early Warning System)'
      },
      timeout
    });

    if (!response.data) {
      return {
        available: false,
        source: sourceName,
        classCode: null,
        className: null,
        category: 'unknown',
        confidence: null,
        retrievedAt,
        error: 'Empty response received from satellite imagery service'
      };
    }

    // Check for Esri error payload in 200 response
    if (response.data.error) {
      return {
        available: false,
        source: sourceName,
        classCode: null,
        className: null,
        category: 'unknown',
        confidence: null,
        retrievedAt,
        error: response.data.error.message || 'Satellite provider returned service error'
      };
    }

    const rawPixelValue = response.data.value != null ? response.data.value : response.data.properties?.Values?.[0];

    if (rawPixelValue == null || rawPixelValue === 'NoData' || rawPixelValue === '') {
      return {
        available: false,
        source: sourceName,
        classCode: null,
        className: 'NoData',
        category: 'unknown',
        confidence: null,
        retrievedAt,
        error: 'No satellite observation pixel data at these coordinates'
      };
    }

    const normalized = normalizeClass(rawPixelValue);

    return {
      available: true,
      source: sourceName,
      classCode: normalized.classCode,
      className: normalized.className,
      category: normalized.category,
      confidence: null, // Truthful: provider does not calculate continuous confidence per point
      retrievedAt
    };
  } catch (err) {
    const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
    const isRateLimited = err.response?.status === 429;

    let errorMessage = err.message || 'Failed to query satellite land cover';
    if (isTimeout) {
      errorMessage = 'Satellite provider request timed out';
    } else if (isRateLimited) {
      errorMessage = 'Satellite provider rate limit exceeded (HTTP 429)';
    }

    return {
      available: false,
      source: sourceName,
      classCode: null,
      className: null,
      category: 'unknown',
      confidence: null,
      retrievedAt,
      error: errorMessage,
      isTimeout: Boolean(isTimeout),
      isRateLimited: Boolean(isRateLimited)
    };
  }
}

module.exports = {
  fetchLandCover,
  normalizeClass,
  CLASS_DEFINITIONS,
  SENTINEL2_IMAGE_SERVER_URL
};
