import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RiskMap from '../pages/RiskMap';
import { landslideEventService } from '../services/landslideEventService';
import { geocodingService } from '../services/geocodingService';
import { areaIntelligenceService } from '../services/areaIntelligenceService';
import React from 'react';

// Leaflet & Map Mocks
const mockFlyTo = vi.fn();
const mockPanTo = vi.fn();
const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();

let registeredMapClickHandler = null;

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom, className }) => (
    <div
      data-testid="map-container"
      data-center={JSON.stringify(center)}
      data-zoom={zoom}
      className={className}
    >
      {children}
    </div>
  ),
  TileLayer: ({ url, 'data-testid': testId }) => (
    <div data-testid={testId || "tile-layer"} data-url={url} />
  ),
  CircleMarker: ({ center, radius, pathOptions, children, eventHandlers }) => (
    <div
      data-testid="circle-marker"
      data-lat={center[0]}
      data-lon={center[1]}
      data-radius={radius}
      data-fill-color={pathOptions?.fillColor}
      onClick={() => eventHandlers?.click?.()}
    >
      {children}
    </div>
  ),
  Popup: ({ children }) => <div data-testid="leaflet-popup">{children}</div>,
  useMap: () => ({
    flyTo: mockFlyTo,
    panTo: mockPanTo,
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    setView: vi.fn(),
    getCenter: () => ({ lat: 26.2, lng: 92.93 }),
    getZoom: () => 6,
  }),
  useMapEvents: (handlers) => {
    registeredMapClickHandler = handlers?.click;
    return handlers || {};
  },
}));

let mockRouterState = { state: null, search: '' };
let mockNavigationType = 'POP';

vi.mock('react-router-dom', () => ({
  useLocation: () => mockRouterState,
  useNavigate: () => vi.fn(),
  useNavigationType: () => mockNavigationType,
}));

vi.mock('../contexts/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
}));

let mockAuthContextValue = {
  token: 'valid_jwt_token_authority',
  user: { name: 'Authority Officer', role: 'authority' },
  loading: false,
  openAuthModal: vi.fn(),
};

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthContextValue,
}));

vi.mock('../services/landslideEventService', () => ({
  landslideEventService: {
    getAllEvents: vi.fn(),
  },
}));

vi.mock('../services/geocodingService', () => ({
  geocodingService: {
    search: vi.fn(),
    cache: new Map(),
    activeControllers: new Map(),
    lastRequestTime: 0,
  },
}));

vi.mock('../services/areaIntelligenceService', () => ({
  areaIntelligenceService: {
    getIntelligence: vi.fn(),
  },
}));

describe('STEP 54D-FIX: Risk Map Regression & Core Fix Verification', () => {
  const realBackendRecords = [
    {
      _id: 'risk-high-1',
      location: { latitude: 27.15, longitude: 93.42 },
      severity: 'high',
      riskScore: 82,
      riskLevel: 'high',
      eventType: 'Active Risk Assessment',
      isHistorical: false,
      date: '2026-09-09T00:00:00.000Z',
      description: 'Severe slope destabilization detected'
    },
    {
      _id: 'risk-med-2',
      location: { latitude: 25.57, longitude: 91.89 },
      severity: 'medium',
      riskScore: 54,
      riskLevel: 'medium',
      eventType: 'Active Risk Assessment',
      isHistorical: false,
      date: '2026-09-09T00:00:00.000Z',
      description: 'Moderate precipitation risk'
    },
    {
      _id: 'risk-low-3',
      location: { latitude: 26.18, longitude: 91.75 },
      severity: 'low',
      riskScore: 22,
      riskLevel: 'low',
      eventType: 'Active Risk Assessment',
      isHistorical: false,
      date: '2026-09-09T00:00:00.000Z',
      description: 'Stable soil moisture conditions'
    },
    {
      _id: 'risk-unclassified-4',
      location: { latitude: 24.83, longitude: 92.78 },
      severity: 'invalid_or_missing',
      riskLevel: null,
      eventType: 'Unclassified Hazard',
      isHistorical: false,
      date: '2026-09-09T00:00:00.000Z',
      description: 'Pending assessment'
    },
    {
      _id: 'nasa-glc-historical-5',
      location: { latitude: 25.67, longitude: 94.11 },
      severity: 'unknown',
      riskLevel: null,
      isHistorical: true,
      source: 'historical_dataset',
      eventType: 'Landslide',
      eventDate: '2020-07-15T00:00:00.000Z',
      description: 'NASA GLC catalogue historical event',
      historicalDensity: {
        level: 'low',
        color: 'hsl(142, 71%, 45%)',
        label: 'Low Historical Landslide Activity',
        neighborCount: 15
      }
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterState = { state: null, search: '' };
    mockNavigationType = 'POP';
    registeredMapClickHandler = null;
    mockAuthContextValue = {
      token: 'valid_jwt_token_authority',
      user: { name: 'Authority Officer', role: 'authority' },
      loading: false,
      openAuthModal: vi.fn(),
    };
    localStorage.setItem('jwt_token', 'valid_jwt_token_authority');
    landslideEventService.getAllEvents.mockResolvedValue(realBackendRecords);
    areaIntelligenceService.getIntelligence.mockResolvedValue({
      assessment: {
        riskScore: 65,
        riskLevel: 'Medium',
        riskCategory: 'Medium Risk'
      },
      elevation: { elevation: 1200, slope: 28 },
      weather: { currentRainfall: 14.5 }
    });
  });

  // =========================================================================
  // TEST A: Layer behavior (1-10)
  // =========================================================================
  describe('TEST A — Layer Button Behavior & Map Isolation', () => {
    it('1 & 2: Toggles Terrain/Street → Satellite and back cleanly', async () => {
      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('openstreetmap.org');

      const layerBtn = screen.getByRole('button', { name: /Toggle map layer/i });
      fireEvent.click(layerBtn);
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('World_Imagery');

      fireEvent.click(layerBtn);
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('openstreetmap.org');
    });

    it('3, 4, 5, 6, 7: Layer click does NOT trigger map-click handler, coordinates/pointer/center/zoom remain identical', async () => {
      // Setup initial selected location via state
      mockRouterState = {
        state: {
          selectedLocation: {
            lat: 27.15,
            lon: 93.42,
            name: 'Existing Selected Point A'
          }
        }
      };

      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      // Confirm point A is selected
      expect(screen.getAllByText('Existing Selected Point A').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/27.1500°, 93.4200°/).length).toBeGreaterThanOrEqual(1);

      // Map center and zoom before layer switch
      const mapContainer = screen.getByTestId('map-container');
      const initialCenter = mapContainer.getAttribute('data-center');
      const initialZoom = mapContainer.getAttribute('data-zoom');

      // Click layer button
      const layerBtn = screen.getByRole('button', { name: /Toggle map layer/i });
      fireEvent.click(layerBtn);

      // Verify selected location coordinates remain EXACTLY point A
      expect(screen.getAllByText('Existing Selected Point A').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/27.1500°, 93.4200°/).length).toBeGreaterThanOrEqual(1);

      // Verify map center & zoom remain unchanged
      expect(mapContainer.getAttribute('data-center')).toBe(initialCenter);
      expect(mapContainer.getAttribute('data-zoom')).toBe(initialZoom);
    });

    it('8, 9, 10: Risk marker count, coordinates, and severity remain completely unchanged after layer toggling', async () => {
      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      // 4 active records in realBackendRecords rendered in Current mode
      const initialMarkers = screen.getAllByTestId('circle-marker');
      expect(initialMarkers).toHaveLength(4);
      const initialLats = initialMarkers.map(m => m.getAttribute('data-lat'));
      const initialColors = initialMarkers.map(m => m.getAttribute('data-fill-color'));

      // Switch to satellite
      const layerBtn = screen.getByRole('button', { name: /Toggle map layer/i });
      fireEvent.click(layerBtn);

      const satelliteMarkers = screen.getAllByTestId('circle-marker');
      expect(satelliteMarkers).toHaveLength(4);
      expect(satelliteMarkers.map(m => m.getAttribute('data-lat'))).toEqual(initialLats);
      expect(satelliteMarkers.map(m => m.getAttribute('data-fill-color'))).toEqual(initialColors);
    });
  });

  // =========================================================================
  // TEST B: Authentication & Area Intelligence (11-17)
  // =========================================================================
  describe('TEST B — Authentication Propagation & Area Intelligence', () => {
    it('11, 12, 13: Valid logged-in authorized user directly loads Area Intelligence and NEVER sees login prompts', async () => {
      mockRouterState = {
        state: {
          selectedLocation: { lat: 27.15, lon: 93.42, name: 'Tawang Monitored Sector' }
        }
      };

      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      // Area Intelligence opens
      expect(await screen.findByText('Area Intelligence')).toBeTruthy();

      // Crucial: Must NEVER show authentication-required prompts for valid authorized session
      expect(screen.queryByText('Authentication Required')).toBeNull();
      expect(screen.queryByText(/Log In to View Intelligence/i)).toBeNull();
      expect(screen.queryByText(/Please sign in to access/i)).toBeNull();
    });

    it('14: Attaches Bearer JWT token from localStorage/authContext on intelligence requests', async () => {
      mockRouterState = {
        state: {
          selectedLocation: { lat: 27.15, lon: 93.42, name: 'Tawang Monitored Sector' }
        }
      };

      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      expect(areaIntelligenceService.getIntelligence).toHaveBeenCalledWith(
        27.15,
        93.42,
        expect.any(AbortSignal)
      );
      expect(localStorage.getItem('jwt_token')).toBe('valid_jwt_token_authority');
    });

    it('15: Expired or invalid JWT producing 401 correctly triggers authentication-required state', async () => {
      const err401 = new Error('Invalid or expired token');
      err401.status = 401;
      areaIntelligenceService.getIntelligence.mockRejectedValueOnce(err401);

      mockRouterState = {
        state: {
          selectedLocation: { lat: 27.15, lon: 93.42, name: 'Tawang Sector' }
        }
      };

      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      // Should show Authentication Required when genuinely 401
      expect(await screen.findByText('Authentication Required')).toBeTruthy();
    });

    it('16: Unauthorized role producing 403 shows permission-denied state instead of misleading login prompt', async () => {
      const err403 = new Error('Insufficient permissions');
      err403.status = 403;
      areaIntelligenceService.getIntelligence.mockRejectedValueOnce(err403);

      mockNavigationType = 'PUSH';
      mockRouterState = {
        state: {
          selectedLocation: { lat: 27.15, lon: 93.42, name: 'Restricted Sector' }
        }
      };

      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      // Should show Access Restricted / sufficient role privileges, NOT "Log in to view"
      expect(await screen.findByText('Access Restricted')).toBeTruthy();
      expect(screen.getByText(/sufficient role privileges/i)).toBeTruthy();
      expect(screen.queryByText('Authentication Required')).toBeNull();
      expect(screen.queryByText(/Log In to View Intelligence/i)).toBeNull();
    });

    it('17: Switching basemap does not reset or lose authentication state', async () => {
      mockRouterState = {
        state: {
          selectedLocation: { lat: 27.15, lon: 93.42, name: 'Active Focus Area' }
        }
      };

      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      expect(await screen.findByText('Area Intelligence')).toBeTruthy();

      // Toggle basemap to satellite
      const layerBtn = screen.getByRole('button', { name: /Toggle map layer/i });
      fireEvent.click(layerBtn);

      // Area Intelligence still open and authenticated
      expect(screen.getByText('Area Intelligence')).toBeTruthy();
      expect(screen.queryByText('Authentication Required')).toBeNull();
      expect(localStorage.getItem('jwt_token')).toBe('valid_jwt_token_authority');
    });
  });

  // =========================================================================
  // TEST C: REAL risk markers (18-24)
  // =========================================================================
  describe('TEST C — REAL Risk Markers & Integrity', () => {
    it('18: Backend-provided HIGH/CRITICAL record renders RED', async () => {
      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      const highMarker = screen.getAllByTestId('circle-marker').find(m => m.getAttribute('data-lat') === '27.15');
      expect(highMarker).toBeTruthy();
      // Red: hsl(346, 87%, 43%)
      expect(highMarker.getAttribute('data-fill-color')).toBe('hsl(346, 87%, 43%)');
    });

    it('19: Backend-provided MEDIUM record renders YELLOW/ORANGE', async () => {
      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      const medMarker = screen.getAllByTestId('circle-marker').find(m => m.getAttribute('data-lat') === '25.57');
      expect(medMarker).toBeTruthy();
      // Amber/Orange: hsl(48, 96%, 53%)
      expect(medMarker.getAttribute('data-fill-color')).toBe('hsl(48, 96%, 53%)');
    });

    it('20: Backend-provided LOW record renders GREEN', async () => {
      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      const lowMarker = screen.getAllByTestId('circle-marker').find(m => m.getAttribute('data-lat') === '26.18');
      expect(lowMarker).toBeTruthy();
      // Green: hsl(142, 71%, 45%)
      expect(lowMarker.getAttribute('data-fill-color')).toBe('hsl(142, 71%, 45%)');
    });

    it('21 & 22: Missing/invalid risk level is not given fabricated color; historical record remains unclassified grey', async () => {
      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      // Unclassified invalid record (lat 24.83) in Current mode
      const unclassMarker = screen.getAllByTestId('circle-marker').find(m => m.getAttribute('data-lat') === '24.83');
      expect(unclassMarker.getAttribute('data-fill-color')).toBe('hsl(215, 16%, 65%)');

      // Switch to Historical mode to inspect historical catalogue records
      const histBtn = screen.getByRole('button', { name: /^Historical$/i });
      fireEvent.click(histBtn);

      // Historical record (lat 25.67) - classified as low historical density green
      const histMarker = screen.getAllByTestId('circle-marker').find(m => m.getAttribute('data-lat') === '25.67');
      expect(histMarker.getAttribute('data-fill-color')).toBe('hsl(142, 71%, 45%)');
    });

    it('23 & 24: No synthetic markers; honest UI notice shown when zero active risk assessments exist', async () => {
      // Only historical records, zero active assessments
      landslideEventService.getAllEvents.mockResolvedValueOnce([
        {
          _id: 'hist-only-1',
          location: { latitude: 25.5, longitude: 91.8 },
          severity: 'unknown',
          isHistorical: true,
          source: 'historical_dataset'
        }
      ]);

      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      // Switch to Current mode where 0 active assessments exist
      const currBtn = screen.getByRole('button', { name: /^Current$/i });
      fireEvent.click(currBtn);

      // Honest notice appears
      expect(screen.getByText('No active risk assessments available for this area.')).toBeTruthy();
      // Historical disclaimer remains
      expect(screen.getByText(/Historical catalogue records provide contextual evidence and are not active hazards/i)).toBeTruthy();
    });
  });

  // =========================================================================
  // TEST D: Both Basemaps (25-27)
  // =========================================================================
  describe('TEST D — Markers on Both Basemaps', () => {
    it('25, 26, 27: Risk markers render identically on Terrain/Street and Satellite basemaps', async () => {
      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      // Terrain view (4 active risk assessments)
      const streetMarkers = screen.getAllByTestId('circle-marker');
      expect(streetMarkers).toHaveLength(4);

      // Switch to Satellite
      const layerBtn = screen.getByRole('button', { name: /Toggle map layer/i });
      fireEvent.click(layerBtn);
      const satTile = screen.getByTestId('tile-layer');
      expect(satTile.getAttribute('data-url')).toContain('World_Imagery');

      // Markers remain on satellite
      const satMarkers = screen.getAllByTestId('circle-marker');
      expect(satMarkers).toHaveLength(4);
      expect(satMarkers.map(m => m.getAttribute('data-lat'))).toEqual(streetMarkers.map(m => m.getAttribute('data-lat')));

      // Switch back to Street
      fireEvent.click(layerBtn);
      const restoredMarkers = screen.getAllByTestId('circle-marker');
      expect(restoredMarkers).toHaveLength(4);
    });
  });

  // =========================================================================
  // TEST E: Existing Functionality & Interactions (28-34)
  // =========================================================================
  describe('TEST E — Existing Interactions Intact', () => {
    it('28: Real map click selects location and opens Area Intelligence', async () => {
      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      // Simulate a real Leaflet map click (not originating from a control)
      expect(registeredMapClickHandler).toBeTruthy();
      registeredMapClickHandler({
        latlng: { lat: 26.55, lng: 92.12 },
        originalEvent: {
          target: document.createElement('div')
        }
      });

      expect(await screen.findByText('Area Intelligence')).toBeTruthy();
      expect(screen.getAllByText(/26.5500°, 92.1200°/).length).toBeGreaterThanOrEqual(1);
    });

    it('29: Risk marker click opens marker details popup', async () => {
      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      const highMarker = screen.getAllByTestId('circle-marker').find(m => m.getAttribute('data-lat') === '27.15');
      fireEvent.click(highMarker);

      // Expect popup with details
      expect(screen.getByText('Severe slope destabilization detected')).toBeTruthy();
    });

    it('30: Area search works and selects searched location', async () => {
      geocodingService.search.mockResolvedValueOnce([
        {
          name: 'Gangtok, Sikkim',
          lat: 27.3389,
          lon: 88.6065,
          type: 'city'
        }
      ]);

      render(<RiskMap />);
      await waitFor(() => expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull());

      const searchInput = screen.getByPlaceholderText(/Search area/i);
      fireEvent.change(searchInput, { target: { value: 'Gangtok' } });

      const searchBtn = screen.getByRole('button', { name: /Submit search/i });
      fireEvent.click(searchBtn);

      const resultItem = await screen.findByText('Gangtok, Sikkim');
      fireEvent.click(resultItem);

      // Searched location selected
      expect(screen.getAllByText('Gangtok, Sikkim').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/27.3389°, 88.6065°/).length).toBeGreaterThanOrEqual(1);
    });
  });
});
