const { syncSoilMoisture } = require('./soilMoistureObservationController');
const soilMoistureIngestionService = require('../services/soilMoistureIngestionService');

jest.mock('../services/soilMoistureIngestionService');

describe('soilMoistureObservationController', () => {
  let req, res;

  beforeEach(() => {
    req = { body: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    jest.clearAllMocks();
  });

  describe('syncSoilMoisture', () => {
    it('should require lat and lon', async () => {
      await syncSoilMoisture(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'lat and lon are required parameters' });
    });

    it('should require lat and lon to be numbers', async () => {
      req.body = { lat: 'bad', lon: 20 };
      await syncSoilMoisture(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'lat and lon must be numbers' });
    });

    it('should call ingestion service and return 200 on success', async () => {
      req.body = { lat: 10, lon: 20 };
      soilMoistureIngestionService.syncSoilMoisture.mockResolvedValue({ status: 'success' });
      
      await syncSoilMoisture(req, res);
      
      expect(soilMoistureIngestionService.syncSoilMoisture).toHaveBeenCalledWith(10, 20, false);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: 'success' });
    });

    it('should pass simulation flag if demo=extreme', async () => {
      req.body = { lat: 10, lon: 20, demo: 'extreme' };
      soilMoistureIngestionService.syncSoilMoisture.mockResolvedValue({ status: 'success' });
      
      await syncSoilMoisture(req, res);
      
      expect(soilMoistureIngestionService.syncSoilMoisture).toHaveBeenCalledWith(10, 20, true);
    });

    it('should return 500 on unexpected error', async () => {
      req.body = { lat: 10, lon: 20 };
      soilMoistureIngestionService.syncSoilMoisture.mockRejectedValue(new Error('Internal DB failure'));
      
      await syncSoilMoisture(req, res);
      
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });
  });
});
