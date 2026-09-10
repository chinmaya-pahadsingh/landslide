import { api } from './api';

export const rainfallObservationService = {
  /**
   * Fetches all registered rainfall observations.
   * @returns {Promise<Array>} Array of rainfall observation objects
   */
  async getAllObservations() {
    return api.get('/rainfall');
  }
};
