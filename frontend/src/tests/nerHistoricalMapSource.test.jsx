import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RiskMap from '../pages/RiskMap';
import { landslideEventService } from '../services/landslideEventService';
import {
  calculateDistanceKm,
  classifyHistoricalEventDensity,
  preclassifyHistoricalEvents,
  HISTORICAL_THRESHOLDS,
  HISTORICAL_COLORS,
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

describe('STEP 54D-NER-HISTORICAL — Frontend Risk Map Historical Source Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterState = { state: null, search: '' };
    mockNavigationType = 'POP';
    if (typeof window !== 'undefined') {
      delete window.__ner_spa_navigated__;
    }
  });

  it('1 & 2: Requests { region: "NER" } and renders real NER records with valid coordinates', async () => {
    const realNerRecords = [
      {
        _id: 'gsi-ner-1001',
        location: { latitude: 25.5788, longitude: 91.8933 },
        isHistorical: true,
        source: 'GSI',
        state: 'Meghalaya',
        district: 'East Khasi Hills',
        region: 'NER',
        eventType: 'debris_flow',
        eventDate: '2021-06-18T00:00:00.000Z',
        description: 'Field-validated GSI NLSM landslide record',
        historicalDensity: {
          level: 'low',
          label: 'Low Historical Landslide Activity',
          color: HISTORICAL_COLORS.LOW,
          neighborCount: 15
        }
      },
      {
        _id: 'gsi-ner-1002',
        location: { latitude: 23.7271, longitude: 92.7176 },
        isHistorical: true,
        source: 'GSI',
        state: 'Mizoram',
        district: 'Aizawl',
        region: 'NER',
        eventType: 'rock_slide',
        eventDate: '2020-08-11T00:00:00.000Z',
        description: 'Field-validated GSI NLSM landslide record',
        historicalDensity: {
          level: 'low',
          label: 'Low Historical Landslide Activity',
          color: HISTORICAL_COLORS.LOW,
          neighborCount: 15
        }
      }
    ];

    landslideEventService.getAllEvents.mockResolvedValueOnce(realNerRecords);

    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    // 1. Verify getAllEvents was called with { region: 'NER' }
    expect(landslideEventService.getAllEvents).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'NER' })
    );

    // 2. Verify markers render with real coordinates
    const markers = screen.getAllByTestId('circle-marker');
    expect(markers.length).toBe(2);
    expect(markers[0].getAttribute('data-lat')).toBe('25.5788');
    expect(markers[0].getAttribute('data-lon')).toBe('91.8933');
    expect(markers[1].getAttribute('data-lat')).toBe('23.7271');
    expect(markers[1].getAttribute('data-lon')).toBe('92.7176');

    // Canvas acceleration is enabled on MapContainer
    const mapContainer = screen.getByTestId('map-container');
    expect(mapContainer.getAttribute('data-prefer-canvas')).toBe('true');
  });

  it('3: Validates coverage across all 8 Northeast Region states', async () => {
    const statesData = [
      { state: 'Assam', lat: 26.20, lon: 92.93 },
      { state: 'Arunachal Pradesh', lat: 27.10, lon: 93.60 },
      { state: 'Manipur', lat: 24.81, lon: 93.94 },
      { state: 'Meghalaya', lat: 25.57, lon: 91.89 },
      { state: 'Mizoram', lat: 23.73, lon: 92.71 },
      { state: 'Nagaland', lat: 25.67, lon: 94.11 },
      { state: 'Sikkim', lat: 27.33, lon: 88.61 },
      { state: 'Tripura', lat: 23.83, lon: 91.28 }
    ];

    const records = statesData.map((item, idx) => ({
      _id: `gsi-ner-${idx}`,
      location: { latitude: item.lat, longitude: item.lon },
      isHistorical: true,
      source: 'GSI',
      state: item.state,
      region: 'NER',
      eventType: 'Landslide',
      eventDate: '2020-01-01T00:00:00.000Z',
      historicalDensity: {
        level: 'low',
        label: 'Low Historical Landslide Activity',
        color: HISTORICAL_COLORS.LOW,
        neighborCount: 15
      }
    }));

    landslideEventService.getAllEvents.mockResolvedValueOnce(records);

    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    const markers = screen.getAllByTestId('circle-marker');
    expect(markers.length).toBe(8);

    // Verify all 8 state names appear in popups
    statesData.forEach(item => {
      expect(screen.getByText(item.state)).toBeTruthy();
    });
  });

  it('4: Strictly excludes NASA / Himachal records from NER Historical markers', async () => {
    const mixedRecords = [
      {
        _id: 'nasa-himachal-1',
        location: { latitude: 31.1048, longitude: 77.1734 },
        isHistorical: true,
        source: 'NASA',
        region: 'HIMACHAL',
        state: 'Himachal Pradesh'
      },
      {
        _id: 'gsi-ner-1',
        location: { latitude: 25.5788, longitude: 91.8933 },
        isHistorical: true,
        source: 'GSI',
        region: 'NER',
        state: 'Meghalaya',
        historicalDensity: {
          level: 'low',
          label: 'Low Historical Landslide Activity',
          color: HISTORICAL_COLORS.LOW,
          neighborCount: 15
        }
      }
    ];

    landslideEventService.getAllEvents.mockResolvedValueOnce(mixedRecords);

    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    // Only the GSI NER record is rendered; the NASA Himachal record is strictly filtered out
    const markers = screen.getAllByTestId('circle-marker');
    expect(markers.length).toBe(1);
    expect(markers[0].getAttribute('data-lat')).toBe('25.5788');
    expect(markers[0].getAttribute('data-lon')).toBe('91.8933');
    expect(screen.queryByText(/Himachal Pradesh/i)).toBeNull();
  });

  it('5: Historical markers display GSI NLSM provenance, past activity tag, and disclaimer', async () => {
    const gsiRecord = [
      {
        _id: 'gsi-101',
        location: { latitude: 25.5788, longitude: 91.8933 },
        isHistorical: true,
        source: 'GSI',
        state: 'Meghalaya',
        district: 'East Khasi Hills',
        eventType: 'debris_flow',
        eventDate: '2021-06-18T00:00:00.000Z',
        historicalDensity: {
          level: 'low',
          label: 'Low Historical Landslide Activity',
          color: HISTORICAL_COLORS.LOW,
          neighborCount: 15
        }
      }
    ];

    landslideEventService.getAllEvents.mockResolvedValueOnce(gsiRecord);

    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    // Provenance tag
    expect(screen.getByText('GSI NLSM NER Landslide Inventory (Historical Evidence)')).toBeTruthy();

    // Past activity disclaimer
    expect(
      screen.getByText(
        /Reflects past documented activity only — NOT a current hazard, prediction, or early warning/i
      )
    ).toBeTruthy();

    // Legend disclaimer
    expect(
      screen.getByText(
        /Past activity only — NOT a current hazard, prediction, or early warning. Historical catalogue records provide contextual evidence and are not active hazards/i
      )
    ).toBeTruthy();
  });

  it('6: Historical ↔ Current mode separation remains completely intact', async () => {
    const dataset = [
      {
        _id: 'gsi-hist-1',
        location: { latitude: 25.5, longitude: 91.5 },
        isHistorical: true,
        source: 'GSI',
        state: 'Meghalaya',
        historicalDensity: {
          level: 'low',
          label: 'Low Historical Landslide Activity',
          color: HISTORICAL_COLORS.LOW,
          neighborCount: 15
        }
      },
      {
        _id: 'live-incident-1',
        location: { latitude: 26.1, longitude: 91.7 },
        isHistorical: false,
        severity: 'critical',
        eventType: 'active_rockfall'
      }
    ];

    landslideEventService.getAllEvents.mockResolvedValueOnce(dataset);

    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    // Toggle between modes
    const histBtn = screen.getByRole('button', { name: /^Historical$/i });
    const currBtn = screen.getByRole('button', { name: /^Current$/i });

    // Historical mode: shows 1 historical marker
    fireEvent.click(histBtn);
    expect(screen.getByText('Past landslide activity')).toBeTruthy();
    let markers = screen.getAllByTestId('circle-marker');
    expect(markers.length).toBe(1);
    expect(markers[0].getAttribute('data-lat')).toBe('25.5');

    // Switch to Current mode: shows 1 active assessment marker
    fireEvent.click(currBtn);
    expect(screen.getAllByText('Current AI risk assessment').length).toBeGreaterThanOrEqual(1);
    markers = screen.getAllByTestId('circle-marker');
    expect(markers.length).toBe(1);
    expect(markers[0].getAttribute('data-lat')).toBe('26.1');
  });

  it('7: Preserves Terrain/Street ↔ Satellite basemap toggle in Historical mode', async () => {
    const gsiRecord = [
      {
        _id: 'gsi-101',
        location: { latitude: 25.5788, longitude: 91.8933 },
        isHistorical: true,
        source: 'GSI',
        state: 'Meghalaya',
        historicalDensity: {
          level: 'low',
          label: 'Low Historical Landslide Activity',
          color: HISTORICAL_COLORS.LOW,
          neighborCount: 15
        }
      }
    ];

    landslideEventService.getAllEvents.mockResolvedValueOnce(gsiRecord);

    render(<RiskMap />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
    });

    const tileLayer = screen.getByTestId('tile-layer');
    expect(tileLayer.getAttribute('data-url')).toContain('openstreetmap.org');

    // Toggle basemap to satellite
    const layerBtn = screen.getByRole('button', { name: /Switch basemap/i });
    fireEvent.click(layerBtn);

    const satLayer = screen.getByTestId('tile-layer');
    expect(satLayer.getAttribute('data-url')).toContain('ArcGIS/rest/services/World_Imagery');

    // Historical marker is still rendered
    const markers = screen.getAllByTestId('circle-marker');
    expect(markers.length).toBe(1);
  });

  it('8: High-density spatial grid classification runs under 100ms for large dataset', () => {
    // Generate 1000 pseudo historical points
    const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
      _id: `gsi-${i}`,
      location: {
        latitude: 23.5 + (i % 50) * 0.05,
        longitude: 91.0 + Math.floor(i / 50) * 0.05
      },
      isHistorical: true
    }));

    const start = performance.now();
    const classified = preclassifyHistoricalEvents(largeDataset);
    const duration = performance.now() - start;

    expect(classified.length).toBe(1000);
    expect(duration).toBeLessThan(100);
    // Data-driven audited thresholds (Step 54D-NER-DENSITY-FINAL)
    expect(HISTORICAL_THRESHOLDS.HIGH_MIN_NEIGHBORS).toBe(65);
    expect(HISTORICAL_THRESHOLDS.MEDIUM_MIN_NEIGHBORS).toBe(30);
    expect(HISTORICAL_THRESHOLDS.LOW_MIN_NEIGHBORS).toBe(10);
  });
});
