import { api } from './api';

export const fieldReportService = {
  /**
   * Fetches all field reports
   * @returns {Promise<Array>} Array of field report objects
   */
  async getAllReports() {
    return api.get('/field-reports');
  },

  /**
   * Fetches field reports within a radius around coordinates.
   * @param {number} lat
   * @param {number} lon
   * @param {number} [radius=50000]
   * @returns {Promise<Array>}
   */
  async getReportsNear(lat, lon, radius = 50000) {
    return api.get(`/field-reports?lat=${lat}&lon=${lon}&radius=${radius}`, false);
  },

  /**
   * Submits a new field report
   * @param {Object} reportData - The report data
   * @param {string} [idempotencyKey] - Optional stability UUID for offline retry protection
   * @returns {Promise<Object>} The saved report object
   */
  async submitReport(reportData, idempotencyKey) {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    const token = localStorage.getItem('jwt_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (idempotencyKey) {
      headers['X-Idempotency-Key'] = idempotencyKey;
    }

    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'}/field-reports`, {
      method: 'POST',
      headers,
      body: JSON.stringify(reportData)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP Error: ${response.status}`);
    }
    
    return response.json();
  }
};
