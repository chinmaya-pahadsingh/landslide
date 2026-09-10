/**
 * Frontend Tests — News.jsx Refresh Button Public Accessibility
 *
 * Verifies that the Refresh Sources button renders as active and usable for EVERYONE:
 *   logged-out visitor → active, clickable button (RefreshCw icon)
 *   citizen            → active, clickable button (RefreshCw icon)
 *   field_team         → active, clickable button (RefreshCw icon)
 *   authority          → active, clickable button (RefreshCw icon)
 *   admin              → active, clickable button (RefreshCw icon)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import News from '../pages/News';

// Mock AuthContext — returns a configurable user
const mockUseAuth = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// Mock newsAPI — always returns empty list (we only care about button rendering)
vi.mock('../services/api', () => ({
  newsAPI: {
    getAll: vi.fn().mockResolvedValue({ data: { articles: [] } }),
    refresh: vi.fn(),
  },
}));

describe('News.jsx — Refresh Sources button public accessibility for everyone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderAndWait = async () => {
    render(<News />);
    await waitFor(() => {
      expect(screen.queryByText(/Scanning regional news feeds/i)).toBeNull();
    });
  };

  it('shows an active Refresh Sources button for LOGGED-OUT visitors', async () => {
    mockUseAuth.mockReturnValue({ user: null });
    await renderAndWait();

    const btn = screen.getByRole('button', { name: /Refresh Sources/i });
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.title).toContain('Refresh news sources');
  });

  it('shows an active Refresh Sources button for CITIZEN', async () => {
    mockUseAuth.mockReturnValue({ user: { role: 'citizen' } });
    await renderAndWait();

    const btn = screen.getByRole('button', { name: /Refresh Sources/i });
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.title).toContain('Refresh news sources');
  });

  it('shows an active Refresh Sources button for FIELD_TEAM', async () => {
    mockUseAuth.mockReturnValue({ user: { role: 'field_team' } });
    await renderAndWait();

    const btn = screen.getByRole('button', { name: /Refresh Sources/i });
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.title).toContain('Refresh news sources');
  });

  it('shows an active Refresh Sources button for AUTHORITY', async () => {
    mockUseAuth.mockReturnValue({ user: { role: 'authority' } });
    await renderAndWait();

    const btn = screen.getByRole('button', { name: /Refresh Sources/i });
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.title).toContain('Refresh news sources');
  });

  it('shows an active Refresh Sources button for ADMIN', async () => {
    mockUseAuth.mockReturnValue({ user: { role: 'admin' } });
    await renderAndWait();

    const btn = screen.getByRole('button', { name: /Refresh Sources/i });
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(btn.title).toContain('Refresh news sources');
  });

  it('automatically displays stored news on initial load without clicking refresh', async () => {
    const { newsAPI } = await import('../services/api');
    newsAPI.getAll.mockResolvedValueOnce({
      data: {
        articles: [
          {
            _id: 'stored-1',
            title: 'Stored Landslide Alert in Dima Hasao',
            summary: 'Active landslide monitoring on NH-27.',
            url: 'https://news.example.com/item-1',
            source: { name: 'NDMA', type: 'OFFICIAL' },
            disasterType: 'landslide',
            publishedAt: new Date().toISOString(),
            importance: 85
          }
        ],
        total: 1,
        cooldownRemainingMinutes: 45
      }
    });

    render(<News />);
    await waitFor(() => {
      expect(screen.getByText(/Stored Landslide Alert in Dima Hasao/i)).toBeTruthy();
    });
    expect(screen.getByText(/Active landslide monitoring on NH-27/i)).toBeTruthy();
  });

  it('shows truthful cooldown message when backend reports cached refresh', async () => {
    const { newsAPI } = await import('../services/api');
    const { fireEvent } = await import('@testing-library/react');

    newsAPI.getAll.mockResolvedValue({
      data: { articles: [], total: 0 }
    });
    newsAPI.refresh.mockResolvedValueOnce({
      data: {
        providerStatus: 'cached',
        cooldownRemainingMinutes: 38,
        message: 'News was recently refreshed. Refresh available in 38 minutes.'
      }
    });

    render(<News />);
    await waitFor(() => {
      expect(screen.queryByText(/Scanning regional news feeds/i)).toBeNull();
    });

    const btn = screen.getByRole('button', { name: /Refresh Sources/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/Refresh available in 38 minutes/i)).toBeTruthy();
    });
  });
});

