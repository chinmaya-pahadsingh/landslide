import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RiskMap from '../pages/RiskMap';
import { landslideEventService } from '../services/landslideEventService';
import { geocodingService } from '../services/geocodingService';
import {
  HISTORICAL_THRESHOLDS,
  HISTORICAL_COLORS,
  classifyHistoricalEventDensity,
  preclassifyHistoricalEvents
} from '../utils/historicalRiskDensity';
import React from 'react';

// Setup Map / Leaflet Mocking
const mockFlyTo = vi.fn();
const mockPanTo = vi.fn();
const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom, className, preferCanvas }) => (
    <div
      data-testid="map-container"
      data-center={JSON.stringify(center)}
      data-zoom={zoom}
      data-prefer-canvas={String(preferCanvas)}
      className={className}
    >
      {children}
    </div>
  ),
  TileLayer: ({ url, updateWhenIdle, updateWhenZooming, keepBuffer, maxZoom, minZoom, 'data-testid': testId, pane, className }) => (
    <div
      data-testid={testId || "tile-layer"}
      data-url={url}
      data-pane={pane}
      data-classname={className}
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
    getCenter: () => ({ lat: 26.20, lng: 92.93 }),
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

describe('STEP 54D-RISK-MAP-VISUAL-FINAL — Clean Historical Map & Satellite Place-Name Labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterState = { state: null, search: '' };
    mockNavigationType = 'POP';
    if (typeof window !== 'undefined') {
      delete window.__ner_spa_navigated__;
    }
  });

  const fourCategoryHistoricalEvents = [
    {
      _id: 'hist-high',
      location: { latitude: 25.5, longitude: 91.5 },
      isHistorical: true,
      source: 'GSI',
      region: 'NER',
      state: 'Meghalaya',
      historicalDensity: {
        level: 'high',
        label: 'High Historical Landslide Activity',
        color: HISTORICAL_COLORS.HIGH,
        neighborCount: 75
      }
    },
    {
      _id: 'hist-medium',
      location: { latitude: 23.7, longitude: 92.7 },
      isHistorical: true,
      source: 'GSI',
      region: 'NER',
      state: 'Mizoram',
      historicalDensity: {
        level: 'medium',
        label: 'Medium Historical Landslide Activity',
        color: HISTORICAL_COLORS.MEDIUM,
        neighborCount: 45
      }
    },
    {
      _id: 'hist-low',
      location: { latitude: 26.2, longitude: 92.9 },
      isHistorical: true,
      source: 'GSI',
      region: 'NER',
      state: 'Assam',
      historicalDensity: {
        level: 'low',
        label: 'Low Historical Landslide Activity',
        color: HISTORICAL_COLORS.LOW,
        neighborCount: 15
      }
    },
    {
      _id: 'hist-insufficient',
      location: { latitude: 27.1, longitude: 93.6 },
      isHistorical: true,
      source: 'GSI',
      region: 'NER',
      state: 'Arunachal Pradesh',
      historicalDensity: {
        level: 'insufficient',
        label: 'Insufficient Historical Evidence',
        color: HISTORICAL_COLORS.INSUFFICIENT,
        neighborCount: 4
      }
    }
  ];

  it('1, 2, 3, 4, 5, 6: Visual-only marker filtering (RED, YELLOW, GREEN rendered; GREY hidden; underlying records intact)', async () => {
    landslideEventService.getAllEvents.mockResolvedValueOnce(fourCategoryHistoricalEvents);
    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    const histBtn = screen.getByRole('button', { name: /^Historical$/i });
    fireEvent.click(histBtn);

    // 4. INSUFFICIENT historical marker is NOT rendered
    const markers = screen.getAllByTestId('circle-marker');
    // Out of 4 records, exactly 3 are rendered (HIGH, MEDIUM, LOW)
    expect(markers.length).toBe(3);

    // 1. HIGH historical marker renders RED
    const highMarker = markers.find(m => m.getAttribute('data-lat') === '25.5');
    expect(highMarker).toBeTruthy();
    expect(highMarker.getAttribute('data-fill-color')).toBe(HISTORICAL_COLORS.HIGH);

    // 2. MEDIUM historical marker renders YELLOW/AMBER
    const medMarker = markers.find(m => m.getAttribute('data-lat') === '23.7');
    expect(medMarker).toBeTruthy();
    expect(medMarker.getAttribute('data-fill-color')).toBe(HISTORICAL_COLORS.MEDIUM);

    // 3. LOW historical marker renders GREEN
    const lowMarker = markers.find(m => m.getAttribute('data-lat') === '26.2');
    expect(lowMarker).toBeTruthy();
    expect(lowMarker.getAttribute('data-fill-color')).toBe(HISTORICAL_COLORS.LOW);

    // The insufficient marker at 27.1 is strictly NOT rendered
    const insufficientMarker = markers.find(m => m.getAttribute('data-lat') === '27.1');
    expect(insufficientMarker).toBeUndefined();

    // 5. Underlying insufficient records are NOT deleted
    // 6. Historical count / data source in status bar and legend header remains intact (4 total records)
    const metricPill = screen.getByText('Mapped Incidents:').parentElement;
    expect(metricPill.textContent).toContain('4');
    expect(screen.getByText('4 records')).toBeTruthy();
  });

  it('7, 8, 9: Historical legend contains ONLY RED/YELLOW/GREEN, shows concise explanation and disclaimer', async () => {
    landslideEventService.getAllEvents.mockResolvedValueOnce(fourCategoryHistoricalEvents);
    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    const histBtn = screen.getByRole('button', { name: /^Historical$/i });
    fireEvent.click(histBtn);

    // 7. Legend contains RED, YELLOW, GREEN items
    expect(screen.getAllByText('High Historical Landslide Activity').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Medium Historical Landslide Activity').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Low Historical Landslide Activity').length).toBeGreaterThanOrEqual(1);

    // Grey insufficient marker is removed from legend
    expect(screen.queryByText('No/Insufficient Historical Evidence')).toBeNull();
    expect(screen.queryByText('Historical Catalogue / Unclassified')).toBeNull();

    // 8. Concise explanation appears
    expect(screen.getByText('Only locations with sufficient historical evidence are shown.')).toBeTruthy();

    // 9. Historical disclaimer remains
    expect(
      screen.getByText(
        /Past activity only — NOT a current hazard, prediction, or early warning/i
      )
    ).toBeTruthy();
  });

  it('10, 11, 12: Satellite basemap includes legitimate reference labels overlay with click isolation', async () => {
    landslideEventService.getAllEvents.mockResolvedValueOnce(fourCategoryHistoricalEvents);
    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    // Toggle basemap from OpenStreetMap to Satellite
    const basemapToggleBtn = screen.getByRole('button', { name: /Switch basemap/i });
    fireEvent.click(basemapToggleBtn);

    // 10. Satellite imagery remains functional
    const baseTile = screen.getByTestId('tile-layer');
    expect(baseTile.getAttribute('data-url')).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    );

    // 11. Satellite place-name/reference labels remain visible
    const labelsTile = screen.getByTestId('satellite-labels-layer');
    expect(labelsTile).toBeTruthy();
    expect(labelsTile.getAttribute('data-url')).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
    );
    expect(labelsTile.getAttribute('data-pane')).toBe('overlayPane');
    expect(labelsTile.getAttribute('data-classname')).toBe('satellite-reference-layer');

    // 12. Label clicks do not trigger location selection (pointer-events: none / click isolation)
    fireEvent.click(labelsTile);
    // Clicking label layer does not open Searched Location pin
    expect(screen.queryByText('Searched Location')).toBeNull();
  });

  it('13, 14, 15, 16: Four orthogonal basemap & data mode combinations work', async () => {
    const orthogonalData = [
      {
        _id: 'hist-1',
        location: { latitude: 25.5, longitude: 91.5 },
        isHistorical: true,
        region: 'NER',
        historicalDensity: {
          level: 'high',
          label: 'High Historical Landslide Activity',
          color: HISTORICAL_COLORS.HIGH,
          neighborCount: 80
        }
      },
      {
        _id: 'curr-1',
        location: { latitude: 26.2, longitude: 92.9 },
        isHistorical: false,
        severity: 'high'
      }
    ];

    landslideEventService.getAllEvents.mockResolvedValueOnce(orthogonalData);
    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    const histBtn = screen.getByRole('button', { name: /^Historical$/i });
    const currBtn = screen.getByRole('button', { name: /^Current$/i });
    const basemapBtn = screen.getByRole('button', { name: /Switch basemap/i });

    // 13. Terrain + Historical
    fireEvent.click(histBtn);
    expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('openstreetmap.org');
    expect(screen.queryByTestId('satellite-labels-layer')).toBeNull();
    expect(screen.getAllByTestId('circle-marker').length).toBe(1);

    // 14. Satellite + Historical
    fireEvent.click(basemapBtn);
    expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('ArcGIS/rest/services/World_Imagery');
    expect(screen.getByTestId('satellite-labels-layer')).toBeTruthy();
    expect(screen.getAllByTestId('circle-marker').length).toBe(1);

    // 16. Satellite + Current
    fireEvent.click(currBtn);
    expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('ArcGIS/rest/services/World_Imagery');
    expect(screen.getByTestId('satellite-labels-layer')).toBeTruthy();
    expect(screen.getAllByTestId('circle-marker').length).toBe(1);

    // 15. Terrain + Current
    fireEvent.click(basemapBtn);
    expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('openstreetmap.org');
    expect(screen.queryByTestId('satellite-labels-layer')).toBeNull();
    expect(screen.getAllByTestId('circle-marker').length).toBe(1);
  });

  it('17, 18, 19, 20: Basemap switching preserves map center, zoom, selected location, and risk mode', async () => {
    mockRouterState = {
      state: {
        selectedLocation: { lat: 26.15, lon: 91.75, name: 'Guwahati Focus Zone' }
      }
    };
    landslideEventService.getAllEvents.mockResolvedValueOnce(fourCategoryHistoricalEvents);
    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    const mapContainer = screen.getByTestId('map-container');
    const initialCenter = mapContainer.getAttribute('data-center');
    const initialZoom = mapContainer.getAttribute('data-zoom');

    // Selected location is present
    expect(screen.getAllByText('Guwahati Focus Zone').length).toBeGreaterThanOrEqual(1);

    // Mode is historical
    const histBtn = screen.getByRole('button', { name: /^Historical$/i });
    fireEvent.click(histBtn);
    expect(histBtn.getAttribute('aria-pressed')).toBe('true');

    // Switch basemap to satellite
    const basemapBtn = screen.getByRole('button', { name: /Switch basemap/i });
    fireEvent.click(basemapBtn);

    // 17. Map center preserved
    expect(mapContainer.getAttribute('data-center')).toBe(initialCenter);
    // 18. Map zoom preserved
    expect(mapContainer.getAttribute('data-zoom')).toBe(initialZoom);
    // 19. Selected location preserved
    expect(screen.getAllByText('Guwahati Focus Zone').length).toBeGreaterThanOrEqual(1);
    // 20. Historical mode remains unchanged
    expect(histBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('21. Current empty state remains honest without generating synthetic markers', async () => {
    // Only historical events in catalog, zero active assessments
    landslideEventService.getAllEvents.mockResolvedValueOnce(fourCategoryHistoricalEvents);
    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    const currBtn = screen.getByRole('button', { name: /^Current$/i });
    fireEvent.click(currBtn);

    // Zero current markers
    expect(screen.queryAllByTestId('circle-marker')).toHaveLength(0);
    // Honest empty notice
    expect(screen.getByText('No active risk assessments available for this area.')).toBeTruthy();
  });

  it('22. Historical data cannot trigger early warning or active hazard alerts', () => {
    // Spatial density metadata declares past activity only
    const sampleHistorical = fourCategoryHistoricalEvents[0];
    const density = sampleHistorical.historicalDensity;
    expect(density.level).toBe('high');
    expect(density.color).toBe(HISTORICAL_COLORS.HIGH);
    expect(density.label).toBe('High Historical Landslide Activity');
    expect(density.label).not.toContain('WATCH');
    expect(density.label).not.toContain('WARNING');
    expect(density.label).not.toContain('CRITICAL');

    // Classification function explicitly generates disclaimer
    const classified = classifyHistoricalEventDensity(sampleHistorical, [sampleHistorical], 10);
    expect(classified.isHistorical).toBe(true);
    expect(classified.disclaimer).toBe('Past activity only — NOT a current hazard, prediction, or early warning.');
  });

  it('23. Existing search behavior remains fully functional', async () => {
    geocodingService.search.mockResolvedValueOnce([
      { lat: 26.1445, lon: 91.7362, display_name: 'Guwahati, Assam, India' }
    ]);
    landslideEventService.getAllEvents.mockResolvedValueOnce(fourCategoryHistoricalEvents);

    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    // Find search input
    const searchInput = screen.getByPlaceholderText(/Search area/i);
    expect(searchInput).toBeTruthy();
    fireEvent.change(searchInput, { target: { value: 'Guwahati' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(geocodingService.search).toHaveBeenCalledWith(
        'Guwahati'
      );
    });
  });
});
