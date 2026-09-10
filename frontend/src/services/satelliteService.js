/**
 * Satellite Service
 *
 * Frontend service to query satellite land-cover observations from the backend API.
 * Endpoint: GET /api/satellite/land-cover?lat=<lat>&lon=<lon>
 */

class SatelliteService {
  /**
   * Fetches satellite land-cover classification for a specific coordinate.
   *
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {AbortSignal} [signal] - Optional abort signal
   * @returns {Promise<Object>} The normalized satellite evidence
   */
  async getLandCover(lat, lon, signal, tokenOverride) {
    if (lat == null || lon == null) {
      throw new Error('Latitude and longitude are required.');
    }

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
    const token = tokenOverride || (typeof localStorage !== 'undefined' ? localStorage.getItem('jwt_token') : null);
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/satellite/land-cover?lat=${lat}&lon=${lon}`, {
        method: 'GET',
        headers,
        signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.error || `HTTP Error: ${response.status} ${response.statusText}`);
        err.status = response.status;
        err.data = errorData;
        throw err;
      }

      const json = await response.json();
      return json.data || json;
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'AbortError') {
        throw new Error('AbortError');
      }
      throw error;
    }
  }
}

export const satelliteService = new SatelliteService();
