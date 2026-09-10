import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GlobalSearch from '../components/GlobalSearch';
import { fieldReportService } from '../services/fieldReportService';
import { notificationAPI } from '../services/api';
import { infrastructureAssetService } from '../services/infrastructureAssetService';
import { landslideEventService } from '../services/landslideEventService';
import { LanguageProvider } from '../contexts/LanguageContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate
}));

vi.mock('../services/fieldReportService', () => ({
  fieldReportService: {
    getAllReports: vi.fn()
  }
}));

vi.mock('../services/api', () => ({
  notificationAPI: {
    getAll: vi.fn()
  }
}));

vi.mock('../services/infrastructureAssetService', () => ({
  infrastructureAssetService: {
    getAllAssets: vi.fn()
  }
}));

vi.mock('../services/landslideEventService', () => ({
  landslideEventService: {
    getAllEvents: vi.fn()
  }
}));

describe('GlobalSearch Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();

    fieldReportService.getAllReports.mockResolvedValue([
      {
        _id: 'rep-1',
        description: 'Mudflow near Guwahati bypass',
        status: 'verified',
        location: { latitude: 26.15, longitude: 91.70, name: 'Guwahati Bypass' }
      }
    ]);

    notificationAPI.getAll.mockResolvedValue({
      data: {
        data: [
          {
            _id: 'alert-1',
            title: 'Critical Slope Failure Alert',
            severity: 'critical',
            location: { latitude: 27.20, longitude: 92.50, name: 'Tawang Pass' }
          }
        ]
      }
    });

    infrastructureAssetService.getAllAssets.mockResolvedValue([
      {
        _id: 'infra-1',
        name: 'NH-10 Corridor Bridge',
        assetType: 'bridge',
        status: 'open',
        location: { latitude: 27.05, longitude: 88.45 }
      }
    ]);

    landslideEventService.getAllEvents.mockResolvedValue([
      {
        _id: 'event-1',
        name: 'Shillong Ridge Rockfall',
        isHistorical: false,
        location: { latitude: 25.57, longitude: 91.88, name: 'Shillong Ridge' }
      }
    ]);
  });

  it('accepts search query text and does not call APIs on empty query', () => {
    render(
      <LanguageProvider>
        <GlobalSearch />
      </LanguageProvider>
    );

    const input = screen.getByRole('textbox', { name: /search locations/i });
    expect(input).toBeTruthy();
    expect(fieldReportService.getAllReports).not.toHaveBeenCalled();

    // Type empty space
    fireEvent.change(input, { target: { value: '   ' } });
    expect(fieldReportService.getAllReports).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('displays matching real application sections and navigates on selection', async () => {
    render(
      <LanguageProvider>
        <GlobalSearch />
      </LanguageProvider>
    );

    const input = screen.getByRole('textbox', { name: /search locations/i });
    fireEvent.change(input, { target: { value: 'Alerts' } });

    const result = await screen.findByText('Alerts');
    expect(result).toBeTruthy();

    fireEvent.click(result);
    expect(mockNavigate).toHaveBeenCalledWith('/alerts');
  });

  it('displays matching real location-bearing field report and preserves coordinates for Area Intelligence', async () => {
    render(
      <LanguageProvider>
        <GlobalSearch />
      </LanguageProvider>
    );

    const input = screen.getByRole('textbox', { name: /search locations/i });
    fireEvent.change(input, { target: { value: 'Guwahati' } });

    const reportItem = await screen.findByText('Mudflow near Guwahati bypass');
    expect(reportItem).toBeTruthy();

    fireEvent.click(reportItem);

    expect(mockNavigate).toHaveBeenCalledWith('/map', {
      state: {
        selectedLocation: {
          lat: 26.15,
          lon: 91.70,
          name: 'Guwahati Bypass'
        }
      }
    });
  });

  it('displays matching real alert and navigates with coordinates', async () => {
    render(
      <LanguageProvider>
        <GlobalSearch />
      </LanguageProvider>
    );

    const input = screen.getByRole('textbox', { name: /search locations/i });
    fireEvent.change(input, { target: { value: 'Tawang' } });

    const alertItem = await screen.findByText('Critical Slope Failure Alert');
    expect(alertItem).toBeTruthy();

    fireEvent.click(alertItem);

    expect(mockNavigate).toHaveBeenCalledWith('/map', {
      state: {
        selectedLocation: {
          lat: 27.20,
          lon: 92.50,
          name: 'Tawang Pass'
        }
      }
    });
  });

  it('displays matching real infrastructure corridor and navigates with coordinates', async () => {
    render(
      <LanguageProvider>
        <GlobalSearch />
      </LanguageProvider>
    );

    const input = screen.getByRole('textbox', { name: /search locations/i });
    fireEvent.change(input, { target: { value: 'NH-10' } });

    const infraItem = await screen.findByText('NH-10 Corridor Bridge');
    expect(infraItem).toBeTruthy();

    fireEvent.click(infraItem);

    expect(mockNavigate).toHaveBeenCalledWith('/map', {
      state: {
        selectedLocation: {
          lat: 27.05,
          lon: 88.45,
          name: 'NH-10 Corridor Bridge'
        }
      }
    });
  });

  it('shows truthful "No results found" state when query matches no real entities and does not invent fake data', async () => {
    render(
      <LanguageProvider>
        <GlobalSearch />
      </LanguageProvider>
    );

    const input = screen.getByRole('textbox', { name: /search locations/i });
    fireEvent.change(input, { target: { value: 'NonExistentPlaceXYZ123' } });

    const noResult = await screen.findByText('No results found');
    expect(noResult).toBeTruthy();

    // Verify no fake results are present
    expect(screen.queryByText(/fake/i)).toBeNull();
  });
});
