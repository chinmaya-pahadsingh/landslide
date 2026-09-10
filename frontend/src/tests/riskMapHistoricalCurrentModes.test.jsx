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
    getCenter: () => ({ lat: 26.2006, lng: 92.9376 }),
    getZoom: () => 7,
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

describe('Step 54D-FIX-2 — Historical ↔ Current Risk Map Separation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterState = { state: null, search: '' };
    mockNavigationType = 'POP';
    if (typeof window !== 'undefined') {
      delete window.__ner_spa_navigated__;
    }
  });

  // ==========================================
  // Section 1: Pure Density Unit Tests
  // ==========================================
  describe('Historical Activity Spatial Density Classification', () => {
    it('1 & 3: computes deterministic Haversine distance and classifications', () => {
      // 0 distance for identical coordinates
      expect(calculateDistanceKm(26.0, 91.0, 26.0, 91.0)).toBe(0);
      // Guwahati to Shillong (~68 km)
      const dist = calculateDistanceKm(26.18, 91.74, 25.57, 91.89);
      expect(dist).toBeGreaterThan(60);
      expect(dist).toBeLessThan(80);
    });

    it('4. classifies HIGH historical activity (>=65 neighbors within 10km) as RED', () => {
      const target = { _id: 'target', location: { latitude: 25.5, longitude: 91.5 } };
      // Exactly 65 nearby events (< 10km away)
      const neighbors = Array.from({ length: 65 }, (_, i) => ({
        _id: `n-${i}`,
        location: { latitude: 25.501 + i * 0.0001, longitude: 91.501 }
      }));
      const allEvents = [target, ...neighbors];

      const res = classifyHistoricalEventDensity(target, allEvents, 10);
      expect(res.level).toBe('high');
      expect(res.color).toBe(HISTORICAL_COLORS.HIGH);
      expect(res.label).toBe('High Historical Landslide Activity');
      expect(res.neighborCount).toBe(65);
    });

    it('5. classifies MEDIUM historical activity (30-64 neighbors within 10km) as YELLOW/AMBER', () => {
      const target = { _id: 'target', location: { latitude: 25.5, longitude: 91.5 } };
      
      // Upper boundary: 64 neighbors
      const neighbors64 = Array.from({ length: 64 }, (_, i) => ({
        _id: `n-${i}`,
        location: { latitude: 25.501 + i * 0.0001, longitude: 91.501 }
      }));
      const res64 = classifyHistoricalEventDensity(target, [target, ...neighbors64], 10);
      expect(res64.level).toBe('medium');
      expect(res64.color).toBe(HISTORICAL_COLORS.MEDIUM);
      expect(res64.label).toBe('Medium Historical Landslide Activity');
      expect(res64.neighborCount).toBe(64);

      // Lower boundary: 30 neighbors
      const neighbors30 = Array.from({ length: 30 }, (_, i) => ({
        _id: `n-${i}`,
        location: { latitude: 25.501 + i * 0.0001, longitude: 91.501 }
      }));
      const res30 = classifyHistoricalEventDensity(target, [target, ...neighbors30], 10);
      expect(res30.level).toBe('medium');
      expect(res30.color).toBe(HISTORICAL_COLORS.MEDIUM);
      expect(res30.neighborCount).toBe(30);
    });

    it('6. classifies LOW historical activity (10-29 neighbors within 10km) as GREEN', () => {
      const target = { _id: 'target', location: { latitude: 25.5, longitude: 91.5 } };

      // Upper boundary: 29 neighbors
      const neighbors29 = Array.from({ length: 29 }, (_, i) => ({
        _id: `n-${i}`,
        location: { latitude: 25.501 + i * 0.0001, longitude: 91.501 }
      }));
      const res29 = classifyHistoricalEventDensity(target, [target, ...neighbors29], 10);
      expect(res29.level).toBe('low');
      expect(res29.color).toBe(HISTORICAL_COLORS.LOW);
      expect(res29.label).toBe('Low Historical Landslide Activity');
      expect(res29.neighborCount).toBe(29);

      // Lower boundary: 10 neighbors
      const neighbors10 = Array.from({ length: 10 }, (_, i) => ({
        _id: `n-${i}`,
        location: { latitude: 25.501 + i * 0.0001, longitude: 91.501 }
      }));
      const res10 = classifyHistoricalEventDensity(target, [target, ...neighbors10], 10);
      expect(res10.level).toBe('low');
      expect(res10.color).toBe(HISTORICAL_COLORS.LOW);
      expect(res10.neighborCount).toBe(10);
    });

    it('7. classifies INSUFFICIENT evidence (< 10 neighbors) as neutral GREY', () => {
      const target = { _id: 'target', location: { latitude: 25.5, longitude: 91.5 } };

      // Boundary: exactly 9 neighbors
      const neighbors9 = Array.from({ length: 9 }, (_, i) => ({
        _id: `n-${i}`,
        location: { latitude: 25.501 + i * 0.0001, longitude: 91.501 }
      }));
      const res9 = classifyHistoricalEventDensity(target, [target, ...neighbors9], 10);
      expect(res9.level).toBe('insufficient');
      expect(res9.color).toBe(HISTORICAL_COLORS.INSUFFICIENT);
      expect(res9.label).toBe('Insufficient Historical Evidence');
      expect(res9.neighborCount).toBe(9);

      // Boundary: exactly 0 neighbors
      const res0 = classifyHistoricalEventDensity(target, [target], 10);
      expect(res0.level).toBe('insufficient');
      expect(res0.color).toBe(HISTORICAL_COLORS.INSUFFICIENT);
      expect(res0.neighborCount).toBe(0);
    });

    it('8 & 9. historical results explicitly declare past activity disclaimer and cannot be current hazard', () => {
      const target = { _id: 'target', location: { latitude: 25.5, longitude: 91.5 } };
      const res = classifyHistoricalEventDensity(target, [target], 10);
      expect(res.isHistorical).toBe(true);
      expect(res.disclaimer).toContain('Past activity only — NOT a current hazard, prediction, or early warning.');
    });

    it('10. handles empty or missing events safely without throwing or fabricating fake data', () => {
      const emptyRes = preclassifyHistoricalEvents([]);
      expect(emptyRes).toEqual([]);
      const nullRes = classifyHistoricalEventDensity(null, []);
      expect(nullRes.level).toBe('insufficient');
      expect(nullRes.neighborCount).toBe(0);
    });
  });

  // ==========================================
  // Section 2: Historical Mode in Component
  // ==========================================
  describe('Historical Mode UI & Coordinate Integrity', () => {
    it('1, 2, 8, 9: renders real historical records with real coordinates and explicit past activity labels', async () => {
      const mockHistorical = [
        {
          _id: 'nasa-101',
          location: { latitude: 25.5788, longitude: 91.8933 },
          isHistorical: true,
          source: 'nasa_glc',
          eventType: 'debris_flow',
          eventDate: '2020-07-15T00:00:00.000Z',
          description: 'Historical slope failure from NASA GLC catalog.',
          historicalDensity: {
            level: 'low',
            label: 'Low Historical Landslide Activity',
            color: HISTORICAL_COLORS.LOW,
            neighborCount: 15
          }
        }
      ];

      landslideEventService.getAllEvents.mockResolvedValueOnce(mockHistorical);
      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Historical mode button is active
      const histBtn = screen.getByRole('button', { name: /Historical/i });
      expect(histBtn.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByText('Past landslide activity')).toBeTruthy();

      // Marker is rendered at the exact real coordinates with Low Historical Landslide Activity green color
      const marker = screen.getByTestId('circle-marker');
      expect(marker.getAttribute('data-lat')).toBe('25.5788');
      expect(marker.getAttribute('data-lon')).toBe('91.8933');
      expect(marker.getAttribute('data-fill-color')).toBe(HISTORICAL_COLORS.LOW);

      // Popup contains explicit Historical Landslide Event label & disclaimer
      expect(screen.getByText('Historical Landslide Event')).toBeTruthy();
      expect(screen.getByText(/NASA Global Landslide Catalog/i)).toBeTruthy();
      expect(screen.getByText(/Reflects past documented activity only — NOT a current hazard, prediction, or early warning/i)).toBeTruthy();
    });
  });

  // ==========================================
  // Section 3: Current Mode & Empty State
  // ==========================================
  describe('Current Mode UI & Zero Active Assessments Empty State', () => {
    it('11, 12, 13, 14: renders current risk assessments with correct severity colors', async () => {
      const mockCurrent = [
        {
          _id: 'curr-1',
          location: { latitude: 26.1, longitude: 91.7 },
          isHistorical: false,
          severity: 'critical',
          eventType: 'slope_instability',
          source: 'sensor',
          eventDate: '2026-09-08T00:00:00.000Z'
        },
        {
          _id: 'curr-2',
          location: { latitude: 27.2, longitude: 92.5 },
          isHistorical: false,
          severity: 'medium',
          eventType: 'mudslide',
          source: 'field_report'
        },
        {
          _id: 'curr-3',
          location: { latitude: 25.8, longitude: 93.1 },
          isHistorical: false,
          severity: 'low',
          eventType: 'rockfall'
        }
      ];

      landslideEventService.getAllEvents.mockResolvedValueOnce(mockCurrent);
      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Switches to Current mode
      const currentBtn = screen.getByRole('button', { name: /^Current$/i });
      fireEvent.click(currentBtn);
      expect(currentBtn.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getAllByText('Current AI risk assessment').length).toBeGreaterThanOrEqual(1);

      const markers = screen.getAllByTestId('circle-marker');
      expect(markers).toHaveLength(3);

      const critMarker = markers.find(m => m.getAttribute('data-lat') === '26.1');
      expect(critMarker.getAttribute('data-fill-color')).toBe('hsl(346, 87%, 43%)'); // Red

      const medMarker = markers.find(m => m.getAttribute('data-lat') === '27.2');
      expect(medMarker.getAttribute('data-fill-color')).toBe('hsl(48, 96%, 53%)'); // Yellow/Amber

      const lowMarker = markers.find(m => m.getAttribute('data-lat') === '25.8');
      expect(lowMarker.getAttribute('data-fill-color')).toBe('hsl(142, 71%, 45%)'); // Green
    });

    it('15 & 16: shows honest empty state when zero current assessments exist, without fabricating markers or converting historical records', async () => {
      // Historical only in database (like current production catalog)
      const mockHistoricalOnly = [
        {
          _id: 'nasa-1',
          location: { latitude: 25.5, longitude: 91.8 },
          isHistorical: true,
          eventType: 'debris_flow'
        }
      ];

      landslideEventService.getAllEvents.mockResolvedValueOnce(mockHistoricalOnly);
      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Switch to Current mode
      const currentBtn = screen.getByRole('button', { name: /^Current$/i });
      fireEvent.click(currentBtn);
      expect(currentBtn.getAttribute('aria-pressed')).toBe('true');

      // Zero current markers rendered
      expect(screen.queryAllByTestId('circle-marker')).toHaveLength(0);

      // Honest empty state message rendered
      expect(screen.getByText('No active risk assessments available for this area.')).toBeTruthy();
    });
  });

  // ==========================================
  // Section 4: 4-Way Orthogonal Basemap & Risk Mode Matrix
  // ==========================================
  describe('Orthogonal Basemap & Risk Data Mode Combinations', () => {
    const mixedDataset = [
      {
        _id: 'hist-1',
        location: { latitude: 25.5, longitude: 91.5 },
        isHistorical: true,
        eventType: 'rockfall',
        historicalDensity: {
          level: 'medium',
          label: 'Medium Historical Landslide Activity',
          color: HISTORICAL_COLORS.MEDIUM,
          neighborCount: 45
        }
      },
      {
        _id: 'curr-1',
        location: { latitude: 26.2, longitude: 92.1 },
        isHistorical: false,
        severity: 'high',
        eventType: 'debris_flow'
      }
    ];

    it('17. Terrain + Historical works', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce(mixedDataset);
      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      const histBtn = screen.getByRole('button', { name: /Historical/i });
      fireEvent.click(histBtn);

      const tile = screen.getByTestId('tile-layer');
      expect(tile.getAttribute('data-url')).toContain('openstreetmap.org');

      const markers = screen.getAllByTestId('circle-marker');
      expect(markers).toHaveLength(1);
      expect(markers[0].getAttribute('data-lat')).toBe('25.5');
    });

    it('18. Satellite + Historical works', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce(mixedDataset);
      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Switch basemap to satellite
      const basemapBtn = screen.getByRole('button', { name: /Switch basemap/i });
      fireEvent.click(basemapBtn);

      const histBtn = screen.getByRole('button', { name: /Historical/i });
      fireEvent.click(histBtn);

      const tile = screen.getByTestId('tile-layer');
      expect(tile.getAttribute('data-url')).toContain('arcgisonline.com');

      const markers = screen.getAllByTestId('circle-marker');
      expect(markers).toHaveLength(1);
      expect(markers[0].getAttribute('data-lat')).toBe('25.5');
    });

    it('19. Terrain + Current works', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce(mixedDataset);
      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      const currBtn = screen.getByRole('button', { name: /^Current$/i });
      fireEvent.click(currBtn);

      const tile = screen.getByTestId('tile-layer');
      expect(tile.getAttribute('data-url')).toContain('openstreetmap.org');

      const markers = screen.getAllByTestId('circle-marker');
      expect(markers).toHaveLength(1);
      expect(markers[0].getAttribute('data-lat')).toBe('26.2');
    });

    it('20. Satellite + Current works', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce(mixedDataset);
      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      // Switch basemap to satellite
      const basemapBtn = screen.getByRole('button', { name: /Switch basemap/i });
      fireEvent.click(basemapBtn);

      const currBtn = screen.getByRole('button', { name: /^Current$/i });
      fireEvent.click(currBtn);

      const tile = screen.getByTestId('tile-layer');
      expect(tile.getAttribute('data-url')).toContain('arcgisonline.com');

      const markers = screen.getAllByTestId('circle-marker');
      expect(markers).toHaveLength(1);
      expect(markers[0].getAttribute('data-lat')).toBe('26.2');
    });

    it('21, 22, 23, 24, 25: Basemap switching preserves risk mode & risk switching preserves basemap, center, zoom, and pointer', async () => {
      landslideEventService.getAllEvents.mockResolvedValueOnce(mixedDataset);
      render(<RiskMap />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading geospatial risk data/i)).toBeNull();
      });

      const histBtn = screen.getByRole('button', { name: /Historical/i });
      const currBtn = screen.getByRole('button', { name: /^Current$/i });
      const basemapBtn = screen.getByRole('button', { name: /Switch basemap/i });

      // Start with Current mode
      fireEvent.click(currBtn);
      expect(currBtn.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('openstreetmap');

      // 21. Basemap switch to Satellite preserves Current risk mode
      fireEvent.click(basemapBtn);
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('arcgisonline');
      expect(currBtn.getAttribute('aria-pressed')).toBe('true');

      // 22. Risk mode switch to Historical preserves Satellite basemap
      fireEvent.click(histBtn);
      expect(histBtn.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('arcgisonline');

      // Map container maintains stable center and zoom
      const mapContainer = screen.getByTestId('map-container');
      expect(mapContainer.getAttribute('data-center')).toBe(JSON.stringify([26.2, 92.93]));
      expect(mapContainer.getAttribute('data-zoom')).toBe('6');
    });
  });
});
