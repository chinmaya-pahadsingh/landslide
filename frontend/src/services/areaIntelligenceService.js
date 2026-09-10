

class AreaIntelligenceService {
  /**
   * Fetches area intelligence for a given latitude and longitude.
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {AbortSignal} [signal] - Optional AbortSignal for request cancellation
   * @returns {Promise<Object>} The area intelligence response
   */
  async getIntelligence(lat, lon, signal, tokenOverride) {
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
      const response = await fetch(`${API_BASE_URL}/area-intelligence?lat=${lat}&lon=${lon}`, {
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

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'AbortError') {
        throw new Error('AbortError');
      }
      throw error;
    }
  }
}

export const areaIntelligenceService = new AreaIntelligenceService();
