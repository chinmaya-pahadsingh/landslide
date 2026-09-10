const RainfallObservation = require('../models/RainfallObservation');
const weatherProviderFactory = require('./weatherProviders/weatherProviderFactory');

const CACHE_TTL_DEFAULT = 3600; // 1 hour
const inFlightRequests = new Map();

/**
 * Gets a fresh observation from the database cache.
 */
const getFreshObservation = async (lat, lon) => {
  const ttlSeconds = parseInt(process.env.WEATHER_CACHE_TTL_SECONDS, 10) || CACHE_TTL_DEFAULT;
  const cutoff = new Date(Date.now() - ttlSeconds * 1000);

  const observation = await RainfallObservation.findOne({
    'location.latitude': lat,
    'location.longitude': lon,
    source: 'weather_api',
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
 * Syncs rainfall data safely.
 */
const syncRainfall = async (lat, lon, isSimulation = false) => {
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
        rainfall: 300, // 300mm simulation
        rainfall24h: 300,
        currentIntervalPrecipitation: 50,
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
          // Add fetchRainfall to provider
          if (!provider.fetchRainfall) {
              throw new Error('Provider does not support fetchRainfall');
          }
          providerData = await provider.fetchRainfall(normalizedLat, normalizedLon);
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

      const { precipitation, precipitation24h, recordedAt, temperature, humidity, windSpeed, precipitationProbability } = providerData;

      // Strict Validation
      if (typeof precipitation !== 'number' || isNaN(precipitation) || !isFinite(precipitation)) {
        throw new Error('NaN/infinite/non-numeric precipitation value.');
      }
      if (precipitation < 0) {
        throw new Error('Impossible precipitation value. Must be >= 0.');
      }
      
      if (!recordedAt || isNaN(recordedAt.getTime())) {
        throw new Error('Invalid or missing timestamp from provider.');
      }

      let valid24h = null;
      if (typeof precipitation24h === 'number' && !isNaN(precipitation24h) && isFinite(precipitation24h) && precipitation24h >= 0) {
        valid24h = precipitation24h;
      }

      // Store in DB
      const newObs = new RainfallObservation({
        location: { latitude: normalizedLat, longitude: normalizedLon },
        rainfall: valid24h !== null ? valid24h : precipitation,
        rainfall24h: valid24h,
        currentIntervalPrecipitation: precipitation,
        source: 'weather_api',
        recordedAt: recordedAt
      });

      if (temperature != null || humidity != null || windSpeed != null || precipitationProbability != null) {
        newObs.weatherTelemetry = {
          temperature: typeof temperature === 'number' && !isNaN(temperature) ? temperature : null,
          humidity: typeof humidity === 'number' && !isNaN(humidity) ? humidity : null,
          windSpeed: typeof windSpeed === 'number' && !isNaN(windSpeed) ? windSpeed : null,
          precipitationProbability: typeof precipitationProbability === 'number' && !isNaN(precipitationProbability) ? precipitationProbability : null
        };
      }

      await newObs.save();

      return {
        status: 'success',
        dataMode: 'live',
        freshness: 'fresh',
        upstreamStatus: 'success',
        data: newObs
      };
    } catch (error) {
      console.error(`Rainfall sync failed for ${normalizedLat}, ${normalizedLon}:`, error.message);
      
      // Fallback explicitly to stale data if available
      const staleObs = await RainfallObservation.findOne({
        'location.latitude': normalizedLat,
        'location.longitude': normalizedLon,
        source: 'weather_api'
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
  syncRainfall
};
