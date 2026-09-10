const { getAreaIntelligence } = require('./areaIntelligenceController');
const LandslideEvent = require('../models/LandslideEvent');
const RainfallObservation = require('../models/RainfallObservation');
const SoilMoistureObservation = require('../models/SoilMoistureObservation');
const FieldReport = require('../models/FieldReport');
const InfrastructureAsset = require('../models/InfrastructureAsset');
const NewsItem = require('../models/NewsItem');
const { fuseEvidence } = require('../services/evidenceFusionService');
const { getTerrainFeaturesForLocation } = require('../services/terrainService');
const { predictSusceptibility } = require('../services/mlPredictionService');

// Mock dependencies
jest.mock('../models/LandslideEvent');
jest.mock('../models/RainfallObservation');
jest.mock('../models/SoilMoistureObservation');
jest.mock('../models/FieldReport');
jest.mock('../models/InfrastructureAsset');
jest.mock('../models/NewsItem');
jest.mock('../services/evidenceFusionService');
jest.mock('../services/terrainService');
jest.mock('../services/mlPredictionService');
jest.mock('../services/earlyWarningService');
jest.mock('../services/rainfallIngestionService');
jest.mock('../services/soilMoistureIngestionService');

const mockRequest = (query) => ({ query });
const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Area Intelligence Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const mockFind = {
      limit: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    };

    LandslideEvent.find.mockReturnValue(mockFind);
    FieldReport.find.mockReturnValue(mockFind);
    InfrastructureAsset.find.mockReturnValue(mockFind);
    NewsItem.find.mockReturnValue(mockFind);
    
    const { syncRainfall } = require('../services/rainfallIngestionService');
    const { syncSoilMoisture } = require('../services/soilMoistureIngestionService');
    
    syncRainfall.mockResolvedValue({
      status: 'success',
      dataMode: 'live',
      freshness: 'fresh',
      upstreamStatus: 'success',
      data: { rainfall: 50, recordedAt: new Date() }
    });
    
    syncSoilMoisture.mockResolvedValue({
      status: 'success',
      dataMode: 'live',
      freshness: 'fresh',
      upstreamStatus: 'success',
      data: { soilMoisture: 80, recordedAt: new Date() }
    });

    fuseEvidence.mockReturnValue({
      evidenceAvailability: {},
      evidence: {},
      reasoning: [],
      overallStatus: 'insufficient_data',
      limitations: []
    });

    getTerrainFeaturesForLocation.mockResolvedValue({
      elevation: 100,
      slope: 5,
      source: 'cache'
    });

    predictSusceptibility.mockResolvedValue({
      status: 'prediction_refused',
      reason: 'No model'
    });

    const { evaluateEarlyWarning } = require('../services/earlyWarningService');
    evaluateEarlyWarning.mockReturnValue({
      warningLevel: 'no_warning',
      triggers: []
    });
  });

  it('rejects missing latitude', async () => {
    const req = mockRequest({ lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Valid latitude') });
  });

  it('rejects missing longitude', async () => {
    const req = mockRequest({ lat: '25' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Valid latitude') });
  });

  it('rejects invalid latitude out of bounds', async () => {
    const req = mockRequest({ lat: '95', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('queries models and returns structured payload on valid coordinates', async () => {
    const req = mockRequest({ lat: '25', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    const { syncRainfall } = require('../services/rainfallIngestionService');
    const { syncSoilMoisture } = require('../services/soilMoistureIngestionService');

    expect(LandslideEvent.find).toHaveBeenCalled();
    expect(syncRainfall).toHaveBeenCalledWith(25, 90);
    expect(syncSoilMoisture).toHaveBeenCalledWith(25, 90);
    expect(predictSusceptibility).toHaveBeenCalledWith({
      elevation_m: 100,
      slope_deg: 5,
      latitude: 25,
      longitude: 90
      
    });
    expect(fuseEvidence).toHaveBeenCalledWith(expect.objectContaining({
      terrain: { elevation: 100, slope: 5, source: 'cache' },
      mlPrediction: { status: 'unavailable', reason: 'No model', modelVersion: '1.0.0' }
    }));
    
    // Check evaluateEarlyWarning
    const { evaluateEarlyWarning } = require('../services/earlyWarningService');
    expect(evaluateEarlyWarning).toHaveBeenCalledWith(expect.objectContaining({
      evidence: expect.any(Object)
    }));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      selectedLocation: { latitude: 25, longitude: 90 },
      providerStatus: {
        rainfall: { dataMode: 'live', freshness: 'fresh', upstreamStatus: 'success' },
        soilMoisture: { dataMode: 'live', freshness: 'fresh', upstreamStatus: 'success' },
        terrain: 'success'
      },
      evidenceAvailability: expect.any(Object),
      earlyWarning: expect.any(Object),
      evidenceFusion: expect.any(Object),
      contextualData: expect.objectContaining({
        terrain: { elevation: 100, slope: 5, source: 'cache' }
      })
    }));
  });

  it('populates unavailable terrain gracefully without failing', async () => {
    getTerrainFeaturesForLocation.mockResolvedValue({
      elevation: null,
      slope: null,
      source: 'unavailable'
    });
    const req = mockRequest({ lat: '25', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    expect(fuseEvidence).toHaveBeenCalledWith(expect.objectContaining({
      terrain: { elevation: null, slope: null, source: 'unavailable' }
    }));
    expect(predictSusceptibility).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('isolates terrain service rejection cleanly and returns unavailable terrain', async () => {
    getTerrainFeaturesForLocation.mockRejectedValue(new Error('Provider timeout'));
    const req = mockRequest({ lat: '25', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    expect(fuseEvidence).toHaveBeenCalledWith(expect.objectContaining({
      terrain: { elevation: null, slope: null, source: 'unavailable' }
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('gracefully handles database query failure', async () => {
    LandslideEvent.find.mockImplementationOnce(() => { throw new Error('DB Error'); });
    const req = mockRequest({ lat: '25', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('unexpected server error') });
  });

  it('passes successful mlPrediction into fuseEvidence', async () => {
    const mockPrediction = {
      status: 'success',
      probability: 0.88
    };
    predictSusceptibility.mockResolvedValue(mockPrediction);

    const req = mockRequest({ lat: '25', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    expect(fuseEvidence).toHaveBeenCalledWith(expect.objectContaining({
      mlPrediction: expect.objectContaining({
        status: 'success',
        prediction: expect.objectContaining({ probability: 0.88 })
      })
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('Area Intelligence with one provider failed and others successful', async () => {
    const { syncRainfall } = require('../services/rainfallIngestionService');
    const { syncSoilMoisture } = require('../services/soilMoistureIngestionService');
    
    // Rainfall fails
    syncRainfall.mockResolvedValue({
      status: 'failed_upstream',
      dataMode: 'unavailable',
      freshness: 'unavailable',
      upstreamStatus: 'failed_upstream',
      message: 'Live data unavailable'
    });
    
    // Soil and terrain succeed
    syncSoilMoisture.mockResolvedValue({
      status: 'success',
      dataMode: 'live',
      freshness: 'fresh',
      upstreamStatus: 'success',
      data: { soilMoisture: 80, recordedAt: new Date() }
    });

    const req = mockRequest({ lat: '25', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    expect(predictSusceptibility).toHaveBeenCalledWith(expect.objectContaining({
      latitude: 25,
      longitude: 90,
      
    }));

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      providerStatus: {
        rainfall: { dataMode: 'unavailable', freshness: 'unavailable', upstreamStatus: 'failed_upstream' },
        soilMoisture: { dataMode: 'live', freshness: 'fresh', upstreamStatus: 'success' },
        terrain: 'success'
      }
    }));
  });

  it('missing data never becomes zero', async () => {
    const { syncRainfall } = require('../services/rainfallIngestionService');
    syncRainfall.mockRejectedValue(new Error('Complete sync failure'));

    const req = mockRequest({ lat: '25', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    expect(predictSusceptibility).toHaveBeenCalledWith(expect.objectContaining({
      latitude: 25,
      longitude: 90, // Must remain null, NOT zero
    }));

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      providerStatus: expect.objectContaining({
        rainfall: { dataMode: 'unavailable', freshness: 'unavailable', upstreamStatus: 'failed_upstream' }
      })
    }));
  });

  it('includes relevant news strictly as situational awareness without altering risk evaluation', async () => {
    const mockNews = [
      {
        title: 'Road cleared after minor rockfall',
        summary: 'NH-10 cleared for traffic',
        source: { name: 'Local News', type: 'NEWS' },
        publishedAt: new Date()
      }
    ];

    NewsItem.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(mockNews)
    });

    const req = mockRequest({ lat: '25', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      relevantNews: mockNews,
      contextualData: expect.objectContaining({
        news: mockNews
      })
    }));

    // Verify fuseEvidence was NOT passed news
    expect(fuseEvidence).toHaveBeenCalledWith(expect.not.objectContaining({
      news: expect.anything()
    }));
  });

  it('supports simulation=true without writing to live cache', async () => {
    const { syncRainfall } = require('../services/rainfallIngestionService');
    const { syncSoilMoisture } = require('../services/soilMoistureIngestionService');

    const req = mockRequest({ lat: '25', lon: '90', simulation: 'true' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    expect(syncRainfall).toHaveBeenCalledWith(25, 90, true);
    expect(syncSoilMoisture).toHaveBeenCalledWith(25, 90, true);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calculates operational infrastructure priority when assets are present', async () => {
    const mockAssets = [
      {
        name: 'Main District Hospital',
        assetType: 'hospital',
        importance: 9,
        populationServed: 15000,
        alternativeAvailable: false,
        status: 'active'
      }
    ];

    InfrastructureAsset.find.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(mockAssets)
    });

    const { evaluateEarlyWarning } = require('../services/earlyWarningService');

    const req = mockRequest({ lat: '25', lon: '90' });
    const res = mockResponse();
    await getAreaIntelligence(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(evaluateEarlyWarning).toHaveBeenCalledWith(expect.objectContaining({
      infrastructure: expect.objectContaining({
        status: 'calculated',
        score: expect.any(Number)
      })
    }));
  });
});
