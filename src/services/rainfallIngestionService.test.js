const { syncRainfall } = require('./rainfallIngestionService');
const RainfallObservation = require('../models/RainfallObservation');
const weatherProviderFactory = require('./weatherProviders/weatherProviderFactory');

jest.mock('../models/RainfallObservation');
jest.mock('./weatherProviders/weatherProviderFactory');

describe('Rainfall Ingestion Service', () => {
  let mockProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      fetchRainfall: jest.fn()
    };
    weatherProviderFactory.getProvider.mockReturnValue(mockProvider);
  });

  describe('syncRainfall', () => {
    it('returns fresh cached rainfall without external request', async () => {
      const mockCached = { rainfall: 50, recordedAt: new Date() };
      
      const mockFindOne = {
        sort: jest.fn().mockResolvedValue(mockCached)
      };
      RainfallObservation.findOne.mockReturnValue(mockFindOne);

      const result = await syncRainfall(25, 90);

      expect(RainfallObservation.findOne).toHaveBeenCalled();
      expect(mockProvider.fetchRainfall).not.toHaveBeenCalled();
      
      expect(result).toEqual({
        status: 'success',
        dataMode: 'cached',
        freshness: 'fresh',
        upstreamStatus: 'not_called',
        data: mockCached
      });
    });

    it('returns successful live rainfall when no cache is available', async () => {
      const mockFindOne = {
        sort: jest.fn().mockResolvedValue(null) // no fresh cache
      };
      RainfallObservation.findOne.mockReturnValue(mockFindOne);

      mockProvider.fetchRainfall.mockResolvedValue({
        precipitation: 120,
        recordedAt: new Date()
      });

      const mockSave = jest.fn().mockResolvedValue(true);
      RainfallObservation.mockImplementation(() => ({
        save: mockSave
      }));

      const result = await syncRainfall(25, 90);

      expect(mockProvider.fetchRainfall).toHaveBeenCalledWith(25, 90);
      expect(mockSave).toHaveBeenCalled();
      
      expect(result).toEqual({
        status: 'success',
        dataMode: 'live',
        freshness: 'fresh',
        upstreamStatus: 'success',
        data: expect.any(Object)
      });
    });

    it('handles stale cache + live failure correctly', async () => {
      const mockFindOne = {
        sort: jest.fn()
          .mockResolvedValueOnce(null) // First call: fresh cache (not found)
          .mockResolvedValueOnce({ rainfall: 10, recordedAt: new Date(Date.now() - 10000000) }) // Second call: stale cache fallback
      };
      RainfallObservation.findOne.mockReturnValue(mockFindOne);

      // Provider fails
      mockProvider.fetchRainfall.mockRejectedValue(new Error('Network Error'));

      const result = await syncRainfall(25, 90);

      expect(result).toEqual({
        status: 'success',
        dataMode: 'cached',
        freshness: 'stale',
        upstreamStatus: 'failed_upstream',
        data: expect.any(Object)
      });
    });

    it('handles no cache + live failure correctly', async () => {
      const mockFindOne = {
        sort: jest.fn().mockResolvedValue(null) // No fresh cache, no stale cache
      };
      RainfallObservation.findOne.mockReturnValue(mockFindOne);

      // Provider fails
      mockProvider.fetchRainfall.mockRejectedValue(new Error('Network Error'));

      const result = await syncRainfall(25, 90);

      expect(result).toEqual({
        status: 'failed_upstream',
        dataMode: 'unavailable',
        freshness: 'unavailable',
        upstreamStatus: 'failed_upstream',
        message: 'Live data unavailable'
      });
    });

    it('returns simulation mode and does not contaminate cache', async () => {
      const result = await syncRainfall(25, 90, true);

      expect(RainfallObservation.findOne).not.toHaveBeenCalled();
      expect(mockProvider.fetchRainfall).not.toHaveBeenCalled();
      
      expect(result).toEqual({
        status: 'success',
        dataMode: 'simulation',
        data: expect.any(Object)
      });
      expect(result.data.source).toBe('simulation');
    });

    it('deduplicates concurrent requests', async () => {
      const mockFindOne = {
        sort: jest.fn().mockResolvedValue(null) // no fresh cache
      };
      RainfallObservation.findOne.mockReturnValue(mockFindOne);

      // Add small delay to provider to allow concurrent calls
      mockProvider.fetchRainfall.mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => resolve({
          precipitation: 120,
          recordedAt: new Date()
        }), 50));
      });

      const mockSave = jest.fn().mockResolvedValue(true);
      RainfallObservation.mockImplementation(() => ({ save: mockSave }));

      const promise1 = syncRainfall(25, 90);
      const promise2 = syncRainfall(25, 90);

      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(mockProvider.fetchRainfall).toHaveBeenCalledTimes(1); // Only called once
      expect(res1).toBe(res2); // Exactly same reference
    });

    it('stores distinct rainfall24h and currentIntervalPrecipitation from provider', async () => {
      const mockFindOne = {
        sort: jest.fn().mockResolvedValue(null)
      };
      RainfallObservation.findOne.mockReturnValue(mockFindOne);

      mockProvider.fetchRainfall.mockResolvedValue({
        precipitation: 0.5,
        precipitation24h: 18.5,
        recordedAt: new Date()
      });

      let savedPayload = null;
      RainfallObservation.mockImplementation((payload) => {
        savedPayload = payload;
        return { save: jest.fn().mockResolvedValue(true) };
      });

      await syncRainfall(26.16, 91.69);

      expect(savedPayload).toBeTruthy();
      expect(savedPayload.rainfall24h).toBe(18.5);
      expect(savedPayload.currentIntervalPrecipitation).toBe(0.5);
      expect(savedPayload.rainfall).toBe(18.5); // Backward-compatible primary value
    });

    it('stores rainfall24h as null when provider cannot calculate 24-hour precipitation', async () => {
      const mockFindOne = {
        sort: jest.fn().mockResolvedValue(null)
      };
      RainfallObservation.findOne.mockReturnValue(mockFindOne);

      mockProvider.fetchRainfall.mockResolvedValue({
        precipitation: 0.3,
        precipitation24h: null, // Hourly data missing or incomplete
        recordedAt: new Date()
      });

      let savedPayload = null;
      RainfallObservation.mockImplementation((payload) => {
        savedPayload = payload;
        return { save: jest.fn().mockResolvedValue(true) };
      });

      await syncRainfall(26.16, 91.69);

      expect(savedPayload).toBeTruthy();
      expect(savedPayload.rainfall24h).toBeNull();
      expect(savedPayload.currentIntervalPrecipitation).toBe(0.3);
    });
  });
});
