import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { 
  Home, 
  Map, 
  Activity, 
  AlertTriangle, 
  Newspaper, 
  Menu, 
  LogOut, 
  User as UserIcon, 
  Moon, 
  Sun, 
  Search, 
  BarChart2, 
  ChevronDown,
  Mountain
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import NotificationCenter from '../components/NotificationCenter';
import LanguageSwitcher from '../components/LanguageSwitcher';
import AtmosphericBackground from '../components/AtmosphericBackground';
import { useLanguage } from '../contexts/LanguageContext';
import { useNetwork } from '../contexts/NetworkContext';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import AuthModal from '../components/AuthModal';
import GlobalSearch from '../components/GlobalSearch';
import { notificationAPI } from '../services/api';
import './AppLayout.css';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadAlertsCount, setUnreadAlertsCount] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  const { t } = useLanguage();
  const { isOnline } = useNetwork();
  const { user, openAuthModal, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const fetchUnreadAlerts = useCallback(async () => {
    try {
      const res = await notificationAPI.getAll({ limit: 1 });
      const count = res.data?.meta?.unreadCount ?? 0;
      setUnreadAlertsCount(count);
    } catch {
      // Graceful fallback when offline or during initial boot
      setUnreadAlertsCount(0);
    }
  }, []);

  useEffect(() => {
    fetchUnreadAlerts();

    const handleAlertsUpdated = () => {
      fetchUnreadAlerts();
    };

    window.addEventListener('alertsUpdated', handleAlertsUpdated);
    return () => window.removeEventListener('alertsUpdated', handleAlertsUpdated);
  }, [fetchUnreadAlerts, location.pathname, user]);

  const navigation = [
    { name: t('Dashboard'), href: '/', icon: Home },
    { name: t('Area Intelligence'), href: '/map', icon: Map },
    { 
      name: t('Alerts'), 
      href: '/alerts', 
      icon: AlertTriangle, 
      badge: unreadAlertsCount > 0 ? String(unreadAlertsCount) : null 
    },
    { name: t('News'), href: '/news', icon: Newspaper },
    { name: t('Field Reports'), href: '/reports', icon: Activity },
  ];

  return (
    <div className="app-container">
      {/* Environmental Atmospheric Background */}
      <AtmosphericBackground />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="sidebar-overlay" 
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Floating Translucent Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Main Navigation">
        <div className="sidebar-header">
          <div className="brand-logo-badge">
            <Mountain className="brand-icon" size={22} />
          </div>
          <div className="brand-text">
            <h2>NER Landslide</h2>
            <span className="brand-subtitle">{t('Early Warning System')}</span>
          </div>
        </div>
        
        <nav className="sidebar-nav">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href || (item.href === '/map' && (location.pathname === '/map' || location.pathname === '/area-intelligence'));
            
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`nav-link ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={18} className="nav-icon" />
                <span className="nav-label">{item.name}</span>
                {item.badge && <span className="nav-badge">{item.badge}</span>}
                {isActive && <span className="active-glow-pill" />}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {user ? (
            <button 
              onClick={logout} 
              className="sidebar-logout-btn" 
              title="Logout from session"
            >
              <LogOut size={17} />
              <span>{t('Logout')}</span>
            </button>
          ) : (
            <button 
              onClick={openAuthModal} 
              className="sidebar-logout-btn" 
              title="Sign in"
            >
              <UserIcon size={17} />
              <span>{t('Sign In')}</span>
            </button>
          )}

          <div className="system-status-indicator">
            <span className={`status-dot-mini ${isOnline ? 'online' : 'offline'}`} />
            <span className="status-text">{isOnline ? t('Regional Node Active') : t('Offline / Cached')}</span>
          </div>
        </div>
      </aside>

      {/* Main content wrapper */}
      <div className="main-content">
        {/* Floating Capsule Header */}
        <header className="top-header">
          <div className="header-glass-wrapper">
            <div className="header-left">
              <button 
                className="mobile-menu-btn"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation menu"
              >
                <Menu size={20} />
              </button>
              
              {/* Integrated Global Search */}
              <GlobalSearch />
            </div>
            
            <div className="header-actions">
              <button 
                className="theme-toggle-btn" 
                onClick={toggleTheme}
                aria-label="Toggle theme"
                title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>

              <LanguageSwitcher />
              <NotificationCenter />
              
              {/* User Profile Pill matching reference */}
              {user ? (
                <div className="user-profile-pill" onClick={openAuthModal} role="button" tabIndex={0}>
                  <div className="user-avatar-circle">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="user-profile-meta">
                    <span className="user-profile-name">{user.name}</span>
                    <span className="user-profile-role">{user.role || 'Authority'}</span>
                  </div>
                  <ChevronDown size={14} className="user-chevron" />
                </div>
              ) : (
                <button 
                  onClick={openAuthModal} 
                  className="user-login-pill"
                >
                  <UserIcon size={14} />
                  <span>{t('Admin / Authority')}</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="page-wrapper" id="main-content">
          <Outlet />
        </main>
      </div>

      <AuthModal />
    </div>
  );
}
