import { api } from './api';

class DashboardService {
  /**
   * Fetches full location-aware dashboard intelligence for given coordinates.
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {AbortSignal} [signal] - Optional AbortSignal for request cancellation
   * @returns {Promise<Object>} Dashboard intelligence payload
   */
  async getIntelligence(lat, lon, signal) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      throw new Error('Valid latitude and longitude are required.');
    }

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('jwt_token') : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/dashboard/intelligence?lat=${lat}&lon=${lon}`, {
        method: 'GET',
        headers,
        signal
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP Error: ${response.status} ${response.statusText}`);
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

export const dashboardService = new DashboardService();
