process.env.JWT_SECRET = 'test_secret_for_step57_infrastructure';
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');

const InfrastructureAsset = require('../models/InfrastructureAsset');
const RainfallObservation = require('../models/RainfallObservation');
const SoilMoistureObservation = require('../models/SoilMoistureObservation');
const LandslideEvent = require('../models/LandslideEvent');
const FieldReport = require('../models/FieldReport');
const Notification = require('../models/Notification');
const User = require('../models/User');

const { calculateOperationalPriority, normaliseImportance, normalisePopulation, normaliseAlternative, normaliseStatus, normaliseHazardContext } = require('../services/infrastructurePriorityService');
const { evaluateEarlyWarning, WARNING_LEVELS } = require('../services/earlyWarningService');

jest.mock('../services/terrainService', () => ({
  getTerrainFeaturesForLocation: jest.fn().mockResolvedValue({
    elevation: 400,
    slope: 12,
    source: 'cache',
    cellKey: 'mock_key'
  })
}));

jest.mock('../services/mlRiskModelService', () => ({
  predictRisk: jest.fn().mockResolvedValue({
    status: 'prediction_refused',
    reason: 'Model unavailable'
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

const testLoc = { latitude: 25.57, longitude: 91.88 }; // Shillong area

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  user = await User.create({
    name: 'Step 57 Infrastructure Officer',
    email: 'step57@example.com',
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
  await InfrastructureAsset.deleteMany({});
  await RainfallObservation.deleteMany({});
  await SoilMoistureObservation.deleteMany({});
  await LandslideEvent.deleteMany({});
  await FieldReport.deleteMany({});
  await Notification.deleteMany({});
  jest.clearAllMocks();
});

describe('Step 57 — Road/Village/Infrastructure Operational Finalization', () => {

  // 1. Nearby road priority
  it('1. Calculates operational priority for a nearby road asset', async () => {
    await InfrastructureAsset.create({
      name: 'National Highway 40',
      assetType: 'road',
      location: { latitude: 25.575, longitude: 91.885 },
      importance: 8,
      populationServed: 12000,
      alternativeAvailable: false,
      status: 'active'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.nearbyInfrastructure).toHaveLength(1);
    const road = res.body.nearbyInfrastructure[0];
    expect(road.name).toBe('National Highway 40');
    expect(road.assetType).toBe('road');
    expect(road.operationalPriority).toBeDefined();
    expect(road.operationalPriority.priorityType).toBe('operational');
    expect(road.operationalPriority.status).toBe('calculated');
    expect(road.operationalPriority.score).toBeGreaterThanOrEqual(0);
    expect(road.operationalPriority.score).toBeLessThanOrEqual(100);
  });

  // 2. Nearby village priority
  it('2. Calculates operational priority for a nearby village asset with high population dependency', async () => {
    await InfrastructureAsset.create({
      name: 'Mawlynnong Village',
      assetType: 'village',
      location: { latitude: 25.568, longitude: 91.879 },
      importance: 7,
      populationServed: 4500,
      alternativeAvailable: false,
      status: 'active'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.nearbyInfrastructure).toHaveLength(1);
    const village = res.body.nearbyInfrastructure[0];
    expect(village.name).toBe('Mawlynnong Village');
    expect(village.assetType).toBe('village');
    expect(village.populationServed).toBe(4500);
    expect(village.operationalPriority.status).toBe('calculated');
    expect(village.operationalPriority.factorAvailability.population).toBe(true);
  });

  // 3. Hospital/bridge/school/public facility priority
  it('3. Distinguishes critical infrastructure types (hospital, bridge, school, public facility) and calculates their priority', async () => {
    await InfrastructureAsset.create([
      {
        name: 'Civil Hospital Shillong',
        assetType: 'hospital',
        location: { latitude: 25.572, longitude: 91.882 },
        importance: 10,
        populationServed: 50000,
        alternativeAvailable: false,
        status: 'active'
      },
      {
        name: 'Umiam River Bridge',
        assetType: 'bridge',
        location: { latitude: 25.580, longitude: 91.890 },
        importance: 9,
        populationServed: 25000,
        alternativeAvailable: false,
        status: 'closed' // closed bridge has top urgency
      },
      {
        name: 'Pine Mount School',
        assetType: 'school',
        location: { latitude: 25.569, longitude: 91.881 },
        importance: 8,
        populationServed: 1200,
        alternativeAvailable: true,
        status: 'active'
      },
      {
        name: 'Community Relief Center',
        assetType: 'public_facility',
        location: { latitude: 25.571, longitude: 91.884 },
        importance: 7,
        populationServed: 5000,
        alternativeAvailable: true,
        status: 'active'
      }
    ]);

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.nearbyInfrastructure).toHaveLength(4);

    const types = res.body.nearbyInfrastructure.map(a => a.assetType);
    expect(types).toContain('hospital');
    expect(types).toContain('bridge');
    expect(types).toContain('school');
    expect(types).toContain('public_facility');

    // Closed bridge with no alternative should have highest or near-highest operational urgency
    const bridge = res.body.nearbyInfrastructure.find(a => a.assetType === 'bridge');
    expect(bridge.status).toBe('closed');
    expect(bridge.operationalPriority.score).toBeGreaterThanOrEqual(75);
  });

  // 4. Multiple assets sorted by operational priority
  it('4. Sorts multiple nearby assets in descending order of operational priority score', async () => {
    await InfrastructureAsset.create([
      {
        name: 'Low Priority Local Road',
        assetType: 'road',
        location: { latitude: 25.571, longitude: 91.881 },
        importance: 2,
        populationServed: 100,
        alternativeAvailable: true,
        status: 'active'
      },
      {
        name: 'High Priority Closed Bridge',
        assetType: 'bridge',
        location: { latitude: 25.572, longitude: 91.882 },
        importance: 10,
        populationServed: 15000,
        alternativeAvailable: false,
        status: 'closed'
      },
      {
        name: 'Medium Priority Clinic',
        assetType: 'hospital',
        location: { latitude: 25.573, longitude: 91.883 },
        importance: 6,
        populationServed: 3000,
        alternativeAvailable: false,
        status: 'active'
      }
    ]);

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const assets = res.body.nearbyInfrastructure;
    expect(assets).toHaveLength(3);

    // Verify descending order
    expect(assets[0].name).toBe('High Priority Closed Bridge');
    expect(assets[0].operationalPriority.score).toBeGreaterThanOrEqual(assets[1].operationalPriority.score);
    expect(assets[1].operationalPriority.score).toBeGreaterThanOrEqual(assets[2].operationalPriority.score);
    expect(assets[2].name).toBe('Low Priority Local Road');
  });

  // 5. Asset outside search radius excluded
  it('5. Excludes infrastructure assets outside the 50km search radius', async () => {
    // Within ~2km
    await InfrastructureAsset.create({
      name: 'Nearby Hospital',
      assetType: 'hospital',
      location: { latitude: 25.58, longitude: 91.89 },
      importance: 8
    });

    // ~120km away (Guwahati area)
    await InfrastructureAsset.create({
      name: 'Distant Guwahati Bridge',
      assetType: 'bridge',
      location: { latitude: 26.18, longitude: 91.75 },
      importance: 9
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.nearbyInfrastructure).toHaveLength(1);
    expect(res.body.nearbyInfrastructure[0].name).toBe('Nearby Hospital');
    expect(res.body.nearbyInfrastructure.some(a => a.name === 'Distant Guwahati Bridge')).toBe(false);
  });

  // 6. No nearby assets returns empty list
  it('6. Returns an explicit empty list when no infrastructure assets exist nearby', async () => {
    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.nearbyInfrastructure).toEqual([]);
    expect(res.body.contextualData.infrastructure).toEqual([]);
  });

  // 7. Missing optional fields handled safely
  it('7. Handles missing optional fields safely without NaN or fabricated values', async () => {
    await InfrastructureAsset.create({
      name: 'Bare Minimum Road',
      assetType: 'road',
      location: { latitude: 25.571, longitude: 91.881 }
      // importance, populationServed, alternativeAvailable, status all omitted
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.nearbyInfrastructure).toHaveLength(1);
    const asset = res.body.nearbyInfrastructure[0];
    expect(asset.name).toBe('Bare Minimum Road');
    expect(asset.importance).toBeUndefined();
    expect(asset.populationServed).toBeUndefined();
    expect(asset.alternativeAvailable).toBeUndefined();
    expect(asset.status).toBeUndefined();

    // Verify operationalPriority handled missing fields safely
    expect(asset.operationalPriority.factorAvailability.importance).toBe(false);
    expect(asset.operationalPriority.factorAvailability.population).toBe(false);
    expect(asset.operationalPriority.factorAvailability.alternative).toBe(false);
    expect(asset.operationalPriority.factorAvailability.status).toBe(false);
    expect(asset.operationalPriority.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('does NOT imply zero population')
    ]));
  });

  // 8. Population served handled correctly
  it('8. Evaluates population served correctly (higher population increases score, soft-capped)', () => {
    const lowPop = calculateOperationalPriority({
      importance: 5,
      populationServed: 1000,
      alternativeAvailable: true,
      status: 'active'
    });

    const highPop = calculateOperationalPriority({
      importance: 5,
      populationServed: 8000,
      alternativeAvailable: true,
      status: 'active'
    });

    const cappedPop = calculateOperationalPriority({
      importance: 5,
      populationServed: 25000, // soft-capped at 10,000
      alternativeAvailable: true,
      status: 'active'
    });

    const missingPop = calculateOperationalPriority({
      importance: 5,
      alternativeAvailable: true,
      status: 'active'
    });

    expect(highPop.score).toBeGreaterThan(lowPop.score);
    expect(cappedPop.score).toBeGreaterThanOrEqual(highPop.score);
    expect(missingPop.factorAvailability.population).toBe(false);
    expect(missingPop.limitations.some(l => l.includes('Population-served data is unavailable'))).toBe(true);
  });

  // 9. Alternative availability handled correctly
  it('9. Evaluates alternative availability (no alternative has higher urgency than alternative available)', () => {
    const withAlt = calculateOperationalPriority({
      importance: 6,
      alternativeAvailable: true,
      status: 'active'
    });

    const withoutAlt = calculateOperationalPriority({
      importance: 6,
      alternativeAvailable: false,
      status: 'active'
    });

    expect(withoutAlt.score).toBeGreaterThan(withAlt.score);
    expect(normaliseAlternative(false).value).toBe(1.0);
    expect(normaliseAlternative(true).value).toBe(0.2);
    expect(normaliseAlternative(null).available).toBe(false);
  });

  // 10. Asset status handled correctly
  it('10. Evaluates asset status correctly (closed > unknown > active)', () => {
    const closed = calculateOperationalPriority({ importance: 5, status: 'closed' });
    const unknown = calculateOperationalPriority({ importance: 5, status: 'unknown' });
    const active = calculateOperationalPriority({ importance: 5, status: 'active' });

    expect(closed.score).toBeGreaterThan(unknown.score);
    expect(unknown.score).toBeGreaterThan(active.score);
    expect(normaliseStatus('closed').value).toBe(1.0);
    expect(normaliseStatus('unknown').value).toBe(0.6);
    expect(normaliseStatus('active').value).toBe(0.3);
  });

  // 11. Hazard context affects operational priority only where intended
  it('11. Hazard context elevates operational response priority when hazardous conditions exist', async () => {
    const weatherFactory = require('../services/weatherProviders/weatherProviderFactory');
    weatherFactory.getProvider.mockReturnValue({
      fetchRainfall: jest.fn().mockResolvedValue({
        precipitation: 120,
        recordedAt: new Date()
      }),
      fetchSoilMoisture: jest.fn().mockResolvedValue({
        soilMoistureVolumetric: 0.85,
        recordedAt: new Date()
      })
    });

    await InfrastructureAsset.create({
      name: 'District Hospital',
      assetType: 'hospital',
      location: { latitude: 25.571, longitude: 91.881 },
      importance: 8,
      populationServed: 10000,
      alternativeAvailable: false,
      status: 'active'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const asset = res.body.nearbyInfrastructure[0];
    expect(asset.operationalPriority.factorAvailability.hazardContext).toBe(true);
    expect(asset.operationalPriority.score).toBeGreaterThanOrEqual(70);
  });

  // 12. Infrastructure does NOT independently escalate NO_WARNING
  it('12. Infrastructure exposure does NOT independently escalate a NO_WARNING state', () => {
    // Zero/low environmental evidence
    const inputEvidence = {
      rainfall: { latestValue: 5, isRecent: true },
      soilMoisture: { latestValue: 15, isRecent: true },
      terrain: { elevation: 100, slope: 4 } // very low slope
    };

    // Even if an infrastructure asset has critical operational priority (e.g. closed hospital, score 95)
    const criticalInfra = { status: 'calculated', score: 95 };

    const warning = evaluateEarlyWarning({
      location: testLoc,
      evidence: inputEvidence,
      infrastructure: criticalInfra
    });

    expect(warning.warningLevel).toBe(WARNING_LEVELS.NO_WARNING);
    expect(warning.triggers.some(t => t.category === 'infrastructure_exposure')).toBe(true);
    expect(warning.reasoning.some(r => r.includes('influences operational priority, not scientific hazard'))).toBe(true);
    expect(warning.recommendedActions).toContain('Prioritize inspections and response for exposed critical infrastructure.');
  });

  // 13. Infrastructure does NOT become a scientific probability
  it('13. Operational priority never claims to be scientific landslide probability', () => {
    const result = calculateOperationalPriority({
      importance: 10,
      populationServed: 50000,
      alternativeAvailable: false,
      status: 'closed',
      hazardContext: 'critical'
    });

    expect(result.priorityType).toBe('operational');
    expect(result.probability).toBeUndefined();
    expect(result.riskLevel).toBeUndefined();
    expect(result.status).toBe('calculated');
    expect(result.totalFactorCount).toBe(5);
  });

  // 14. Correct GeoJSON coordinate order
  it('14. Auto-populates locationPoint with [longitude, latitude] GeoJSON coordinate order', async () => {
    const asset = await InfrastructureAsset.create({
      name: 'GeoJSON Test Asset',
      assetType: 'public_facility',
      location: { latitude: 25.578, longitude: 91.882 }
    });

    expect(asset.location.latitude).toBe(25.578);
    expect(asset.location.longitude).toBe(91.882);
    expect(asset.locationPoint.type).toBe('Point');
    // GeoJSON order: [longitude, latitude]
    expect(asset.locationPoint.coordinates[0]).toBe(91.882);
    expect(asset.locationPoint.coordinates[1]).toBe(25.578);
  });

  // 15. Invalid coordinates rejected
  it('15. Rejects invalid coordinates for infrastructure queries and schema validation', async () => {
    // 15A: API validation
    const resBadLat = await request(app)
      .get(`/api/area-intelligence?lat=95&lon=91.88`)
      .set('Authorization', `Bearer ${token}`);
    expect(resBadLat.status).toBe(400);

    const resBadLon = await request(app)
      .get(`/api/area-intelligence?lat=25.57&lon=200`)
      .set('Authorization', `Bearer ${token}`);
    expect(resBadLon.status).toBe(400);

    // 15B: Model validation
    const invalidDoc = new InfrastructureAsset({
      name: 'Invalid Lat Road',
      assetType: 'road',
      location: { latitude: 100, longitude: 91.88 }
    });
    const err = invalidDoc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors['location.latitude']).toBeDefined();
  });

  // 16. Area Intelligence exposes infrastructure correctly
  it('16. Exposes complete operational infrastructure metadata in Area Intelligence response', async () => {
    await InfrastructureAsset.create({
      name: 'Shillong Civil Hospital',
      assetType: 'hospital',
      location: { latitude: 25.571, longitude: 91.881 },
      importance: 9,
      populationServed: 30000,
      alternativeAvailable: false,
      status: 'active'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const asset = res.body.nearbyInfrastructure[0];
    expect(asset._id).toBeDefined();
    expect(asset.name).toBe('Shillong Civil Hospital');
    expect(asset.assetType).toBe('hospital');
    expect(asset.location).toEqual({ latitude: 25.571, longitude: 91.881 });
    expect(asset.status).toBe('active');
    expect(asset.importance).toBe(9);
    expect(asset.populationServed).toBe(30000);
    expect(asset.alternativeAvailable).toBe(false);
    expect(asset.operationalPriority).toBeDefined();
    expect(asset.operationalPriority.score).toBeDefined();
    expect(asset.operationalPriority.reasoning).toBeDefined();
    expect(asset.operationalPriority.limitations).toBeDefined();
  });

  // 17. Existing early warning and notification behavior remains intact
  it('17. Preserves early warning decision escalation and notification pipeline when hazard triggers exist', async () => {
    const weatherFactory = require('../services/weatherProviders/weatherProviderFactory');
    weatherFactory.getProvider.mockReturnValue({
      fetchRainfall: jest.fn().mockResolvedValue({
        precipitation: 250,
        recordedAt: new Date()
      }),
      fetchSoilMoisture: jest.fn().mockResolvedValue({
        soilMoistureVolumetric: 0.90,
        recordedAt: new Date()
      })
    });

    // High operational priority asset in the area
    await InfrastructureAsset.create({
      name: 'High Risk Pass Bridge',
      assetType: 'bridge',
      location: { latitude: 25.571, longitude: 91.881 },
      importance: 9,
      populationServed: 10000,
      alternativeAvailable: false,
      status: 'closed'
    });

    const res = await request(app)
      .get(`/api/area-intelligence?lat=${testLoc.latitude}&lon=${testLoc.longitude}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.earlyWarning).toBeDefined();
    // Environmental baseline critical + high infra exposure escalates warning to critical
    expect(res.body.earlyWarning.warningLevel).toBe(WARNING_LEVELS.CRITICAL);
    expect(res.body.earlyWarning.triggers.some(t => t.category === 'infrastructure_exposure')).toBe(true);

    // Verify that a notification was created for this critical event
    // Allow brief async resolution
    await new Promise(r => setTimeout(r, 300));
    const notifications = await Notification.find({});
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    expect(notifications[0].severity).toBe('critical');
    expect(notifications[0].type).toBe('warning');
  });

});
