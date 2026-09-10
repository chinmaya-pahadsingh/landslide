const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { validateFeatureRow, normalizeFeatureRow, calculateGeodesicDistanceKm, generateTrainingDatasetAudit } = require('./mlDatasetService');
const LandslideEvent = require('../models/LandslideEvent');
const RainfallObservation = require('../models/RainfallObservation');
const SoilMoistureObservation = require('../models/SoilMoistureObservation');
const terrainService = require('./terrainService');

jest.mock('./terrainService');

describe('ML Dataset Service', () => {
  describe('validateFeatureRow', () => {
    it('accepts valid rows', () => {
      const row = { observation_timestamp: '2026-09-01T12:00:00Z', latitude: 27, longitude: 88, elevation_meters: 1000, slope_degrees: 30, rainfall_24h_mm: 50, soil_moisture_index: 0.8 };
      expect(validateFeatureRow(row).isValid).toBe(true);
    });

    it('rejects missing fields', () => {
      const row = { observation_timestamp: '2026-09-01T12:00:00Z', latitude: 27, longitude: 88, slope_degrees: 30 };
      const { isValid, missingFeatures } = validateFeatureRow(row);
      expect(isValid).toBe(false);
      expect(missingFeatures).toContain('elevation_meters');
    });

    it('rejects invalid coordinates', () => {
      expect(validateFeatureRow({ observation_timestamp: '2026-09-01T12:00:00Z', latitude: 95, longitude: 88, elevation_meters: 1000, slope_degrees: 30, rainfall_24h_mm: 0, soil_moisture_index: 0 }).isValid).toBe(false);
    });

    it('rejects missing or invalid observation_timestamp', () => {
      const row1 = { latitude: 27, longitude: 88, elevation_meters: 1000, slope_degrees: 30, rainfall_24h_mm: 50, soil_moisture_index: 0.8 };
      const { isValid: valid1, isTimestampMissing: miss1 } = validateFeatureRow(row1);
      expect(valid1).toBe(false);
      expect(miss1).toBe(true);

      const row2 = { observation_timestamp: 'not-a-date', latitude: 27, longitude: 88, elevation_meters: 1000, slope_degrees: 30, rainfall_24h_mm: 50, soil_moisture_index: 0.8 };
      const { isValid: valid2, isTimestampMissing: miss2 } = validateFeatureRow(row2);
      expect(valid2).toBe(false);
      expect(miss2).toBe(true);
    });
  });

  describe('normalizeFeatureRow', () => {
    it('normalizes locations and applies defaults', () => {
      const res = normalizeFeatureRow({ location: { latitude: 27, longitude: 88 }, elevation: 1500, slope: 45 });
      expect(res.latitude).toBe(27);
      expect(res.elevation_meters).toBe(1500);
      expect(res.rainfall_24h_mm).toBe(0);
      expect(res.soil_moisture_index).toBe(0);
    });
  });

  describe('calculateGeodesicDistanceKm', () => {
    it('calculates distance correctly', () => {
      // rough distance between 0,0 and 1,0 is ~111km
      const d = calculateGeodesicDistanceKm(0, 0, 1, 0);
      expect(d).toBeGreaterThan(110);
      expect(d).toBeLessThan(112);
    });
  });

  describe('generateTrainingDatasetAudit', () => {
    let mongoServer;

    beforeAll(async () => {
      mongoServer = await MongoMemoryServer.create();
      await mongoose.connect(mongoServer.getUri());
    });

    afterAll(async () => {
      await mongoose.disconnect();
      await mongoServer.stop();
    });

    afterEach(async () => {
      await LandslideEvent.deleteMany({});
      await RainfallObservation.deleteMany({});
      await SoilMoistureObservation.deleteMany({});
      jest.clearAllMocks();
    });

    it('returns INSUFFICIENT_TRAINING_DATA when db is empty', async () => {
      const audit = await generateTrainingDatasetAudit();
      expect(audit.status).toBe('INSUFFICIENT_TRAINING_DATA');
      expect(audit.pipelineReady).toBe(false);
      expect(audit.trainingReady).toBe(false);
      expect(audit.sampleCount).toBe(0);
    });

    it('generates positive and negative samples avoiding temporal leakage', async () => {
      terrainService.getTerrainFeaturesForLocation.mockResolvedValue({ elevation: 100, slope: 10, source: 'dem' });
      
      const now = new Date('2026-09-01T12:00:00Z');
      
      // Positive event
      await LandslideEvent.create({
        location: { latitude: 20, longitude: 90 },
        eventDate: now,
        reportedAt: new Date(now.getTime() + 10000), // explicitly different
        source: 'official'
      });
      
      // Matched Rainfall & Soil Moisture for event (within 72h before)
      await RainfallObservation.create({
        location: { latitude: 20.1, longitude: 90.1 }, // Close enough (~15km)
        rainfall: 50,
        recordedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 1 day before
        source: 'sensor'
      });
      await SoilMoistureObservation.create({
        location: { latitude: 20.05, longitude: 90.05 },
        soilMoisture: 0.6,
        recordedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        source: 'sensor'
      });

      // Negative candidate (far away, safely negative)
      await RainfallObservation.create({
        location: { latitude: 25, longitude: 85 }, // Far
        rainfall: 0,
        recordedAt: now,
        source: 'sensor'
      });
      await SoilMoistureObservation.create({
        location: { latitude: 25.1, longitude: 85.1 },
        soilMoisture: 0.2,
        recordedAt: now,
        source: 'sensor'
      });

      // Ambiguous candidate (near event, should be excluded)
      await RainfallObservation.create({
        location: { latitude: 20.2, longitude: 90.2 }, // Close to event
        rainfall: 10,
        recordedAt: now, // Within 72h window
        source: 'sensor'
      });
      await SoilMoistureObservation.create({
        location: { latitude: 20.2, longitude: 90.2 },
        soilMoisture: 0.3,
        recordedAt: now,
        source: 'sensor'
      });
      
      const audit = await generateTrainingDatasetAudit();
      
      expect(audit.positiveCount).toBe(1);
      expect(audit.negativeCount).toBe(1); // the far one
      expect(audit.excludedCandidateCount).toBe(2); // the ambiguous one AND the positive match's rain are both excluded from being negatives
      
      // Pipeline ready is false because it needs >=5, training ready is false because it needs 1000
      expect(audit.pipelineReady).toBe(false);
      
      const positiveSample = audit.dataset.find(s => s.landslide_occurrence === 1);
      expect(positiveSample.rainfall_24h_mm).toBe(10);
      expect(positiveSample.soil_moisture_index).toBe(0.3);
      expect(positiveSample.elevation_meters).toBe(100);
      expect(positiveSample.observation_timestamp).toBe(now.toISOString());
      
      const negativeSample = audit.dataset.find(s => s.landslide_occurrence === 0);
      expect(negativeSample.rainfall_24h_mm).toBe(0);
      expect(negativeSample.soil_moisture_index).toBe(0.2);
      expect(negativeSample.observation_timestamp).toBe(now.toISOString());
      
      expect(audit.temporalMetadata.temporalOrderingAvailable).toBe(true);
      expect(audit.temporalMetadata.timestampMissingCount).toBe(0);
    });

    it('rejects positive events missing eventDate without falling back to reportedAt', async () => {
      terrainService.getTerrainFeaturesForLocation.mockResolvedValue({ elevation: 100, slope: 10, source: 'dem' });
      
      const now = new Date('2026-09-01T12:00:00Z');
      
      // Positive event without eventDate, but WITH reportedAt
      await LandslideEvent.create({
        location: { latitude: 20, longitude: 90 },
        reportedAt: now,
        source: 'official'
      });
      
      const audit = await generateTrainingDatasetAudit();
      
      expect(audit.positiveCount).toBe(0);
      expect(audit.invalidSampleCount).toBe(1);
      expect(audit.temporalMetadata.timestampMissingCount).toBe(1);
    });
  });
});
