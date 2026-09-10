process.env.JWT_SECRET = 'test_secret_for_step58_reliability';
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

const mockFetchElevations = jest.fn();
jest.mock('../services/terrainProviders/openMeteoElevationProvider', () => ({
  fetchElevations: (...args) => mockFetchElevations(...args)
}));

const mockFetchLandCover = jest.fn().mockResolvedValue({
  available: false,
  source: 'Sentinel-2 10m Land Cover (ESA / Impact Observatory)'
});
jest.mock('../services/satelliteProviders/sentinel2LandCoverProvider', () => ({
  fetchLandCover: (...args) => mockFetchLandCover(...args)
}));

const app = require('../app');

const User = require('../models/User');
const FieldReport = require('../models/FieldReport');
const LandslideEvent = require('../models/LandslideEvent');
const RainfallObservation = require('../models/RainfallObservation');
const SoilMoistureObservation = require('../models/SoilMoistureObservation');
const InfrastructureAsset = require('../models/InfrastructureAsset');
const Notification = require('../models/Notification');
const NewsItem = require('../models/NewsItem');
const TerrainCache = require('../models/TerrainCache');

const { syncRainfall } = require('../services/rainfallIngestionService');
const { syncSoilMoisture } = require('../services/soilMoistureIngestionService');
const { getTerrainFeaturesForLocation } = require('../services/terrainService');
const { predictRisk } = require('../services/mlRiskModelService');
const { fuseEvidence } = require('../services/evidenceFusionService');
const { evaluateEarlyWarning, WARNING_LEVELS } = require('../services/earlyWarningService');
const { createNotification } = require('../services/notificationService');
const weatherProviderFactory = require('../services/weatherProviders/weatherProviderFactory');

let mongoServer;
let adminToken;
let citizenToken;
let adminUser;
let citizenUser;

const testLoc = { latitude: 25.57, longitude: 91.88 };

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  adminUser = await User.create({
    name: 'Step 58 Admin',
    email: 'admin_step58@example.com',
    passwordHash: 'fakehash',
    role: 'admin'
  });

  citizenUser = await User.create({
    name: 'Step 58 Citizen',
    email: 'citizen_step58@example.com',
    passwordHash: 'fakehash',
    role: 'citizen'
  });

  adminToken = jwt.sign({ id: adminUser._id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  citizenToken = jwt.sign({ id: citizenUser._id, role: 'citizen' }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await FieldReport.deleteMany({});
  await LandslideEvent.deleteMany({});
  await RainfallObservation.deleteMany({});
  await SoilMoistureObservation.deleteMany({});
  await InfrastructureAsset.deleteMany({});
  await Notification.deleteMany({});
  await NewsItem.deleteMany({});
  await TerrainCache.deleteMany({});
  jest.clearAllMocks();

  // Default terrain mock: elevation service down (safe fallback)
  mockFetchElevations.mockResolvedValue({
    status: 'error',
    reason: 'Open-Meteo elevation service down'
  });
});

describe('Step 58 — Full Reliability & Failure Testing Suite', () => {

  // =========================================================================
  // 1. MongoDB / Database Failures & Controlled Error Responses
  // =========================================================================
  describe('1. Database Failures & Error Handling', () => {
    it('1.1. Returns controlled 500 error instead of crashing when DB query throws in Area Intelligence', async () => {
      const originalFind = LandslideEvent.find;
      LandslideEvent.find = jest.fn().mockImplementation(() => {
        throw new Error('Simulated database connection loss');
      });

      try {
        const res = await request(app)
          .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(500);
        expect(res.body).toHaveProperty('error');
        expect(res.body.error).toContain('unexpected server error');
      } finally {
        LandslideEvent.find = originalFind;
      }
    });

    it('1.2. Returns controlled 500 error when DB save fails on createLandslideEvent', async () => {
      const originalSave = LandslideEvent.prototype.save;
      LandslideEvent.prototype.save = jest.fn().mockRejectedValue(new Error('Simulated write error'));

      try {
        const res = await request(app)
          .post('/api/landslide-events')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            location: testLoc,
            severity: 'high',
            occurredAt: new Date().toISOString()
          });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('An unexpected server error occurred.');
      } finally {
        LandslideEvent.prototype.save = originalSave;
      }
    });

    it('1.3. Rejects invalid ObjectId format on /api/notifications/:id with 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/notifications/invalid-mongo-id-123')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid notification ID format.');
    });
  });

  // =========================================================================
  // 2. Live Rainfall / Weather Integration Failures
  // =========================================================================
  describe('2. Live Rainfall Provider Failures', () => {
    it('2.1. Handles provider timeout and falls back to failed_upstream safely without crashing', async () => {
      const mockProvider = {
        fetchRainfall: jest.fn().mockRejectedValue(new Error('timeout of 5000ms exceeded'))
      };
      jest.spyOn(weatherProviderFactory, 'getProvider').mockReturnValue(mockProvider);

      const result = await syncRainfall(testLoc.latitude, testLoc.longitude);

      expect(result.status).toBe('failed_upstream');
      expect(result.dataMode).toBe('unavailable');
      expect(result.freshness).toBe('unavailable');
      expect(result.upstreamStatus).toBe('failed_upstream');
    });

    it('2.2. Falls back to stale cached rainfall when live provider fails with 5xx', async () => {
      const oldTime = new Date(Date.now() - 4 * 3600 * 1000); // 4 hours ago (stale)
      await RainfallObservation.create({
        location: { latitude: 25.57, longitude: 91.88 },
        rainfall: 42.5,
        source: 'weather_api',
        recordedAt: oldTime
      });

      const mockProvider = {
        fetchRainfall: jest.fn().mockRejectedValue(new Error('503 Service Unavailable'))
      };
      jest.spyOn(weatherProviderFactory, 'getProvider').mockReturnValue(mockProvider);

      const result = await syncRainfall(testLoc.latitude, testLoc.longitude);

      expect(result.status).toBe('success');
      expect(result.dataMode).toBe('cached');
      expect(result.freshness).toBe('stale');
      expect(result.upstreamStatus).toBe('failed_upstream');
      expect(result.data.rainfall).toBe(42.5);
    });

    it('2.3. Does not retry 4xx errors from provider', async () => {
      const err400 = new Error('Bad request');
      err400.status = 400;
      const mockProvider = {
        fetchRainfall: jest.fn().mockRejectedValue(err400)
      };
      jest.spyOn(weatherProviderFactory, 'getProvider').mockReturnValue(mockProvider);

      const result = await syncRainfall(testLoc.latitude, testLoc.longitude);

      expect(mockProvider.fetchRainfall).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('failed_upstream');
    });

    it('2.4. Rejects malformed provider response (negative or non-finite precipitation)', async () => {
      const mockProvider = {
        fetchRainfall: jest.fn().mockResolvedValue({
          precipitation: -10, // Invalid negative rainfall
          recordedAt: new Date()
        })
      };
      jest.spyOn(weatherProviderFactory, 'getProvider').mockReturnValue(mockProvider);

      const result = await syncRainfall(testLoc.latitude, testLoc.longitude);
      expect(result.status).toBe('failed_upstream');
    });

    it('2.5. Deduplicates concurrent duplicate requests for the same coordinates', async () => {
      let fetchCount = 0;
      const mockProvider = {
        fetchRainfall: jest.fn().mockImplementation(async () => {
          fetchCount++;
          await new Promise(r => setTimeout(r, 50));
          return { precipitation: 15, recordedAt: new Date() };
        })
      };
      jest.spyOn(weatherProviderFactory, 'getProvider').mockReturnValue(mockProvider);

      const [res1, res2] = await Promise.all([
        syncRainfall(25.57, 91.88),
        syncRainfall(25.57, 91.88)
      ]);

      expect(fetchCount).toBe(1);
      expect(res1.data.rainfall).toBe(15);
      expect(res2.data.rainfall).toBe(15);
    });
  });

  // =========================================================================
  // 3. Live Soil-Moisture Integration Failures
  // =========================================================================
  describe('3. Live Soil Moisture Provider Failures', () => {
    it('3.1. Rejects invalid soil moisture fraction > 1.0 without storing to database', async () => {
      const mockProvider = {
        fetchSoilMoisture: jest.fn().mockResolvedValue({
          soilMoistureVolumetric: 1.85, // Impossible > 1.0 (185%)
          recordedAt: new Date()
        })
      };
      jest.spyOn(weatherProviderFactory, 'getProvider').mockReturnValue(mockProvider);

      const result = await syncSoilMoisture(testLoc.latitude, testLoc.longitude);
      expect(result.status).toBe('failed_upstream');

      const count = await SoilMoistureObservation.countDocuments({});
      expect(count).toBe(0);
    });

    it('3.2. Falls back to stale cached soil moisture when live fetch fails', async () => {
      const oldTime = new Date(Date.now() - 5 * 3600 * 1000);
      await SoilMoistureObservation.create({
        location: { latitude: 25.57, longitude: 91.88 },
        soilMoisture: 65,
        source: 'modelled',
        recordedAt: oldTime
      });

      const mockProvider = {
        fetchSoilMoisture: jest.fn().mockRejectedValue(new Error('Network error'))
      };
      jest.spyOn(weatherProviderFactory, 'getProvider').mockReturnValue(mockProvider);

      const result = await syncSoilMoisture(testLoc.latitude, testLoc.longitude);

      expect(result.status).toBe('success');
      expect(result.dataMode).toBe('cached');
      expect(result.freshness).toBe('stale');
      expect(result.upstreamStatus).toBe('failed_upstream');
      expect(result.data.soilMoisture).toBe(65);
    });
  });

  // =========================================================================
  // 4. Terrain & Elevation Integration Failures
  // =========================================================================
  describe('4. Terrain Provider & Cache Failures', () => {
    it('4.1. Gracefully returns unavailable when provider fails and no cache exists', async () => {
      mockFetchElevations.mockResolvedValueOnce({
        status: 'error',
        reason: 'Open-Meteo elevation service down'
      });

      const terrain = await getTerrainFeaturesForLocation(25.571, 91.882);

      expect(terrain.elevation).toBeNull();
      expect(terrain.slope).toBeNull();
      expect(terrain.source).toBe('unavailable');
    });

    it('4.2. Returns valid center elevation but null slope when neighbor elevation is missing', async () => {
      mockFetchElevations.mockImplementationOnce(async (coords) => {
        return {
          status: 'success',
          data: coords.map((pt, idx) => ({
            latitude: pt.latitude,
            longitude: pt.longitude,
            elevation: idx === 0 ? 550 : null // Only center exists, neighbors missing
          }))
        };
      });

      const terrain = await getTerrainFeaturesForLocation(25.575, 91.885);

      expect(terrain.elevation).toBe(550);
      expect(terrain.slope).toBeNull(); // Safely null, never fake or NaN
    });
  });

  // =========================================================================
  // 5. ML Prediction Failures & Safety Boundaries
  // =========================================================================
  describe('5. ML Prediction Failure Guardrails', () => {
    it('5.1. Strictly refuses prediction when any required dynamic feature is missing or null (NO zero-conversion)', async () => {
      const missingRainfall = await predictRisk({
        elevation_meters: 500,
        slope_degrees: 25,
        rainfall_24h_mm: null, // missing
        soil_moisture_index: 45
      });

      expect(missingRainfall.status).toBe('prediction_refused');
      expect(missingRainfall.reason).toContain('missing, non-numeric, or infinite');
      expect(missingRainfall.prediction).toBeUndefined();

      const missingSoil = await predictRisk({
        elevation_meters: 500,
        slope_degrees: 25,
        rainfall_24h_mm: 50,
        soil_moisture_index: undefined // missing
      });

      expect(missingSoil.status).toBe('prediction_refused');
    });

    it('5.2. Refuses prediction on NaN or Infinity values', async () => {
      const nanFeature = await predictRisk({
        elevation_meters: 500,
        slope_degrees: NaN,
        rainfall_24h_mm: 50,
        soil_moisture_index: 45
      });

      expect(nanFeature.status).toBe('prediction_refused');

      const infFeature = await predictRisk({
        elevation_meters: 500,
        slope_degrees: 25,
        rainfall_24h_mm: Infinity,
        soil_moisture_index: 45
      });

      expect(infFeature.status).toBe('prediction_refused');
    });

    it('5.3. Safely handles missing features object or empty input', async () => {
      const emptyResult = await predictRisk(null);
      expect(emptyResult.status).toBe('prediction_refused');
    });
  });

  // =========================================================================
  // 6. Evidence Fusion Failure & Absence Handling
  // =========================================================================
  describe('6. Evidence Fusion Safety & Degradation', () => {
    it('6.1. Accurately marks status as insufficient_data when all evidence is missing, never treating missing as zero', () => {
      const result = fuseEvidence({
        location: testLoc,
        referenceTime: new Date()
      });

      expect(result.overallStatus).toBe('insufficient_data');
      expect(result.availableSourceCount).toBe(0);
      expect(result.evidenceAvailability.rainfall).toBe(false);
      expect(result.evidenceAvailability.soilMoisture).toBe(false);
      expect(result.evidenceAvailability.terrain).toBe(false);
      expect(result.evidenceAvailability.mlPrediction).toBe(false);

      expect(result.limitations).toEqual(expect.arrayContaining([
        expect.stringContaining('Rainfall data is unavailable; this does NOT imply low rainfall.'),
        expect.stringContaining('Soil-moisture data is unavailable; this does NOT imply dry conditions.'),
        expect.stringContaining('Terrain data is unavailable.')
      ]));
    });

    it('6.2. Marks observations older than 72 hours as isRecent: false and notes limitation', () => {
      const staleTime = new Date(Date.now() - 100 * 3600 * 1000);
      const result = fuseEvidence({
        location: testLoc,
        rainfallObservations: [{ rainfall: 80, recordedAt: staleTime }],
        referenceTime: new Date()
      });

      expect(result.evidenceAvailability.rainfall).toBe(true);
      expect(result.evidence.rainfall.isRecent).toBe(false);
      expect(result.limitations).toEqual(expect.arrayContaining([
        expect.stringContaining('older than 72 hours')
      ]));
    });
  });

  // =========================================================================
  // 7. Early Warning Decision Boundaries & Escalation Rules
  // =========================================================================
  describe('7. Early Warning Decision Boundaries', () => {
    it('7.1. Generates ADVISORY (not safe/NO_WARNING) when data is completely insufficient', () => {
      const warning = evaluateEarlyWarning({
        location: testLoc,
        evidence: {} // nothing available
      });

      expect(warning.warningLevel).toBe(WARNING_LEVELS.ADVISORY);
      expect(warning.dataStatus).toBe('insufficient');
      expect(warning.reasoning).toEqual(expect.arrayContaining([
        expect.stringContaining('Insufficient data to assess hazard. Issuing ADVISORY')
      ]));
    });

    it('7.2. Critical infrastructure exposure CANNOT independently trigger an active warning from NO_WARNING', () => {
      const lowRiskEvidence = {
        rainfall: { latestValue: 5, isRecent: true },
        soilMoisture: { latestValue: 10, isRecent: true },
        terrain: { elevation: 150, slope: 5 } // very low
      };

      const criticalInfra = { status: 'calculated', score: 100 };

      const warning = evaluateEarlyWarning({
        location: testLoc,
        evidence: lowRiskEvidence,
        infrastructure: criticalInfra
      });

      expect(warning.warningLevel).toBe(WARNING_LEVELS.NO_WARNING);
      expect(warning.triggers.some(t => t.category === 'infrastructure_exposure')).toBe(true);
      expect(warning.reasoning.some(r => r.includes('influences operational priority, not scientific hazard'))).toBe(true);
    });

    it('7.3. Infrastructure escalates warning level when an environmental hazard baseline exists', () => {
      const highRiskEvidence = {
        rainfall: { latestValue: 250, isRecent: true },
        soilMoisture: { latestValue: 90, isRecent: true }
      };

      // Environmental baseline critical (score 86) sets baseline warning to WARNING
      // Infrastructure exposure score 85 escalates WARNING to CRITICAL
      const criticalInfra = { status: 'calculated', score: 85 };

      const warning = evaluateEarlyWarning({
        location: testLoc,
        evidence: highRiskEvidence,
        infrastructure: criticalInfra
      });

      expect(warning.warningLevel).toBe(WARNING_LEVELS.CRITICAL);
      expect(warning.triggers.some(t => t.category === 'infrastructure_exposure')).toBe(true);
    });
  });

  // =========================================================================
  // 8. Notification Failure Resilience & Idempotency
  // =========================================================================
  describe('8. Notification Resilience', () => {
    it('8.1. Early warning API succeeds with 200 even if notification DB write fails', async () => {
      const originalSave = Notification.prototype.save;
      Notification.prototype.save = jest.fn().mockRejectedValue(new Error('Simulated Notification DB failure'));

      try {
        const res = await request(app)
          .post('/api/early-warning/evaluate')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            location: testLoc,
            evidence: {
              rainfall: { latestValue: 250, isRecent: true },
              soilMoisture: { latestValue: 90, isRecent: true }
            }
          });

        expect(res.status).toBe(200);
        expect(res.body.decisionStatus).toBe('success');
        expect(res.body.warningLevel).toBe(WARNING_LEVELS.WARNING);
      } finally {
        Notification.prototype.save = originalSave;
      }
    });

    it('8.2. Deduplicates repeated notifications with identical deduplicationKey', async () => {
      const notifData = {
        type: 'warning',
        severity: 'critical',
        priority: 'critical',
        title: 'Critical Landslide Alert',
        message: 'Severe slope failure risk',
        deduplicationKey: 'dedup_unique_step58_key'
      };

      const res1 = await createNotification(notifData);
      expect(res1.success).toBe(true);
      expect(res1.isDuplicate).toBe(false);

      const res2 = await createNotification(notifData);
      expect(res2.success).toBe(true);
      expect(res2.isDuplicate).toBe(true);

      const count = await Notification.countDocuments({ deduplicationKey: 'dedup_unique_step58_key' });
      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // 9. Authentication, Security & Input Validation
  // =========================================================================
  describe('9. Authentication & Security Edge Cases', () => {
    it('9.1. Rejects missing Authorization header on protected endpoints with 401', async () => {
      const res = await request(app)
        .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Missing or malformed token');
    });

    it('9.2. Rejects malformed JWT token with 401', async () => {
      const res = await request(app)
        .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
        .set('Authorization', 'Bearer this.is.an.invalid.token');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid token.');
    });

    it('9.3. Rejects expired JWT token with 401', async () => {
      const expiredToken = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET, { expiresIn: '-1s' });

      const res = await request(app)
        .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Token has expired.');
    });

    it('9.4. Rejects citizen from calling admin/authority protected endpoint with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/early-warning/evaluate')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({ location: testLoc });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Insufficient privileges');
    });

    it('9.5. Rejects out-of-range latitude (> 90) with 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/area-intelligence?lat=95.0&lon=91.88')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Valid latitude [-90, 90]');
    });

    it('9.6. Rejects malformed JSON syntax in request body with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "broken json without closing brace');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Malformed JSON payload.');
    });
  });

  // =========================================================================
  // 10. Offline / Idempotency Failures & Safe Recovery
  // =========================================================================
  describe('10. Idempotency & Repeat Request Safety', () => {
    it('10.1. Safely returns existing record with 200 OK when duplicate idempotency key is submitted', async () => {
      const idempotencyKey = `idemp_${Date.now()}_test`;
      const reportPayload = {
        location: testLoc,
        reportType: 'rockfall',
        description: 'Boulders on roadway',
        source: 'citizen'
      };

      const res1 = await request(app)
        .post('/api/field-reports')
        .set('Authorization', `Bearer ${citizenToken}`)
        .set('x-idempotency-key', idempotencyKey)
        .send(reportPayload);

      expect(res1.status).toBe(201);
      const originalId = res1.body._id;

      // Second identical request (e.g. client timeout retry)
      const res2 = await request(app)
        .post('/api/field-reports')
        .set('Authorization', `Bearer ${citizenToken}`)
        .set('x-idempotency-key', idempotencyKey)
        .send(reportPayload);

      expect(res2.status).toBe(200);
      expect(res2.body._id).toBe(originalId);

      const count = await FieldReport.countDocuments({ idempotencyKey });
      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // 11. Area Intelligence Degraded State Resilience
  // =========================================================================
  describe('11. Area Intelligence Graceful Degradation', () => {
    it('11.1. Returns structurally complete response when live weather providers fail and DB is empty', async () => {
      const mockProvider = {
        fetchRainfall: jest.fn().mockRejectedValue(new Error('Weather provider offline')),
        fetchSoilMoisture: jest.fn().mockRejectedValue(new Error('Soil provider offline'))
      };
      jest.spyOn(weatherProviderFactory, 'getProvider').mockReturnValue(mockProvider);

      mockFetchElevations.mockResolvedValueOnce({
        status: 'error',
        reason: 'Elevation provider down'
      });

      const res = await request(app)
        .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.providerStatus.rainfall.upstreamStatus).toBe('failed_upstream');
      expect(res.body.providerStatus.soilMoisture.upstreamStatus).toBe('failed_upstream');
      expect(res.body.providerStatus.terrain).toBe('unavailable');
      expect(res.body.evidenceAvailability.rainfall).toBe(false);
      expect(res.body.evidenceAvailability.soilMoisture).toBe(false);
      expect(res.body.evidenceAvailability.terrain).toBe(false);
      expect(res.body.nearbyInfrastructure).toEqual([]);
      expect(res.body.relevantNews).toEqual([]);
      expect(res.body.earlyWarning).toBeDefined();
      expect(res.body.earlyWarning.dataStatus).toBe('insufficient');
      expect(res.body.evidenceFusion.overallStatus).toBe('insufficient_data');
    });
  });

});
