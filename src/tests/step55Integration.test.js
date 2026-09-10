process.env.JWT_SECRET = 'test_secret_for_step55_integration';
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
const Notification = require('../models/Notification');
const User = require('../models/User');

const { evaluateEarlyWarning, WARNING_LEVELS, DATA_STATUS } = require('../services/earlyWarningService');
const { notifyEarlyWarning, createNotification } = require('../services/notificationService');
const { calculateRiskScore } = require('../services/riskScoreService');
const { fuseEvidence } = require('../services/evidenceFusionService');
const { syncRainfall } = require('../services/rainfallIngestionService');
const { syncSoilMoisture } = require('../services/soilMoistureIngestionService');

// Mock weather provider and terrain service
jest.mock('../services/terrainService', () => ({
  getTerrainFeaturesForLocation: jest.fn().mockResolvedValue({
    elevation: null,
    slope: null,
    source: 'unavailable',
    cellKey: 'mock_key'
  })
}));

jest.mock('../services/weatherProviders/weatherProviderFactory', () => {
  const mockProvider = {
    fetchRainfall: jest.fn().mockRejectedValue(new Error('Mock provider down')),
    fetchSoilMoisture: jest.fn().mockRejectedValue(new Error('Mock provider down'))
  };
  return {
    getProvider: jest.fn().mockReturnValue(mockProvider)
  };
});

let mongoServer;
let token;
let user;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  user = await User.create({
    name: 'Step 55 Test User',
    email: 'step55@example.com',
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
  await Notification.deleteMany({});
});

describe('Step 55 — Final Early Warning + Notification Integration', () => {
  const testLoc = { latitude: 27.15, longitude: 93.62 };

  // 1. Valid environmental data -> Risk + Early Warning Flow
  it('1. Valid environmental data -> risk score + early warning + notification flow', async () => {
    // Insert fresh rainfall & soil moisture
    const now = new Date();
    await RainfallObservation.create({
      location: testLoc,
      rainfall: 200, // 40 pts
      source: 'weather_api',
      recordedAt: now
    });
    await SoilMoistureObservation.create({
      location: testLoc,
      soilMoisture: 70, // 28 pts -> total 68 -> high baseline
      source: 'modelled',
      recordedAt: now
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning).toBeDefined();
    expect(res.body.earlyWarning.environmentalRisk).toBeDefined();
    expect(res.body.earlyWarning.environmentalRisk.level).toBe('high');
    expect(res.body.earlyWarning.environmentalRisk.score).toBe(68);
    expect(res.body.earlyWarning.warningLevel).toBe('watch');

    // Notification should have been triggered for 'watch'
    // Give async event loop a tick to write notification
    await new Promise(resolve => setTimeout(resolve, 50));
    const notifications = await Notification.find({ type: 'warning' });
    expect(notifications.length).toBe(1);
    expect(notifications[0].severity).toBe('watch');
    expect(notifications[0].priority).toBe('medium');
  });

  // 2. Missing rainfall
  it('2. Missing rainfall -> environmentalRisk remains null and never converted to zero', async () => {
    const now = new Date();
    await SoilMoistureObservation.create({
      location: testLoc,
      soilMoisture: 70,
      source: 'modelled',
      recordedAt: now
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning.environmentalRisk).toBeNull();
    expect(res.body.earlyWarning.limitations.some(l => l.includes('does NOT imply zero rainfall'))).toBe(true);
  });

  // 3. Missing soil moisture
  it('3. Missing soil moisture -> environmentalRisk remains null and never converted to zero', async () => {
    const now = new Date();
    await RainfallObservation.create({
      location: testLoc,
      rainfall: 150,
      source: 'weather_api',
      recordedAt: now
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning.environmentalRisk).toBeNull();
    expect(res.body.earlyWarning.limitations.some(l => l.includes('does NOT imply dry conditions'))).toBe(true);
  });

  // 4. Stale rainfall
  it('4. Stale rainfall (>72h or marked stale) -> excluded from baseline calculation', async () => {
    const staleDate = new Date(Date.now() - 80 * 60 * 60 * 1000); // 80h old
    await RainfallObservation.create({
      location: testLoc,
      rainfall: 250,
      source: 'weather_api',
      recordedAt: staleDate
    });
    await SoilMoistureObservation.create({
      location: testLoc,
      soilMoisture: 70,
      source: 'modelled',
      recordedAt: new Date()
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning.environmentalRisk).toBeNull();
    expect(res.body.earlyWarning.limitations.some(l => l.includes('stale/not recent') || l.includes('unavailable'))).toBe(true);
  });

  // 5. Stale soil moisture
  it('5. Stale soil moisture -> excluded from baseline calculation', async () => {
    const staleDate = new Date(Date.now() - 90 * 60 * 60 * 1000); // 90h old
    await RainfallObservation.create({
      location: testLoc,
      rainfall: 150,
      source: 'weather_api',
      recordedAt: new Date()
    });
    await SoilMoistureObservation.create({
      location: testLoc,
      soilMoisture: 80,
      source: 'modelled',
      recordedAt: staleDate
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning.environmentalRisk).toBeNull();
    expect(res.body.earlyWarning.limitations.some(l => l.includes('stale/not recent') || l.includes('unavailable'))).toBe(true);
  });

  // 6. Unavailable provider
  it('6. Unavailable provider -> explicit unavailable state preserved', async () => {
    // No observations in DB, weather provider will fail with mock rejection
    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.providerStatus.rainfall.dataMode).toBe('unavailable');
    expect(res.body.providerStatus.rainfall.upstreamStatus).toBe('failed_upstream');
    expect(res.body.providerStatus.soilMoisture.dataMode).toBe('unavailable');
    expect(res.body.providerStatus.soilMoisture.upstreamStatus).toBe('failed_upstream');
  });

  // 7. ML prediction_refused
  it('7. ML prediction_refused remains explicit refusal state', async () => {
    // In our test environment without a trained XGBoost artifact, ML predictRisk returns prediction_refused
    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.evidenceFusion.evidenceAvailability.mlPrediction).toBe(false);
    expect(res.body.earlyWarning.limitations.some(l => l.includes('No machine learning prediction'))).toBe(true);
  });

  // 8. ML successful prediction (unit test path for operational escalation)
  it('8. ML successful prediction provides operational trigger escalation', () => {
    const evalResult = evaluateEarlyWarning({
      location: testLoc,
      evidence: {
        rainfall: { latestValue: 200, isRecent: true },
        soilMoisture: { latestValue: 70, isRecent: true },
        mlPrediction: { class: 1, probability: 0.88, modelVersion: '1.0.0' }
      }
    });

    expect(evalResult.warningLevel).toBe('warning'); // Escalated from watch to warning
    expect(evalResult.triggers.some(t => t.category === 'ml_prediction')).toBe(true);
  });

  // 9. Historical evidence alone does not create an active warning
  it('9. Historical evidence alone does NOT create an active warning', async () => {
    await LandslideEvent.create({
      location: testLoc,
      severity: 'critical',
      eventType: 'landslide',
      source: 'official',
      reportedAt: new Date('2022-01-01')
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Insufficient data for baseline -> ADVISORY, NOT watch/warning/critical
    expect(res.body.earlyWarning.warningLevel).toBe('advisory');
    expect(res.body.earlyWarning.triggers.some(t => t.category === 'historical_evidence')).toBe(true);
    expect(res.body.earlyWarning.reasoning.some(r => r.includes('Historical landslide events are present in this area, providing context but not active hazard'))).toBe(true);
  });

  // 10. Field report trigger
  it('10. Field report trigger remains observational/unverified evidence', async () => {
    await FieldReport.create({
      location: testLoc,
      reportType: 'rockfall',
      severity: 'medium',
      source: 'citizen',
      status: 'submitted',
      reportedAt: new Date()
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning.triggers.some(t => t.category === 'field_reports')).toBe(true);
    expect(res.body.earlyWarning.reasoning.some(r => r.includes('unverified evidence'))).toBe(true);
  });

  // 11. Infrastructure exposure handling
  it('11. Infrastructure exposure affects operational response priority and does NOT escalate NO_WARNING', () => {
    // When no hazard exists (baseline 0, flat terrain), infra should not escalate NO_WARNING
    const resNoWarning = evaluateEarlyWarning({
      location: testLoc,
      evidence: {
        rainfall: { latestValue: 0, isRecent: true },
        soilMoisture: { latestValue: 0, isRecent: true },
        terrain: { slope: 5 }
      },
      infrastructure: { status: 'calculated', score: 95 }
    });
    expect(resNoWarning.warningLevel).toBe('no_warning');

    // When an active warning exists (watch), infra escalates operational priority to warning
    const resWithHazard = evaluateEarlyWarning({
      location: testLoc,
      evidence: {
        rainfall: { latestValue: 200, isRecent: true },
        soilMoisture: { latestValue: 70, isRecent: true }
      },
      infrastructure: { status: 'calculated', score: 85 }
    });
    expect(resWithHazard.warningLevel).toBe('warning');
  });

  // 12. No-warning does not create an unintended notification
  it('12. No-warning and advisory states do NOT create notifications', async () => {
    const decisionAdvisory = {
      decisionStatus: 'success',
      warningLevel: 'advisory',
      location: testLoc
    };
    const resAdv = await notifyEarlyWarning(decisionAdvisory);
    expect(resAdv.success).toBe(true);
    expect(resAdv.reason).toContain('not high enough');

    const decisionNoWarning = {
      decisionStatus: 'success',
      warningLevel: 'no_warning',
      location: testLoc
    };
    const resNoWarn = await notifyEarlyWarning(decisionNoWarning);
    expect(resNoWarn.success).toBe(true);
    expect(resNoWarn.reason).toContain('not high enough');

    const count = await Notification.countDocuments({});
    expect(count).toBe(0);
  });

  // 13. Warning creates notification when appropriate
  it('13. Elevated warning states create notifications', async () => {
    const decisionWatch = {
      decisionStatus: 'success',
      warningLevel: 'watch',
      location: testLoc,
      triggers: [{ detail: 'High rainfall and soil saturation' }]
    };
    const res = await notifyEarlyWarning(decisionWatch);
    expect(res.success).toBe(true);
    expect(res.isDuplicate).toBe(false);

    const doc = await Notification.findById(res.notification._id);
    expect(doc).toBeDefined();
    expect(doc.severity).toBe('watch');
    expect(doc.priority).toBe('medium');
  });

  // 14. Duplicate notification is prevented (same day/location/warning level)
  it('14. Duplicate notification is prevented for same warning/location/day', async () => {
    const decision = {
      decisionStatus: 'success',
      warningLevel: 'warning',
      location: testLoc,
      triggers: [{ detail: 'Severe storm hazard' }]
    };

    const res1 = await notifyEarlyWarning(decision);
    expect(res1.success).toBe(true);
    expect(res1.isDuplicate).toBe(false);

    const res2 = await notifyEarlyWarning(decision);
    expect(res2.success).toBe(true);
    expect(res2.isDuplicate).toBe(true);

    const count = await Notification.countDocuments({ type: 'warning' });
    expect(count).toBe(1);
  });

  // 15. Warning escalation creates a distinct notification
  it('15. Warning escalation creates a distinct notification', async () => {
    const decisionWatch = {
      decisionStatus: 'success',
      warningLevel: 'watch',
      location: testLoc,
      triggers: [{ detail: 'Conditions deteriorating' }]
    };
    const decisionCritical = {
      decisionStatus: 'success',
      warningLevel: 'critical',
      location: testLoc,
      triggers: [{ detail: 'Extreme hazard imminent' }]
    };

    const res1 = await notifyEarlyWarning(decisionWatch);
    const res2 = await notifyEarlyWarning(decisionCritical);

    expect(res1.success).toBe(true);
    expect(res1.isDuplicate).toBe(false);

    expect(res2.success).toBe(true);
    expect(res2.isDuplicate).toBe(false);

    const count = await Notification.countDocuments({ type: 'warning' });
    expect(count).toBe(2);
  });

  // 16. Notification DB failure does not break early warning / area intelligence response
  it('16. Notification DB failure does NOT break early warning or Area Intelligence response', async () => {
    // Temporarily sabotage Notification.findOne to simulate DB crash
    const originalFindOne = Notification.findOne;
    Notification.findOne = jest.fn().mockImplementation(() => {
      throw new Error('Fatal MongoDB Connection Outage');
    });

    const now = new Date();
    await RainfallObservation.create({
      location: testLoc,
      rainfall: 250,
      source: 'weather_api',
      recordedAt: now
    });
    await SoilMoistureObservation.create({
      location: testLoc,
      soilMoisture: 80,
      source: 'modelled',
      recordedAt: now
    });

    // Area Intelligence endpoint should succeed with 200 despite notification DB failure
    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning).toBeDefined();
    expect(res.body.earlyWarning.warningLevel).toBe('warning');

    // Early warning evaluate controller should also succeed with 200
    const ewRes = await request(app)
      .post('/api/early-warning/evaluate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        location: testLoc,
        evidence: {
          rainfall: { latestValue: 250, isRecent: true },
          soilMoisture: { latestValue: 80, isRecent: true }
        }
      });

    expect(ewRes.status).toBe(200);
    expect(ewRes.body.warningLevel).toBe('warning');

    // Restore
    Notification.findOne = originalFindOne;
  });

  // 17. Malformed / internal service result is handled safely
  it('17. Malformed and edge inputs are handled safely without crashing', async () => {
    // evaluateEarlyWarning malformed
    expect(evaluateEarlyWarning(null).decisionStatus).toBe('error');
    expect(evaluateEarlyWarning('string').decisionStatus).toBe('error');
    expect(evaluateEarlyWarning({ location: { latitude: 'invalid' } }).decisionStatus).toBe('error');

    // notifyEarlyWarning malformed
    const res1 = await notifyEarlyWarning(null);
    expect(res1.success).toBe(false);

    const res2 = await notifyEarlyWarning({ decisionStatus: 'error' });
    expect(res2.success).toBe(false);

    const res3 = await notifyEarlyWarning({ decisionStatus: 'success', warningLevel: 'invalid_level' });
    expect(res3.success).toBe(true);
    expect(res3.reason).toContain('not high enough');
  });

  // 18. Simulation remains isolated from live environmental cache
  it('18. Simulation remains completely isolated from live environmental cache', async () => {
    const simLat = 26.5;
    const simLon = 92.5;

    // Call Area Intelligence with simulation=true
    const res = await request(app)
      .get(`/api/area-intelligence?lat=${simLat}&lon=${simLon}&simulation=true`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.providerStatus.rainfall.dataMode).toBe('simulation');
    expect(res.body.providerStatus.soilMoisture.dataMode).toBe('simulation');

    // Verify database has ZERO saved observations for this simulation
    const rainCount = await RainfallObservation.countDocuments({
      'location.latitude': simLat,
      'location.longitude': simLon
    });
    const soilCount = await SoilMoistureObservation.countDocuments({
      'location.latitude': simLat,
      'location.longitude': simLon
    });

    expect(rainCount).toBe(0);
    expect(soilCount).toBe(0);
  });
});
