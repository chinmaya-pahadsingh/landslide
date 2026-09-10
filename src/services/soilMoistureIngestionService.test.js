const { syncSoilMoisture } = require('./soilMoistureIngestionService');
const SoilMoistureObservation = require('../models/SoilMoistureObservation');
const weatherProviderFactory = require('./weatherProviders/weatherProviderFactory');

jest.mock('../models/SoilMoistureObservation');
jest.mock('./weatherProviders/weatherProviderFactory');

describe('soilMoistureIngestionService', () => {
  let mockProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProvider = {
      fetchSoilMoisture: jest.fn()
    };
    weatherProviderFactory.getProvider.mockReturnValue(mockProvider);
  });

  it('should reject invalid coordinates', async () => {
    await expect(syncSoilMoisture('bad', 20)).rejects.toThrow('Invalid coordinates');
    await expect(syncSoilMoisture(10, 'bad')).rejects.toThrow('Invalid coordinates');
    await expect(syncSoilMoisture(NaN, 20)).rejects.toThrow('Invalid coordinates');
  });

  it('should reject when provider returns NaN or non-numeric', async () => {
    SoilMoistureObservation.findOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(null)
    });

    mockProvider.fetchSoilMoisture.mockResolvedValue({
      soilMoistureVolumetric: NaN,
      recordedAt: new Date()
    });

    const result = await syncSoilMoisture(10, 20);
    expect(result.status).toBe('failed_upstream');
    expect(result.message).toBe('Live data unavailable');
  });

  it('should reject when provider returns negative value', async () => {
    SoilMoistureObservation.findOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(null)
    });

    mockProvider.fetchSoilMoisture.mockResolvedValue({
      soilMoistureVolumetric: -0.1,
      recordedAt: new Date()
    });

    const result = await syncSoilMoisture(10, 20);
    expect(result.status).toBe('failed_upstream');
  });

  it('should reject when provider returns > 1.0', async () => {
    SoilMoistureObservation.findOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(null)
    });

    mockProvider.fetchSoilMoisture.mockResolvedValue({
      soilMoistureVolumetric: 1.5, // impossible
      recordedAt: new Date()
    });

    const result = await syncSoilMoisture(10, 20);
    expect(result.status).toBe('failed_upstream');
  });

  it('should correctly convert 0.35 to 35% v/v and save as modelled', async () => {
    SoilMoistureObservation.findOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(null)
    });

    const fakeDate = new Date();
    mockProvider.fetchSoilMoisture.mockResolvedValue({
      soilMoistureVolumetric: 0.35,
      recordedAt: fakeDate
    });

    const mockSave = jest.fn().mockResolvedValue(true);
    SoilMoistureObservation.mockImplementation(() => ({
      save: mockSave
    }));

    const result = await syncSoilMoisture(10, 20);
    
    expect(result.status).toBe('success');
    expect(result.dataMode).toBe('live');
    
    expect(SoilMoistureObservation).toHaveBeenCalledWith({
      location: { latitude: 10, longitude: 20 },
      soilMoisture: 35, // 0.35 * 100
      source: 'modelled',
      recordedAt: fakeDate
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('should hit cache and bypass provider if fresh modelled data exists', async () => {
    SoilMoistureObservation.findOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue({
        location: { latitude: 10, longitude: 20 },
        soilMoisture: 40,
        source: 'modelled',
        recordedAt: new Date()
      })
    });

    const result = await syncSoilMoisture(10, 20);
    
    expect(result.status).toBe('success');
    expect(result.dataMode).toBe('cached');
    expect(result.freshness).toBe('fresh');
    expect(result.upstreamStatus).toBe('not_called');
    expect(result.data.soilMoisture).toBe(40);
    expect(mockProvider.fetchSoilMoisture).not.toHaveBeenCalled();
  });

  it('should bypass DB persistence entirely if simulation', async () => {
    const result = await syncSoilMoisture(10, 20, true);
    
    expect(result.status).toBe('success');
    expect(result.dataMode).toBe('simulation');
    expect(result.data.source).toBe('simulation');
    expect(result.data.soilMoisture).toBe(100);
    
    expect(mockProvider.fetchSoilMoisture).not.toHaveBeenCalled();
    expect(SoilMoistureObservation.findOne).not.toHaveBeenCalled();
    expect(SoilMoistureObservation).not.toHaveBeenCalled(); // No save
  });
  
  it('should deduplicate concurrent requests', async () => {
    SoilMoistureObservation.findOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(null)
    });

    // Slow provider fetch
    mockProvider.fetchSoilMoisture.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        soilMoistureVolumetric: 0.50,
        recordedAt: new Date()
      };
    });
    
    SoilMoistureObservation.mockImplementation(() => ({
      save: jest.fn().mockResolvedValue(true)
    }));

    const p1 = syncSoilMoisture(10, 20);
    const p2 = syncSoilMoisture(10, 20);
    
    const [res1, res2] = await Promise.all([p1, p2]);
    
    expect(res1.status).toBe('success');
    expect(res2.status).toBe('success');
    // Provider only called once due to Promise sharing
    expect(mockProvider.fetchSoilMoisture).toHaveBeenCalledTimes(1);
  });

  it('handles stale cache + live failure correctly', async () => {
    const mockFindOne = {
      sort: jest.fn()
        .mockResolvedValueOnce(null) // fresh cache miss
        .mockResolvedValueOnce({ soilMoisture: 10, recordedAt: new Date(Date.now() - 10000000) }) // stale cache hit
    };
    SoilMoistureObservation.findOne.mockReturnValue(mockFindOne);

    mockProvider.fetchSoilMoisture.mockRejectedValue(new Error('Network Error'));

    const result = await syncSoilMoisture(10, 20);

    expect(result.status).toBe('success');
    expect(result.dataMode).toBe('cached');
    expect(result.freshness).toBe('stale');
    expect(result.upstreamStatus).toBe('failed_upstream');
    expect(result.data.soilMoisture).toBe(10);
  });

  it('handles no cache + live failure correctly', async () => {
    const mockFindOne = {
      sort: jest.fn().mockResolvedValue(null) // No fresh cache, no stale cache
    };
    SoilMoistureObservation.findOne.mockReturnValue(mockFindOne);

    mockProvider.fetchSoilMoisture.mockRejectedValue(new Error('Network Error'));

    const result = await syncSoilMoisture(10, 20);

    expect(result.status).toBe('failed_upstream');
    expect(result.dataMode).toBe('unavailable');
    expect(result.freshness).toBe('unavailable');
    expect(result.upstreamStatus).toBe('failed_upstream');
  });
});
