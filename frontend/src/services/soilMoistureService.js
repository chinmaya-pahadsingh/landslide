import { api } from './api';

export const soilMoistureService = {
  /**
   * Fetches all registered soil moisture observations.
   * @returns {Promise<Array>} Array of soil moisture observation objects
   */
  async getAllObservations() {
    return api.get('/soil-moisture');
  }
};
