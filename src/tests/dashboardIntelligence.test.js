const request = require('supertest');
const app = require('../app');
const LandslideEvent = require('../models/LandslideEvent');
const FieldReport = require('../models/FieldReport');
const InfrastructureAsset = require('../models/InfrastructureAsset');
const OpenMeteoProvider = require('../services/weatherProviders/openMeteoProvider');
const soilMoistureIngestionService = require('../services/soilMoistureIngestionService');
const terrainService = require('../services/terrainService');
const mlRiskModelService = require('../services/mlRiskModelService');
const { predictSusceptibility } = require('../services/mlPredictionService');

jest.mock('../models/LandslideEvent');
jest.mock('../models/FieldReport');
jest.mock('../models/InfrastructureAsset');
jest.mock('../services/weatherProviders/openMeteoProvider');
jest.mock('../services/soilMoistureIngestionService');
jest.mock('../services/terrainService');
jest.mock('../services/mlRiskModelService');
jest.mock('../services/mlPredictionService');

describe('Dashboard Intelligence API (GET /api/dashboard/intelligence)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    OpenMeteoProvider.fetchWeather.mockResolvedValue({
      temperature: 28.5,
      humidity: 80,
      windSpeed: 10.2,
      precipitationProbability: 45,
      precipitation24h: 35.0,
      precipitation: 1.2,
      recordedAt: new Date('2026-09-09T10:00:00Z')
    });

    soilMoistureIngestionService.syncSoilMoisture.mockResolvedValue({
      status: 'success',
      dataMode: 'live',
      freshness: 'fresh',
      data: {
        soilMoisture: 65.5,
        recordedAt: new Date('2026-09-09T10:00:00Z')
      }
    });

    terrainService.getTerrainFeaturesForLocation.mockResolvedValue({
      elevation: 500,
      slope: 22.5,
      source: 'SRTM'
    });

    mlRiskModelService.predictRisk.mockResolvedValue({
      status: 'success',
      modelVersion: '1.0.0',
      prediction: { probability: 0.75, class: 'High' }
    });

    predictSusceptibility.mockResolvedValue({
      status: 'success',
      probability: 0.75,
      features: { elevation_m: 500, slope_deg: 22.5 }
    });

    LandslideEvent.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: 'ev1',
            location: { latitude: 31.15, longitude: 77.20 },
            isHistorical: true,
            severity: 'high',
            reportedAt: new Date('2023-07-09T00:00:00Z')
          }
        ])
      })
    });

    FieldReport.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              _id: 'rep1',
              description: 'Rockfall on hill road',
              status: 'verified',
              location: { latitude: 31.12, longitude: 77.18 }
            }
          ])
        })
      })
    });

    InfrastructureAsset.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: 'inf1',
            name: 'State Highway 10',
            assetType: 'road',
            status: 'closed',
            importance: 5,
            location: { latitude: 31.14, longitude: 77.19 }
          }
        ])
      })
    });
  });

  it('rejects missing or invalid coordinates with HTTP 400', async () => {
    const res1 = await request(app).get('/api/dashboard/intelligence');
    expect(res1.status).toBe(400);
    expect(res1.body.error).toContain('Valid latitude');

    const res2 = await request(app).get('/api/dashboard/intelligence?lat=abc&lon=91.5');
    expect(res2.status).toBe(400);

    const res3 = await request(app).get('/api/dashboard/intelligence?lat=95&lon=91.5');
    expect(res3.status).toBe(400);
  });

  it('returns comprehensive location-aware intelligence for valid coordinates', async () => {
    const res = await request(app).get('/api/dashboard/intelligence?lat=31.1048&lon=77.1734');
    expect(res.status).toBe(200);

    // Selected location
    expect(res.body.selectedLocation).toEqual({ latitude: 31.1048, longitude: 77.1734 });

    // Weather telemetry
    expect(res.body.weather.temperature).toBe(28.5);
    expect(res.body.weather.humidity).toBe(80);
    expect(res.body.weather.windSpeed).toBe(10.2);
    expect(res.body.weather.precipitationProbability).toBe(45);
    expect(res.body.weather.rainfall24h).toBe(35.0);
    expect(res.body.weather.currentIntervalPrecipitation).toBe(1.2);

    // Incident History with distanceKm
    expect(res.body.incidentHistory.totalCount).toBe(1);
    expect(res.body.incidentHistory.events[0].distanceKm).toBeGreaterThan(0);
    expect(res.body.incidentHistory.events[0].isHistorical).toBe(true);

    // Field reports with distanceKm
    expect(res.body.fieldReports.totalCount).toBe(1);
    expect(res.body.fieldReports.reports[0].distanceKm).toBeGreaterThan(0);

    // Infrastructure with distanceKm and operational priority
    expect(res.body.infrastructure.totalCount).toBe(1);
    expect(res.body.infrastructure.assets[0].distanceKm).toBeGreaterThan(0);
    expect(res.body.infrastructure.assets[0].operationalPriority.status).toBe('calculated');

    // AI Risk Analysis
    expect(res.body.aiRiskAnalysis.riskLevel).toBeDefined();
    expect(res.body.aiRiskAnalysis.confidence).toBe(75);
  });

  it('correctly reports 0 count and empty events when no nearby landslides are found', async () => {
    LandslideEvent.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([])
      })
    });

    const res = await request(app).get('/api/dashboard/intelligence?lat=26.16&lon=91.69');
    expect(res.status).toBe(200);
    expect(res.body.incidentHistory.totalCount).toBe(0);
    expect(res.body.incidentHistory.events).toEqual([]);
    expect(res.body.incidentHistory.nearestDistanceKm).toBeNull();
  });

  it('handles weather provider upstream failure gracefully with unavailable status', async () => {
    OpenMeteoProvider.fetchWeather.mockRejectedValue(new Error('Open-Meteo network timeout'));

    const res = await request(app).get('/api/dashboard/intelligence?lat=26.16&lon=91.69');
    expect(res.status).toBe(200);
    expect(res.body.weather.dataMode).toBe('unavailable');
    expect(res.body.weather.rainfall24h).toBeNull();
    expect(res.body.weather.temperature).toBeNull();
  });

  it('preserves rainfall24h as null when 24h accumulation is unavailable, never falling back to current precipitation', async () => {
    OpenMeteoProvider.fetchWeather.mockResolvedValue({
      temperature: 30.1,
      humidity: 85,
      windSpeed: 8.0,
      precipitationProbability: 30,
      precipitation24h: null,
      precipitation: 0.4,
      recordedAt: new Date('2026-09-09T10:00:00Z')
    });

    const res = await request(app).get('/api/dashboard/intelligence?lat=26.16&lon=91.69');
    expect(res.status).toBe(200);
    expect(res.body.weather.rainfall24h).toBeNull();
    expect(res.body.weather.currentIntervalPrecipitation).toBe(0.4);
  });
});
