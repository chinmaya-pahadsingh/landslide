process.env.JWT_SECRET = 'test_secret_for_area_intelligence';
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const LandslideEvent = require('../models/LandslideEvent');
const RainfallObservation = require('../models/RainfallObservation');
const User = require('../models/User');

jest.mock('../services/terrainService', () => ({
  getTerrainFeaturesForLocation: jest.fn().mockResolvedValue({
    elevation: null, slope: null, source: 'unavailable', cellKey: 'mock_key'
  })
}));

jest.mock('../services/weatherProviders/weatherProviderFactory', () => {
  const mockProvider = {
    fetchRainfall: jest.fn().mockRejectedValue(new Error('Mock provider unavailable')),
    fetchSoilMoisture: jest.fn().mockRejectedValue(new Error('Mock provider unavailable'))
  };
  return {
    getProvider: jest.fn().mockReturnValue(mockProvider)
  };
});

jest.mock('../services/satelliteLandCoverService', () => ({
  satelliteLandCoverService: {
    getLandCover: jest.fn().mockResolvedValue({
      available: false,
      source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)'
    })
  }
}));

const { getTerrainFeaturesForLocation } = require('../services/terrainService');

let mongoServer;
let token;
let user;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  user = await User.create({
    name: 'Test Citizen',
    email: 'citizen@example.com',
    passwordHash: 'fakehash',
    role: 'citizen'
  });

  token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await LandslideEvent.deleteMany({});
  await RainfallObservation.deleteMany({});
});

describe('Area Intelligence Integration', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/area-intelligence?lat=25&lon=90');
    expect(res.status).toBe(401);
  });

  it('rejects invalid coordinates', async () => {
    const res = await request(app)
      .get('/api/area-intelligence?lat=999&lon=90')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns appropriate intelligence when no data is near', async () => {
    const res = await request(app)
      .get('/api/area-intelligence?lat=25&lon=90')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.selectedLocation.latitude).toBe(25);
    expect(res.body.evidenceFusion.overallStatus).toBe('insufficient_data');
  });

  it('retrieves valid terrain and fuses it properly', async () => {
    // Override the global mock for just this test
    getTerrainFeaturesForLocation.mockResolvedValueOnce({
      elevation: 450.5,
      slope: 12.3,
      source: 'dem',
      cellKey: 'mock_key'
    });
    
    const res = await request(app)
      .get('/api/area-intelligence?lat=25&lon=90')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    
    // The fusion service evaluates it as available
    expect(res.body.evidenceFusion.evidenceAvailability.terrain).toBe(true);
    
    // The terrain data is preserved un-altered
    expect(res.body.evidenceFusion.evidence.terrain.elevation).toBe(450.5);
    expect(res.body.evidenceFusion.evidence.terrain.slope).toBe(12.3);
    
    // Contextual data preserves source
    expect(res.body.contextualData.terrain.source).toBe('dem');
  });

  it('retrieves nearby events using 2dsphere and ignores distant events', async () => {
    // Nearby event (approx 10km away)
    await LandslideEvent.create({
      location: { latitude: 25.1, longitude: 90.1 }, // near
      severity: 'high',
      eventType: 'landslide',
      source: 'citizen',
      reportedAt: new Date()
    });

    // Distant event (far away, well beyond 50km)
    await LandslideEvent.create({
      location: { latitude: 10, longitude: 10 }, // far
      severity: 'low',
      eventType: 'rockfall',
      source: 'citizen',
      reportedAt: new Date()
    });

    const res = await request(app)
      .get('/api/area-intelligence?lat=25&lon=90')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.evidenceFusion.evidenceAvailability.historical).toBe(true);
    expect(res.body.evidenceFusion.evidence.historical.eventCount).toBe(1); // Only the nearby one
    expect(res.body.evidenceFusion.evidence.historical.severityCounts.high).toBe(1);
  });

  it('retrieves fresh rainfall within bounding box and ignores stale', async () => {
    const now = new Date();
    
    // Fresh nearby rainfall
    await RainfallObservation.create({
      location: { latitude: 25, longitude: 90 },
      rainfall: 120,
      source: 'weather_api',
      recordedAt: now
    });

    // Stale nearby rainfall (80 hours old, cutoff is 72)
    await RainfallObservation.create({
      location: { latitude: 25, longitude: 90 },
      rainfall: 300,
      source: 'weather_api',
      recordedAt: new Date(now.getTime() - 80 * 60 * 60 * 1000)
    });

    const res = await request(app)
      .get('/api/area-intelligence?lat=25&lon=90')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.evidenceFusion.evidenceAvailability.rainfall).toBe(true);
    expect(res.body.evidenceFusion.evidence.rainfall.latestValue).toBe(120);
    // Should explicitly evaluate to recent
    expect(res.body.evidenceFusion.evidence.rainfall.isRecent).toBe(true);
  });
});
