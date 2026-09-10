import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import Dashboard from '../pages/Dashboard';
import { landslideEventService } from '../services/landslideEventService';
import { rainfallObservationService } from '../services/rainfallObservationService';
import { soilMoistureService } from '../services/soilMoistureService';
import { infrastructureAssetService } from '../services/infrastructureAssetService';
import { notificationAPI } from '../services/api';
import { fieldReportService } from '../services/fieldReportService';
import { LanguageProvider } from '../contexts/LanguageContext';

const mockNavigate = vi.fn();

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock NetworkContext
vi.mock('../contexts/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
}));

// Mock Services
vi.mock('../services/landslideEventService', () => ({
  landslideEventService: {
    getAllEvents: vi.fn(),
  },
}));

vi.mock('../services/rainfallObservationService', () => ({
  rainfallObservationService: {
    getAllObservations: vi.fn(),
  },
}));

vi.mock('../services/soilMoistureService', () => ({
  soilMoistureService: {
    getAllObservations: vi.fn(),
  },
}));

vi.mock('../services/infrastructureAssetService', () => ({
  infrastructureAssetService: {
    getAllAssets: vi.fn(),
  },
}));

vi.mock('../services/api', () => ({
  notificationAPI: {
    getAll: vi.fn(),
  },
}));

vi.mock('../services/fieldReportService', () => ({
  fieldReportService: {
    getAllReports: vi.fn(),
  },
}));

vi.mock('../services/dashboardService', () => ({
  dashboardService: {
    getIntelligence: vi.fn(),
  },
}));

import { dashboardService } from '../services/dashboardService';
import { geocodingService } from '../services/geocodingService';

vi.mock('../services/geocodingService', () => ({
  geocodingService: {
    search: vi.fn(),
  },
}));

describe('Dashboard Core Data Correctness', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default empty/clean mocks
    landslideEventService.getAllEvents.mockResolvedValue([]);
    rainfallObservationService.getAllObservations.mockResolvedValue([]);
    soilMoistureService.getAllObservations.mockResolvedValue([]);
    infrastructureAssetService.getAllAssets.mockResolvedValue([]);
    notificationAPI.getAll.mockResolvedValue({ data: { data: [] } });
    fieldReportService.getAllReports.mockResolvedValue([]);
  });

  it('historical events are not incorrectly counted as active incidents', async () => {
    // 5 historical catalog events (like NASA dataset)
    const mockHistoricalEvents = [
      { id: '1', title: 'Historic Event 1', isHistorical: true, severity: 'high' },
      { id: '2', title: 'Historic Event 2', isHistorical: true, severity: 'critical' },
      { id: '3', title: 'Historic Event 3', isHistorical: true, severity: 'medium' },
      { id: '4', title: 'Historic Event 4', isHistorical: true, severity: 'low' },
      { id: '5', title: 'Historic Event 5', isHistorical: true, severity: 'low' },
    ];
    landslideEventService.getAllEvents.mockResolvedValueOnce(mockHistoricalEvents);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText('...')).toBeNull();
    });

    // Active Incidents stat must show 0, NOT 5
    const activeStat = screen.getByText('Active Incidents');
    const parentContainer = activeStat.closest('.quick-stat-meta');
    expect(parentContainer.textContent).toContain('0');
    expect(parentContainer.textContent).not.toContain('5');
  });

  it('counts legitimate non-historical events as active incidents', async () => {
    const mockEvents = [
      { id: 'h1', title: 'Historic Event', isHistorical: true, severity: 'high' },
      { id: 'a1', title: 'Live Landslide Report', isHistorical: false, severity: 'high' },
    ];
    landslideEventService.getAllEvents.mockResolvedValueOnce(mockEvents);

    render(<Dashboard />);

    await waitFor(() => {
      const activeStat = screen.getByText('Active Incidents');
      const parentContainer = activeStat.closest('.quick-stat-meta');
      expect(parentContainer.textContent).toContain('1');
    });
  });

  it('missing/insufficient risk data never becomes falsely LOW', async () => {
    // No active critical incidents and no active alerts
    landslideEventService.getAllEvents.mockResolvedValueOnce([
      { id: 'h1', isHistorical: true, severity: 'critical' },
    ]);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText('...')).toBeNull();
    });

    // Nearby Risk Level must display 'Unavailable', NOT 'Low'
    const riskTag = document.querySelector('.risk-level-tag');
    expect(riskTag.textContent).toBe('Unavailable');
    expect(riskTag.textContent).not.toBe('Low');

    // High Risk Areas metric must show 'Unavailable', not 0
    const highRiskLabel = screen.getByText('High Risk Areas');
    const highRiskCard = highRiskLabel.closest('.metric-glass-card');
    expect(highRiskCard.textContent).toContain('Unavailable');
    expect(highRiskCard.textContent).toContain('No active risk zoning');
  });

  it('missing infrastructure data does not create critical-road values', async () => {
    infrastructureAssetService.getAllAssets.mockResolvedValueOnce([]);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText('Loading infrastructure telemetry...')).toBeNull();
    });

    // Critical Roads metric must display Unavailable
    const roadsLabel = screen.getByText('Critical Roads');
    const roadsCard = roadsLabel.closest('.metric-glass-card');
    expect(roadsCard.textContent).toContain('Unavailable');
    expect(roadsCard.textContent).toContain('No corridor telemetry');

    // Infrastructure Priority panel must show truthful empty state, not hardcoded mock corridors
    expect(screen.getByText('No infrastructure corridors registered')).toBeTruthy();
    expect(screen.queryByText('NH-13 Potin-Pangin')).toBeNull();
  });

  it('missing zone data does not create fake monitored-zone counts', async () => {
    render(<Dashboard />);

    await waitFor(() => {
      const zoneLabel = screen.getByText('Monitored Zones');
      const zoneCard = zoneLabel.closest('.metric-glass-card');
      expect(zoneCard.textContent).toContain('Unavailable');
      expect(zoneCard.textContent).toContain('No zone dataset configured');
    });
  });

  it('real rainfall data still renders', async () => {
    const mockRainfall = [
      { id: 'rf1', rainfall: 28.4, recordedAt: new Date().toISOString() },
      { id: 'rf2', rainfall: 12.1, recordedAt: new Date(Date.now() - 3600000).toISOString() },
    ];
    rainfallObservationService.getAllObservations.mockResolvedValueOnce(mockRainfall);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getAllByText(/28\.4 mm/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('real soil-moisture data still renders', async () => {
    const mockSoil = [
      { id: 'sm1', soilMoisture: 42.6, recordedAt: new Date().toISOString() },
    ];
    soilMoistureService.getAllObservations.mockResolvedValueOnce(mockSoil);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getAllByText(/42\.6%/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('alerts render from their API and historical events are never fallback alerts', async () => {
    // Historical events exist, but active alerts are empty
    landslideEventService.getAllEvents.mockResolvedValueOnce([
      { id: 'h1', title: 'Ancient Landslide', isHistorical: true, severity: 'critical' },
    ]);
    notificationAPI.getAll.mockResolvedValueOnce({ data: { data: [] } });

    render(<Dashboard />);

    await waitFor(() => {
      // Historical events must NOT be converted into fake alerts
      expect(screen.getByText('No active alerts broadcasted')).toBeTruthy();
      expect(screen.queryByText('Ancient Landslide')).toBeNull();
    });
  });

  it('renders active alerts when received from notification API', async () => {
    const mockAlerts = [
      {
        _id: 'alt-1',
        title: 'Flash Flood Threat',
        location: 'Pasighat, Arunachal',
        severity: 'critical',
        createdAt: new Date().toISOString(),
      },
    ];
    notificationAPI.getAll.mockResolvedValueOnce({ data: { data: mockAlerts } });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Flash Flood Threat')).toBeTruthy();
      expect(screen.getByText('Pasighat, Arunachal')).toBeTruthy();
    });
  });

  it('field reports render from their API', async () => {
    const mockReports = [
      {
        _id: 'rep-1',
        description: 'Road blocked by rockfall near bridge',
        status: 'verified',
        location: { latitude: 27.12, longitude: 93.45 },
      },
    ];
    fieldReportService.getAllReports.mockResolvedValueOnce(mockReports);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Road blocked by rockfall near bridge')).toBeTruthy();
      expect(screen.getByText('Verified')).toBeTruthy();
    });
  });

  describe('Dashboard Clickable Interactions & Area Intelligence Navigation', () => {
    it('unavailable-data states are not clickable as if real and have disabled controls', async () => {
      render(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      // 1. Monitored zones: disabled
      const zoneLabel = screen.getByText('Monitored Zones');
      const zoneCard = zoneLabel.closest('.metric-glass-card');
      expect(zoneCard.classList.contains('disabled')).toBe(true);
      const zoneArrow = zoneCard.querySelector('.card-nav-arrow');
      expect(zoneArrow.disabled).toBe(true);

      // Attempt click
      fireEvent.click(zoneCard);
      expect(mockNavigate).not.toHaveBeenCalled();

      // 2. High risk areas when unavailable: disabled
      const highRiskLabel = screen.getByText('High Risk Areas');
      const highRiskCard = highRiskLabel.closest('.metric-glass-card');
      expect(highRiskCard.classList.contains('disabled')).toBe(true);
      const highRiskArrow = highRiskCard.querySelector('.card-nav-arrow');
      expect(highRiskArrow.disabled).toBe(true);

      fireEvent.click(highRiskCard);
      expect(mockNavigate).not.toHaveBeenCalled();

      // 3. Critical roads when 0 assets exist: disabled
      const roadsLabel = screen.getByText('Critical Roads');
      const roadsCard = roadsLabel.closest('.metric-glass-card');
      expect(roadsCard.classList.contains('disabled')).toBe(true);
      const roadsArrow = roadsCard.querySelector('.card-nav-arrow');
      expect(roadsArrow.disabled).toBe(true);

      fireEvent.click(roadsCard);
      expect(mockNavigate).not.toHaveBeenCalled();

      // 4. Infrastructure priority table arrow when 0 assets: disabled
      const infraArrow = document.querySelector('.command-bottom-grid .command-glass-panel:nth-child(3) .panel-arrow-btn');
      expect(infraArrow.disabled).toBe(true);
    });

    it('clicking a real field report navigates to Risk Map with relevant location context for Area Intelligence', async () => {
      const mockReports = [
        {
          _id: 'rep-real-1',
          description: 'Active mudflow blocking NH-10',
          status: 'verified',
          location: { latitude: 27.15, longitude: 93.42 },
        },
      ];
      fieldReportService.getAllReports.mockResolvedValueOnce(mockReports);

      render(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText('Active mudflow blocking NH-10')).toBeTruthy();
      });

      const reportItem = screen.getByText('Active mudflow blocking NH-10').closest('.report-feed-item');
      expect(reportItem.classList.contains('clickable')).toBe(true);

      fireEvent.click(reportItem);

      // Must navigate to /map with location state for Area Intelligence
      expect(mockNavigate).toHaveBeenCalledWith('/map', {
        state: {
          selectedLocation: {
            lat: 27.15,
            lon: 93.42,
            name: 'Active mudflow blocking NH-10',
          },
        },
      });
    });

    it('clicking an active critical hazard navigates to Risk Map with incident location context', async () => {
      const liveIncident = [
        {
          _id: 'live-ev-1',
          title: 'Immediate Rockfall Hazard',
          severity: 'critical',
          isHistorical: false,
          location: { latitude: 28.12, longitude: 94.35 },
        },
      ];
      landslideEventService.getAllEvents.mockResolvedValueOnce(liveIncident);

      render(<Dashboard />);

      await waitFor(() => {
        const areasCard = screen.getByText('High Risk Areas').closest('.metric-glass-card');
        expect(areasCard.classList.contains('disabled')).toBe(false);
      });

      const areasCard = screen.getByText('High Risk Areas').closest('.metric-glass-card');
      fireEvent.click(areasCard);

      await waitFor(() => {
        expect(screen.getByText('Immediate Rockfall Hazard')).toBeTruthy();
      });

      const mapBtn = screen.getByText('VIEW ON MAP');
      fireEvent.click(mapBtn);

      expect(mockNavigate).toHaveBeenCalledWith('/map', {
        state: {
          selectedLocation: {
            lat: 28.12,
            lon: 94.35,
            name: 'Immediate Rockfall Hazard',
          },
        },
      });
    });

    it('clicking a real infrastructure row navigates to Risk Map with corridor location context', async () => {
      const mockInfra = [
        {
          _id: 'infra-1',
          name: 'NH-13 Potin Corridor',
          status: 'closed',
          importance: 5,
          location: { latitude: 27.35, longitude: 93.65 },
        },
      ];
      infrastructureAssetService.getAllAssets.mockResolvedValueOnce(mockInfra);

      render(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText('NH-13 Potin Corridor')).toBeTruthy();
      });

      const infraRow = screen.getByText('NH-13 Potin Corridor').closest('.infra-row');
      expect(infraRow.classList.contains('clickable')).toBe(true);

      fireEvent.click(infraRow);

      expect(mockNavigate).toHaveBeenCalledWith('/map', {
        state: {
          selectedLocation: {
            lat: 27.35,
            lon: 93.65,
            name: 'NH-13 Potin Corridor',
          },
        },
      });
    });

    it('general navigation buttons navigate to respective routes', async () => {
      render(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      // 1. Regional Monitoring Card -> Modal -> /map
      const regionalCard = screen.getByText('Regional Monitoring').closest('.side-metric-card');
      fireEvent.click(regionalCard);
      
      await waitFor(() => {
        expect(screen.getByText('Regional Monitoring Details')).toBeTruthy();
      });

      const regionalMapBtn = screen.getByText('VIEW ON MAP');
      fireEvent.click(regionalMapBtn);

      expect(mockNavigate).toHaveBeenCalledWith('/map', {
        state: {
          selectedLocation: {
            lat: 26.1445,
            lon: 91.7362,
            name: 'Guwahati Hub'
          }
        }
      });

      // 2. Alerts Header Arrow -> /alerts
      const alertsArrow = document.querySelector('.command-bottom-grid .command-glass-panel:nth-child(1) .panel-arrow-btn');
      fireEvent.click(alertsArrow);
      expect(mockNavigate).toHaveBeenCalledWith('/alerts');

      // 3. Reports Header Arrow -> /reports
      const reportsArrow = document.querySelector('.command-bottom-grid .command-glass-panel:nth-child(2) .panel-arrow-btn');
      fireEvent.click(reportsArrow);
      expect(mockNavigate).toHaveBeenCalledWith('/reports');
    });
  });

  describe('Dashboard Localization Application', () => {
    it('changing language to Hindi updates Dashboard visible labels while preserving dynamic values', async () => {
      localStorage.setItem('ner_lmrs_language', 'hi');

      rainfallObservationService.getAllObservations.mockResolvedValueOnce([
        { recordedAt: new Date().toISOString(), rainfall: 42.5 }
      ]);
      soilMoistureService.getAllObservations.mockResolvedValueOnce([
        { recordedAt: new Date().toISOString(), soilMoisture: 78.2 }
      ]);
      landslideEventService.getAllEvents.mockResolvedValueOnce([
        { id: 'act-1', isHistorical: false, severity: 'critical', location: { latitude: 26.2, longitude: 92.9 } }
      ]);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      // Translated visible labels in Hindi
      expect(screen.getByText('सक्रिय घटनाएँ')).toBeTruthy();
      expect(screen.getByText('पूर्वोत्तर भारत')).toBeTruthy();
      expect(screen.getByText('क्षेत्रीय निगरानी')).toBeTruthy();
      expect(screen.getByText('उच्च जोखिम वाले क्षेत्र')).toBeTruthy();
      expect(screen.getByText('महत्वपूर्ण सड़कें')).toBeTruthy();
      expect(screen.getByText('हालिया अलर्ट')).toBeTruthy();
      expect(screen.getByText('हालिया फील्ड रिपोर्ट')).toBeTruthy();
      expect(screen.getByText('बुनियादी ढांचा प्राथमिकता')).toBeTruthy();

      // Dynamic real numbers and measurements must remain strictly numerical/unaltered
      expect(screen.getAllByText(/42\.5\s*mm/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/78\.2%/).length).toBeGreaterThan(0);
    });

    it('translates important Dashboard empty and unavailable states in Assamese', async () => {
      localStorage.setItem('ner_lmrs_language', 'as');

      // Empty responses
      landslideEventService.getAllEvents.mockResolvedValueOnce([]);
      rainfallObservationService.getAllObservations.mockResolvedValueOnce([]);
      soilMoistureService.getAllObservations.mockResolvedValueOnce([]);
      infrastructureAssetService.getAllAssets.mockResolvedValueOnce([]);
      notificationAPI.getAll.mockResolvedValueOnce({ data: { data: [] } });
      fieldReportService.getAllReports.mockResolvedValueOnce([]);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      // Assamese empty & unavailable states
      expect(screen.getAllByText('উপলব্ধ নহয়').length).toBeGreaterThan(0);
      expect(screen.getByText('কোনো সক্ৰিয় এলাৰ্ট জাৰি কৰা হোৱা নাই')).toBeTruthy();
      expect(screen.getByText('কোনো ক্ষেত্ৰ প্ৰতিবেদন লিপিবদ্ধ নাই')).toBeTruthy();
      expect(screen.getByText('কোনো আন্তঃগাঁথনিৰ কৰিডৰ পঞ্জীয়ন হোৱা নাই')).toBeTruthy();
      expect(screen.getByText('নিৰীক্ষণাধীন মণ্ডলসমূহ')).toBeTruthy();
    });

    it('preserves English as default language', async () => {
      localStorage.setItem('ner_lmrs_language', 'en');

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      expect(screen.getByText('Active Incidents')).toBeTruthy();
      expect(screen.getByText('Northeast India')).toBeTruthy();
      expect(screen.getByText('Regional Monitoring')).toBeTruthy();
      expect(screen.getByText('High Risk Areas')).toBeTruthy();
    });
  });

  describe('Dashboard Rainfall Metric Correctness', () => {
    it('displays the correct 24-hour accumulated rainfall value under Rainfall (24h) and Recent Rainfall', async () => {
      rainfallObservationService.getAllObservations.mockResolvedValueOnce([
        {
          _id: 'rain-1',
          location: { latitude: 26.16, longitude: 91.69 },
          rainfall: 24.5,
          rainfall24h: 24.5,
          currentIntervalPrecipitation: 0.3,
          recordedAt: new Date().toISOString()
        }
      ]);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      // Quick-stat item for Rainfall (24h)
      const statLabel = screen.getByText(/Rainfall \(24h\)/);
      const statParent = statLabel.closest('.quick-stat-meta');
      expect(statParent.textContent).toContain('24.5 mm');

      // Metric Card 4 for Recent Rainfall (Last 24 hours)
      const metric4 = screen.getByText('Recent Rainfall').closest('.metric-glass-card');
      expect(metric4.textContent).toContain('24.5 mm');
    });

    it('displays Unavailable under Rainfall (24h) when rainfall24h is null, never falling back to current interval or legacy rainfall', async () => {
      rainfallObservationService.getAllObservations.mockResolvedValueOnce([
        {
          _id: 'rain-legacy',
          location: { latitude: 26.16, longitude: 91.69 },
          rainfall: 0.3, // Legacy/short interval value
          rainfall24h: null, // No valid 24-hour accumulated data
          currentIntervalPrecipitation: 0.3,
          recordedAt: new Date().toISOString()
        }
      ]);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      // Quick-stat item must NOT show 0.3 mm; must show Unavailable
      const statLabel = screen.getByText(/Rainfall \(24h\)/);
      const statParent = statLabel.closest('.quick-stat-meta');
      expect(statParent.textContent).toContain('Unavailable');
      expect(statParent.textContent).not.toContain('0.3 mm');

      // Metric Card 4 must NOT show 0.3 mm; must show Unavailable
      const metric4 = screen.getByText('Recent Rainfall').closest('.metric-glass-card');
      expect(metric4.textContent).toContain('Unavailable');
      expect(metric4.textContent).not.toContain('0.3 mm');
    });
  });

  describe('Location-Aware Dashboard Intelligence Flow', () => {
    it('searches and selects a location, updating active coordinates, dynamic weather, AI risk analysis, and historical catalogue events with distances', async () => {
      geocodingService.search.mockResolvedValueOnce([
        { id: 'shimla', name: 'Shimla, Himachal Pradesh', lat: 31.1048, lon: 77.1734 }
      ]);

      dashboardService.getIntelligence.mockResolvedValueOnce({
        location: { lat: 31.1048, lon: 77.1734, name: 'Shimla, Himachal Pradesh' },
        weather: {
          rainfall24h: 15.2,
          currentIntervalPrecipitation: 0.5,
          temperature: 19.4,
          humidity: 78,
          windSpeed: 12.3,
          precipitationProbability: 40,
          recordedAt: new Date().toISOString(),
          isStale: false,
          source: 'open-meteo'
        },
        soilMoisture: { value: 38.5, recordedAt: new Date().toISOString() },
        aiRiskAnalysis: {
          riskLevel: 'HIGH',
          riskScore: 0.74,
          confidence: 0.88,
          reasoning: ['Steep slopes exceeding 30 degrees combined with 15.2mm antecedent rainfall'],
          primaryFactors: ['Slope: 32°', 'Rainfall 24h: 15.2mm']
        },
        activeIncidents: { count: 0, incidents: [] },
        incidentHistory: {
          totalCount: 1,
          radiusKm: 50,
          events: [
            {
              _id: 'hist-shimla-1',
              description: 'Shimla Ridge Debris Slide',
              severity: 'high',
              distanceKm: 4.8,
              eventDate: '2023-07-15T00:00:00.000Z',
              location: { latitude: 31.11, longitude: 77.18 }
            }
          ]
        },
        fieldReports: {
          totalCount: 1,
          radiusKm: 50,
          reports: [
            {
              _id: 'rep-shimla-1',
              description: 'Tension crack near Highway 5',
              status: 'verified',
              distanceKm: 2.3,
              location: { latitude: 31.10, longitude: 77.17 }
            }
          ]
        },
        infrastructure: {
          totalCount: 1,
          radiusKm: 50,
          assets: [
            {
              _id: 'infra-shimla-1',
              name: 'NH-5 Corridor',
              status: 'open',
              importance: 5,
              distanceKm: 3.1,
              location: { latitude: 31.09, longitude: 77.16 }
            }
          ]
        }
      });

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      // Type Shimla into search input
      const searchInput = screen.getByLabelText('Search for an area');
      fireEvent.change(searchInput, { target: { value: 'Shimla' } });
      const searchBtn = screen.getByLabelText('Submit search');
      fireEvent.click(searchBtn);

      // Wait for geocoding dropdown option and click it
      await waitFor(() => {
        expect(screen.getByText('Shimla, Himachal Pradesh')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Shimla, Himachal Pradesh'));

      // Verify dashboardService.getIntelligence was invoked with selected coordinates
      await waitFor(() => {
        expect(dashboardService.getIntelligence).toHaveBeenCalledWith(
          31.1048,
          77.1734,
          expect.any(AbortSignal)
        );
      });

      // Active Coordinates Pill displays location name and coordinates
      await waitFor(() => {
        expect(screen.getByText(/Shimla, Himachal Pradesh \(31.10°, 77.17°\)/)).toBeTruthy();
      });

      // Weather telemetry displays temperature, humidity, wind, and 24h rainfall
      expect(screen.getByText('19.4°C')).toBeTruthy();
      expect(screen.getByText(/Humidity: 78%/)).toBeTruthy();
      expect(screen.getByText('12.3 km/h')).toBeTruthy();
      expect(screen.getAllByText('15.2 mm').length).toBeGreaterThan(0);

      // AI Risk Analysis displays HIGH and specific reasoning
      expect(screen.getByText('HIGH')).toBeTruthy();
      expect(screen.getByText('Steep slopes exceeding 30 degrees combined with 15.2mm antecedent rainfall')).toBeTruthy();

      // Field Report & Infrastructure render with distance
      expect(screen.getByText('Tension crack near Highway 5')).toBeTruthy();
      expect(screen.getByText('2.3 km away')).toBeTruthy();
      expect(screen.getByText('NH-5 Corridor')).toBeTruthy();
      expect(screen.getByText('3.1 km away')).toBeTruthy();
    });

    it('selecting a second location cancels/replaces previous location telemetry and displays truthful empty states', async () => {
      // 1st location: Shimla
      geocodingService.search.mockResolvedValueOnce([
        { id: 'shimla', name: 'Shimla, HP', lat: 31.1048, lon: 77.1734 }
      ]);
      dashboardService.getIntelligence.mockResolvedValueOnce({
        location: { lat: 31.1048, lon: 77.1734, name: 'Shimla, HP' },
        weather: { rainfall24h: 10.0, temperature: 18.0, humidity: 70, windSpeed: 10.0, recordedAt: new Date().toISOString() },
        soilMoisture: { value: 30.0, recordedAt: new Date().toISOString() },
        aiRiskAnalysis: { riskLevel: 'MODERATE', riskScore: 0.5, confidence: 0.8, reasoning: ['Moderate risk'] },
        activeIncidents: { count: 0, incidents: [] },
        incidentHistory: { totalCount: 1, radiusKm: 50, events: [{ _id: 'h1', description: 'Shimla Slide', distanceKm: 5.0 }] },
        fieldReports: { totalCount: 0, radiusKm: 50, reports: [] },
        infrastructure: { totalCount: 0, radiusKm: 50, assets: [] }
      });

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      const searchInput = screen.getByLabelText('Search for an area');
      fireEvent.change(searchInput, { target: { value: 'Shimla' } });
      fireEvent.click(screen.getByLabelText('Submit search'));

      await waitFor(() => {
        expect(screen.getByText('Shimla, HP')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Shimla, HP'));

      await waitFor(() => {
        expect(screen.getByText(/Shimla, HP \(31.10°, 77.17°\)/)).toBeTruthy();
      });

      // 2nd location: Guwahati (with zero nearby catalog events, field reports, or infrastructure)
      geocodingService.search.mockResolvedValueOnce([
        { id: 'guwahati', name: 'Guwahati, Assam', lat: 26.1445, lon: 91.7362 }
      ]);
      dashboardService.getIntelligence.mockResolvedValueOnce({
        location: { lat: 26.1445, lon: 91.7362, name: 'Guwahati, Assam' },
        weather: { rainfall24h: 0.0, currentIntervalPrecipitation: 0.0, temperature: 27.5, humidity: 60, windSpeed: 5.0, recordedAt: new Date().toISOString() },
        soilMoisture: { value: 15.0, recordedAt: new Date().toISOString() },
        aiRiskAnalysis: { riskLevel: 'LOW', riskScore: 0.15, confidence: 0.9, reasoning: ['Baseline stability'] },
        activeIncidents: { count: 0, incidents: [] },
        incidentHistory: { totalCount: 0, radiusKm: 50, events: [] },
        fieldReports: { totalCount: 0, radiusKm: 50, reports: [] },
        infrastructure: { totalCount: 0, radiusKm: 50, assets: [] }
      });

      fireEvent.change(searchInput, { target: { value: 'Guwahati' } });
      fireEvent.click(screen.getByLabelText('Submit search'));

      await waitFor(() => {
        expect(screen.getByText('Guwahati, Assam')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Guwahati, Assam'));

      // Location replaces Shimla with Guwahati
      await waitFor(() => {
        expect(screen.getByText(/Guwahati, Assam \(26.14°, 91.74°\)/)).toBeTruthy();
      });
      expect(screen.queryByText(/Shimla, HP/)).toBeNull();

      // Truthful empty states rendered
      expect(screen.getByText('No field reports logged in this area')).toBeTruthy();
      expect(screen.getByText('No infrastructure corridors registered')).toBeTruthy();
    });

    it('strictly displays Unavailable for Rainfall (24h) when selected location rainfall24h is null, never falling back to current interval', async () => {
      geocodingService.search.mockResolvedValueOnce([
        { id: 'loc-1', name: 'Test Ridge', lat: 25.5, lon: 90.5 }
      ]);
      dashboardService.getIntelligence.mockResolvedValueOnce({
        location: { lat: 25.5, lon: 90.5, name: 'Test Ridge' },
        weather: {
          rainfall24h: null, // Missing 24h accumulation
          currentIntervalPrecipitation: 2.5, // Present short-interval
          temperature: 22.0,
          humidity: 80,
          windSpeed: 7.0,
          recordedAt: new Date().toISOString()
        },
        soilMoisture: { value: 25.0, recordedAt: new Date().toISOString() },
        aiRiskAnalysis: { riskLevel: 'LOW', riskScore: 0.1, confidence: 0.8, reasoning: ['Stable'] },
        activeIncidents: { count: 0, incidents: [] },
        incidentHistory: { totalCount: 0, radiusKm: 50, events: [] },
        fieldReports: { totalCount: 0, radiusKm: 50, reports: [] },
        infrastructure: { totalCount: 0, radiusKm: 50, assets: [] }
      });

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      const searchInput = screen.getByLabelText('Search for an area');
      fireEvent.change(searchInput, { target: { value: 'Test Ridge' } });
      fireEvent.click(screen.getByLabelText('Submit search'));

      await waitFor(() => {
        expect(screen.getByText('Test Ridge')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Test Ridge'));

      await waitFor(() => {
        expect(screen.getByText(/Test Ridge \(25.50°, 90.50°\)/)).toBeTruthy();
      });

      // Quick-stat item for Rainfall (24h) must display Unavailable, NOT 2.5 mm
      const statLabel = screen.getByText(/Rainfall \(24h\)/);
      const statParent = statLabel.closest('.quick-stat-meta');
      expect(statParent.textContent).toContain('Unavailable');
      expect(statParent.textContent).not.toContain('2.5 mm');
    });

    it('displays error banner when location intelligence retrieval fails', async () => {
      geocodingService.search.mockResolvedValueOnce([
        { id: 'loc-fail', name: 'Fail Loc', lat: 27.0, lon: 92.0 }
      ]);
      dashboardService.getIntelligence.mockRejectedValueOnce(
        new Error('Upstream meteorological satellite feed unreachable')
      );

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      const searchInput = screen.getByLabelText('Search for an area');
      fireEvent.change(searchInput, { target: { value: 'Fail Loc' } });
      fireEvent.click(screen.getByLabelText('Submit search'));

      await waitFor(() => {
        expect(screen.getByText('Fail Loc')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Fail Loc'));

      // Error banner displays the error message
      await waitFor(() => {
        expect(screen.getByText('Upstream meteorological satellite feed unreachable')).toBeTruthy();
      });
    });

    it('displays error message in search dropdown when geocoding service fails', async () => {
      geocodingService.search.mockRejectedValueOnce(
        new Error('Geocoding provider connection refused')
      );

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      const searchInput = screen.getByLabelText('Search for an area');
      fireEvent.change(searchInput, { target: { value: 'Crash Place' } });
      fireEvent.click(screen.getByLabelText('Submit search'));

      await waitFor(() => {
        expect(screen.getByText('Geocoding provider connection refused')).toBeTruthy();
      });
    });
  });

  describe('Use My Location in Regional Monitoring', () => {
    let originalGeolocation;
    let originalFetch;

    beforeEach(() => {
      originalGeolocation = global.navigator.geolocation;
      originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          address: { city: 'Guwahati', state: 'Assam' }
        })
      });
    });

    afterEach(() => {
      if (originalGeolocation !== undefined) {
        Object.defineProperty(global.navigator, 'geolocation', {
          value: originalGeolocation,
          configurable: true,
          writable: true,
        });
      }
      global.fetch = originalFetch;
    });

    it('renders the "Use My Location" button in Regional Monitoring card', async () => {
      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /use my location/i })).toBeTruthy();
      });
    });

    it('updates Regional Monitoring with current user coordinates and live weather on click', async () => {
      const mockCoords = { latitude: 26.18, longitude: 91.75 };
      const mockGetCurrentPosition = vi.fn().mockImplementation((success) => {
        success({ coords: mockCoords });
      });

      Object.defineProperty(global.navigator, 'geolocation', {
        value: { getCurrentPosition: mockGetCurrentPosition },
        configurable: true,
        writable: true,
      });

      dashboardService.getIntelligence.mockResolvedValueOnce({
        location: { lat: 26.18, lon: 91.75, name: 'Guwahati Dispur' },
        weather: {
          temperature: 28.5,
          humidity: 72,
          windSpeed: 10.4,
          rainfall24h: 3.2,
          currentIntervalPrecipitation: 0.0,
          precipitationProbability: 15,
          source: 'open-meteo',
        },
        soilMoisture: { value: 34.0 },
        aiRiskAnalysis: { riskLevel: 'LOW' },
        activeIncidents: { count: 0, incidents: [] },
        incidentHistory: { totalCount: 0, events: [] },
        fieldReports: { totalCount: 0, reports: [] },
        infrastructure: { totalCount: 0, criticalAssets: [] },
      });

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      const useLocationBtn = await screen.findByRole('button', { name: /use my location/i });
      fireEvent.click(useLocationBtn);

      expect(mockGetCurrentPosition).toHaveBeenCalled();

      await waitFor(() => {
        expect(dashboardService.getIntelligence).toHaveBeenCalledWith(26.18, 91.75, expect.anything());
      });

      await waitFor(() => {
        expect(screen.getByText('28.5°C')).toBeTruthy();
        expect(screen.getByText(/Humidity: 72%/)).toBeTruthy();
      });
    });

    it('handles geolocation permission denied gracefully with user-facing message', async () => {
      const mockGetCurrentPosition = vi.fn().mockImplementation((_success, error) => {
        error({ code: 1, message: 'User denied Geolocation' });
      });

      Object.defineProperty(global.navigator, 'geolocation', {
        value: { getCurrentPosition: mockGetCurrentPosition },
        configurable: true,
        writable: true,
      });

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      const useLocationBtn = await screen.findByRole('button', { name: /use my location/i });
      fireEvent.click(useLocationBtn);

      await waitFor(() => {
        expect(screen.getByText(/Location permission denied/i)).toBeTruthy();
      });
    });

    it('allows resetting back to default regional monitoring', async () => {
      const mockCoords = { latitude: 26.18, longitude: 91.75 };
      const mockGetCurrentPosition = vi.fn().mockImplementation((success) => {
        success({ coords: mockCoords });
      });

      Object.defineProperty(global.navigator, 'geolocation', {
        value: { getCurrentPosition: mockGetCurrentPosition },
        configurable: true,
        writable: true,
      });

      dashboardService.getIntelligence.mockResolvedValue({
        location: { lat: 26.18, lon: 91.75, name: 'Guwahati Dispur' },
        weather: {
          temperature: 28.5,
          humidity: 72,
          windSpeed: 10.4,
          rainfall24h: 3.2,
          source: 'open-meteo',
        },
        soilMoisture: { value: 34.0 },
        aiRiskAnalysis: { riskLevel: 'LOW' },
        activeIncidents: { count: 0, incidents: [] },
        incidentHistory: { totalCount: 0, events: [] },
        fieldReports: { totalCount: 0, reports: [] },
        infrastructure: { totalCount: 0, criticalAssets: [] },
      });

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      const useLocationBtn = await screen.findByRole('button', { name: /use my location/i });
      fireEvent.click(useLocationBtn);

      await waitFor(() => {
        expect(screen.getByText('(Reset)')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('(Reset)'));

      await waitFor(() => {
        expect(screen.getByText('Northeast India Grid')).toBeTruthy();
        expect(screen.queryByText('(Reset)')).toBeNull();
      });
    });
  });

  describe('Infrastructure Priority Enhancements', () => {
    it('displays prioritized corridors with closed routes at the top', async () => {
      const mockAssets = [
        {
          _id: 'infra-active',
          name: 'NH-27 Guwahati Expressway',
          status: 'active',
          importance: 3,
          alternativeAvailable: true,
          location: { latitude: 26.14, longitude: 91.73 },
        },
        {
          _id: 'infra-closed',
          name: 'NH-10 Teesta Valley Highway',
          status: 'closed',
          importance: 5,
          alternativeAvailable: false,
          location: { latitude: 27.33, longitude: 88.60 },
        },
      ];
      infrastructureAssetService.getAllAssets.mockResolvedValueOnce(mockAssets);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('NH-10 Teesta Valley Highway')).toBeTruthy();
      });

      // Closed route must be sorted to the top
      const rows = document.querySelectorAll('.infra-priority-table tbody tr');
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('NH-10 Teesta Valley Highway');
      expect(rows[0].textContent).toContain('Critical');
      expect(rows[0].textContent).toContain('Route Closed');

      expect(rows[1].textContent).toContain('NH-27 Guwahati Expressway');
    });

    it('clicking the header arrow opens the Infrastructure Priority floating detail modal', async () => {
      const mockAssets = [
        {
          _id: 'infra-closed',
          name: 'NH-10 Teesta Valley Highway',
          status: 'closed',
          importance: 5,
          alternativeAvailable: false,
          location: { latitude: 27.3389, longitude: 88.6065 },
        },
      ];
      infrastructureAssetService.getAllAssets.mockResolvedValueOnce(mockAssets);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('NH-10 Teesta Valley Highway')).toBeTruthy();
      });

      const arrowBtn = screen.getByTitle('Inspect infrastructure routes in detail');
      fireEvent.click(arrowBtn);

      await waitFor(() => {
        expect(screen.getByText('Infrastructure Priority & Corridors')).toBeTruthy();
        expect(screen.getByText(/Priority Corridor:/)).toBeTruthy();
        expect(screen.getAllByText(/27.3389°N, 88.6065°E/).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('clicking an individual corridor in the detail modal navigates to Risk Map with corridor context', async () => {
      const mockAssets = [
        {
          _id: 'infra-corridor-1',
          name: 'NH-6 Shillong-Silchar Mountain Corridor',
          status: 'active',
          importance: 5,
          alternativeAvailable: true,
          location: { latitude: 25.5788, longitude: 91.8933 },
        },
      ];
      infrastructureAssetService.getAllAssets.mockResolvedValueOnce(mockAssets);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('NH-6 Shillong-Silchar Mountain Corridor')).toBeTruthy();
      });

      const arrowBtn = screen.getByTitle('Inspect infrastructure routes in detail');
      fireEvent.click(arrowBtn);

      await waitFor(() => {
        expect(screen.getByText('Infrastructure Priority & Corridors')).toBeTruthy();
      });

      // Find the clickable item in the modal list
      const modalItem = screen.getByTitle('Click to focus this corridor on map');
      fireEvent.click(modalItem);

      expect(mockNavigate).toHaveBeenCalledWith('/map', {
        state: {
          selectedLocation: {
            lat: 25.5788,
            lon: 91.8933,
            name: 'NH-6 Shillong-Silchar Mountain Corridor',
          },
        },
      });
    });

    it('clicking VIEW ON MAP in the detail modal navigates to Risk Map with primary corridor', async () => {
      const mockAssets = [
        {
          _id: 'infra-primary',
          name: 'Tawang-Bumla Himalayan Access Route',
          status: 'closed',
          importance: 5,
          alternativeAvailable: false,
          location: { latitude: 27.5861, longitude: 91.8679 },
        },
      ];
      infrastructureAssetService.getAllAssets.mockResolvedValueOnce(mockAssets);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Tawang-Bumla Himalayan Access Route')).toBeTruthy();
      });

      const arrowBtn = screen.getByTitle('Inspect infrastructure routes in detail');
      fireEvent.click(arrowBtn);

      await waitFor(() => {
        expect(screen.getByText('VIEW ON MAP')).toBeTruthy();
      });

      const mapBtn = screen.getByText('VIEW ON MAP');
      fireEvent.click(mapBtn);

      expect(mockNavigate).toHaveBeenCalledWith('/map', {
        state: {
          selectedLocation: {
            lat: 27.5861,
            lon: 91.8679,
            name: 'Tawang-Bumla Himalayan Access Route',
          },
        },
      });
    });

    it('prioritizes mountain landslide lifelines (Teesta Valley NH-10) over flat plain expressways (Guwahati NH-27) and navigates to mountain corridor on map', async () => {
      const mockAssets = [
        {
          _id: 'infra-guwahati',
          name: 'NH-27 Guwahati-Nagaon National Expressway',
          status: 'active',
          condition: 'good',
          importance: 5,
          alternativeAvailable: true,
          location: { latitude: 26.1445, longitude: 91.7362, name: 'Kamrup, Assam' }
        },
        {
          _id: 'infra-teesta',
          name: 'NH-10 Siliguri-Gangtok Highway (Teesta Valley)',
          status: 'active',
          condition: 'vulnerable',
          importance: 5,
          alternativeAvailable: false,
          location: { latitude: 27.3389, longitude: 88.6065, name: 'East Sikkim' }
        },
        {
          _id: 'infra-shillong',
          name: 'NH-6 Shillong-Silchar Mountain Corridor',
          status: 'active',
          condition: 'fair',
          importance: 5,
          alternativeAvailable: true,
          location: { latitude: 25.5788, longitude: 91.8933, name: 'East Khasi Hills, Meghalaya' }
        }
      ];

      infrastructureAssetService.getAllAssets.mockResolvedValueOnce(mockAssets);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Corridor Route')).toBeTruthy();
        expect(screen.getByText('Risk Level')).toBeTruthy();
        expect(screen.getByText('Transit Flow')).toBeTruthy();
      });

      // Teesta Valley and Shillong should be ranked at the top of the table
      const rows = document.querySelectorAll('.infra-row');
      expect(rows.length).toBe(3);
      expect(rows[0].textContent).toContain('NH-10 Siliguri-Gangtok Highway (Teesta Valley)');
      expect(rows[0].textContent).toContain('Slide Vulnerable');

      // Click on Critical Roads card in the 4-metrics row
      const roadsCard = screen.getByText('Critical Roads').closest('.metric-glass-card');
      fireEvent.click(roadsCard);

      await waitFor(() => {
        expect(screen.getAllByText('Critical Corridors').length).toBeGreaterThan(0);
        expect(screen.getByText('Priority Corridor:')).toBeTruthy();
        expect(document.querySelector('.modal-location-banner').textContent).toContain('NH-10 Siliguri-Gangtok Highway (Teesta Valley)');
        expect(document.querySelector('.modal-location-banner').textContent).toContain('27.3389°N, 88.6065°E');
      });

      // Click VIEW ON MAP in the modal footer
      const viewMapBtn = screen.getByText('VIEW ON MAP');
      fireEvent.click(viewMapBtn);

      expect(mockNavigate).toHaveBeenCalledWith('/map', {
        state: {
          selectedLocation: {
            lat: 27.3389,
            lon: 88.6065,
            name: 'NH-10 Siliguri-Gangtok Highway (Teesta Valley)'
          }
        }
      });
    });

    it('Recent Rainfall card is interactive, opens detail modal, and navigates to rainfall station on map', async () => {
      const mockRainfall = [
        {
          _id: 'rain-station-1',
          rainfall: 32.4,
          rainfall24h: 32.4,
          location: { latitude: 27.34, longitude: 88.61, name: 'East Sikkim Station' },
          recordedAt: new Date().toISOString()
        }
      ];

      rainfallObservationService.getAllObservations.mockResolvedValueOnce(mockRainfall);

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      // Find Recent Rainfall card in the middle metrics grid
      const rainLabel = screen.getByText('Recent Rainfall');
      const rainCard = rainLabel.closest('.metric-glass-card');
      expect(rainCard.textContent).toContain('32.4 mm');

      // Click the card to open the rainfall detail modal
      fireEvent.click(rainCard);

      await waitFor(() => {
        expect(screen.getByText('Recent Precipitation & Rainfall')).toBeTruthy();
        expect(screen.getByText('Station Location:')).toBeTruthy();
        expect(document.querySelector('.modal-location-banner').textContent).toContain('East Sikkim Station');
        expect(screen.getByText('Accumulated (24h)')).toBeTruthy();
      });

      // Click VIEW ON MAP in modal footer
      const viewMapBtn = screen.getByText('VIEW ON MAP');
      fireEvent.click(viewMapBtn);

      expect(mockNavigate).toHaveBeenCalledWith('/map', {
        state: {
          selectedLocation: {
            lat: 27.34,
            lon: 88.61,
            name: 'East Sikkim Station'
          }
        }
      });
    });

    it('Hero Card displays real accumulated rainfall instead of 0.0mm and resolves ML prediction risk level instead of Unavailable', async () => {
      const mockRainfall = [
        {
          _id: 'rain-guw-1',
          rainfall: 0.0,
          rainfall24h: 39.1,
          currentIntervalPrecipitation: 0.0,
          recordedAt: new Date().toISOString(),
          location: { latitude: 26.14, longitude: 91.73, name: 'Guwahati Station' }
        }
      ];
      rainfallObservationService.getAllObservations.mockResolvedValueOnce(mockRainfall);

      geocodingService.search.mockResolvedValueOnce([
        { id: 'guw-loc', name: 'Guwahati, Assam', lat: 26.1445, lon: 91.7362 }
      ]);
      dashboardService.getIntelligence.mockResolvedValueOnce({
        location: { lat: 26.1445, lon: 91.7362, name: 'Guwahati, Assam' },
        weather: {
          rainfall24h: 39.1,
          currentIntervalPrecipitation: 0.0,
          precipitationProbability: 29,
          temperature: 26.3,
          humidity: 98,
          windSpeed: 5.6,
          recordedAt: new Date().toISOString()
        },
        soilMoisture: { value: 35.0, recordedAt: new Date().toISOString() },
        aiRiskAnalysis: {
          riskLevel: 'Unavailable',
          reasoning: ['Elevation data available: 52 m.']
        },
        mlPrediction: {
          status: 'success',
          prediction: { riskLevel: 'low', probability: 0.186 }
        },
        activeIncidents: { count: 0, incidents: [] },
        incidentHistory: { totalCount: 0, events: [] },
        fieldReports: { totalCount: 0, reports: [] },
        infrastructure: { totalCount: 0, assets: [] }
      });

      render(
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('...')).toBeNull();
      });

      // Hero weather widget features real 39.1 mm rainfall baseline from 24h telemetry, NOT 0.0 mm
      const heroWeatherVal = document.querySelector('.hero-weather-main .hero-temp-val');
      expect(heroWeatherVal.textContent).toBe('39.1 mm');

      // Now search and select Guwahati
      const searchInput = screen.getByLabelText('Search for an area');
      fireEvent.change(searchInput, { target: { value: 'Guwahati' } });
      const searchBtn = screen.getByLabelText('Submit search');
      fireEvent.click(searchBtn);

      await waitFor(() => {
        expect(screen.getByText('Guwahati, Assam')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Guwahati, Assam'));

      await waitFor(() => {
        expect(document.querySelector('.hero-location-pill').textContent).toContain('Guwahati, Assam');
      });

      // After location intelligence loads:
      // 1. Hero weather maintains real 39.1 mm rainfall, NOT 0.0 mm
      expect(document.querySelector('.hero-weather-main .hero-temp-val').textContent).toBe('39.1 mm');

      // 2. Forecast strip resolves ML prediction 'Low' instead of displaying 'Unavailable'
      const forecastStrip = document.querySelector('.hero-forecast-strip');
      expect(forecastStrip.textContent).toContain('Recent Prediction: Low');
      expect(forecastStrip.textContent).not.toContain('Recent Prediction: Unavailable');
    });
  });
});


