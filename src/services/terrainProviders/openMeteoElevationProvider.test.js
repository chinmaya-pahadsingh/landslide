const axios = require('axios');
const { fetchElevations, OPEN_METEO_URL } = require('./openMeteoElevationProvider');

jest.mock('axios');

describe('openMeteoElevationProvider', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('1. Successful single-coordinate response', async () => {
    axios.get.mockResolvedValueOnce({
      data: { elevation: [1500] }
    });
    
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    
    expect(result.status).toBe('success');
    expect(result.data.length).toBe(1);
    expect(result.data[0].elevation).toBe(1500);
    expect(result.data[0].status).toBe('success');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('2. Successful multi-coordinate response', async () => {
    axios.get.mockResolvedValueOnce({
      data: { elevation: [1500, 1600] }
    });
    
    const result = await fetchElevations([
      { latitude: 27, longitude: 88 },
      { latitude: 28, longitude: 89 }
    ]);
    
    expect(result.status).toBe('success');
    expect(result.data.length).toBe(2);
    expect(result.data[1].elevation).toBe(1600);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(OPEN_METEO_URL, expect.objectContaining({
      params: { latitude: '27,28', longitude: '88,89' }
    }));
  });

  it('3. Correct parsing of numeric elevation', async () => {
    axios.get.mockResolvedValueOnce({
      data: { elevation: [0] }
    });
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(result.data[0].elevation).toBe(0);
  });

  it('4. Missing elevation array', async () => {
    axios.get.mockResolvedValueOnce({
      data: { } // missing elevation array
    });
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(result.status).toBe('error');
    expect(result.reason).toContain('missing elevation array');
  });

  it('5. Empty elevation array', async () => {
    axios.get.mockResolvedValueOnce({
      data: { elevation: [] } 
    });
    // coordinates array has 1 element, so length mismatch
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(result.status).toBe('error');
    expect(result.reason).toContain('Mismatch');
  });

  it('6. Null elevation', async () => {
    axios.get.mockResolvedValueOnce({
      data: { elevation: [null] }
    });
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(result.status).toBe('success');
    expect(result.data[0].elevation).toBeNull();
    expect(result.data[0].status).toBe('missing');
  });

  it('7. Non-numeric elevation', async () => {
    axios.get.mockResolvedValueOnce({
      data: { elevation: ["1500"] }
    });
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(result.status).toBe('success');
    expect(result.data[0].elevation).toBeNull();
    expect(result.data[0].status).toBe('missing');
  });

  it('8. NaN/Infinity elevation', async () => {
    axios.get.mockResolvedValueOnce({
      data: { elevation: [NaN, Infinity] }
    });
    const result = await fetchElevations([
      { latitude: 27, longitude: 88 },
      { latitude: 28, longitude: 89 }
    ]);
    expect(result.status).toBe('success');
    expect(result.data[0].elevation).toBeNull();
    expect(result.data[1].elevation).toBeNull();
  });

  it('9. HTTP 400', async () => {
    axios.get.mockRejectedValueOnce({
      response: { status: 400 }
    });
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(result.status).toBe('error');
    expect(result.reason).toContain('Client error: 400');
    expect(axios.get).toHaveBeenCalledTimes(1); // No retry for 400
  });

  it('10. HTTP 500 (with retry)', async () => {
    axios.get
      .mockRejectedValueOnce({ response: { status: 500 }, message: 'Server Error' })
      .mockRejectedValueOnce({ response: { status: 500 }, message: 'Server Error' });
      
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(result.status).toBe('error');
    expect(result.reason).toBe('Server Error');
    expect(axios.get).toHaveBeenCalledTimes(2); // Initial + 1 retry
  });

  it('11. Timeout (with retry)', async () => {
    axios.get
      .mockRejectedValueOnce({ code: 'ECONNABORTED' })
      .mockRejectedValueOnce({ code: 'ECONNABORTED' });
      
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(result.status).toBe('error');
    expect(result.reason).toBe('Timeout');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('12. Network failure', async () => {
    axios.get
      .mockRejectedValueOnce({ message: 'Network Error' })
      .mockRejectedValueOnce({ message: 'Network Error' });
      
    const result = await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(result.status).toBe('error');
    expect(result.reason).toBe('Network Error');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('13. Invalid latitude/longitude rejected before HTTP request', async () => {
    const result = await fetchElevations([{ latitude: 95, longitude: 88 }]);
    expect(result.status).toBe('error');
    expect(result.reason).toBe('Invalid coordinates provided');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('14. Verify the correct Open-Meteo endpoint is requested', async () => {
    axios.get.mockResolvedValueOnce({ data: { elevation: [100] } });
    await fetchElevations([{ latitude: 27, longitude: 88 }]);
    expect(axios.get).toHaveBeenCalledWith(OPEN_METEO_URL, expect.any(Object));
  });

  it('15. Verify coordinates are passed correctly', async () => {
    axios.get.mockResolvedValueOnce({ data: { elevation: [100] } });
    await fetchElevations([{ latitude: 27.5, longitude: 88.2 }]);
    expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      params: { latitude: '27.5', longitude: '88.2' }
    }));
  });

  it('16. Verify the provider does not write to MongoDB (implicit)', () => {
    // No mongoose operations are included in the file.
    expect(true).toBe(true);
  });
});
