const axios = require('axios');
const OpenMeteoProvider = require('./openMeteoProvider');

jest.mock('axios');

describe('OpenMeteoProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchSoilMoisture', () => {
    it('should correctly parse valid provider response', async () => {
      const mockData = {
        data: {
          current: {
            time: '2023-01-01T12:00:00Z',
            soil_moisture_0_to_1cm: 0.35
          }
        }
      };
      
      axios.get.mockResolvedValue(mockData);

      const result = await OpenMeteoProvider.fetchSoilMoisture(10, 20);
      
      expect(result.soilMoistureVolumetric).toBe(0.35);
      expect(result.recordedAt).toBeInstanceOf(Date);
      expect(axios.get).toHaveBeenCalledWith('https://api.open-meteo.com/v1/forecast', expect.any(Object));
    });

    it('should throw on malformed response (missing current)', async () => {
      axios.get.mockResolvedValue({ data: {} });
      await expect(OpenMeteoProvider.fetchSoilMoisture(10, 20)).rejects.toThrow('Malformed provider response');
    });

    it('should throw on missing time', async () => {
      axios.get.mockResolvedValue({
        data: {
          current: {
            soil_moisture_0_to_1cm: 0.35
          }
        }
      });
      await expect(OpenMeteoProvider.fetchSoilMoisture(10, 20)).rejects.toThrow('Malformed provider response');
    });

    it('should throw and attach 429 status when rate limited', async () => {
      const error = new Error('Request failed');
      error.response = { status: 429 };
      axios.get.mockRejectedValue(error);

      await expect(OpenMeteoProvider.fetchSoilMoisture(10, 20)).rejects.toThrow('Rate limit exceeded from provider.');
    });
  });

  describe('fetchRainfall', () => {
    it('calculates mathematically valid 24-hour accumulated precipitation from controlled hourly fixture', async () => {
      const refTime = '2026-09-09T09:00:00Z';
      const refDate = new Date(refTime);

      // Generate 24 preceding hourly records, each with 0.5 mm
      const times = [];
      const precipitations = [];
      for (let h = 23; h >= 0; h--) {
        const d = new Date(refDate.getTime() - h * 3600 * 1000);
        times.push(d.toISOString());
        precipitations.push(0.5);
      }

      const mockResponse = {
        data: {
          current: {
            time: refTime,
            precipitation: 0.2 // Current interval (15-min) value
          },
          hourly: {
            time: times,
            precipitation: precipitations
          }
        }
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await OpenMeteoProvider.fetchRainfall(26.16, 91.69);

      // 24 hours * 0.5 mm = 12.0 mm
      expect(result.precipitation24h).toBe(12.0);
      // Current interval precipitation must remain distinct
      expect(result.precipitation).toBe(0.2);
      expect(result.recordedAt).toEqual(refDate);

      // Verify request parameters passed to provider
      expect(axios.get).toHaveBeenCalledWith('https://api.open-meteo.com/v1/forecast', expect.objectContaining({
        params: expect.objectContaining({
          latitude: 26.16,
          longitude: 91.69,
          current: expect.stringContaining('precipitation'),
          hourly: expect.stringContaining('precipitation'),
          past_hours: 24,
          forecast_hours: 1
        })
      }));
    });

    it('extracts temperature, humidity, wind speed, and precipitation probability when present', async () => {
      const refDate = new Date('2026-09-09T10:00:00Z');
      const mockResponse = {
        data: {
          current: {
            time: refDate.toISOString(),
            precipitation: 0.5,
            temperature_2m: 28.4,
            relative_humidity_2m: 82,
            wind_speed_10m: 14.5
          },
          hourly: {
            time: [refDate.toISOString()],
            precipitation: [0.5],
            precipitation_probability: [65]
          }
        }
      };
      axios.get.mockResolvedValueOnce(mockResponse);

      const result = await OpenMeteoProvider.fetchRainfall(26.16, 91.69);
      expect(result.temperature).toBe(28.4);
      expect(result.humidity).toBe(82);
      expect(result.windSpeed).toBe(14.5);
      expect(result.precipitationProbability).toBe(65);
    });

    it('returns null for precipitation24h when hourly data is completely missing', async () => {
      const mockResponse = {
        data: {
          current: {
            time: '2026-09-09T09:00:00Z',
            precipitation: 0.4
          }
        }
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await OpenMeteoProvider.fetchRainfall(26.16, 91.69);

      expect(result.precipitation).toBe(0.4);
      expect(result.precipitation24h).toBeNull();
    });

    it('returns null for precipitation24h when hourly coverage has fewer than 24 hours', async () => {
      const refTime = '2026-09-09T09:00:00Z';
      const refDate = new Date(refTime);

      // Incomplete: only 10 hours provided
      const times = [];
      const precipitations = [];
      for (let h = 9; h >= 0; h--) {
        const d = new Date(refDate.getTime() - h * 3600 * 1000);
        times.push(d.toISOString());
        precipitations.push(1.0);
      }

      const mockResponse = {
        data: {
          current: {
            time: refTime,
            precipitation: 0.1
          },
          hourly: {
            time: times,
            precipitation: precipitations
          }
        }
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await OpenMeteoProvider.fetchRainfall(26.16, 91.69);

      // Incomplete coverage must be rejected and not fabricated
      expect(result.precipitation24h).toBeNull();
      expect(result.precipitation).toBe(0.1);
    });

    it('returns null for precipitation24h when an hourly precipitation value is invalid/corrupt', async () => {
      const refTime = '2026-09-09T09:00:00Z';
      const refDate = new Date(refTime);

      const times = [];
      const precipitations = [];
      for (let h = 23; h >= 0; h--) {
        const d = new Date(refDate.getTime() - h * 3600 * 1000);
        times.push(d.toISOString());
        precipitations.push(h === 5 ? 'corrupted' : 0.5);
      }

      const mockResponse = {
        data: {
          current: {
            time: refTime,
            precipitation: 0.1
          },
          hourly: {
            time: times,
            precipitation: precipitations
          }
        }
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await OpenMeteoProvider.fetchRainfall(26.16, 91.69);

      expect(result.precipitation24h).toBeNull();
    });

    it('throws when current precipitation is missing from provider response', async () => {
      axios.get.mockResolvedValue({
        data: {
          current: { time: '2026-09-09T09:00:00Z' }
        }
      });

      await expect(OpenMeteoProvider.fetchRainfall(10, 20)).rejects.toThrow('Malformed provider response');
    });

    it('throws and attaches 429 status on provider rate limit', async () => {
      const error = new Error('Rate limit error');
      error.response = { status: 429 };
      axios.get.mockRejectedValue(error);

      await expect(OpenMeteoProvider.fetchRainfall(10, 20)).rejects.toThrow('Rate limit exceeded from provider.');
    });
  });
});
