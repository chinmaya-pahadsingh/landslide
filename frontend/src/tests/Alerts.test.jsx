import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Alerts from '../pages/Alerts';
import { notificationAPI } from '../services/api';
import React from 'react';

// Mock LanguageContext
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key) => key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

// Mock notificationAPI
vi.mock('../services/api', () => ({
  notificationAPI: {
    getAll: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  },
}));

describe('Alerts Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNotifications = [
    {
      _id: 'n1',
      title: 'Critical Landslide Warning',
      message: 'High rainfall has triggered immediate evacuation advisory.',
      severity: 'critical',
      isRead: false,
      createdAt: new Date().toISOString(),
      location: { name: 'Dima Hasao, Assam' },
      source: 'TELEMETRY'
    },
    {
      _id: 'n2',
      title: 'Moderate Watch',
      message: 'Ground saturation rising.',
      severity: 'watch',
      isRead: true,
      createdAt: new Date().toISOString(),
      location: { name: 'Shillong, Meghalaya' },
      source: 'SENSOR'
    }
  ];

  it('renders loading state initially and then shows alert items', async () => {
    notificationAPI.getAll.mockResolvedValueOnce({
      data: { data: mockNotifications }
    });

    render(<Alerts />);

    expect(screen.getByText(/Loading early warning notifications/i)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Critical Landslide Warning')).toBeTruthy();
      expect(screen.getByText('Moderate Watch')).toBeTruthy();
    });

    // Check metric totals
    expect(screen.getByText('Total Feed')).toBeTruthy();
  });

  it('renders reassuring operational empty state when there are 0 alerts', async () => {
    notificationAPI.getAll.mockResolvedValueOnce({
      data: { data: [] }
    });

    render(<Alerts />);

    await waitFor(() => {
      expect(screen.getByText('No Active Alerts')).toBeTruthy();
      expect(screen.getByText(/There are currently no active alerts in the available monitoring data/i)).toBeTruthy();
      expect(screen.getByText(/Monitoring Active/i)).toBeTruthy();
    });
  });

  it('filters by severity tab', async () => {
    notificationAPI.getAll.mockResolvedValueOnce({
      data: { data: mockNotifications }
    });

    render(<Alerts />);

    await waitFor(() => {
      expect(screen.getByText('Critical Landslide Warning')).toBeTruthy();
    });

    // Click on 'Watch' filter
    const watchTab = screen.getByRole('tab', { name: /^Watch/i });
    fireEvent.click(watchTab);

    // Should show Watch and hide Critical
    expect(screen.queryByText('Critical Landslide Warning')).toBeNull();
    expect(screen.getByText('Moderate Watch')).toBeTruthy();
  });

  it('marks a single notification as read and dispatches alertsUpdated event', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    notificationAPI.getAll.mockResolvedValueOnce({
      data: { data: mockNotifications }
    });
    notificationAPI.markAsRead.mockResolvedValueOnce({ data: { success: true } });

    render(<Alerts />);

    await waitFor(() => {
      expect(screen.getByText('Mark as read')).toBeTruthy();
    });

    const markBtn = screen.getByText('Mark as read');
    fireEvent.click(markBtn);

    await waitFor(() => {
      expect(notificationAPI.markAsRead).toHaveBeenCalledWith('n1');
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'alertsUpdated' }));
    });
  });

  it('handles error state properly', async () => {
    notificationAPI.getAll.mockRejectedValueOnce(new Error('Failed to fetch alerts'));

    render(<Alerts />);

    await waitFor(() => {
      expect(screen.getByText(/Notification Error/i)).toBeTruthy();
      expect(screen.getByText(/Failed to fetch alerts/i)).toBeTruthy();
    });
  });

  it('safely renders alerts with object source without crashing the display', async () => {
    notificationAPI.getAll.mockResolvedValueOnce({
      data: {
        data: [
          {
            _id: 'n3',
            title: 'IMD Monsoon Advisory',
            message: 'Heavy precipitation recorded across Sohra.',
            severity: 'warning',
            isRead: false,
            createdAt: new Date().toISOString(),
            location: { name: 'Cherrapunji, Meghalaya' },
            source: { type: 'early_warning_system', referenceId: 'IMD-EKH-001' }
          }
        ]
      }
    });

    render(<Alerts />);

    await waitFor(() => {
      expect(screen.getByText('IMD Monsoon Advisory')).toBeTruthy();
      expect(screen.getByText(/early warning system • IMD-EKH-001/i)).toBeTruthy();
    });
  });
});
