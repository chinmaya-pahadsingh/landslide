const axios = require('axios');

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation';
const TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;

/**
 * Validates a single coordinate pair
 */
const isValidCoordinate = (lat, lon) => {
  if (lat == null || lon == null) return false;
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!isFinite(lat) || !isFinite(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  return true;
};

/**
 * Fetches elevation for an array of coordinate pairs
 * @param {Array<{latitude: number, longitude: number}>} coordinates
 * @returns {Promise<{ status: 'success' | 'error', reason?: string, data?: Array<{latitude: number, longitude: number, elevation: number | null, status: 'success' | 'missing'}> }>}
 */
const fetchElevations = async (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { status: 'error', reason: 'Invalid or empty coordinates array' };
  }

  const lats = [];
  const lons = [];

  for (const c of coordinates) {
    if (!isValidCoordinate(c.latitude, c.longitude)) {
      return { status: 'error', reason: 'Invalid coordinates provided' };
    }
    lats.push(c.latitude);
    lons.push(c.longitude);
  }

  const params = {
    latitude: lats.join(','),
    longitude: lons.join(',')
  };

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      const response = await axios.get(OPEN_METEO_URL, {
        params,
        timeout: TIMEOUT_MS
      });

      const data = response.data;
      if (!data || !Array.isArray(data.elevation)) {
        return { status: 'error', reason: 'Malformed response: missing elevation array' };
      }

      if (data.elevation.length !== coordinates.length) {
        return { status: 'error', reason: 'Mismatch between requested coordinates and response array' };
      }

      // Parse the results
      const results = coordinates.map((coord, index) => {
        const rawElev = data.elevation[index];
        let elevation = null;
        let pointStatus = 'missing';

        if (typeof rawElev === 'number' && isFinite(rawElev)) {
            elevation = rawElev;
            pointStatus = 'success';
        }

        return {
          latitude: coord.latitude,
          longitude: coord.longitude,
          elevation,
          status: pointStatus
        };
      });

      return { status: 'success', data: results };

    } catch (error) {
      // Don't retry on 429 Rate Limit
      if (error.response && error.response.status === 429) {
        return {
          status: 'error',
          reason: 'Rate limit exceeded from provider',
          isRateLimited: true,
          statusCode: 429
        };
      }

      // Don't retry on other 4xx Client Errors
      if (error.response && error.response.status >= 400 && error.response.status < 500) {
        return {
          status: 'error',
          reason: `Client error: ${error.response.status}`,
          statusCode: error.response.status
        };
      }

      const isTimeout = error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout');

      attempt++;
      if (attempt > MAX_RETRIES) {
         return { 
           status: 'error', 
           reason: isTimeout ? 'Timeout' : (error.message || 'Network failure'),
           isTimeout: !!isTimeout
         };
      }
      
      // Backoff before retry (e.g., 200ms)
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
};

module.exports = {
  fetchElevations,
  isValidCoordinate,
  OPEN_METEO_URL
};
