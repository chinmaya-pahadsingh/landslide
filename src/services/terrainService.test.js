const { getTerrainFeaturesForLocation, getNeighborCoordinates, calculateSlopeDegrees } = require('./terrainService');
const TerrainCache = require('../models/TerrainCache');
const { fetchElevations } = require('./terrainProviders/openMeteoElevationProvider');

jest.mock('../models/TerrainCache');
jest.mock('./terrainProviders/openMeteoElevationProvider');

describe('terrainService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('A. Cache hit: returns cached elevation/slope and provider not called', async () => {
    TerrainCache.findOne.mockResolvedValueOnce({ elevation: 1500, slope: 45 });
    const result = await getTerrainFeaturesForLocation(27, 88);
    expect(result.source).toBe('cache');
    expect(result.elevation).toBe(1500);
    expect(result.slope).toBe(45);
    expect(fetchElevations).not.toHaveBeenCalled();
  });

  it('B. Cache miss: provider called, terrain result returned, valid result cached', async () => {
    TerrainCache.findOne.mockResolvedValueOnce(null);
    fetchElevations.mockImplementationOnce(async (coords) => {
      return {
        status: 'success',
        data: coords.map((c, i) => ({
          latitude: c.latitude,
          longitude: c.longitude,
          elevation: i === 1 ? 110 : (i === 2 ? 90 : 100) // center=100, north=110, south=90, east=100, west=100
        }))
      };
    });

    TerrainCache.findOneAndUpdate.mockResolvedValueOnce({});

    const result = await getTerrainFeaturesForLocation(27, 88);
    expect(result.source).toBe('open-meteo');
    expect(result.elevation).toBe(100);
    expect(result.slope).toBeGreaterThan(0);
    expect(fetchElevations).toHaveBeenCalledTimes(1);
    expect(TerrainCache.findOneAndUpdate).toHaveBeenCalled();
  });

  it('C. Provider receives all required samples in one request', async () => {
    TerrainCache.findOne.mockResolvedValueOnce(null);
    fetchElevations.mockResolvedValueOnce({ status: 'error' }); // abort early
    await getTerrainFeaturesForLocation(27, 88);
    expect(fetchElevations).toHaveBeenCalledTimes(1);
    const args = fetchElevations.mock.calls[0][0];
    expect(args.length).toBe(5);
  });

  it('D, E, F. Correct coordinate generation and distance conversion', () => {
    const lat = 27;
    const lon = 88;
    const coords = getNeighborCoordinates(lat, lon);
    
    expect(coords.center.latitude).toBe(27);
    expect(coords.center.longitude).toBe(88);
    
    const latDiff = Math.abs(coords.north.latitude - lat);
    expect(latDiff).toBeCloseTo(90 / 111320, 5); // ~0.000808
    
    const expectedLonDiff = 90 / (111320 * Math.cos(27 * Math.PI / 180));
    const lonDiff = Math.abs(coords.east.longitude - lon);
    expect(lonDiff).toBeCloseTo(expectedLonDiff, 5);
  });

  it('G. Mathematical slope test', () => {
    const slope = calculateSlopeDegrees(100, 280, 100, 280, 100, 90, 90);
    expect(slope).toBeCloseTo(54.73, 1);
  });

  it('H. Flat terrain slope = 0', () => {
    const slope = calculateSlopeDegrees(100, 100, 100, 100, 100, 90, 90);
    expect(slope).toBe(0);
  });

  it('I. Missing center elevation', async () => {
    TerrainCache.findOne.mockResolvedValueOnce(null);
    fetchElevations.mockImplementationOnce(async (coords) => {
      return {
        status: 'success',
        data: coords.map((c, i) => ({
          latitude: c.latitude,
          longitude: c.longitude,
          elevation: i === 0 ? null : 100 // center is missing
        }))
      };
    });
    
    const result = await getTerrainFeaturesForLocation(27, 88);
    expect(result.elevation).toBeNull();
    expect(result.slope).toBeNull();
    expect(result.source).toBe('unavailable');
  });

  it('J. Missing neighbor', async () => {
    TerrainCache.findOne.mockResolvedValueOnce(null);
    fetchElevations.mockImplementationOnce(async (coords) => {
      return {
        status: 'success',
        data: coords.map((c, i) => ({
          latitude: c.latitude,
          longitude: c.longitude,
          elevation: i === 1 ? null : 100 // north is missing
        }))
      };
    });
    
    const result = await getTerrainFeaturesForLocation(27, 88);
    expect(result.elevation).toBe(100);
    expect(result.slope).toBeNull();
    expect(result.source).toBe('open-meteo');
    
    expect(TerrainCache.findOneAndUpdate).toHaveBeenCalledWith(
       expect.any(Object),
       expect.objectContaining({ elevation: 100, slope: null }),
       expect.any(Object)
    );
  });

  it('K. Provider failure', async () => {
    TerrainCache.findOne.mockResolvedValueOnce(null);
    fetchElevations.mockResolvedValueOnce({ status: 'error', reason: 'Timeout' });
    
    const result = await getTerrainFeaturesForLocation(27, 88);
    expect(result.elevation).toBeNull();
    expect(result.slope).toBeNull();
    expect(result.source).toBe('unavailable');
  });

  it('L. Cache failure/malformed cache', async () => {
    TerrainCache.findOne.mockResolvedValueOnce({ elevation: 'bad', slope: NaN });
    fetchElevations.mockImplementationOnce(async (coords) => ({
      status: 'success',
      data: coords.map(c => ({ latitude: c.latitude, longitude: c.longitude, elevation: 100 }))
    }));
    
    const result = await getTerrainFeaturesForLocation(27, 88);
    expect(result.source).toBe('open-meteo');
    expect(result.elevation).toBe(100);
  });

  it('M, N. Concurrent request deduplication', async () => {
    TerrainCache.findOne.mockResolvedValue(null);
    
    fetchElevations.mockImplementationOnce(async () => {
      // Simulate a small network delay to ensure promises queue up
      await new Promise(resolve => setTimeout(resolve, 10));
      return { status: 'error', reason: 'timeout' };
    });

    const p1 = getTerrainFeaturesForLocation(27, 88);
    const p2 = getTerrainFeaturesForLocation(27, 88);
    const p3 = getTerrainFeaturesForLocation(27, 88);
    
    const results = await Promise.all([p1, p2, p3]);
    
    expect(fetchElevations).toHaveBeenCalledTimes(1);
    expect(results[0].source).toBe('unavailable');
    expect(results[1].source).toBe('unavailable');
    expect(results[2].source).toBe('unavailable');
    
    // After failure, next call should try again
    fetchElevations.mockResolvedValueOnce({ status: 'error' });
    await getTerrainFeaturesForLocation(27, 88);
    expect(fetchElevations).toHaveBeenCalledTimes(2);
  });

  it('O. Invalid coordinates', async () => {
    await expect(getTerrainFeaturesForLocation(95, 88)).rejects.toThrow('Latitude out of bounds');
    expect(fetchElevations).not.toHaveBeenCalled();
  });
});
