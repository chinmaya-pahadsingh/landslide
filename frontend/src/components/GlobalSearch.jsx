import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, MapPin, AlertTriangle, Activity, Truck, Compass, Layout, ExternalLink } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { fieldReportService } from '../services/fieldReportService';
import { notificationAPI } from '../services/api';
import { infrastructureAssetService } from '../services/infrastructureAssetService';
import { landslideEventService } from '../services/landslideEventService';
import './GlobalSearch.css';

// In-memory cache for real application entities (60 second TTL)
let entityCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60000;

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entities, setEntities] = useState(entityCache || { reports: [], alerts: [], assets: [], events: [] });
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const { t } = useLanguage();

  // Keyboard shortcut Ctrl+K / Cmd+K to focus search input
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch real application entities safely with caching
  const loadEntities = async () => {
    const now = Date.now();
    if (entityCache && now - cacheTimestamp < CACHE_TTL_MS) {
      setEntities(entityCache);
      return;
    }

    setLoading(true);
    try {
      const [reportsRes, alertsRes, assetsRes, eventsRes] = await Promise.allSettled([
        fieldReportService.getAllReports(),
        notificationAPI.getAll({ limit: 50 }),
        infrastructureAssetService.getAllAssets(),
        landslideEventService.getAllEvents()
      ]);

      const loaded = {
        reports: reportsRes.status === 'fulfilled' && Array.isArray(reportsRes.value) ? reportsRes.value : [],
        alerts: alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value?.data?.data) ? alertsRes.value.data.data : [],
        assets: assetsRes.status === 'fulfilled' && Array.isArray(assetsRes.value) ? assetsRes.value : [],
        events: eventsRes.status === 'fulfilled' && Array.isArray(eventsRes.value) ? eventsRes.value : []
      };

      entityCache = loaded;
      cacheTimestamp = now;
      setEntities(loaded);
    } catch {
      // Retain existing state on fetch error
    } finally {
      setLoading(false);
    }
  };

  // Trigger data load when user starts typing
  useEffect(() => {
    if (query.trim().length > 0) {
      loadEntities();
      setIsOpen(true);
      setActiveIndex(-1);
    } else {
      setIsOpen(false);
    }
  }, [query]);

  // Predefined legitimate application sections
  const sections = useMemo(() => [
    { id: 'sec-dash', title: t('Dashboard'), path: '/', category: 'Sections', icon: Layout },
    { id: 'sec-map', title: t('Risk Map'), path: '/map', category: 'Sections', icon: Compass },
    { id: 'sec-ai', title: t('Area Intelligence'), path: '/area-intelligence', category: 'Sections', icon: Compass },
    { id: 'sec-alerts', title: t('Alerts'), path: '/alerts', category: 'Sections', icon: AlertTriangle },
    { id: 'sec-rep', title: t('Field Reports'), path: '/reports', category: 'Sections', icon: Activity },
    { id: 'sec-news', title: t('News'), path: '/news', category: 'Sections', icon: ExternalLink }
  ], [t]);

  // Compute matched real results without fake items
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const results = [];

    // 1. Dashboard Sections
    for (const sec of sections) {
      if (sec.title.toLowerCase().includes(q)) {
        results.push({
          id: sec.id,
          type: 'section',
          category: t('Sections'),
          title: sec.title,
          subtitle: `${t('Navigation')} • ${sec.path}`,
          targetPath: sec.path,
          hasLocation: false,
          icon: sec.icon
        });
      }
    }

    // 2. Real Alerts
    for (const alert of entities.alerts) {
      const matchTitle = (alert.title || '').toLowerCase().includes(q);
      const matchMsg = (alert.message || '').toLowerCase().includes(q);
      const matchLoc = typeof alert.location === 'string' 
        ? alert.location.toLowerCase().includes(q) 
        : (alert.location?.name || '').toLowerCase().includes(q);

      if (matchTitle || matchMsg || matchLoc) {
        const lat = alert.location?.latitude;
        const lon = alert.location?.longitude;
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

        results.push({
          id: `alert-${alert._id || alert.id}`,
          type: 'alert',
          category: t('Recent Alerts'),
          title: alert.title || t('Landslide Advisory'),
          subtitle: `${alert.severity?.toUpperCase() || 'ALERT'} • ${alert.location?.name || (typeof alert.location === 'string' ? alert.location : 'Alert Zone')}`,
          targetPath: '/alerts',
          hasLocation: hasCoords,
          location: hasCoords ? { lat, lon, name: alert.location?.name || alert.title } : null,
          icon: AlertTriangle
        });
      }
    }

    // 3. Real Field Reports
    for (const rep of entities.reports) {
      const matchDesc = (rep.description || '').toLowerCase().includes(q);
      const matchStatus = (rep.status || '').toLowerCase().includes(q);
      const matchReporter = (rep.reporterName || '').toLowerCase().includes(q);

      if (matchDesc || matchStatus || matchReporter) {
        const lat = rep.location?.latitude;
        const lon = rep.location?.longitude;
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

        results.push({
          id: `rep-${rep._id || rep.id}`,
          type: 'report',
          category: t('Recent Field Reports'),
          title: rep.description || t('Field Observation Report'),
          subtitle: `${rep.status === 'verified' ? t('Verified') : t('Pending')} • ${hasCoords ? `${lat.toFixed(2)}°, ${lon.toFixed(2)}°` : t('Field Sector')}`,
          targetPath: '/reports',
          hasLocation: hasCoords,
          location: hasCoords ? { lat, lon, name: rep.location?.name || rep.description || 'Field Report Location' } : null,
          icon: Activity
        });
      }
    }

    // 4. Real Infrastructure Assets
    for (const asset of entities.assets) {
      const matchName = (asset.name || '').toLowerCase().includes(q);
      const matchType = (asset.assetType || '').toLowerCase().includes(q);

      if (matchName || matchType) {
        const lat = asset.location?.latitude;
        const lon = asset.location?.longitude;
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

        results.push({
          id: `asset-${asset._id || asset.id}`,
          type: 'infrastructure',
          category: t('Infrastructure Priority'),
          title: asset.name,
          subtitle: `${asset.status === 'closed' ? t('Route Closed') : t('Active')} • ${asset.assetType || 'corridor'}`,
          targetPath: '/map',
          hasLocation: hasCoords,
          location: hasCoords ? { lat, lon, name: asset.name } : null,
          icon: Truck
        });
      }
    }

    // 5. Real Mapped Events
    for (const event of entities.events) {
      const matchName = (event.name || '').toLowerCase().includes(q);
      const matchLoc = (event.location?.name || '').toLowerCase().includes(q);
      const matchDesc = (event.description || '').toLowerCase().includes(q);

      if (matchName || matchLoc || matchDesc) {
        const lat = event.location?.latitude;
        const lon = event.location?.longitude;
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

        results.push({
          id: `event-${event._id || event.id}`,
          type: 'event',
          category: t('Mapped Locations'),
          title: event.name || event.location?.name || 'Landslide Event',
          subtitle: `${event.isHistorical ? 'Historical Record' : 'Active Hazard'} • ${hasCoords ? `${lat.toFixed(2)}°, ${lon.toFixed(2)}°` : ''}`,
          targetPath: '/map',
          hasLocation: hasCoords,
          location: hasCoords ? { lat, lon, name: event.name || event.location?.name } : null,
          icon: MapPin
        });
      }
    }

    // Limit to 10 most relevant results
    return results.slice(0, 10);
  }, [query, sections, entities, t]);

  const handleSelect = (item) => {
    setIsOpen(false);
    setQuery('');

    if (item.hasLocation && item.location) {
      navigate('/map', {
        state: {
          selectedLocation: {
            lat: item.location.lat,
            lon: item.location.lon,
            name: item.location.name || item.title
          }
        }
      });
    } else {
      navigate(item.targetPath);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (activeIndex >= 0 && activeIndex < searchResults.length) {
      handleSelect(searchResults[activeIndex]);
    } else if (searchResults.length > 0) {
      handleSelect(searchResults[0]);
    }
  };

  const handleKeyDown = (e) => {
    if (!isOpen || searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
    }
  };

  return (
    <div className="global-search-container" ref={containerRef}>
      <form className="header-search-form" onSubmit={handleFormSubmit}>
        <div className="header-search-capsule">
          <Search size={16} className="search-capsule-icon" />
          <input
            ref={inputRef}
            id="header-location-search"
            type="text"
            placeholder={t('Search disasters, alerts, reports... (Ctrl+K)')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (query.trim()) setIsOpen(true);
            }}
            aria-label={t('Search locations, disasters, alerts, and reports')}
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              className="search-clear-mini-btn"
              onClick={() => {
                setQuery('');
                setIsOpen(false);
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd className="search-kbd-hint">Ctrl K</kbd>
          )}
        </div>
      </form>

      {/* Global Search Dropdown Menu */}
      {isOpen && query.trim().length > 0 && (
        <div className="global-search-dropdown" role="listbox">
          {loading && (
            <div className="global-search-status text-muted">
              {t('Searching...')}
            </div>
          )}

          {!loading && searchResults.length === 0 && (
            <div className="global-search-status text-muted">
              {t('No results found')}
            </div>
          )}

          {!loading && searchResults.length > 0 && (
            <ul className="global-search-results-list">
              {searchResults.map((item, idx) => {
                const ItemIcon = item.icon || MapPin;
                const isSelected = idx === activeIndex;
                return (
                  <li
                    key={item.id}
                    role="option"
                    aria-selected={isSelected}
                    className={`global-search-result-item ${isSelected ? 'active' : ''}`}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <div className={`global-search-item-icon-wrap type-${item.type}`}>
                      <ItemIcon size={16} />
                    </div>
                    <div className="global-search-item-content">
                      <div className="global-search-item-header">
                        <span className="global-search-item-title">{item.title}</span>
                        <span className="global-search-item-badge">{item.category}</span>
                      </div>
                      <span className="global-search-item-sub">{item.subtitle}</span>
                    </div>
                    {item.hasLocation && (
                      <span className="global-search-coord-indicator" title="Opens Area Intelligence on Risk Map">
                        <Compass size={13} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
