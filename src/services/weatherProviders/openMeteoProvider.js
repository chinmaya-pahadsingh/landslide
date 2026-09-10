const axios = require('axios');

class OpenMeteoProvider {
  /**
   * Fetches soil moisture for the given coordinates.
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {Promise<Object>} An object containing the volumetric soil moisture fraction (m3/m3) and the timestamp.
   */
  static async fetchSoilMoisture(lat, lon) {
    const timeout = parseInt(process.env.WEATHER_API_TIMEOUT_MS, 10) || 5000;
    
    try {
      const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: lat,
          longitude: lon,
          current: 'soil_moisture_0_to_1cm'
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
    const timeout = parseInt(process.env.WEATHER_API_TIMEOUT_MS, 10) || 5000;
    
    try {
      const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: lat,
          longitude: lon,
          current: 'precipitation,temperature_2m,relative_humidity_2m,wind_speed_10m',
          hourly: 'precipitation,precipitation_probability',
          past_hours: 24,
          forecast_hours: 1
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
        const windowStartMs = refTimeMs - 24 * 60 * 60 * 1000;

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

      return {
        precipitation: current.precipitation,
        precipitation24h: precipitation24h,
        temperature,
        humidity,
        windSpeed,
        precipitationProbability,
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
   * for the given coordinates.
   */
  static async fetchWeather(lat, lon) {
    return OpenMeteoProvider.fetchRainfall(lat, lon);
  }
}

module.exports = OpenMeteoProvider;
