import { api } from './api';

export const landslideEventService = {
  /**
   * Fetches registered landslide events with optional filtering.
   * @param {Object} [params]
   * @param {string} [params.region] - e.g. 'NER'
   * @param {string} [params.source] - e.g. 'GSI' or 'NASA'
   * @param {boolean} [params.isHistorical]
   * @returns {Promise<Array>} Array of landslide event objects
   */
  async getAllEvents(params = {}) {
    const queryParts = [];
    if (params?.region) queryParts.push(`region=${encodeURIComponent(params.region)}`);
    if (params?.source) queryParts.push(`source=${encodeURIComponent(params.source)}`);
    if (params?.isHistorical !== undefined) queryParts.push(`isHistorical=${params.isHistorical}`);
    const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return api.get(`/landslide-events${qs}`);
  },

  /**
   * Fetches landslide events within a radius around coordinates.
   * @param {number} lat
   * @param {number} lon
   * @param {number} [radius=50000]
   * @returns {Promise<Array>}
   */
  async getEventsNear(lat, lon, radius = 50000) {
    return api.get(`/landslide-events?lat=${lat}&lon=${lon}&radius=${radius}`, false);
  }
};
