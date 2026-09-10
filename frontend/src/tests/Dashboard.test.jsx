import { describe, it, expect, vi, beforeEach } from 'vitest';
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

      // 4. Nearby risk level when unavailable: disabled
      const riskCard = document.querySelector('.risk-highlight-card');
      expect(riskCard.classList.contains('disabled')).toBe(true);
      const riskArrow = riskCard.querySelector('.card-nav-arrow');
      expect(riskArrow.disabled).toBe(true);

      fireEvent.click(riskCard);
      expect(mockNavigate).not.toHaveBeenCalled();

      // 5. Infrastructure priority table arrow when 0 assets: disabled
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
        const riskTag = document.querySelector('.risk-level-tag');
        expect(riskTag.textContent).toBe('High');
      });

      const riskCard = document.querySelector('.risk-highlight-card');
      expect(riskCard.classList.contains('disabled')).toBe(false);

      fireEvent.click(riskCard);

      expect(mockNavigate).toHaveBeenCalledWith('/map', {
        state: {
          selectedLocation: {
            lat: 28.12,
            lon: 94.35,
            name: 'Active Hazard Area',
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

      // 1. Regional Monitoring Card -> /map
      const regionalCard = screen.getByText('Regional Monitoring').closest('.side-metric-card');
      fireEvent.click(regionalCard);
      expect(mockNavigate).toHaveBeenCalledWith('/map');

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

      // Card 4: Incident History renders historical slide and distance
      expect(screen.getByText('Shimla Ridge Debris Slide')).toBeTruthy();
      expect(screen.getByText('4.8 km away')).toBeTruthy();
      expect(screen.getByText('Historical records provide contextual evidence, NOT active incidents.')).toBeTruthy();

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
      expect(screen.getByText('No historical landslides found in this area')).toBeTruthy();
      expect(screen.getByText('No recorded catalog events within 50km of this location.')).toBeTruthy();
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
});
