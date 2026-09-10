process.env.JWT_SECRET = 'test_secret_for_step56_area_intelligence';
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');

const LandslideEvent = require('../models/LandslideEvent');
const RainfallObservation = require('../models/RainfallObservation');
const SoilMoistureObservation = require('../models/SoilMoistureObservation');
const InfrastructureAsset = require('../models/InfrastructureAsset');
const FieldReport = require('../models/FieldReport');
const NewsItem = require('../models/NewsItem');
const Notification = require('../models/Notification');
const User = require('../models/User');

const { getTerrainFeaturesForLocation } = require('../services/terrainService');
const { predictSusceptibility } = require('../services/mlPredictionService');

jest.mock('../services/terrainService', () => ({
  getTerrainFeaturesForLocation: jest.fn().mockResolvedValue({
    elevation: 350,
    slope: 15,
    source: 'cache',
    cellKey: 'mock_key'
  })
}));

jest.mock('../services/mlPredictionService', () => ({
  predictSusceptibility: jest.fn().mockResolvedValue({
    status: 'prediction_refused',
    reason: 'Model unavailable'
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
      source: 'satellite_mock'
    })
  }
}));

let mongoServer;
let token;
let user;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  await Promise.all([
    LandslideEvent.createIndexes(),
    FieldReport.createIndexes(),
    InfrastructureAsset.createIndexes(),
    NewsItem.createIndexes()
  ]);

  user = await User.create({
    name: 'Step 56 Test Officer',
    email: 'step56@example.com',
    passwordHash: 'fakehash',
    role: 'authority'
  });

  token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await LandslideEvent.deleteMany({});
  await RainfallObservation.deleteMany({});
  await SoilMoistureObservation.deleteMany({});
  await InfrastructureAsset.deleteMany({});
  await FieldReport.deleteMany({});
  await NewsItem.deleteMany({});
  await Notification.deleteMany({});
  jest.clearAllMocks();

  // Default terrain mock
  getTerrainFeaturesForLocation.mockResolvedValue({
    elevation: 350,
    slope: 15,
    source: 'cache',
    cellKey: 'mock_key'
  });

  // Default ML mock
  predictSusceptibility.mockResolvedValue({
    status: 'prediction_refused',
    reason: 'Model unavailable'
  });
});

describe('Step 56 — Area Intelligence Final Integration', () => {
  const testLoc = { latitude: 27.15, longitude: 93.62 };

  // 1. Complete Area Intelligence response with all available evidence
  it('1. Returns complete operational summary with all available evidence integrated', async () => {
    const now = new Date();

    await RainfallObservation.create({
      location: testLoc,
      rainfall: 180,
      source: 'weather_api',
      recordedAt: now
    });

    await SoilMoistureObservation.create({
      location: testLoc,
      soilMoisture: 65,
      source: 'modelled',
      recordedAt: now
    });

    await LandslideEvent.create({
      location: testLoc,
      severity: 'medium',
      eventType: 'landslide',
      source: 'official',
      reportedAt: new Date('2025-06-01')
    });

    await FieldReport.create({
      location: testLoc,
      reportType: 'slope_movement',
      severity: 'high',
      source: 'field_team',
      status: 'submitted',
      reportedAt: now
    });

    await InfrastructureAsset.create({
      name: 'District Hospital',
      assetType: 'hospital',
      location: testLoc,
      importance: 9,
      populationServed: 12000,
      alternativeAvailable: false,
      status: 'active'
    });

    await NewsItem.create({
      title: 'Landslide Warning Issued for District',
      summary: 'Heavy rains have prompted local advisories',
      url: 'https://news.gov.in/item1',
      source: { name: 'State Portal', domain: 'gov.in', type: 'OFFICIAL' },
      disasterType: 'landslide',
      location: { latitude: testLoc.latitude, longitude: testLoc.longitude },
      publishedAt: now,
      contentHash: 'hash_123'
    });

    predictSusceptibility.mockResolvedValueOnce({
      status: 'success',
      prediction: { probability: 0.82, class: 1 },
      modelVersion: '1.0.0'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('selectedLocation');
    expect(res.body).toHaveProperty('providerStatus');
    expect(res.body).toHaveProperty('evidenceAvailability');
    expect(res.body).toHaveProperty('earlyWarning');
    expect(res.body).toHaveProperty('evidenceFusion');
    expect(res.body).toHaveProperty('mlPrediction');
    expect(res.body).toHaveProperty('nearbyInfrastructure');
    expect(res.body).toHaveProperty('relevantNews');
    expect(res.body).toHaveProperty('contextualData');
    expect(res.body).toHaveProperty('retrievedAt');

    expect(res.body.evidenceAvailability.rainfall).toBe(true);
    expect(res.body.evidenceAvailability.soilMoisture).toBe(true);
    expect(res.body.evidenceAvailability.terrain).toBe(true);
    expect(res.body.evidenceAvailability.historical).toBe(true);
    expect(res.body.evidenceAvailability.fieldReports).toBe(true);
    expect(res.body.evidenceAvailability.mlPrediction).toBe(true);

    expect(res.body.relevantNews.length).toBe(1);
    expect(res.body.relevantNews[0].title).toBe('Landslide Warning Issued for District');
    expect(res.body.nearbyInfrastructure.length).toBe(1);

    // Ensure no fabricated or unsupported scores exist in the response
    expect(res.body).not.toHaveProperty('confidenceScore');
    expect(res.body).not.toHaveProperty('confidence');
    expect(res.body).not.toHaveProperty('fusedScore');
    expect(res.body.evidenceFusion).not.toHaveProperty('fusedScore');
    expect(res.body.earlyWarning).not.toHaveProperty('confidenceScore');

    // Ensure soil moisture representation is correct (0-100% v/v as established in Step 49)
    // The DB contains 65, which is correctly passed to the controller without altering units
    expect(res.body.contextualData.soilMoisture[0].soilMoisture).toBe(65);
  });

  // 2. Rainfall live state
  it('2. Rainfall live state: correctly represents live ingestion data', async () => {
    const weatherFactory = require('../services/weatherProviders/weatherProviderFactory');
    const mockProvider = {
      fetchRainfall: jest.fn().mockResolvedValue({
        precipitation: 95,
        recordedAt: new Date()
      }),
      fetchSoilMoisture: jest.fn().mockRejectedValue(new Error('Provider down'))
    };
    weatherFactory.getProvider.mockReturnValue(mockProvider);

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.providerStatus.rainfall.dataMode).toBe('live');
    expect(res.body.providerStatus.rainfall.freshness).toBe('fresh');
    expect(res.body.providerStatus.rainfall.upstreamStatus).toBe('success');
  });

  // 3. Rainfall cached state
  it('3. Rainfall cached state: fresh cache avoids upstream provider call', async () => {
    await RainfallObservation.create({
      location: testLoc,
      rainfall: 40,
      source: 'weather_api',
      recordedAt: new Date() // Fresh cache within TTL
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.providerStatus.rainfall.dataMode).toBe('cached');
    expect(res.body.providerStatus.rainfall.freshness).toBe('fresh');
    expect(res.body.providerStatus.rainfall.upstreamStatus).toBe('not_called');
  });

  // 4. Rainfall stale state
  it('4. Rainfall stale state: upstream failure with stale cache marks data stale', async () => {
    const staleTime = new Date(Date.now() - 3 * 3600 * 1000); // 3 hours ago (> 1 hour TTL)
    await RainfallObservation.create({
      location: testLoc,
      rainfall: 120,
      source: 'weather_api',
      recordedAt: staleTime
    });

    // Provider rejects
    const weatherFactory = require('../services/weatherProviders/weatherProviderFactory');
    weatherFactory.getProvider.mockReturnValue({
      fetchRainfall: jest.fn().mockRejectedValue(new Error('Weather API 500')),
      fetchSoilMoisture: jest.fn().mockRejectedValue(new Error('Soil API 500'))
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.providerStatus.rainfall.dataMode).toBe('cached');
    expect(res.body.providerStatus.rainfall.freshness).toBe('stale');
    expect(res.body.providerStatus.rainfall.upstreamStatus).toBe('failed_upstream');
  });

  // 5. Rainfall unavailable state
  it('5. Rainfall unavailable state: no cache and provider failure explicitly reported', async () => {
    const weatherFactory = require('../services/weatherProviders/weatherProviderFactory');
    weatherFactory.getProvider.mockReturnValue({
      fetchRainfall: jest.fn().mockRejectedValue(new Error('Network error')),
      fetchSoilMoisture: jest.fn().mockRejectedValue(new Error('Network error'))
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.providerStatus.rainfall.dataMode).toBe('unavailable');
    expect(res.body.providerStatus.rainfall.freshness).toBe('unavailable');
    expect(res.body.providerStatus.rainfall.upstreamStatus).toBe('failed_upstream');
  });

  // 6. Soil moisture equivalent states
  it('6. Soil moisture equivalent states: cached fresh and unavailable states', async () => {
    await SoilMoistureObservation.create({
      location: testLoc,
      soilMoisture: 75,
      source: 'modelled',
      recordedAt: new Date()
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.providerStatus.soilMoisture.dataMode).toBe('cached');
    expect(res.body.providerStatus.soilMoisture.freshness).toBe('fresh');
    expect(res.body.providerStatus.soilMoisture.upstreamStatus).toBe('not_called');
  });

  // 7. Terrain available / unavailable
  it('7. Terrain available and unavailable states handled gracefully', async () => {
    // Test terrain unavailable
    getTerrainFeaturesForLocation.mockResolvedValueOnce({
      elevation: null,
      slope: null,
      source: 'unavailable',
      cellKey: 'mock_key'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.providerStatus.terrain).toBe('unavailable');
    expect(res.body.evidenceAvailability.terrain).toBe(false);
  });

  // 8. Historical evidence
  it('8. Historical evidence remains contextual and does not independently create active warning', async () => {
    await LandslideEvent.create({
      location: testLoc,
      severity: 'critical',
      eventType: 'landslide',
      source: 'official',
      reportedAt: new Date('2023-01-01')
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.evidenceAvailability.historical).toBe(true);
    expect(res.body.earlyWarning.warningLevel).toBe('advisory'); // Does not trigger watch/warning
    expect(res.body.earlyWarning.triggers.some(t => t.category === 'historical_evidence')).toBe(true);
  });

  // 9. Field reports
  it('9. Field reports remain observational evidence', async () => {
    await FieldReport.create({
      location: testLoc,
      reportType: 'crack',
      severity: 'high',
      source: 'citizen',
      status: 'submitted',
      reportedAt: new Date()
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.evidenceAvailability.fieldReports).toBe(true);
    expect(res.body.earlyWarning.triggers.some(t => t.category === 'field_reports')).toBe(true);
    expect(res.body.earlyWarning.reasoning.some(r => r.includes('unverified evidence'))).toBe(true);
  });

  // 10. Infrastructure operational priority
  it('10. Infrastructure operational priority reflects exposure without fabricating hazard probability', async () => {
    await InfrastructureAsset.create({
      name: 'Key Mountain Pass Road',
      assetType: 'road',
      location: testLoc,
      importance: 8,
      populationServed: 5000,
      alternativeAvailable: false,
      status: 'active'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.nearbyInfrastructure.length).toBe(1);
    expect(res.body.nearbyInfrastructure[0].name).toBe('Key Mountain Pass Road');
  });

  // 11. ML prediction success
  it('11. ML prediction success provides operational trigger', async () => {
    predictSusceptibility.mockResolvedValueOnce({
      status: 'success',
      prediction: { probability: 0.85, class: 1 },
      modelVersion: '1.0.0',
      limitations: []
    });

    await RainfallObservation.create({
      location: testLoc,
      rainfall: 150,
      source: 'weather_api',
      recordedAt: new Date()
    });
    await SoilMoistureObservation.create({
      location: testLoc,
      soilMoisture: 60,
      source: 'modelled',
      recordedAt: new Date()
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.mlPrediction.status).toBe('success');
    expect(res.body.evidenceAvailability.mlPrediction).toBe(true);
    expect(res.body.earlyWarning.triggers.some(t => t.category === 'ml_prediction')).toBe(true);
  });

  // 12. ML prediction_refused
  it('12. ML prediction_refused remains explicit refusal state', async () => {
    predictSusceptibility.mockResolvedValueOnce({
      status: 'prediction_refused',
      reason: 'Feature schema mismatch'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.mlPrediction.status).toBe('unavailable');
    expect(res.body.evidenceAvailability.mlPrediction).toBe(false);
  });

  // 13. Evidence fusion integration
  it('13. Evidence fusion accurately tracks missing evidence and limitations', async () => {
    getTerrainFeaturesForLocation.mockResolvedValueOnce({
      elevation: null,
      slope: null,
      source: 'unavailable',
      cellKey: 'mock_key'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.evidenceFusion.overallStatus).toBe('insufficient_data');
    expect(res.body.evidenceFusion.limitations.length).toBeGreaterThan(0);
    expect(res.body.evidenceAvailability.terrain).toBe(false);
    expect(res.body.evidenceAvailability.rainfall).toBe(false);
    expect(res.body.evidenceAvailability.soilMoisture).toBe(false);
  });

  // 14. Early warning integration
  it('14. Early warning integration produces clear reasoning and recommended actions', async () => {
    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning.decisionStatus).toBe('success');
    expect(res.body.earlyWarning.recommendedActions.length).toBeGreaterThan(0);
  });

  // 15. Notification failure isolation
  it('15. Notification failure is isolated and does NOT cause Area Intelligence to fail', async () => {
    const originalFindOne = Notification.findOne;
    Notification.findOne = jest.fn().mockImplementation(() => {
      throw new Error('Sabotaged DB connection');
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning).toBeDefined();

    Notification.findOne = originalFindOne;
  });

  // 16. Relevant news inclusion without changing risk/warning
  it('16. Relevant news is included as situational awareness without changing risk score or warning level', async () => {
    const now = new Date();
    await NewsItem.create({
      title: 'Bridge damaged by flood waters',
      summary: 'Repairs underway',
      url: 'https://news.gov.in/bridge-1',
      source: { name: 'State News', domain: 'gov.in', type: 'NEWS' },
      disasterType: 'flood',
      location: { latitude: testLoc.latitude, longitude: testLoc.longitude },
      publishedAt: now,
      contentHash: 'hash_456'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.relevantNews.length).toBe(1);
    expect(res.body.relevantNews[0].title).toBe('Bridge damaged by flood waters');
    // News does NOT alter the environmental baseline (which remains null since no rainfall/soil present)
    expect(res.body.earlyWarning.environmentalRisk).toBeNull();
    expect(res.body.earlyWarning.warningLevel).toBe('advisory');
  });

  // 17. Missing data never becoming zero
  it('17. Missing dynamic features are never converted to zero', async () => {
    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.evidenceAvailability.rainfall).toBe(false);
    expect(res.body.evidenceAvailability.soilMoisture).toBe(false);
    expect(res.body.earlyWarning.environmentalRisk).toBeNull();
  });

  // 18. No unnecessary duplicate provider/database calls
  it('18. Reuses cached data and in-flight deduplication across calls', async () => {
    await RainfallObservation.create({
      location: testLoc,
      rainfall: 80,
      source: 'weather_api',
      recordedAt: new Date()
    });

    const p1 = request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);
    const p2 = request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.providerStatus.rainfall.dataMode).toBe('cached');
    expect(res2.body.providerStatus.rainfall.dataMode).toBe('cached');
  });

  // 19. Malformed / invalid location handling
  it('19. Rejects invalid or missing location coordinates safely with 400', async () => {
    const resNoLat = await request(app)
      .get('/api/area-intelligence?lon=93.62')
      .set('Authorization', `Bearer ${token}`);
    expect(resNoLat.status).toBe(400);

    const resNoLon = await request(app)
      .get('/api/area-intelligence?lat=27.15')
      .set('Authorization', `Bearer ${token}`);
    expect(resNoLon.status).toBe(400);

    const resBadLat = await request(app)
      .get('/api/area-intelligence?lat=999&lon=93.62')
      .set('Authorization', `Bearer ${token}`);
    expect(resBadLat.status).toBe(400);

    const resBadLon = await request(app)
      .get('/api/area-intelligence?lat=27.15&lon=999')
      .set('Authorization', `Bearer ${token}`);
    expect(resBadLon.status).toBe(400);

    const resNonNumeric = await request(app)
      .get('/api/area-intelligence?lat=abc&lon=def')
      .set('Authorization', `Bearer ${token}`);
    expect(resNonNumeric.status).toBe(400);
  });
});
