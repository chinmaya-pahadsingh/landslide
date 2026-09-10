import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AreaIntelligencePanel } from '../components/AreaIntelligencePanel';
import { areaIntelligenceService } from '../services/areaIntelligenceService';
import { satelliteService } from '../services/satelliteService';

vi.mock('../services/areaIntelligenceService', () => ({
  areaIntelligenceService: {
    getIntelligence: vi.fn()
  }
}));

vi.mock('../services/satelliteService', () => ({
  satelliteService: {
    getLandCover: vi.fn()
  }
}));

const mockOpenAuthModal = vi.fn();
let currentMockToken = 'valid_token';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    token: currentMockToken,
    user: currentMockToken ? { name: 'Test User' } : null,
    openAuthModal: mockOpenAuthModal
  })
}));

describe('AreaIntelligencePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockToken = 'valid_token';
    localStorage.setItem('jwt_token', 'valid_token');
    satelliteService.getLandCover.mockResolvedValue({ available: false });
  });

  const mockLocation = { lat: 25, lon: 90, name: 'Test Location' };

  it('renders nothing when no selected location', () => {
    const { container } = render(<AreaIntelligencePanel selectedLocation={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows login-required state for unauthenticated user and does not call API', async () => {
    currentMockToken = null;
    localStorage.removeItem('jwt_token');

    render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

    expect(screen.getByText(/Authentication Required/i)).toBeTruthy();
    expect(screen.getByText(/require an authorized session/i)).toBeTruthy();
    expect(screen.getByText(/Map viewing, satellite telemetry, and location search remain fully accessible/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Log In to View Intelligence/i })).toBeTruthy();
    
    // Protected API must NOT be called
    expect(areaIntelligenceService.getIntelligence).not.toHaveBeenCalled();

    // No fake environmental values
    expect(screen.queryByText(/mm/i)).toBeNull();
    expect(screen.queryByText(/Soil Moisture/i)).toBeNull();
  });

  it('calls openAuthModal when login button is clicked in guest state', async () => {
    currentMockToken = null;
    localStorage.removeItem('jwt_token');

    render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

    const loginBtn = screen.getByRole('button', { name: /Log In to View Intelligence/i });
    fireEvent.click(loginBtn);

    expect(mockOpenAuthModal).toHaveBeenCalledTimes(1);
  });

  it('handles HTTP 401 specifically as an authentication-required state', async () => {
    // Token was initially present, but rejected with 401
    const authError = new Error('Authentication required. Missing or malformed token.');
    authError.status = 401;
    areaIntelligenceService.getIntelligence.mockRejectedValue(authError);

    render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

    await waitFor(() => {
      expect(screen.getByText(/Authentication Required/i)).toBeTruthy();
    });

    // Should NOT show generic Intelligence Error
    expect(screen.queryByText(/Intelligence Error/i)).toBeNull();
  });

  it('shows loading state initially for authenticated user', async () => {
    areaIntelligenceService.getIntelligence.mockImplementation(() => new Promise(() => {}));
    render(<AreaIntelligencePanel selectedLocation={mockLocation} />);
    expect(screen.getByText(/Gathering local intelligence/i)).toBeTruthy();
  });

  it('displays intelligence data on success for authenticated user with distinct 24h and current precipitation', async () => {
    areaIntelligenceService.getIntelligence.mockResolvedValue({
      selectedLocation: { latitude: 25, longitude: 90 },
      evidenceAvailability: { rainfall: true, soilMoisture: false, historical: true, fieldReports: false },
      evidenceFusion: {
        overallStatus: 'partial_data',
        evidence: {
          rainfall: { latestValue: 150, rainfall24h: 150, currentIntervalPrecipitation: 5.0 },
          historical: { eventCount: 2 }
        },
        limitations: ['No soil moisture']
      },
      nearbyInfrastructure: [],
      retrievedAt: new Date().toISOString()
    });

    render(<AreaIntelligencePanel selectedLocation={mockLocation} />);
    
    expect(await screen.findByText(/partial data/i)).toBeTruthy();
    expect(screen.getByText('Rainfall (24h)')).toBeTruthy();
    expect(screen.getByText(/150 mm/i)).toBeTruthy();
    expect(screen.getByText('Current Precipitation')).toBeTruthy();
    expect(screen.getByText(/5 mm/i)).toBeTruthy();
    expect(screen.getByText(/2 recorded/i)).toBeTruthy();
    expect(screen.getByText(/No soil moisture/i)).toBeTruthy();
  });

  it('displays Unavailable for Rainfall (24h) when rainfall24h is null, not falling back to current precipitation', async () => {
    areaIntelligenceService.getIntelligence.mockResolvedValue({
      selectedLocation: { latitude: 25, longitude: 90 },
      evidenceAvailability: { rainfall: true, soilMoisture: false, historical: false, fieldReports: false },
      evidenceFusion: {
        overallStatus: 'partial_data',
        evidence: {
          rainfall: { latestValue: 0.3, rainfall24h: null, currentIntervalPrecipitation: 0.3 },
        },
        limitations: []
      },
      nearbyInfrastructure: [],
      retrievedAt: new Date().toISOString()
    });

    render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

    await waitFor(() => {
      expect(screen.getByText('Rainfall (24h)')).toBeTruthy();
    });

    // Rainfall (24h) item must display Unavailable
    const rainfallItem = screen.getByText('Rainfall (24h)').closest('.ai-item');
    expect(rainfallItem.textContent).toContain('Unavailable');
    expect(rainfallItem.textContent).not.toContain('0.3 mm');

    // Current Precipitation displays its own distinct value
    const currentItem = screen.getByText('Current Precipitation').closest('.ai-item');
    expect(currentItem.textContent).toContain('0.3 mm');
  });

  it('displays standard error state on non-401 failure', async () => {
    areaIntelligenceService.getIntelligence.mockRejectedValue(new Error('Network error'));

    render(<AreaIntelligencePanel selectedLocation={mockLocation} />);
    
    expect(await screen.findByText(/Intelligence Error/i)).toBeTruthy();
    expect(screen.getByText(/Network error/i)).toBeTruthy();
    expect(screen.queryByText(/Authentication Required/i)).toBeNull();
  });

  it('calls onClose when close button is clicked', async () => {
    areaIntelligenceService.getIntelligence.mockResolvedValue({
      selectedLocation: { latitude: 25, longitude: 90 },
      evidenceAvailability: {},
      evidenceFusion: { overallStatus: 'insufficient_data', limitations: [] },
      retrievedAt: new Date().toISOString()
    });

    const onClose = vi.fn();
    render(<AreaIntelligencePanel selectedLocation={mockLocation} onClose={onClose} />);
    
    expect(await screen.findByText(/insufficient data/i)).toBeTruthy();

    const closeBtn = screen.getByRole('button', { name: /Close panel/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  describe('Data-Truth and Provenance Verification', () => {
    it('displays "AI Prediction: Unavailable" with truthful reason when no model is operational and manufactures zero fake confidence', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25.5, longitude: 91.2 },
        evidenceAvailability: { mlPrediction: false },
        mlPrediction: {
          status: 'prediction_refused',
          reason: 'Model artifact or metadata unavailable.'
        },
        evidenceFusion: { overallStatus: 'partial_data', limitations: ['No trained ML prediction is currently available.'] },
        retrievedAt: new Date().toISOString()
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('AI Prediction: Unavailable')).toBeTruthy();
      expect(screen.getByText(/Model artifact or metadata unavailable/i)).toBeTruthy();
      expect(screen.getByText(/training gate requires 1,000 genuine samples/i)).toBeTruthy();

      // Ensure no manufactured confidence or fake percentages are shown
      expect(screen.queryByText(/AI Risk: LOW/i)).toBeNull();
      expect(screen.queryByText(/AI Risk: HIGH/i)).toBeNull();
      expect(screen.queryByText(/Model confidence/i)).toBeNull();
    });

    it('displays "Unavailable" for missing environmental telemetry without converting to zero', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25.5, longitude: 91.2 },
        evidenceAvailability: { rainfall: false, soilMoisture: false, terrain: false },
        evidenceFusion: {
          overallStatus: 'insufficient_data',
          evidence: {},
          limitations: []
        },
        retrievedAt: new Date().toISOString()
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      await waitFor(() => {
        expect(screen.getByText('Evidence-Based Risk Assessment')).toBeTruthy();
      });

      // Environmental metrics must show Unavailable, not 0
      const rainfallEl = screen.getByText('Rainfall (24h)').closest('.ai-item');
      expect(rainfallEl.textContent).toContain('Unavailable');
      expect(rainfallEl.textContent).not.toContain('0 mm');

      const soilEl = screen.getByText('Soil Moisture').closest('.ai-item');
      expect(soilEl.textContent).toContain('Unavailable');
      expect(soilEl.textContent).not.toContain('0%');

      const elevEl = screen.getByText('Elevation').closest('.ai-item');
      expect(elevEl.textContent).toContain('Unavailable');
      expect(elevEl.textContent).not.toContain('0 m');

      const slopeEl = screen.getByText('Slope').closest('.ai-item');
      expect(slopeEl.textContent).toContain('Unavailable');
      expect(slopeEl.textContent).not.toContain('0.0°');
    });

    it('renders truthful empty states for historical landslides, field reports, and infrastructure', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25.5, longitude: 91.2 },
        evidenceAvailability: { historical: false, fieldReports: false },
        evidenceFusion: { overallStatus: 'insufficient_data', evidence: {}, limitations: [] },
        nearbyInfrastructure: [],
        retrievedAt: new Date().toISOString()
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('No historical landslides found in this area')).toBeTruthy();
      expect(screen.getByText('No field reports logged in this area')).toBeTruthy();
      expect(screen.getByText('No infrastructure assets recorded in this area')).toBeTruthy();
      expect(screen.getByText(/Historical catalogue events for contextual awareness \(not active hazards\)/i)).toBeTruthy();
    });

    it('labels evidence fusion explicitly as "Evidence-Based Risk Assessment" avoiding "AI prediction"', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25.5, longitude: 91.2 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('Evidence-Based Risk Assessment')).toBeTruthy();
    });

    it('displays early warning status with transparent explanation for insufficient baseline data', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25.5, longitude: 91.2 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'insufficient_data', limitations: [] },
        earlyWarning: {
          warningLevel: 'advisory',
          dataStatus: 'insufficient',
          recommendedActions: ['Deploy sensors to gather environmental data.']
        },
        retrievedAt: new Date().toISOString()
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('ADVISORY')).toBeTruthy();
      expect(screen.getByText('Advisory issued due to incomplete/unknown baseline data.')).toBeTruthy();
      expect(screen.getByText('Deploy sensors to gather environmental data.')).toBeTruthy();
    });

    it('immediately clears stale location A data when switching to location B', async () => {
      let resolveLocationB;
      const promiseB = new Promise((resolve) => {
        resolveLocationB = resolve;
      });

      areaIntelligenceService.getIntelligence
        .mockResolvedValueOnce({
          selectedLocation: { latitude: 25, longitude: 90 },
          evidenceAvailability: { rainfall: true },
          evidenceFusion: {
            overallStatus: 'available',
            evidence: { rainfall: { rainfall24h: 125 } },
            limitations: []
          },
          retrievedAt: new Date().toISOString()
        })
        .mockImplementationOnce(() => promiseB);

      const { rerender } = render(<AreaIntelligencePanel selectedLocation={{ lat: 25, lon: 90, name: 'Location A' }} />);

      expect(await screen.findByText(/125 mm/i)).toBeTruthy();

      // Switch to Location B
      rerender(<AreaIntelligencePanel selectedLocation={{ lat: 27, lon: 92, name: 'Location B' }} />);

      // Stale Location A data must NOT be visible while Location B is loading
      expect(screen.queryByText(/125 mm/i)).toBeNull();
      expect(screen.getByText(/Gathering local intelligence/i)).toBeTruthy();

      // Resolve Location B
      resolveLocationB({
        selectedLocation: { latitude: 27, longitude: 92 },
        evidenceAvailability: { rainfall: true },
        evidenceFusion: {
          overallStatus: 'available',
          evidence: { rainfall: { rainfall24h: 40 } },
          limitations: []
        },
        retrievedAt: new Date().toISOString()
      });

      expect(await screen.findByText(/40 mm/i)).toBeTruthy();
      expect(screen.queryByText(/125 mm/i)).toBeNull();
    });

    it('renders simulation banner when simulation mode telemetry is detected', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25, longitude: 90 },
        providerStatus: {
          rainfall: { dataMode: 'simulation' },
          soilMoisture: { dataMode: 'simulation' }
        },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText(/SIMULATION MODE ACTIVE/i)).toBeTruthy();
      expect(screen.getByText(/Telemetry is simulated for testing\/demonstration/i)).toBeTruthy();
    });

    it('renders exact provenance source badges matching real providers', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25, longitude: 90 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('Open-Meteo model data')).toBeTruthy();
      expect(screen.getByText('Copernicus DEM (90m)')).toBeTruthy();
      expect(screen.getByText('NASA Global Landslide Catalog')).toBeTruthy();
      expect(screen.getByText('Ground field reports')).toBeTruthy();
      expect(screen.getByText('Infrastructure database')).toBeTruthy();
      expect(screen.getByText('XGBoost (ml/predict.py)')).toBeTruthy();
      expect(screen.getByText('Sentinel-2 10m')).toBeTruthy();
    });
  });

  describe('Satellite Land-Cover Evidence Integration (Step 54D)', () => {
    it('renders available satellite evidence with source, class, category, context, and contribution points', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25, longitude: 90 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      satelliteService.getLandCover.mockResolvedValue({
        available: true,
        source: 'Sentinel-2 10m Land Cover',
        classCode: 60,
        className: 'Bare Ground',
        category: 'bare',
        confidence: null,
        contributionPoints: 5,
        riskContext: 'Increased surface vulnerability'
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('Sentinel-2 10m Land Cover')).toBeTruthy();
      expect(screen.getByText('Bare Ground')).toBeTruthy();
      expect(screen.getByText('bare')).toBeTruthy();
      expect(screen.getByText('Increased surface vulnerability')).toBeTruthy();
      expect(screen.getByText('+5 points')).toBeTruthy();
    });

    it('renders vegetative satellite evidence with stabilizing context and negative contribution', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25, longitude: 90 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      satelliteService.getLandCover.mockResolvedValue({
        available: true,
        source: 'Sentinel-2 10m Land Cover',
        classCode: 10,
        className: 'Tree Cover',
        category: 'vegetation',
        contributionPoints: -3
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('Tree Cover')).toBeTruthy();
      expect(screen.getByText('vegetation')).toBeTruthy();
      expect(screen.getByText('Contextual root anchoring & stabilization')).toBeTruthy();
      expect(screen.getByText('-3 points')).toBeTruthy();
    });

    it('displays "Satellite evidence unavailable" when provider returns available: false', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25, longitude: 90 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      satelliteService.getLandCover.mockResolvedValue({
        available: false,
        reason: 'Coordinates out of bounds or provider timeout'
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('Satellite evidence unavailable')).toBeTruthy();
      // Must NOT fabricate values
      expect(screen.queryByText(/Tree Cover/i)).toBeNull();
      expect(screen.queryByText(/Bare Ground/i)).toBeNull();
      expect(screen.queryByText(/\+5 points/i)).toBeNull();
    });

    it('displays "Satellite evidence unavailable" when category is unknown and does NOT fabricate vegetation or 0', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25, longitude: 90 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      satelliteService.getLandCover.mockResolvedValue({
        available: true,
        source: 'Sentinel-2 10m Land Cover',
        category: 'unknown'
      });

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('Satellite evidence unavailable')).toBeTruthy();
      expect(screen.queryByText(/vegetation/i)).toBeNull();
      expect(screen.queryByText(/safe/i)).toBeNull();
    });

    it('displays loading state while satellite query is pending without blocking other intelligence', async () => {
      let resolveSatellite;
      const satellitePromise = new Promise((resolve) => {
        resolveSatellite = resolve;
      });

      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25, longitude: 90 },
        evidenceAvailability: { rainfall: true },
        evidenceFusion: {
          overallStatus: 'available',
          evidence: { rainfall: { rainfall24h: 55 } },
          limitations: []
        },
        retrievedAt: new Date().toISOString()
      });

      satelliteService.getLandCover.mockReturnValue(satellitePromise);

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      // Rainfall data is displayed
      expect(await screen.findByText(/55 mm/i)).toBeTruthy();

      // Satellite is still loading
      expect(screen.getByText(/Querying satellite observations/i)).toBeTruthy();

      // Resolve satellite query
      resolveSatellite({
        available: true,
        source: 'Sentinel-2 10m Land Cover',
        className: 'Cropland',
        category: 'cropland',
        contributionPoints: 2
      });

      expect(await screen.findByText('Cropland')).toBeTruthy();
      expect(screen.queryByText(/Querying satellite observations/i)).toBeNull();
    });

    it('handles satellite API rejection gracefully without crashing and displays unavailable state', async () => {
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 25, longitude: 90 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      satelliteService.getLandCover.mockRejectedValue(new Error('Network error or rate limit'));

      render(<AreaIntelligencePanel selectedLocation={mockLocation} />);

      expect(await screen.findByText('Satellite evidence unavailable')).toBeTruthy();
      expect(screen.queryByText(/Querying satellite observations/i)).toBeNull();
    });
  });
});

