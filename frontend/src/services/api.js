const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const getHeaders = (requireAuth = true) => {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (requireAuth) {
    const token = localStorage.getItem('jwt_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  
  return headers;
};

/**
 * Core API service handling standard fetch logic, JSON parsing, and HTTP errors.
 */
export const api = {
  async get(endpoint, requireAuth = true) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'GET',
        headers: getHeaders(requireAuth)
      });

      if (!response.ok) {
        let errorMsg = `HTTP Error: ${response.status} ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData && (errData.error || errData.message)) {
            errorMsg = errData.error || errData.message;
          }
        } catch (e) {
          // Ignore JSON parse error
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`API GET ${endpoint} failed:`, error);
      throw error;
    }
  },
  
  async post(endpoint, payload, requireAuth = true) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: getHeaders(requireAuth),
        body: payload ? JSON.stringify(payload) : undefined
      });

      if (!response.ok) {
        let errorMsg = `HTTP Error: ${response.status} ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData && (errData.error || errData.message)) {
            errorMsg = errData.error || errData.message;
          }
        } catch (e) {
          // Ignore JSON parse error
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`API POST ${endpoint} failed:`, error);
      throw error;
    }
  },
  
  async patch(endpoint, payload, requireAuth = true) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'PATCH',
        headers: getHeaders(requireAuth),
        body: payload ? JSON.stringify(payload) : undefined
      });

      if (!response.ok) {
        let errorMsg = `HTTP Error: ${response.status} ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData && (errData.error || errData.message)) {
            errorMsg = errData.error || errData.message;
          }
        } catch (e) {
          // Ignore JSON parse error
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`API PATCH ${endpoint} failed:`, error);
      throw error;
    }
  }
};

export const newsAPI = {
  getAll: (params) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return api.get(`/news${qs}`).then(data => ({ data }));
  },
  refresh: () => api.post('/news/refresh').then(data => ({ data })),
};

export const notificationAPI = {
  getAll: (params) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return api.get(`/notifications${qs}`).then(data => ({ data }));
  },
  markAsRead: (id) => api.patch(`/notifications/${id}/read`).then(data => ({ data })),
  markAllAsRead: () => api.patch('/notifications/read-all').then(data => ({ data })),
};
