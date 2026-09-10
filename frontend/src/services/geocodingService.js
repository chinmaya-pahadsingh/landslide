class GeocodingService {
  constructor() {
    this.cache = new Map();
    this.activeControllers = new Map(); // query -> AbortController
    this.lastRequestTime = 0;
    this.MIN_DELAY_MS = 1000; // 1 second as per Nominatim policy
  }

  async search(query) {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return [];
    }
    
    const normalizedQuery = query.trim().toLowerCase();

    // 1. Check Cache
    if (this.cache.has(normalizedQuery)) {
      return this.cache.get(normalizedQuery);
    }

    // 2. Cancellation of in-flight identical or previous requests
    // Cancel any active request if a NEW search is initiated to avoid race conditions.
    for (const [key, controller] of this.activeControllers.entries()) {
      controller.abort();
      this.activeControllers.delete(key);
    }

    const abortController = new AbortController();
    this.activeControllers.set(normalizedQuery, abortController);

    // 3. Throttling / Rate Limiting (ensure at least 1s between requests)
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_DELAY_MS) {
      const waitTime = this.MIN_DELAY_MS - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Check if aborted during the wait
    if (abortController.signal.aborted) {
      throw new Error('AbortError');
    }

    this.lastRequestTime = Date.now();

    try {
      let data = null;

      // 4. Primary: OpenStreetMap Nominatim with English preference
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(normalizedQuery)}&limit=5&accept-language=en&addressdetails=1`;

      try {
        const response = await fetch(nominatimUrl, {
          signal: abortController.signal
        });

        if (response && response.ok) {
          const json = await response.json();
          if (Array.isArray(json) || (json && Array.isArray(json.features))) {
            data = json;
          }
        }
      } catch (err) {
        if (abortController.signal.aborted) throw err;
        // Provider network error or policy block; proceed to fallback
      }

      // Check if primary response has usable results
      const hasResults = (Array.isArray(data) && data.length > 0) || (data && Array.isArray(data.features) && data.features.length > 0);

      // 5. Fallback: OpenStreetMap Photon (Komoot) when Nominatim fails, is blocked, or returns empty
      if (!hasResults) {
        try {
          const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(normalizedQuery)}&limit=5`;
          const photonRes = await fetch(photonUrl, {
            signal: abortController.signal
          });

          if (photonRes && photonRes.ok) {
            const photonJson = await photonRes.json();
            if (photonJson && Array.isArray(photonJson.features) && photonJson.features.length > 0) {
              data = photonJson;
            }
          }
        } catch (photonErr) {
          if (abortController.signal.aborted) throw photonErr;
        }
      }

      const hasResultsAfterPhoton = (Array.isArray(data) && data.length > 0) || (data && Array.isArray(data.features) && data.features.length > 0);

      // 6. Tier 3 Fallback: Server-side geocoding proxy (/api/geocoding) with offline gazetteer
      if (!hasResultsAfterPhoton) {
        try {
          const proxyUrl = `/api/geocoding?q=${encodeURIComponent(normalizedQuery)}`;
          const proxyRes = await fetch(proxyUrl, {
            signal: abortController.signal
          });

          if (proxyRes && proxyRes.ok) {
            const proxyJson = await proxyRes.json();
            if (Array.isArray(proxyJson) && proxyJson.length > 0) {
              data = proxyJson;
            }
          }
        } catch (proxyErr) {
          if (abortController.signal.aborted) throw proxyErr;
        }
      }

      if (!data) {
        throw new Error('Geocoding providers unavailable.');
      }

      // 7. Validation & Standardization
      const results = this.parseResults(data);

      // 7. Cache non-empty results
      if (results.length > 0) {
        this.cache.set(normalizedQuery, results);
        if (this.cache.size > 50) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
      }

      return results;
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'AbortError') {
        throw error; // Rethrow to let caller handle cancellation silently
      }
      console.error('Geocoding error:', error);
      throw new Error('Failed to fetch location data. Please try again later.');
    } finally {
      this.activeControllers.delete(normalizedQuery);
    }
  }

  /**
   * Parses results from both Nominatim format and Photon GeoJSON format.
   */
  parseResults(data) {
    if (!data) return [];

    // Format 1: Photon GeoJSON FeatureCollection
    if (data && Array.isArray(data.features)) {
      return data.features
        .map(f => {
          const coords = f.geometry?.coordinates || [];
          const lon = parseFloat(coords[0]);
          const lat = parseFloat(coords[1]);
          const p = f.properties || {};
          const parts = [p.name, p.city, p.district, p.state, p.country].filter(
            (v, i, a) => v && typeof v === 'string' && a.indexOf(v) === i
          );
          return {
            id: String(p.osm_id || Math.random().toString()),
            name: parts.join(', ') || p.name || 'Unknown Location',
            lat,
            lon
          };
        })
        .filter(item => this.isValidCoordinate(item.lat, item.lon));
    }

    // Format 2: Standard OpenStreetMap Nominatim Array
    if (Array.isArray(data)) {
      return data
        .map(item => {
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          return {
            id: String(item.place_id || item.id || item.name || Math.random().toString()),
            name: item.display_name || item.name || 'Unknown Location',
            lat,
            lon
          };
        })
        .filter(item => this.isValidCoordinate(item.lat, item.lon));
    }

    return [];
  }

  /**
   * Coordinate validation guardrail
   */
  isValidCoordinate(lat, lon) {
    return (
      typeof lat === 'number' &&
      typeof lon === 'number' &&
      !isNaN(lat) &&
      !isNaN(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    );
  }
}

export const geocodingService = new GeocodingService();
