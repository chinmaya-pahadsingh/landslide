const axios = require('axios');

const weatherCache = new Map();
const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

class OpenMeteoProvider {
  /**
   * Fetches soil moisture for the given coordinates.
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {Promise<Object>} An object containing the volumetric soil moisture fraction (m3/m3) and the timestamp.
   */
  static async fetchSoilMoisture(lat, lon) {
    const timeout = parseInt(process.env.WEATHER_API_TIMEOUT_MS, 10) || 10000;
    
    try {
      const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: lat,
          longitude: lon,
          current: 'soil_moisture_0_to_1cm'
        },
        headers: {
          'User-Agent': 'LandslideEarlyWarning/1.0.0 (https://github.com/chinmaya-pahadsingh/landslide)'
        },
        timeout: timeout
      });

      const current = response.data.current;
      if (!current || current.soil_moisture_0_to_1cm === undefined || current.time === undefined) {
        throw new Error('Malformed provider response: missing required soil moisture fields.');
      }

      return {
        soilMoistureVolumetric: current.soil_moisture_0_to_1cm,
        recordedAt: new Date(current.time)
      };
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout')) {
        const err = new Error('Weather provider request timed out.');
        err.status = 504;
        err.isTimeout = true;
        throw err;
      }
      if (error.response && error.response.status === 429) {
        const err = new Error('Rate limit exceeded from provider.');
        err.status = 429;
        err.isRateLimited = true;
        throw err;
      }
      if (error.response && error.response.status >= 400 && error.response.status < 500) {
        const err = new Error(`Provider returned ${error.response.status}`);
        err.status = error.response.status;
        throw err;
      }
      throw error;
    }
  }

  /**
   * Fetches rainfall/precipitation for the given coordinates.
   * Requests both current interval precipitation and hourly precipitation covering the preceding 24 hours.
   * Calculates the mathematically valid accumulated 24-hour precipitation relative to the provider observation time.
   *
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {Promise<Object>} An object containing:
   *   - precipitation: current interval precipitation (mm)
   *   - precipitation24h: accumulated 24-hour precipitation (mm) or null if coverage is incomplete/invalid
   *   - recordedAt: Date of the current observation
   */
  static async fetchRainfall(lat, lon) {
    const timeout = parseInt(process.env.WEATHER_API_TIMEOUT_MS, 10) || 10000;
    
    try {
      const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: lat,
          longitude: lon,
          current: 'precipitation,temperature_2m,relative_humidity_2m,wind_speed_10m',
          hourly: 'precipitation,precipitation_probability',
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
          timezone: 'auto',
          past_hours: 24,
          forecast_hours: 1
        },
        headers: {
          'User-Agent': 'LandslideEarlyWarning/1.0.0 (https://github.com/chinmaya-pahadsingh/landslide)'
        },
        timeout: timeout
      });

      const current = response.data?.current;
      if (!current || current.precipitation === undefined || current.time === undefined) {
        throw new Error('Malformed provider response: missing required precipitation fields.');
      }

      const recordedAt = new Date(current.time);
      if (isNaN(recordedAt.getTime())) {
        throw new Error('Malformed provider response: invalid current time.');
      }

      // Calculate 24-hour accumulated precipitation from hourly intervals preceding recordedAt
      let precipitation24h = null;
      let precipitationProbability = null;
      const hourly = response.data?.hourly;

      if (
        hourly &&
        Array.isArray(hourly.time) &&
        Array.isArray(hourly.precipitation) &&
        hourly.time.length === hourly.precipitation.length &&
        hourly.time.length > 0
      ) {
        const refTimeMs = recordedAt.getTime();
        // Allow covering the preceding 24 full hourly intervals even when current observation time has a non-zero minute offset (e.g. :15, :30, :45)
        const windowStartMs = refTimeMs - 25 * 60 * 60 * 1000;

        const matchedHourly = [];
        let hasInvalidValue = false;

        for (let i = 0; i < hourly.time.length; i++) {
          const t = new Date(hourly.time[i]);
          if (isNaN(t.getTime())) {
            hasInvalidValue = true;
            break;
          }
          const tMs = t.getTime();

          // Collect hourly records that fall within the preceding 24-hour window up to the current observation time
          if (tMs >= windowStartMs && tMs <= refTimeMs) {
            const val = hourly.precipitation[i];
            if (typeof val !== 'number' || isNaN(val) || !isFinite(val) || val < 0) {
              hasInvalidValue = true;
              break;
            }
            matchedHourly.push({ timeMs: tMs, val });
          }
        }

        // Full 24-hour hourly coverage requires at least 24 valid hourly records in the 24h window
        if (!hasInvalidValue && matchedHourly.length >= 24) {
          const target24 = matchedHourly.slice(-24);
          const sum = target24.reduce((acc, h) => acc + h.val, 0);
          precipitation24h = Math.round(sum * 10) / 10;
        }

        // Extract precipitation probability for current interval if available
        if (Array.isArray(hourly.precipitation_probability) && hourly.precipitation_probability.length > 0) {
          const lastProb = hourly.precipitation_probability[hourly.precipitation_probability.length - 1];
          if (typeof lastProb === 'number' && !isNaN(lastProb) && lastProb >= 0 && lastProb <= 100) {
            precipitationProbability = lastProb;
          }
        }
      }

      const temperature = typeof current.temperature_2m === 'number' && !isNaN(current.temperature_2m)
        ? Math.round(current.temperature_2m * 10) / 10
        : null;

      const humidity = typeof current.relative_humidity_2m === 'number' && !isNaN(current.relative_humidity_2m)
        ? Math.round(current.relative_humidity_2m)
        : null;

      const windSpeed = typeof current.wind_speed_10m === 'number' && !isNaN(current.wind_speed_10m)
        ? Math.round(current.wind_speed_10m * 10) / 10
        : null;

      let dailyForecast = null;
      const daily = response.data?.daily;
      if (daily && Array.isArray(daily.time) && daily.time.length > 0) {
        dailyForecast = daily.time.map((dateStr, idx) => ({
          date: dateStr,
          weatherCode: daily.weather_code?.[idx] ?? 0,
          maxTemp: typeof daily.temperature_2m_max?.[idx] === 'number' ? Math.round(daily.temperature_2m_max[idx] * 10) / 10 : null,
          minTemp: typeof daily.temperature_2m_min?.[idx] === 'number' ? Math.round(daily.temperature_2m_min[idx] * 10) / 10 : null,
          precipitationSum: typeof daily.precipitation_sum?.[idx] === 'number' ? Math.round(daily.precipitation_sum[idx] * 10) / 10 : 0,
          precipitationProbabilityMax: daily.precipitation_probability_max?.[idx] ?? null
        })).slice(0, 7);
      }

      return {
        precipitation: current.precipitation,
        precipitation24h: precipitation24h,
        temperature,
        humidity,
        windSpeed,
        precipitationProbability,
        dailyForecast,
        recordedAt: recordedAt
      };
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout')) {
        const err = new Error('Weather provider request timed out.');
        err.status = 504;
        err.isTimeout = true;
        throw err;
      }
      if (error.response && error.response.status === 429) {
        const err = new Error('Rate limit exceeded from provider.');
        err.status = 429;
        err.isRateLimited = true;
        throw err;
      }
      if (error.response && error.response.status >= 400 && error.response.status < 500) {
        const err = new Error(`Provider returned ${error.response.status}`);
        err.status = error.response.status;
        throw err;
      }
      throw error;
    }
  }

  /**
   * Fetches weather telemetry (temperature, humidity, wind, 24h rainfall, current precipitation, rain probability)
   * for the given coordinates with resilient caching and fast lightweight fallback.
   */
  static async fetchWeather(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
      throw new Error('Invalid coordinates');
    }

    const isTest = process.env.NODE_ENV === 'test';
    const normLat = Math.round(lat * 100) / 100;
    const normLon = Math.round(lon * 100) / 100;
    const cacheKey = `${normLat}_${normLon}`;

    if (!isTest) {
      const cached = weatherCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp < WEATHER_CACHE_TTL_MS)) {
        return cached.data;
      }
    }

    let lastError;
    // Primary attempt: Full 24h rainfall, hourly series and daily forecast
    try {
      const data = await OpenMeteoProvider.fetchRainfall(lat, lon);
      if (!isTest) {
        weatherCache.set(cacheKey, { timestamp: Date.now(), data });
      }
      return data;
    } catch (err) {
      lastError = err;
    }

    // Fallback: If heavy request timed out or was rate-limited on cloud server, attempt fast lightweight current query
    try {
      const timeout = Math.min(parseInt(process.env.WEATHER_API_TIMEOUT_MS, 10) || 10000, 6000);
      const fastResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: lat,
          longitude: lon,
          current: 'precipitation,temperature_2m,relative_humidity_2m,wind_speed_10m',
          daily: 'precipitation_sum,precipitation_probability_max'
        },
        headers: {
          'User-Agent': 'LandslideEarlyWarning/1.0.0 (https://github.com/chinmaya-pahadsingh/landslide)'
        },
        timeout
      });

      const current = fastResponse.data?.current;
      if (current && current.temperature_2m !== undefined) {
        const recordedAt = current.time ? new Date(current.time) : new Date();
        const daily = fastResponse.data?.daily;
        const fallbackData = {
          precipitation: typeof current.precipitation === 'number' ? current.precipitation : 0,
          precipitation24h: typeof daily?.precipitation_sum?.[0] === 'number' ? Math.round(daily.precipitation_sum[0] * 10) / 10 : null,
          temperature: typeof current.temperature_2m === 'number' ? Math.round(current.temperature_2m * 10) / 10 : null,
          humidity: typeof current.relative_humidity_2m === 'number' ? Math.round(current.relative_humidity_2m) : null,
          windSpeed: typeof current.wind_speed_10m === 'number' ? Math.round(current.wind_speed_10m * 10) / 10 : null,
          precipitationProbability: typeof daily?.precipitation_probability_max?.[0] === 'number' ? daily.precipitation_probability_max[0] : null,
          dailyForecast: null,
          recordedAt
        };
        if (!isTest) {
          weatherCache.set(cacheKey, { timestamp: Date.now(), data: fallbackData });
        }
        return fallbackData;
      }
    } catch (fallbackErr) {
      // Fast fallback also failed
    }

    throw lastError || new Error('Weather fetch failed');
  }
}

module.exports = OpenMeteoProvider;
