/**
 * Satellite Land Cover Service
 *
 * Provides normalized satellite-derived Land Use / Land Cover (LULC) evidence.
 * Integrates European Space Agency (ESA) Sentinel-2 10m land cover observations.
 *
 * Design & Safety Principles:
 *   - Genuine satellite data only (no fabricated or randomly generated classes).
 *   - Unavailable/failed provider data is strictly preserved as 'unknown' and available=false.
 *   - Unavailable land cover is NEVER treated as a "safe" vegetative shield.
 *   - No fake confidence scores (strictly null when provider does not calculate one).
 *   - In-memory bounded cache with coordinate rounding (~11m spatial resolution).
 *   - In-flight request deduplication prevents redundant simultaneous provider calls.
 *   - Isolated: core risk engine and early warning services operate independently if satellite data is offline.
 */

const defaultProvider = require('./satelliteProviders/sentinel2LandCoverProvider');

// Cache configuration
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (land-cover is seasonally stable)
const MAX_CACHE_ENTRIES = 1000;

class SatelliteLandCoverService {
  constructor(provider = defaultProvider) {
    this.provider = provider;
    this.cache = new Map();
    this.pendingRequests = new Map();
  }

  /**
   * Generates a normalized cache key from geographic coordinates.
   * 4 decimal places gives ~11m precision, matching 10m Sentinel-2 pixel size.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {string}
   */
  getCacheKey(lat, lon) {
    return `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
  }

  /**
   * Validates input coordinates.
   *
   * @param {*} latitude
   * @param {*} longitude
   * @returns {{ valid: boolean, error?: string }}
   */
  validateCoordinates(latitude, longitude) {
    if (latitude == null || longitude == null) {
      return { valid: false, error: 'Latitude and longitude are required.' };
    }

    const lat = typeof latitude === 'number' ? latitude : parseFloat(latitude);
    const lon = typeof longitude === 'number' ? longitude : parseFloat(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { valid: false, error: 'Coordinates must be valid finite numbers.' };
    }

    if (lat < -90 || lat > 90) {
      return { valid: false, error: 'Latitude must be between -90 and 90 degrees.' };
    }

    if (lon < -180 || lon > 180) {
      return { valid: false, error: 'Longitude must be between -180 and 180 degrees.' };
    }

    return { valid: true, lat, lon };
  }

  /**
   * Retrieves satellite land cover for a coordinate pair.
   *
   * @param {number} latitude
   * @param {number} longitude
   * @param {Object} [options]
   * @returns {Promise<Object>} Normalized land cover evidence
   */
  async getLandCover(latitude, longitude, options = {}) {
    const validation = this.validateCoordinates(latitude, longitude);
    if (!validation.valid) {
      return {
        available: false,
        source: 'satellite_validation',
        classCode: null,
        className: null,
        category: 'unknown',
        confidence: null,
        retrievedAt: new Date().toISOString(),
        error: validation.error
      };
    }

    const { lat, lon } = validation;
    const cacheKey = this.getCacheKey(lat, lon);

    // 1. Check in-memory cache
    if (!options.bypassCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return {
          ...cached.data,
          cached: true
        };
      }
      this.cache.delete(cacheKey);
    }

    // 2. In-flight request deduplication
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    // 3. Query provider with deduplication promise
    const requestPromise = (async () => {
      try {
        const result = await this.provider.fetchLandCover(lat, lon, options);

        // Cache successful and clean responses (bounded LRU-style eviction)
        if (result && result.available) {
          if (this.cache.size >= MAX_CACHE_ENTRIES) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
          }
          this.cache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
          });
        }

        return result;
      } catch (err) {
        return {
          available: false,
          source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
          classCode: null,
          className: null,
          category: 'unknown',
          confidence: null,
          retrievedAt: new Date().toISOString(),
          error: err.message || 'Unexpected error fetching satellite land cover'
        };
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * Clears the in-memory cache and in-flight requests.
   */
  clearCache() {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Sets a custom provider (for testing or provider switching).
   * @param {Object} provider
   */
  setProvider(provider) {
    this.provider = provider;
    this.clearCache();
  }
}

/**
 * Evaluates contextual risk contribution points for a normalized satellite land-cover result.
 *
 * Risk Logic:
 *   - bare: +5 points (lack of root anchoring, increased surface erosion vulnerability)
 *   - vegetation: -3 points (canopy interception and root shear reinforcement)
 *   - cropland: +2 points (agricultural disturbance, managed soil)
 *   - built_up: +1 point (human infrastructure footprint, slope cut exposure)
 *   - water / other / unknown: 0 points (neutral)
 *   - unavailable / error: 0 points (neutral; NEVER converted to safe)
 *
 * @param {Object} [satelliteResult]
 * @returns {Object} Structured satellite evidence with bounded contribution points and interpretation
 */
function evaluateSatelliteRiskContribution(satelliteResult) {
  if (!satelliteResult || !satelliteResult.available) {
    return {
      available: false,
      source: satelliteResult?.source || 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)',
      classCode: null,
      className: null,
      category: 'unknown',
      contributionPoints: 0,
      interpretation: 'Satellite land-cover evidence unavailable or unclassified; neutral contribution (0 pts).'
    };
  }

  const category = satelliteResult.category;
  const className = satelliteResult.className || 'Unknown';
  const source = satelliteResult.source || 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)';

  let contributionPoints = 0;
  let interpretation = '';

  switch (category) {
    case 'bare':
      contributionPoints = 5;
      interpretation = `Exposed bare ground / loose surface (${className}) detected from satellite imagery; lacks root anchoring, increasing surface vulnerability (+5 pts).`;
      break;
    case 'vegetation':
      contributionPoints = -3;
      interpretation = `Dense vegetation / tree canopy (${className}) detected from satellite imagery; provides contextual soil reinforcement and rainfall interception (-3 pts).`;
      break;
    case 'cropland':
      contributionPoints = 2;
      interpretation = `Agricultural / cropland (${className}) detected from satellite imagery; managed soil and altered drainage represent moderate contextual susceptibility (+2 pts).`;
      break;
    case 'built_up':
      contributionPoints = 1;
      interpretation = `Built-up / infrastructure footprint (${className}) detected from satellite imagery; highlights human exposure and slope modification (+1 pt).`;
      break;
    case 'water':
      contributionPoints = 0;
      interpretation = `Surface water body (${className}) detected from satellite imagery; represents aquatic environment (0 pts).`;
      break;
    case 'other':
      contributionPoints = 0;
      interpretation = `Alpine snow/ice or other land cover (${className}) detected from satellite imagery; neutral contribution (0 pts).`;
      break;
    case 'unknown':
    default:
      contributionPoints = 0;
      interpretation = `Unclassified or obscured land cover (${className}) from satellite imagery; neutral contribution (0 pts).`;
      break;
  }

  return {
    available: true,
    source,
    classCode: satelliteResult.classCode,
    className,
    category,
    contributionPoints,
    interpretation
  };
}

const singletonService = new SatelliteLandCoverService();

module.exports = {
  SatelliteLandCoverService,
  satelliteLandCoverService: singletonService,
  evaluateSatelliteRiskContribution
};
