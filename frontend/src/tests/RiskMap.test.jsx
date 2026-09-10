import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RiskMap from '../pages/RiskMap';
import { landslideEventService } from '../services/landslideEventService';
import { geocodingService } from '../services/geocodingService';
import { areaIntelligenceService } from '../services/areaIntelligenceService';
import React from 'react';

// Setup Map / Leaflet Mocking
const mockFlyTo = vi.fn();
const mockPanTo = vi.fn();
const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();

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
  TileLayer: ({ url, updateWhenIdle, updateWhenZooming, keepBuffer, maxZoom, minZoom, 'data-testid': testId }) => (
    <div
      data-testid={testId || "tile-layer"}
      data-url={url}
      data-update-when-idle={String(updateWhenIdle)}
      data-update-when-zooming={String(updateWhenZooming)}
      data-keep-buffer={keepBuffer}
      data-max-zoom={maxZoom}
      data-min-zoom={minZoom}
    />
  ),
  CircleMarker: ({ center, radius, pathOptions, children }) => (
    <div
      data-testid="circle-marker"
      data-lat={center[0]}
      data-lon={center[1]}
      data-radius={radius}
      data-fill-color={pathOptions?.fillColor}
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
    getCenter: vi.fn(),
    getZoom: () => 6,
  }),
  useMapEvents: (handlers) => handlers || {},
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

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'test_token',
    user: { name: 'Authority User', role: 'authority' },
    openAuthModal: vi.fn(),
  }),
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

describe('RiskMap Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterState = { state: null, search: '' };
    mockNavigationType = 'POP';
    if (typeof window !== 'undefined') {
      delete window.__ner_spa_navigated__;
    }
    localStorage.setItem('jwt_token', 'test_token');
  });

  // 1. Map Initialization
  describe('Map Initialization', () => {
    it('mounts successfully with Northeast India center [26.20, 92.93] and zoom 6', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);

      render(<RiskMap />);

      // Initial loading state
      expect(screen.getByText(/Loading geospatial risk data/i)).toBeTruthy();

      // Settle loading
      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Verify page headers and badges
      expect(screen.getByText(/Geospatial Hazard & Risk Map/i)).toBeTruthy();
      expect(screen.getByText(/Northeast India GIS Grid/i)).toBeTruthy();
      expect(screen.getByText(/Telemetry Live/i)).toBeTruthy();

      // Verify MapContainer props
      const mapContainer = screen.getByTestId('map-container');
      expect(mapContainer.getAttribute('data-center')).toBe(JSON.stringify([26.2, 92.93]));
      expect(mapContainer.getAttribute('data-zoom')).toBe('6');

      // Verify TileLayer uses verified OpenStreetMap Standard without API key requirements
      const tileLayer = screen.getByTestId('tile-layer');
      expect(tileLayer.getAttribute('data-url')).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      expect(tileLayer.getAttribute('data-url')).not.toContain('cartocdn.com');
      expect(tileLayer.getAttribute('data-url')).not.toContain('voyager');
      expect(tileLayer.getAttribute('data-update-when-idle')).toBe('false');
      expect(tileLayer.getAttribute('data-update-when-zooming')).toBe('true');
      expect(tileLayer.getAttribute('data-keep-buffer')).toBe('8');
      expect(tileLayer.getAttribute('data-max-zoom')).toBe('19');
      expect(tileLayer.getAttribute('data-min-zoom')).toBe('4');
    });
  });

  // 2. Landslide Event Rendering
  describe('Landslide Event Rendering', () => {
    it('renders real event CircleMarkers with matching severity colors and popup details', async () => {
      const mockEvents = [
        {
          _id: 'ev-1',
          location: { latitude: 25.5788, longitude: 91.8933 },
          severity: 'critical',
          eventType: 'debris_flow',
          source: 'sensor',
          eventDate: '2026-05-15T00:00:00.000Z',
          description: 'Major slope collapse blocking highway.'
        },
        {
          _id: 'ev-2',
          location: { latitude: 27.1234, longitude: 93.5678 },
          severity: 'low',
          eventType: 'rockfall',
          source: 'citizen',
          reportedAt: '2026-06-01T00:00:00.000Z',
          description: 'Minor gravel movement.'
        }
      ];

      landslideEventService.getAllEvents.mockResolvedValueOnce(mockEvents);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Mapped incidents metric count
      expect(screen.getByText('Mapped Incidents:')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();

      // Find markers
      const markers = screen.getAllByTestId('circle-marker');
      expect(markers).toHaveLength(2);

      // Verify critical event marker
      const critMarker = markers.find(m => m.getAttribute('data-lat') === '25.5788');
      expect(critMarker).toBeTruthy();
      expect(critMarker.getAttribute('data-lon')).toBe('91.8933');
      expect(critMarker.getAttribute('data-fill-color')).toBe('hsl(346, 87%, 43%)'); // critical red

      // Verify low event marker
      const lowMarker = markers.find(m => m.getAttribute('data-lat') === '27.1234');
      expect(lowMarker).toBeTruthy();
      expect(lowMarker.getAttribute('data-lon')).toBe('93.5678');
      expect(lowMarker.getAttribute('data-fill-color')).toBe('hsl(142, 71%, 45%)'); // low green

      // Verify popup content
      expect(screen.getByText('Major slope collapse blocking highway.')).toBeTruthy();
      expect(screen.getByText('debris flow')).toBeTruthy();
      expect(screen.getByText('sensor')).toBeTruthy();
      expect(screen.getByText(/25.5788°, 91.8933°/)).toBeTruthy();
      expect(screen.getByText('Minor gravel movement.')).toBeTruthy();
    });
  });

  // 3. Invalid Coordinate Safety
  describe('Invalid Coordinate Safety', () => {
    it('safely ignores invalid, NaN, Infinity, and out-of-bounds coordinates without crashing', async () => {
      const mixedEvents = [
        { _id: 'valid-1', location: { latitude: 26.1, longitude: 91.7 }, severity: 'high' },
        { _id: 'missing-coords', location: {}, severity: 'high' },
        { _id: 'missing-loc', severity: 'high' },
        { _id: 'nan-lat', location: { latitude: NaN, longitude: 91.7 }, severity: 'high' },
        { _id: 'infinity-lat', location: { latitude: Infinity, longitude: 91.7 }, severity: 'high' },
        { _id: 'neg-infinity-lon', location: { latitude: 26.1, longitude: -Infinity }, severity: 'high' },
        { _id: 'string-coords', location: { latitude: '26.1', longitude: '91.7' }, severity: 'high' },
        { _id: 'out-of-bounds-lat-high', location: { latitude: 95.0, longitude: 91.7 }, severity: 'high' },
        { _id: 'out-of-bounds-lat-low', location: { latitude: -95.0, longitude: 91.7 }, severity: 'high' },
        { _id: 'out-of-bounds-lon-high', location: { latitude: 26.1, longitude: 185.0 }, severity: 'high' },
        { _id: 'out-of-bounds-lon-low', location: { latitude: 26.1, longitude: -185.0 }, severity: 'high' }
      ];

      landslideEventService.getAllEvents.mockResolvedValueOnce(mixedEvents);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Component remains intact and rendered
      expect(screen.getByText(/Geospatial Hazard & Risk Map/i)).toBeTruthy();

      // Exactly 1 valid incident should be counted
      const markers = screen.getAllByTestId('circle-marker');
      expect(markers).toHaveLength(1);
      expect(markers[0].getAttribute('data-lat')).toBe('26.1');
      expect(markers[0].getAttribute('data-lon')).toBe('91.7');

      // Metric count reflects single valid record
      expect(screen.getByText('1')).toBeTruthy();
    });
  });

  // 4. Empty Event State
  describe('Empty Event State', () => {
    it('renders truthful empty notice and 0 count when no events exist in database', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Empty notice in legend HUD
      expect(screen.getByText(/No events currently recorded/i)).toBeTruthy();

      // Toolbar metric pill shows 0
      expect(screen.getByText('0')).toBeTruthy();

      // No circle markers
      expect(screen.queryByTestId('circle-marker')).toBeNull();
    });
  });

  // 5. AreaSearch Integration
  describe('AreaSearch Integration', () => {
    it('selects a searched location, moves the map, and renders the searched location pin', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);
      geocodingService.search.mockResolvedValueOnce([
        { id: 'geo-guwahati', name: 'Guwahati, Kamrup Metropolitan, Assam', lat: 26.1806, lon: 91.7539 }
      ]);
      areaIntelligenceService.getIntelligence.mockResolvedValueOnce({
        selectedLocation: { latitude: 26.1806, longitude: 91.7539 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Find search input
      const searchInput = screen.getByRole('textbox', { name: /Search for an area/i });
      fireEvent.change(searchInput, { target: { value: 'Guwahati' } });

      // Click Search button
      const searchBtn = screen.getByRole('button', { name: /Submit search/i });
      fireEvent.click(searchBtn);

      // Wait for dropdown result
      const searchResultItem = await screen.findByText('Guwahati, Kamrup Metropolitan, Assam');
      expect(searchResultItem).toBeTruthy();

      // Click the result item
      fireEvent.click(searchResultItem);

      // Verify Area Intelligence opened
      expect(await screen.findByText('Area Intelligence')).toBeTruthy();

      // Verify MapUpdater triggered map.flyTo
      expect(mockFlyTo).toHaveBeenCalledWith([26.1806, 91.7539], 12, expect.objectContaining({ animate: true }));

      // Verify searched location CircleMarker appears
      const markers = screen.getAllByTestId('circle-marker');
      const searchMarker = markers.find(m => m.getAttribute('data-lat') === '26.1806');
      expect(searchMarker).toBeTruthy();
      expect(searchMarker.getAttribute('data-lon')).toBe('91.7539');
      expect(searchMarker.getAttribute('data-fill-color')).toBe('hsl(217, 91%, 60%)'); // Distinct Blue

      // Verify searched location popup details
      expect(screen.getByText('Searched Location')).toBeTruthy();
      expect(screen.getByText(/26.1806°, 91.7539°/)).toBeTruthy();

      // Verify toolbar displays active location pill
      const activePill = screen.getByTitle(/Current focused coordinate/i);
      expect(activePill).toBeTruthy();
      expect(activePill.textContent).toContain('Guwahati, Kamrup Metropolitan, Assam');
    });
  });

  // 6. Area Intelligence Panel State
  describe('Area Intelligence Panel State', () => {
    it('opens Area Intelligence on location select, keeps pin when closed, and allows reopening from toolbar', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);
      geocodingService.search.mockResolvedValueOnce([
        { id: 'geo-shillong', name: 'Shillong, Meghalaya', lat: 25.5788, lon: 91.8933 }
      ]);
      areaIntelligenceService.getIntelligence.mockResolvedValueOnce({
        selectedLocation: { latitude: 25.5788, longitude: 91.8933 },
        evidenceAvailability: { rainfall: true, terrain: true },
        evidenceFusion: {
          overallStatus: 'available',
          evidence: {
            rainfall: { latestValue: 80, rainfall24h: 80 },
            terrain: { elevation: 1525, slope: 14.2 }
          }
        },
        nearbyInfrastructure: [],
        retrievedAt: new Date().toISOString()
      });

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Search & select Shillong
      const searchInput = screen.getByRole('textbox', { name: /Search for an area/i });
      fireEvent.change(searchInput, { target: { value: 'Shillong' } });
      fireEvent.click(screen.getByRole('button', { name: /Submit search/i }));

      const resultItem = await screen.findByText('Shillong, Meghalaya');
      fireEvent.click(resultItem);

      // Area Intelligence panel must open
      expect(await screen.findByText('Area Intelligence')).toBeTruthy();
      expect(await screen.findByText('80 mm')).toBeTruthy();

      // Searched pin must be rendered
      expect(screen.getByTestId('circle-marker').getAttribute('data-lat')).toBe('25.5788');

      // Close the Area Intelligence panel
      const closeBtn = screen.getByRole('button', { name: /Close panel/i });
      fireEvent.click(closeBtn);

      // Area Intelligence panel should be closed/hidden
      await waitFor(() => {
        expect(screen.queryByText('Area Intelligence')).toBeNull();
      });

      // CRITICAL: Searched-location pin must STILL be visible on the map
      const persistentMarker = screen.getByTestId('circle-marker');
      expect(persistentMarker).toBeTruthy();
      expect(persistentMarker.getAttribute('data-lat')).toBe('25.5788');
      expect(persistentMarker.getAttribute('data-lon')).toBe('91.8933');

      // Active location pill in toolbar must STILL be visible
      const activeLocationPill = screen.getByTitle(/Click to view Area Intelligence/i);
      expect(activeLocationPill).toBeTruthy();
      expect(activeLocationPill.textContent).toContain('Shillong, Meghalaya');

      // Reopen Area Intelligence from active location pill
      fireEvent.click(activeLocationPill);

      // Panel re-appears with Shillong intelligence
      expect(await screen.findByText('Area Intelligence')).toBeTruthy();
    });

    it('initializes focused location and opens Area Intelligence when navigating with router state context', async () => {
      mockRouterState = {
        state: {
          selectedLocation: {
            lat: 27.15,
            lon: 93.42,
            name: 'Active Mudflow Sector',
          },
        },
      };
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);
      areaIntelligenceService.getIntelligence.mockResolvedValueOnce({
        selectedLocation: { latitude: 27.15, longitude: 93.42 },
        evidenceAvailability: { rainfall: true, terrain: true },
        evidenceFusion: {
          overallStatus: 'available',
          evidence: {
            rainfall: { latestValue: 62, rainfall24h: 62 },
            terrain: { elevation: 1200, slope: 35 }
          }
        },
        nearbyInfrastructure: [],
        retrievedAt: new Date().toISOString()
      });

      render(<RiskMap />);

      // Searched/focused pin must be placed at [27.15, 93.42]
      await waitFor(() => {
        const marker = screen.getByTestId('circle-marker');
        expect(marker.getAttribute('data-lat')).toBe('27.15');
        expect(marker.getAttribute('data-lon')).toBe('93.42');
      });

      // Area Intelligence panel automatically opens for that context
      expect(await screen.findByText('Area Intelligence')).toBeTruthy();
      expect(await screen.findByText(/27\.1500, 93\.4200/)).toBeTruthy();
      expect(await screen.findByText('62 mm')).toBeTruthy();

      // Active location pill in toolbar displays location name
      const activePill = screen.getByTitle(/Current focused coordinate/i);
      expect(activePill.textContent).toContain('Active Mudflow Sector');
    });
  });

  // 7. Floating Controls & Smooth Navigation Interactions
  describe('Floating Controls & Smooth Navigation Interactions', () => {
    it('provides accessible Zoom In, Zoom Out, Recenter, and Layer buttons that invoke map controls without page refresh', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Zoom In button
      const zoomInBtn = screen.getByRole('button', { name: /Zoom in/i });
      expect(zoomInBtn).toBeTruthy();
      fireEvent.click(zoomInBtn);
      expect(mockZoomIn).toHaveBeenCalledTimes(1);

      // Zoom Out button
      const zoomOutBtn = screen.getByRole('button', { name: /Zoom out/i });
      expect(zoomOutBtn).toBeTruthy();
      fireEvent.click(zoomOutBtn);
      expect(mockZoomOut).toHaveBeenCalledTimes(1);

      // Recenter button
      const recenterBtn = screen.getByRole('button', { name: /Reset map view/i });
      expect(recenterBtn).toBeTruthy();
      fireEvent.click(recenterBtn);
      expect(mockFlyTo).toHaveBeenCalledWith([26.2, 92.93], 6, expect.objectContaining({ animate: true }));

      // Layer toggle button switches between OpenStreetMap Standard and Satellite Imagery
      const layerBtn = screen.getByRole('button', { name: /Toggle map layer/i });
      expect(layerBtn).toBeTruthy();
      fireEvent.click(layerBtn);
      expect(screen.getByText('Satellite Imagery (Esri World Imagery)')).toBeTruthy();
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).not.toContain('cartocdn.com');

      // Clicking again toggles back to OpenStreetMap Standard
      fireEvent.click(layerBtn);
      expect(screen.getByText('OpenStreetMap Standard')).toBeTruthy();
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');

      // Ensure MapContainer was NOT remounted or duplicated
      expect(screen.getAllByTestId('map-container')).toHaveLength(1);
    });

    it('distinguishes historical catalogue events from active incidents in marker popups and legend', async () => {
      const mockHistoricalEvents = [
        {
          _id: 'hist-1',
          location: { latitude: 31.1, longitude: 77.1 },
          severity: 'unknown',
          isHistorical: true,
          eventType: 'Landslide',
          source: 'historical_dataset',
          eventDate: '2023-07-09T00:00:00.000Z',
          description: 'NASA inventory event.',
          historicalDensity: {
            level: 'low',
            label: 'Low Historical Landslide Activity',
            color: 'hsl(142, 71%, 45%)',
            neighborCount: 15
          }
        }
      ];

      landslideEventService.getAllEvents.mockResolvedValueOnce(mockHistoricalEvents);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Marker popup labels it as historical
      expect(screen.getByText('Historical Landslide Event')).toBeTruthy();
      expect(screen.getByText(/NASA Global Landslide Catalog/i)).toBeTruthy();

      // Legend distinguishes historical catalogue and shows sufficient evidence explanation
      expect(screen.getByText(/Only locations with sufficient historical evidence are shown/i)).toBeTruthy();
      expect(screen.getByText(/Past activity only — NOT a current hazard, prediction, or early warning/i)).toBeTruthy();
    });

    it('active location pill in toolbar has accessible keyboard interaction', async () => {
      mockRouterState = {
        state: {
          selectedLocation: {
            lat: 26.15,
            lon: 91.75,
            name: 'Guwahati Focus Zone',
          },
        },
      };
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);
      areaIntelligenceService.getIntelligence.mockResolvedValueOnce({
        selectedLocation: { latitude: 26.15, longitude: 91.75 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Close the panel
      const closeBtn = await screen.findByRole('button', { name: /Close panel/i });
      fireEvent.click(closeBtn);

      await waitFor(() => {
        expect(screen.queryByText('Area Intelligence')).toBeNull();
      });

      // Reopen using Enter key on active location pill
      const activePill = screen.getByRole('button', { name: /Guwahati Focus Zone/i });
      expect(activePill).toBeTruthy();
      fireEvent.keyDown(activePill, { key: 'Enter', code: 'Enter' });

      expect(await screen.findByText('Area Intelligence')).toBeTruthy();
    });
  });

  // 6. Selected-Location Persistence & Fresh Map Behavior
  describe('Selected-Location Persistence & Fresh Map Behavior', () => {
    it('fresh /map has no selected location, closes Area Intelligence, and makes no intelligence API request', async () => {
      mockRouterState = { state: null, search: '' };
      mockNavigationType = 'POP';
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // No selected location indicator or popup
      expect(screen.queryByText('Searched Location')).toBeNull();
      // Area Intelligence is CLOSED
      expect(screen.queryByText('Area Intelligence')).toBeNull();
      // No area-intelligence API call was made
      expect(areaIntelligenceService.getIntelligence).not.toHaveBeenCalled();
      // Map container centered on default NER center
      const mapContainer = screen.getByTestId('map-container');
      expect(mapContainer.getAttribute('data-center')).toBe(JSON.stringify([26.2, 92.93]));
      expect(mapContainer.getAttribute('data-zoom')).toBe('6');
    });

    it('browser refresh (reload) ignores stale router state and stays on clean default NER map', async () => {
      // Simulate reload navigation
      const originalGetEntries = window.performance.getEntriesByType;
      window.performance.getEntriesByType = vi.fn().mockImplementation((type) => {
        if (type === 'navigation') {
          return [{ type: 'reload' }];
        }
        return [];
      });

      mockNavigationType = 'POP';
      // Stale coordinates (such as 21.4974, 103.4355) lingering in history state
      mockRouterState = {
        state: {
          selectedLocation: {
            lat: 21.4974,
            lon: 103.4355,
            name: 'Location (21.4974°, 103.4355°)'
          }
        },
        search: ''
      };

      landslideEventService.getAllEvents.mockResolvedValueOnce([]);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Area Intelligence MUST NOT be opened for stale coordinates
      expect(screen.queryByText('Area Intelligence')).toBeNull();
      // No intelligence request made
      expect(areaIntelligenceService.getIntelligence).not.toHaveBeenCalled();
      // Stale location marker is NOT rendered
      expect(screen.queryByText('Searched Location')).toBeNull();

      // Restore performance.getEntriesByType
      window.performance.getEntriesByType = originalGetEntries;
    });

    it('Dashboard → Risk Map client-side navigation DOES restore selectedLocation, even if document had previously reloaded', async () => {
      // Simulate prior document reload before SPA navigation occurred
      const originalGetEntries = window.performance.getEntriesByType;
      window.performance.getEntriesByType = vi.fn().mockImplementation((type) => {
        if (type === 'navigation') {
          return [{ type: 'reload' }];
        }
        return [];
      });

      // Client-side router navigation transition from Dashboard
      mockNavigationType = 'PUSH';
      mockRouterState = {
        state: {
          selectedLocation: {
            lat: 27.15,
            lon: 93.42,
            name: 'Active Mudflow Sector'
          }
        },
        search: ''
      };

      landslideEventService.getAllEvents.mockResolvedValueOnce([]);
      areaIntelligenceService.getIntelligence.mockResolvedValueOnce({
        selectedLocation: { latitude: 27.15, longitude: 93.42 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // MUST restore legitimate client-side navigation despite previous reload
      expect(await screen.findByText('Area Intelligence')).toBeTruthy();
      expect(areaIntelligenceService.getIntelligence).toHaveBeenCalledWith(
        27.15,
        93.42,
        expect.any(AbortSignal)
      );

      // Marker placed at selected coordinates
      const marker = screen.getByTestId('circle-marker');
      expect(marker.getAttribute('data-lat')).toBe('27.15');
      expect(marker.getAttribute('data-lon')).toBe('93.42');

      window.performance.getEntriesByType = originalGetEntries;
    });

    it('preserves unrelated router history state fields when clearing selectedLocation', async () => {
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

      // History state with other feature/user properties
      window.history.replaceState({
        usr: {
          selectedLocation: { lat: 27.15, lon: 93.42, name: 'Active Sector' },
          customFilter: 'critical-only',
          activeViewTab: 'satellite'
        },
        key: 'test_key_123',
        idx: 2
      }, '');

      mockNavigationType = 'PUSH';
      mockRouterState = {
        state: {
          selectedLocation: {
            lat: 27.15,
            lon: 93.42,
            name: 'Active Sector'
          },
          customFilter: 'critical-only',
          activeViewTab: 'satellite'
        },
        search: ''
      };

      landslideEventService.getAllEvents.mockResolvedValueOnce([]);
      areaIntelligenceService.getIntelligence.mockResolvedValueOnce({
        selectedLocation: { latitude: 27.15, longitude: 93.42 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Replaces history state: selectedLocation is removed, but customFilter, activeViewTab, key, idx are preserved!
      expect(replaceStateSpy).toHaveBeenCalled();
      const lastCallArgs = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
      expect(lastCallArgs[0]).toEqual({
        usr: {
          customFilter: 'critical-only',
          activeViewTab: 'satellite'
        },
        key: 'test_key_123',
        idx: 2
      });

      replaceStateSpy.mockRestore();
    });

    it('restores location when explicitly encoded in URL query parameters (Case 6)', async () => {
      mockRouterState = {
        state: null,
        search: '?lat=26.1806&lon=91.7539&name=Guwahati'
      };

      landslideEventService.getAllEvents.mockResolvedValueOnce([]);
      areaIntelligenceService.getIntelligence.mockResolvedValueOnce({
        selectedLocation: { latitude: 26.1806, longitude: 91.7539 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Area Intelligence opens for URL-specified location
      expect(await screen.findByText('Area Intelligence')).toBeTruthy();
      expect(areaIntelligenceService.getIntelligence).toHaveBeenCalledWith(
        26.1806,
        91.7539,
        expect.any(AbortSignal)
      );

      // Marker exists at URL coordinates
      const marker = screen.getByTestId('circle-marker');
      expect(marker.getAttribute('data-lat')).toBe('26.1806');
      expect(marker.getAttribute('data-lon')).toBe('91.7539');
    });

    it('prevents duplicate flyTo calls on re-renders with the same target', async () => {
      mockNavigationType = 'PUSH';
      mockRouterState = {
        state: {
          selectedLocation: {
            lat: 27.15,
            lon: 93.42,
            name: 'Active Mudflow Sector'
          }
        },
        search: ''
      };

      landslideEventService.getAllEvents.mockResolvedValue([]);
      areaIntelligenceService.getIntelligence.mockResolvedValue({
        selectedLocation: { latitude: 27.15, longitude: 93.42 },
        evidenceAvailability: {},
        evidenceFusion: { overallStatus: 'available', limitations: [] },
        retrievedAt: new Date().toISOString()
      });

      const { rerender } = render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      const initialFlyToCalls = mockFlyTo.mock.calls.length;

      // Re-render RiskMap with identical props/state
      rerender(<RiskMap />);

      // Duplicate flyTo must NOT have been called
      expect(mockFlyTo.mock.calls.length).toBe(initialFlyToCalls);
    });
  });

  // 7. Basemap Provider Reliability & Zero API-Key Watermarks
  describe('Basemap Provider Reliability & Zero API-Key Watermarks', () => {
    it('uses OpenStreetMap Standard as the primary verified reliable basemap without API keys', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Active basemap indicator must display OpenStreetMap Standard
      expect(screen.getByText('OpenStreetMap Standard')).toBeTruthy();

      // TileLayer URL must point to standard openstreetmap.org and NEVER cartocdn.com
      const tileLayer = screen.getByTestId('tile-layer');
      expect(tileLayer.getAttribute('data-url')).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      expect(tileLayer.getAttribute('data-url')).not.toContain('cartocdn.com');
      expect(tileLayer.getAttribute('data-url')).not.toContain('voyager');

      // MapContainer must remain mounted once
      expect(screen.getAllByTestId('map-container')).toHaveLength(1);
    });

    it('does not expose or switch to broken CartoDB Voyager requiring unavailable API key', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Initial basemap is OpenStreetMap Standard
      expect(screen.getByText('OpenStreetMap Standard')).toBeTruthy();

      // Clicking layer control switches to verified Esri World Imagery, never CartoDB Voyager
      const layerBtn = screen.getByRole('button', { name: /Toggle map layer/i });
      fireEvent.click(layerBtn);

      const tileLayer = screen.getByTestId('tile-layer');
      expect(tileLayer.getAttribute('data-url')).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
      expect(tileLayer.getAttribute('data-url')).not.toContain('cartocdn.com');
      expect(tileLayer.getAttribute('data-url')).not.toContain('voyager');
      expect(screen.queryByText('Topographic / Natural GIS')).toBeNull();
      expect(screen.getByText('Satellite Imagery (Esri World Imagery)')).toBeTruthy();

      // Toggling again returns to OpenStreetMap Standard
      fireEvent.click(layerBtn);
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      expect(screen.getByText('OpenStreetMap Standard')).toBeTruthy();
    });

    it('retains all GIS markers, overlays, and controls when switching to satellite basemap', async () => {
      const mockEvents = [
        {
          _id: 'ev-sat-1',
          location: { latitude: 25.5, longitude: 91.8 },
          severity: 'high',
          eventType: 'Landslide',
          date: '2025-06-15T00:00:00.000Z',
          riskLevel: 'high'
        }
      ];
      landslideEventService.getAllEvents.mockResolvedValueOnce(mockEvents);

      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Markers are rendered
      expect(screen.getAllByTestId('circle-marker')).toHaveLength(1);

      // Switch to Satellite basemap
      const layerBtn = screen.getByRole('button', { name: /Toggle map layer/i });
      fireEvent.click(layerBtn);

      // Tile layer updated to Esri World Imagery
      const tileLayer = screen.getByTestId('tile-layer');
      expect(tileLayer.getAttribute('data-url')).toContain('World_Imagery');
      expect(screen.getByText('Satellite Imagery (Esri World Imagery)')).toBeTruthy();

      // Overlays remain intact: circle markers and map container are still present
      expect(screen.getAllByTestId('circle-marker')).toHaveLength(1);
      expect(screen.getAllByTestId('map-container')).toHaveLength(1);

      // Switch back to OSM basemap
      fireEvent.click(layerBtn);
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('openstreetmap.org');
      expect(screen.getByText('OpenStreetMap Standard')).toBeTruthy();
      expect(screen.getAllByTestId('circle-marker')).toHaveLength(1);
    });
  });
});
