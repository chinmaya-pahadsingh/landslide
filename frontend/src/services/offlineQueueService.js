const DB_NAME = 'ner_lmrs_offline_db';
const STORE_NAME = 'field_reports_queue';
const DB_VERSION = 1;

/**
 * Open the IndexedDB database
 */
const openDB = () => {
  return new Promise((resolve, reject) => {
    // Graceful fallback for non-browser environments (like Node.js tests) without IndexedDB
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
};

/**
 * Generate a client-side UUID for pending records
 */
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

export const offlineQueueService = {
  /**
   * Queue a report payload to IndexedDB
   * @param {Object} payload 
   * @param {string} [idempotencyKey] 
   * @returns {Promise<Object>} The queued record
   */
  async queueReport(payload, idempotencyKey) {
    const recordId = idempotencyKey || generateId();
    const db = await openDB();
    
    if (!db) {
      // In-memory fallback if IndexedDB is completely unavailable (e.g., private mode or tests)
      console.warn('IndexedDB unavailable. Queueing to memory (will not persist across reloads).');
      return { id: recordId, payload, queuedAt: Date.now() };
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const record = {
        id: recordId,
        payload,
        queuedAt: Date.now()
      };

      const request = store.add(record);

      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Retrieve all pending queued reports
   * @returns {Promise<Array>} Array of queued records
   */
  async getQueuedReports() {
    const db = await openDB();
    if (!db) return [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Remove a report from the queue after successful sync
   * @param {string} id 
   */
  async removeReport(id) {
    const db = await openDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};
