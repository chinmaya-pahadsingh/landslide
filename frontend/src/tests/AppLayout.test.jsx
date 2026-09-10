import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import { notificationAPI } from '../services/api';
import React from 'react';

// Mock contexts
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key) => key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('../contexts/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    openAuthModal: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'dark',
    toggleTheme: vi.fn(),
  }),
}));

// Mock child components that are heavy or tested separately
vi.mock('../components/AtmosphericBackground', () => ({
  default: () => <div data-testid="atmospheric-bg" />
}));

vi.mock('../components/GlobalSearch', () => ({
  default: () => <div data-testid="global-search" />
}));

vi.mock('../components/NotificationCenter', () => ({
  default: () => <div data-testid="notification-center" />
}));

vi.mock('../components/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher" />
}));

vi.mock('../components/AuthModal', () => ({
  default: () => <div data-testid="auth-modal" />
}));

// Mock notificationAPI
vi.mock('../services/api', () => ({
  notificationAPI: {
    getAll: vi.fn(),
  },
}));

describe('AppLayout Navigation and Alerts Badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders consolidated sidebar with single Area Intelligence link and NO duplicate Risk Map', async () => {
    notificationAPI.getAll.mockResolvedValueOnce({
      data: { data: [], meta: { unreadCount: 0 } }
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppLayout />
      </MemoryRouter>
    );

    // Single entry for map/risk: "Area Intelligence"
    expect(screen.getByText('Area Intelligence')).toBeTruthy();
    
    // There should NOT be a duplicate "Risk Map" in the navigation
    const navLinks = screen.getAllByRole('link');
    const linkTexts = navLinks.map(link => link.textContent);
    expect(linkTexts.some(t => t === 'Risk Map')).toBe(false);

    // Check logical order
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Alerts')).toBeTruthy();
    expect(screen.getByText('News')).toBeTruthy();
    expect(screen.getByText('Field Reports')).toBeTruthy();
  });

  it('does NOT render a badge when unread alerts count is 0', async () => {
    notificationAPI.getAll.mockResolvedValueOnce({
      data: { data: [], meta: { unreadCount: 0 } }
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppLayout />
      </MemoryRouter>
    );

    await waitFor(() => {
      // nav-badge should not exist
      const badges = container.querySelectorAll('.nav-badge');
      expect(badges.length).toBe(0);
    });
  });

  it('renders accurate badge when unread alerts count > 0 and updates dynamically on alertsUpdated event', async () => {
    notificationAPI.getAll.mockResolvedValueOnce({
      data: { data: [{ _id: '1' }, { _id: '2' }], meta: { unreadCount: 2 } }
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppLayout />
      </MemoryRouter>
    );

    await waitFor(() => {
      const badge = container.querySelector('.nav-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('2');
    });

    // Mock next response with 0 unread alerts when event triggers
    notificationAPI.getAll.mockResolvedValueOnce({
      data: { data: [], meta: { unreadCount: 0 } }
    });

    // Fire the custom alertsUpdated event
    act(() => {
      window.dispatchEvent(new CustomEvent('alertsUpdated'));
    });

    await waitFor(() => {
      const badge = container.querySelector('.nav-badge');
      expect(badge).toBeNull();
    });
  });
});
