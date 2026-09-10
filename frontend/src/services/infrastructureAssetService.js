import { api } from './api';

export const infrastructureAssetService = {
  /**
   * Fetches all registered infrastructure assets.
   * @returns {Promise<Array>} Array of infrastructure asset objects
   */
  async getAllAssets() {
    return api.get('/infrastructure-assets', false);
  },

  /**
   * Fetches infrastructure assets within a radius around coordinates.
   * @param {number} lat
   * @param {number} lon
   * @param {number} [radius=50000]
   * @returns {Promise<Array>}
   */
  async getAssetsNear(lat, lon, radius = 50000) {
    return api.get(`/infrastructure-assets?lat=${lat}&lon=${lon}&radius=${radius}`, false);
  }
};
