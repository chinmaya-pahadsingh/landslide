const SoilMoistureObservation = require('../models/SoilMoistureObservation');
const weatherProviderFactory = require('./weatherProviders/weatherProviderFactory');

const CACHE_TTL_DEFAULT = 3600; // 1 hour
const inFlightRequests = new Map();

/**
 * Gets a fresh observation from the database cache.
 */
const getFreshObservation = async (lat, lon) => {
  const ttlSeconds = parseInt(process.env.WEATHER_CACHE_TTL_SECONDS, 10) || CACHE_TTL_DEFAULT;
  const cutoff = new Date(Date.now() - ttlSeconds * 1000);

  const observation = await SoilMoistureObservation.findOne({
    'location.latitude': lat,
    'location.longitude': lon,
    source: 'modelled',
    recordedAt: { $gte: cutoff }
  }).sort({ recordedAt: -1 });

  return observation;
};

/**
 * Normalizes coordinates to 2 decimal places to help caching/grid alignment.
 */
const normalizeCoordinate = (coord) => {
  return Math.round(coord * 100) / 100;
};

/**
 * Syncs soil moisture data safely.
 */
const syncSoilMoisture = async (lat, lon, isSimulation = false) => {
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
    throw new Error('Invalid coordinates');
  }

  const normalizedLat = normalizeCoordinate(lat);
  const normalizedLon = normalizeCoordinate(lon);

  // 1. Simulation bypassing
  if (isSimulation) {
    return {
      status: 'success',
      dataMode: 'simulation',
      data: {
        location: { latitude: normalizedLat, longitude: normalizedLon },
        soilMoisture: 100, // 100% v/v simulation
        source: 'simulation',
        recordedAt: new Date()
      }
    };
  }

  // 2. Cache check
  const freshObs = await getFreshObservation(normalizedLat, normalizedLon);
  if (freshObs) {
    return {
      status: 'success',
      dataMode: 'cached',
      freshness: 'fresh',
      upstreamStatus: 'not_called',
      data: freshObs
    };
  }

  // 3. Deduplication check
  const deduplicationKey = `${normalizedLat}_${normalizedLon}`;
  if (inFlightRequests.has(deduplicationKey)) {
    return inFlightRequests.get(deduplicationKey);
  }

  // 4. Fetch and Store logic
  const fetchPromise = (async () => {
    try {
      const providerName = process.env.WEATHER_PROVIDER || 'open-meteo';
      const provider = weatherProviderFactory.getProvider(providerName);

      // Simple bounded retry logic
      let providerData;
      let lastError;
      const MAX_RETRIES = 1;
      
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          providerData = await provider.fetchSoilMoisture(normalizedLat, normalizedLon);
          break; // Success
        } catch (error) {
          lastError = error;
          if (error.status && error.status >= 400 && error.status < 500) {
            // Do not retry 4xx errors
            break;
          }
          if (attempt < MAX_RETRIES) {
            // Simple backoff
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      if (!providerData) {
        throw lastError || new Error('Provider failed');
      }

      const { soilMoistureVolumetric, recordedAt } = providerData;

      // Strict Validation
      if (typeof soilMoistureVolumetric !== 'number' || isNaN(soilMoistureVolumetric) || !isFinite(soilMoistureVolumetric)) {
        throw new Error('NaN/infinite/non-numeric soil moisture value.');
      }
      if (soilMoistureVolumetric < 0 || soilMoistureVolumetric > 1.0) {
        throw new Error('Impossible soil moisture value. Must be between 0 and 1.0 (m3/m3).');
      }
      
      if (!recordedAt || isNaN(recordedAt.getTime())) {
        throw new Error('Invalid or missing timestamp from provider.');
      }

      // Conversion: multiply by 100 for % v/v
      const soilMoisturePercentage = Math.round(soilMoistureVolumetric * 100);

      // Store in DB
      const newObs = new SoilMoistureObservation({
        location: { latitude: normalizedLat, longitude: normalizedLon },
        soilMoisture: soilMoisturePercentage,
        source: 'modelled',
        recordedAt: recordedAt
      });

      await newObs.save();

      return {
        status: 'success',
        dataMode: 'live',
        freshness: 'fresh',
        upstreamStatus: 'success',
        data: newObs
      };
    } catch (error) {
      console.error(`Soil moisture sync failed for ${normalizedLat}, ${normalizedLon}:`, error.message);
      
      // Fallback explicitly to stale data if available
      const staleObs = await SoilMoistureObservation.findOne({
        'location.latitude': normalizedLat,
        'location.longitude': normalizedLon,
        source: 'modelled'
      }).sort({ recordedAt: -1 });

      if (staleObs) {
        return {
          status: 'success',
          dataMode: 'cached',
          freshness: 'stale',
          upstreamStatus: 'failed_upstream',
          data: staleObs
        };
      }

      return {
        status: 'failed_upstream',
        dataMode: 'unavailable',
        freshness: 'unavailable',
        upstreamStatus: 'failed_upstream',
        message: 'Live data unavailable'
      };
    } finally {
      inFlightRequests.delete(deduplicationKey);
    }
  })();

  inFlightRequests.set(deduplicationKey, fetchPromise);
  return fetchPromise;
};

module.exports = {
  syncSoilMoisture
};
