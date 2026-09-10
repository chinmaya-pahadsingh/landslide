import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { landslideEventService } from '../services/landslideEventService';
import { rainfallObservationService } from '../services/rainfallObservationService';
import { soilMoistureService } from '../services/soilMoistureService';
import { notificationAPI } from '../services/api';
import { fieldReportService } from '../services/fieldReportService';
import { infrastructureAssetService } from '../services/infrastructureAssetService';
import { dashboardService } from '../services/dashboardService';
import { AreaSearch } from '../components/AreaSearch';
import { useNetwork } from '../contexts/NetworkContext';
import { useLanguage } from '../contexts/LanguageContext';
import { LoadingSpinner, ErrorState } from '../components/StatusDisplay';
import { 
  AlertTriangle, 
  CloudRain, 
  Droplets, 
  Activity, 
  Clock, 
  RefreshCw, 
  MapPin, 
  ShieldAlert, 
  Users, 
  ArrowRight,
  Wind,
  CloudSun,
  Truck,
  CheckCircle2,
  Check,
  AlertCircle,
  History,
  FileText,
  Compass
} from 'lucide-react';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  let routeLocation = { state: null };
  try {
    if (typeof useLocation === 'function') {
      const loc = useLocation();
      if (loc) routeLocation = loc;
    }
  } catch {
    routeLocation = { state: null };
  }
  const { isOnline } = useNetwork();
  const { t } = useLanguage();

  // Active Location & Geocoding State
  const [selectedLocation, setSelectedLocation] = useState(
    routeLocation.state?.selectedLocation || null
  );
  const [locationData, setLocationData] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(null);

  // Baseline System Telemetry
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(null);

  const [rainfall, setRainfall] = useState([]);
  const [rainfallLoading, setRainfallLoading] = useState(true);
  const [rainfallError, setRainfallError] = useState(null);

  const [soilMoisture, setSoilMoisture] = useState([]);
  const [soilMoistureLoading, setSoilMoistureLoading] = useState(true);
  const [soilMoistureError, setSoilMoistureError] = useState(null);

  const [infrastructureAssets, setInfrastructureAssets] = useState([]);
  const [infraLoading, setInfraLoading] = useState(true);

  const [alerts, setAlerts] = useState([]);
  const [fieldReports, setFieldReports] = useState([]);

  const [refreshing, setRefreshing] = useState(false);

  const fetchEvents = async () => {
    try {
      setEventsLoading(true);
      setEventsError(null);
      const data = await landslideEventService.getAllEvents();
      setEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      setEventsError(err.message || 'Failed to fetch landslide events');
    } finally {
      setEventsLoading(false);
    }
  };

  const fetchRainfall = async () => {
    try {
      setRainfallLoading(true);
      setRainfallError(null);
      const data = await rainfallObservationService.getAllObservations();
      setRainfall(Array.isArray(data) ? data : []);
    } catch (err) {
      setRainfallError(err.message || 'Failed to fetch rainfall observations');
    } finally {
      setRainfallLoading(false);
    }
  };

  const fetchSoilMoisture = async () => {
    try {
      setSoilMoistureLoading(true);
      setSoilMoistureError(null);
      const data = await soilMoistureService.getAllObservations();
      setSoilMoisture(Array.isArray(data) ? data : []);
    } catch (err) {
      setSoilMoistureError(err.message || 'Failed to fetch soil moisture observations');
    } finally {
      setSoilMoistureLoading(false);
    }
  };

  const fetchInfrastructure = async () => {
    try {
      setInfraLoading(true);
      const data = await infrastructureAssetService.getAllAssets().catch(() => []);
      setInfrastructureAssets(Array.isArray(data) ? data : []);
    } catch {
      setInfrastructureAssets([]);
    } finally {
      setInfraLoading(false);
    }
  };

  const fetchAlertsAndReports = async () => {
    try {
      const res = await notificationAPI.getAll({ limit: 5 }).catch(() => ({ data: { data: [] } }));
      setAlerts(res.data?.data || []);
    } catch {
      setAlerts([]);
    }

    try {
      const repData = await fieldReportService.getAllReports().catch(() => []);
      setFieldReports(Array.isArray(repData) ? repData : []);
    } catch {
      setFieldReports([]);
    }
  };

  const handleMarkAlertAsRead = async (id) => {
    if (!id) return;
    setAlerts(prev => prev.map(a => (a._id === id || a.id === id) ? { ...a, isRead: true } : a));
    window.dispatchEvent(new CustomEvent('alertsUpdated'));
    try {
      await notificationAPI.markAsRead(id);
    } catch (err) {
      console.warn('Failed to mark alert as read on server:', err);
    }
  };

  const fetchAllData = async () => {
    setRefreshing(true);
    const promises = [
      fetchEvents(), 
      fetchRainfall(), 
      fetchSoilMoisture(),
      fetchInfrastructure(),
      fetchAlertsAndReports()
    ];

    if (selectedLocation?.lat != null && selectedLocation?.lon != null) {
      promises.push(
        dashboardService.getIntelligence(selectedLocation.lat, selectedLocation.lon)
          .then(data => {
            setLocationData(data);
            setLocationError(null);
          })
          .catch(err => {
            setLocationError(err.message || 'Failed to refresh location intelligence');
          })
      );
    }

    await Promise.allSettled(promises);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Location intelligence synchronizer when selectedLocation changes
  useEffect(() => {
    if (!selectedLocation || selectedLocation.lat == null || selectedLocation.lon == null) {
      setLocationData(null);
      setLocationError(null);
      setLocationLoading(false);
      return;
    }

    const abortController = new AbortController();
    setLocationLoading(true);
    setLocationError(null);

    const loadLocationIntelligence = async () => {
      try {
        const data = await dashboardService.getIntelligence(
          selectedLocation.lat,
          selectedLocation.lon,
          abortController.signal
        );
        setLocationData(data);
      } catch (err) {
        if (err.name !== 'AbortError' && err.message !== 'AbortError') {
          setLocationError(err.message || 'Failed to fetch location intelligence');
          setLocationData(null);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLocationLoading(false);
        }
      }
    };

    loadLocationIntelligence();

    return () => {
      abortController.abort();
    };
  }, [selectedLocation?.lat, selectedLocation?.lon]);

  // Baseline incident filtering
  const activeIncidents = locationData
    ? locationData.activeIncidents.incidents
    : events.filter(e => !e.isHistorical);

  const activeCriticalIncidents = activeIncidents.filter(
    e => e.severity === 'high' || e.severity === 'critical'
  );
  const activeCriticalAlerts = alerts.filter(
    a => (a.severity === 'critical' || a.severity === 'high') && !a.isRead
  );

  // Risk evaluation: use location AI risk analysis if available, otherwise baseline
  const hasActiveRiskTelemetry = activeCriticalIncidents.length > 0 || activeCriticalAlerts.length > 0;
  
  const calculatedRiskLevel = locationData
    ? locationData.aiRiskAnalysis.riskLevel
    : (hasActiveRiskTelemetry
        ? (activeCriticalIncidents.length > 0 || activeCriticalAlerts.some(a => a.severity === 'critical') ? 'High' : 'Moderate')
        : 'Unavailable');

  const hasUsableRisk = locationData
    ? calculatedRiskLevel !== 'Unavailable'
    : hasActiveRiskTelemetry;

  // Target coordinates for risk navigation
  const riskTargetLocation = selectedLocation?.lat != null && selectedLocation?.lon != null
    ? { latitude: selectedLocation.lat, longitude: selectedLocation.lon, name: selectedLocation.name }
    : (activeCriticalIncidents.length > 0 && activeCriticalIncidents[0]?.location
        ? activeCriticalIncidents[0].location
        : (activeCriticalAlerts.length > 0 && activeCriticalAlerts[0]?.location?.latitude ? activeCriticalAlerts[0].location : null));

  // Infrastructure metrics
  const activeInfrastructure = locationData
    ? locationData.infrastructure.assets
    : infrastructureAssets;

  const closedOrCriticalRoads = activeInfrastructure.filter(
    a => a.status === 'closed' || (a.importance >= 4 && (a.assetType === 'road' || !a.assetType))
  );
  const hasCriticalRoads = activeInfrastructure.length > 0 && closedOrCriticalRoads.length > 0;
  const criticalRoadTarget = hasCriticalRoads ? closedOrCriticalRoads[0] : null;

  // Environmental observations
  const sortedRainfall = [...rainfall].sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  const latestRainfall = sortedRainfall.length > 0 ? sortedRainfall[0] : null;
  const hasRainfallLocation = Boolean(
    (selectedLocation?.lat != null && selectedLocation?.lon != null) ||
    (latestRainfall?.location?.latitude && latestRainfall?.location?.longitude)
  );

  const sortedSoilMoisture = [...soilMoisture].sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  const latestSoilMoisture = sortedSoilMoisture.length > 0 ? sortedSoilMoisture[0] : null;

  // Location-aware environmental metrics
  const displayRainfall24h = locationData
    ? (typeof locationData.weather?.rainfall24h === 'number' && !isNaN(locationData.weather.rainfall24h) ? locationData.weather.rainfall24h : null)
    : (latestRainfall && typeof latestRainfall.rainfall24h === 'number' && !isNaN(latestRainfall.rainfall24h) ? latestRainfall.rainfall24h : null);

  const displayPrecipitation = locationData
    ? (typeof locationData.weather?.currentIntervalPrecipitation === 'number' && !isNaN(locationData.weather.currentIntervalPrecipitation)
        ? locationData.weather.currentIntervalPrecipitation
        : null)
    : (latestRainfall ? latestRainfall.rainfall : null);

  const displayTemperature = locationData?.weather?.temperature != null && !isNaN(locationData.weather.temperature)
    ? locationData.weather.temperature
    : null;

  const displayHumidity = locationData?.weather?.humidity != null && !isNaN(locationData.weather.humidity)
    ? locationData.weather.humidity
    : null;

  const displayWindSpeed = locationData?.weather?.windSpeed != null && !isNaN(locationData.weather.windSpeed)
    ? locationData.weather.windSpeed
    : null;

  const displaySoilMoisture = locationData
    ? (typeof locationData.soilMoisture?.soilMoisture === 'number' && !isNaN(locationData.soilMoisture.soilMoisture)
        ? locationData.soilMoisture.soilMoisture
        : null)
    : (latestSoilMoisture ? latestSoilMoisture.soilMoisture : null);

  // Safe navigation helper that attaches real location context to Risk Map
  const navigateToMapWithLocation = (loc, nameFallback) => {
    if (!loc) return;
    const lat = loc.latitude ?? loc.lat;
    const lon = loc.longitude ?? loc.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      navigate('/map', {
        state: {
          selectedLocation: {
            lat,
            lon,
            name: loc.name || nameFallback || `Location (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`
          }
        }
      });
    }
  };

  // Staleness helper
  const isDataStale = (dateString) => {
    if (!dateString) return false;
    const diffMs = Date.now() - new Date(dateString).getTime();
    return diffMs > 24 * 60 * 60 * 1000;
  };

  const isAnyLoading = eventsLoading || rainfallLoading || soilMoistureLoading || infraLoading || locationLoading;

  return (
    <div className="dashboard-root animate-fade-in">
      {/* Top Controls & Status Bar */}
      <div className="dashboard-top-bar">
        <div className="dashboard-search-container">
          <AreaSearch 
            onLocationSelect={(loc) => setSelectedLocation(loc)} 
          />
        </div>

        <div className="dashboard-top-right">
          <div className="telemetry-status-pill">
            <span className={`status-dot-mini ${isOnline ? 'online' : 'offline'}`} />
            <span>
              {isOnline ? t('Live Command Telemetry') : t('Offline Mode • Cached Feeds')}
            </span>
          </div>

          <button 
            className="refresh-telemetry-btn" 
            onClick={fetchAllData} 
            disabled={refreshing || isAnyLoading}
            title={t('Update real-time telemetry')}
            aria-label={t('Refresh Telemetry')}
          >
            <RefreshCw size={14} className={refreshing || isAnyLoading ? "animate-spin" : ""} />
            <span>{refreshing || locationLoading ? t('Updating Feeds...') : t('Refresh Telemetry')}</span>
          </button>
        </div>
      </div>

      {locationError && (
        <div className="location-error-banner animate-fade-in" style={{ padding: '0.75rem 1rem', background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)', borderRadius: 'var(--radius-md)', color: '#f43f5e', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertCircle size={16} />
          <span>{locationError}</span>
        </div>
      )}

      {/* =========================================================================
          1. HERO MONITORING SECTION (Wide Hero Card + Stacked Right Cards)
          ========================================================================= */}
      <div className="hero-monitoring-grid">
        {/* Large Left Hero Card */}
        <div className="hero-main-card glass-panel">
          <div className="hero-card-header">
            <div 
              className="hero-location-pill" 
              title={selectedLocation ? `Active Coordinates: ${selectedLocation.lat.toFixed(4)}°, ${selectedLocation.lon.toFixed(4)}°` : t('Regional Zone')}
            >
              <MapPin size={13} className="hero-pin-icon" />
              <span>
                {selectedLocation 
                  ? `${selectedLocation.name} (${selectedLocation.lat.toFixed(2)}°, ${selectedLocation.lon.toFixed(2)}°)` 
                  : t('Northeast India')}
              </span>
            </div>
            {selectedLocation && (
              <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                {locationLoading ? t('Synchronizing telemetry...') : t('Location-aware Active')}
              </span>
            )}
          </div>

          <div className="hero-content-split">
            <div className="hero-heading-block">
              <h1 className="hero-headline">{t('Monitoring')}<br />{t('Landslide Risk')}</h1>
              <p className="hero-description">
                {t('Real-time environmental data, risk analysis and early warnings for safer communities.')}
              </p>
            </div>

            {/* Quick Weather & Telemetry Snapshot */}
            <div className="hero-telemetry-block">
              <div className="hero-weather-main">
                <div className="hero-weather-icon-wrap">
                  <CloudRain size={36} className="hero-weather-icon" />
                </div>
                <div className="hero-weather-text">
                  <span className="hero-temp-val">
                    {displayPrecipitation !== null
                      ? `${displayPrecipitation.toFixed(1)} mm`
                      : (displayRainfall24h !== null ? `${displayRainfall24h.toFixed(1)} mm` : t('Unavailable'))}
                  </span>
                  <span className="hero-temp-sub">
                    {displayPrecipitation !== null
                      ? t('Recent Precipitation')
                      : t('Precipitation Telemetry Offline')}
                  </span>
                </div>
              </div>

              <div className="hero-quick-stats">
                <div className="quick-stat-item">
                  <Activity size={15} className="quick-stat-icon" />
                  <div className="quick-stat-meta">
                    <span className="quick-stat-val">
                      {isAnyLoading ? '...' : activeIncidents.length}
                    </span>
                    <span className="quick-stat-lbl">{t('Active Incidents')}</span>
                  </div>
                </div>

                <div className="quick-stat-item">
                  <Droplets size={15} className="quick-stat-icon" />
                  <div className="quick-stat-meta">
                    <span className="quick-stat-val">
                      {displayRainfall24h !== null
                        ? `${displayRainfall24h.toFixed(1)} mm`
                        : t('Unavailable')}
                    </span>
                    <span className="quick-stat-lbl">
                      {t('Rainfall (24h)')} {latestRainfall && isDataStale(latestRainfall.recordedAt) && !locationData ? t('(Stale)') : ''}
                    </span>
                  </div>
                </div>

                <div className="quick-stat-item">
                  <Droplets size={15} className="quick-stat-icon" />
                  <div className="quick-stat-meta">
                    <span className="quick-stat-val">
                      {displaySoilMoisture !== null
                        ? `${displaySoilMoisture.toFixed(1)}%`
                        : t('Unavailable')}
                    </span>
                    <span className="quick-stat-lbl">
                      {t('Soil Saturation')} {latestSoilMoisture && isDataStale(latestSoilMoisture.recordedAt) && !locationData ? t('(Stale)') : ''}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Environmental Trend / Forecast Strip */}
          <div className="hero-forecast-strip forecast-empty-strip">
            <div className="forecast-unavailable-message">
              <CloudSun size={17} className="forecast-empty-icon" />
              <span>
                {locationData?.weather?.precipitationProbability != null
                  ? `${t('Precipitation Probability')}: ${locationData.weather.precipitationProbability}% • Open-Meteo Synced`
                  : t('Multi-day forecast telemetry unavailable • Upstream meteorological provider not connected')}
              </span>
            </div>
          </div>
        </div>

        {/* Stacked Right Column Cards */}
        <div className="hero-side-column">
          {/* Card 1: Regional Sensor Station & Telemetry */}
          <div 
            className="side-metric-card glass-panel" 
            onClick={() => {
              if (selectedLocation?.lat != null && selectedLocation?.lon != null) {
                navigateToMapWithLocation(
                  { lat: selectedLocation.lat, lon: selectedLocation.lon, name: selectedLocation.name },
                  t('Monitored Area')
                );
              } else {
                navigate('/map');
              }
            }} 
            role="button" 
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (selectedLocation?.lat != null && selectedLocation?.lon != null) {
                  navigateToMapWithLocation(
                    { lat: selectedLocation.lat, lon: selectedLocation.lon, name: selectedLocation.name },
                    t('Monitored Area')
                  );
                } else {
                  navigate('/map');
                }
              }
            }}
          >
            <div className="side-card-top">
              <div className="side-location-group">
                <MapPin size={15} className="side-pin-icon" />
                <div>
                  <h3 className="side-location-title">
                    {selectedLocation ? selectedLocation.name : t('Regional Monitoring')}
                  </h3>
                  <span className="side-location-sub">
                    {selectedLocation 
                      ? `${selectedLocation.lat.toFixed(2)}°, ${selectedLocation.lon.toFixed(2)}°` 
                      : t('Northeast India Grid')}
                  </span>
                </div>
              </div>
              <button className="card-nav-arrow" aria-label={t('View region on map')}>
                <ArrowRight size={14} />
              </button>
            </div>

            <div className="side-weather-body">
              <div className="side-big-temp">
                <span className={`temp-figure ${displayTemperature === null ? 'unavailable-val' : ''}`}>
                  {displayTemperature !== null ? `${displayTemperature.toFixed(1)}°C` : t('Unavailable')}
                </span>
                <CloudSun size={28} className={`side-weather-symbol ${displayTemperature === null ? 'text-muted' : ''}`} />
              </div>
              <span className="side-condition-text">
                {displayTemperature !== null 
                  ? (displayHumidity !== null ? `${t('Humidity')}: ${displayHumidity}%` : t('Real-time meteorological telemetry'))
                  : t('Temperature telemetry unavailable')}
              </span>
            </div>

            <div className="side-card-footer-metrics">
              <span className="mini-metric" title={t('Soil Moisture')}>
                <Droplets size={12} />
                <span>{displaySoilMoisture !== null ? `${displaySoilMoisture.toFixed(1)}%` : t('Unavailable')}</span>
              </span>
              <span className="mini-metric" title={t('Wind Speed')}>
                <Wind size={12} />
                <span>{displayWindSpeed !== null ? `${displayWindSpeed.toFixed(1)} km/h` : t('Unavailable')}</span>
              </span>
              <span className="mini-metric" title={t('Rainfall (24h)')}>
                <CloudRain size={12} />
                <span>{displayRainfall24h !== null ? `${displayRainfall24h.toFixed(1)} mm` : t('Unavailable')}</span>
              </span>
            </div>
          </div>

          {/* Card 2: Nearby Risk Level with glowing wave sparkline */}
          <div 
            className={`side-metric-card glass-panel risk-highlight-card ${!hasUsableRisk ? 'disabled' : ''}`} 
            onClick={hasUsableRisk && riskTargetLocation ? () => navigateToMapWithLocation(riskTargetLocation, t('Active Hazard Area')) : undefined} 
            role={hasUsableRisk && riskTargetLocation ? "button" : undefined} 
            tabIndex={hasUsableRisk && riskTargetLocation ? 0 : undefined}
            onKeyDown={hasUsableRisk && riskTargetLocation ? (e) => { if (e.key === 'Enter' || e.key === ' ') navigateToMapWithLocation(riskTargetLocation, t('Active Hazard Area')); } : undefined}
            title={hasUsableRisk ? t('View active risk area on map') : t('Live risk telemetry unavailable')}
          >
            <div className="side-card-top">
              <span className="side-card-label">{t('Nearby Risk Level')}</span>
              <button 
                className="card-nav-arrow" 
                aria-label={t('View risk details')}
                disabled={!hasUsableRisk}
                title={hasUsableRisk ? t('View risk details on map') : t('Live risk telemetry unavailable')}
              >
                <ArrowRight size={14} />
              </button>
            </div>

            <div className="risk-level-body">
              <div className={`risk-badge-icon ${calculatedRiskLevel.toLowerCase()}`}>
                <ShieldAlert size={22} className={`risk-status-icon ${calculatedRiskLevel.toLowerCase()}`} />
              </div>
              <div className="risk-level-details">
                <span className={`risk-level-tag ${calculatedRiskLevel.toLowerCase()}`}>
                  {t(calculatedRiskLevel)}
                </span>
                <p className="risk-level-sub">
                  {calculatedRiskLevel === 'Unavailable'
                    ? t('Live regional risk telemetry unavailable • No active hazard assessment')
                    : (locationData?.aiRiskAnalysis?.reasoning?.[0]
                        || (hasActiveRiskTelemetry
                            ? t('Increased landslide probability in surrounding areas.')
                            : t('Hazard probability within monitored baseline.')))}
                </p>
              </div>
            </div>

            {/* Glowing smooth wave sparkline */}
            <div className={`risk-wave-container ${calculatedRiskLevel === 'Unavailable' ? 'risk-wave-unavailable' : ''}`}>
              {calculatedRiskLevel === 'Unavailable' ? (
                <svg className="risk-wave-svg" viewBox="0 0 320 40" preserveAspectRatio="none">
                  <line x1="0" y1="20" x2="320" y2="20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.3" />
                </svg>
              ) : (
                <svg className="risk-wave-svg" viewBox="0 0 320 40" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="waveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0 35 Q 40 10, 80 25 T 160 15 T 240 28 T 320 18 L 320 40 L 0 40 Z"
                    fill="url(#waveGrad)"
                  />
                  <path
                    d="M0 35 Q 40 10, 80 25 T 160 15 T 240 28 T 320 18"
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="2.2"
                  />
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          2. MIDDLE 4-METRICS ROW (High Risk Areas, People at Risk, Roads, Rain)
          ========================================================================= */}
      <div className="middle-metrics-grid">
        {/* Metric 1: High Risk Areas */}
        <div 
          className={`metric-glass-card glass-panel ${!hasUsableRisk ? 'disabled' : ''}`} 
          onClick={hasUsableRisk && riskTargetLocation ? () => navigateToMapWithLocation(riskTargetLocation, t('High Risk Area')) : undefined} 
          role={hasUsableRisk && riskTargetLocation ? "button" : undefined} 
          tabIndex={hasUsableRisk && riskTargetLocation ? 0 : undefined}
          onKeyDown={hasUsableRisk && riskTargetLocation ? (e) => { if (e.key === 'Enter' || e.key === ' ') navigateToMapWithLocation(riskTargetLocation, t('High Risk Area')); } : undefined}
          title={hasUsableRisk ? t('View high risk zones on map') : t('No active risk zones identified')}
        >
          <div className="metric-card-top">
            <div className="metric-icon-wrap red-accent">
              <AlertTriangle size={18} />
            </div>
            <button 
              className="card-nav-arrow" 
              aria-label={t('View high risk areas')}
              disabled={!hasUsableRisk}
              title={hasUsableRisk ? t('View high risk zones on map') : t('No active risk zones identified')}
            >
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="metric-card-info">
            <span className="metric-label">{t('High Risk Areas')}</span>
            <div className="metric-number-row">
              <span className={`metric-main-val ${!hasUsableRisk ? 'unavailable-val' : ''}`}>
                {isAnyLoading ? '...' : (hasUsableRisk ? (locationData ? (activeCriticalIncidents.length || 1) : (activeCriticalIncidents.length + activeCriticalAlerts.length)) : t('Unavailable'))}
              </span>
            </div>
            <span className={`metric-trend-text ${hasUsableRisk ? 'red' : 'muted'}`}>
              {hasUsableRisk
                ? t(`↑ ${locationData ? (activeCriticalIncidents.length || 1) : (activeCriticalIncidents.length + activeCriticalAlerts.length)} active critical zones`)
                : t('No active risk zoning')}
            </span>
          </div>
        </div>

        {/* Metric 2: Monitored Zones */}
        <div 
          className="metric-glass-card glass-panel disabled"
          title={t('Monitored zone dataset not configured')}
        >
          <div className="metric-card-top">
            <div className="metric-icon-wrap teal-accent">
              <Users size={18} />
            </div>
            <button 
              className="card-nav-arrow" 
              aria-label={t('View monitored zones')}
              disabled
              title={t('No zone dataset configured')}
            >
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="metric-card-info">
            <span className="metric-label">{t('Monitored Zones')}</span>
            <div className="metric-number-row">
              <span className="metric-main-val unavailable-val">{t('Unavailable')}</span>
            </div>
            <span className="metric-trend-text muted">
              {t('No zone dataset configured')}
            </span>
          </div>
        </div>

        {/* Metric 3: Critical Roads */}
        <div 
          className={`metric-glass-card glass-panel ${!hasCriticalRoads ? 'disabled' : ''}`} 
          onClick={hasCriticalRoads && criticalRoadTarget?.location ? () => navigateToMapWithLocation(criticalRoadTarget.location, criticalRoadTarget.name) : undefined} 
          role={hasCriticalRoads && criticalRoadTarget?.location ? "button" : undefined} 
          tabIndex={hasCriticalRoads && criticalRoadTarget?.location ? 0 : undefined}
          onKeyDown={hasCriticalRoads && criticalRoadTarget?.location ? (e) => { if (e.key === 'Enter' || e.key === ' ') navigateToMapWithLocation(criticalRoadTarget.location, criticalRoadTarget.name); } : undefined}
          title={hasCriticalRoads ? t('View critical corridors on map') : t('No corridor telemetry available')}
        >
          <div className="metric-card-top">
            <div className="metric-icon-wrap blue-accent">
              <Truck size={18} />
            </div>
            <button 
              className="card-nav-arrow" 
              aria-label={t('View critical roads')}
              disabled={!hasCriticalRoads}
              title={hasCriticalRoads ? t('View critical corridors on map') : t('No corridor telemetry available')}
            >
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="metric-card-info">
            <span className="metric-label">{t('Critical Roads')}</span>
            <div className="metric-number-row">
              <span className={`metric-main-val ${activeInfrastructure.length === 0 ? 'unavailable-val' : ''}`}>
                {infraLoading || locationLoading ? '...' : (activeInfrastructure.length === 0 ? t('Unavailable') : closedOrCriticalRoads.length)}
              </span>
            </div>
            <span className="metric-trend-text muted">
              {infraLoading || locationLoading
                ? t('Loading corridors...')
                : (activeInfrastructure.length === 0
                  ? t('No corridor telemetry')
                  : (closedOrCriticalRoads.length > 0 ? t(`${closedOrCriticalRoads.length} affected routes`) : t('All corridors operational')))}
            </span>
          </div>
        </div>

        {/* Metric 4: Recent Rainfall */}
        <div 
          className={`metric-glass-card glass-panel ${!hasRainfallLocation ? 'disabled' : ''}`} 
          onClick={hasRainfallLocation ? () => navigateToMapWithLocation(
            selectedLocation ? { latitude: selectedLocation.lat, longitude: selectedLocation.lon, name: selectedLocation.name } : latestRainfall.location,
            displayRainfall24h !== null ? `Rainfall Station (${displayRainfall24h.toFixed(1)} mm)` : 'Rainfall Station'
          ) : undefined} 
          role={hasRainfallLocation ? "button" : undefined} 
          tabIndex={hasRainfallLocation ? 0 : undefined}
          onKeyDown={hasRainfallLocation ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              navigateToMapWithLocation(
                selectedLocation ? { latitude: selectedLocation.lat, longitude: selectedLocation.lon, name: selectedLocation.name } : latestRainfall.location,
                displayRainfall24h !== null ? `Rainfall Station (${displayRainfall24h.toFixed(1)} mm)` : 'Rainfall Station'
              );
            }
          } : undefined}
          title={hasRainfallLocation ? t('View rainfall station location on map') : t('Precipitation telemetry')}
        >
          <div className="metric-card-top">
            <div className="metric-icon-wrap rain-accent">
              <CloudRain size={18} />
            </div>
            <button 
              className="card-nav-arrow" 
              aria-label={t('View rainfall telemetry')}
              disabled={!hasRainfallLocation}
              title={hasRainfallLocation ? t('View rainfall station on map') : t('Rainfall location telemetry offline')}
            >
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="metric-card-info">
            <span className="metric-label">{t('Recent Rainfall')}</span>
            <div className="metric-number-row">
              <span className="metric-main-val">
                {rainfallLoading || locationLoading
                  ? '...'
                  : (displayRainfall24h !== null
                      ? `${displayRainfall24h.toFixed(1)} mm`
                      : t('Unavailable'))}
              </span>
            </div>
            <span className="metric-trend-text muted">
              {latestRainfall && isDataStale(latestRainfall.recordedAt) && !locationData ? t('Stale observation') : t('Last 24 hours')}
            </span>
          </div>
        </div>
      </div>

      {/* =========================================================================
          3. BOTTOM COMMAND CENTER ROW (Recent Alerts, Field Reports, Infrastructure, History)
          ========================================================================= */}
      <div className="command-bottom-grid">
        {/* Card 1: Recent Alerts */}
        <div className="command-glass-panel glass-panel">
          <div className="panel-header-row">
            <h3 className="panel-title">{t('Recent Alerts')}</h3>
            <button className="panel-arrow-btn" onClick={() => navigate('/alerts')} aria-label={t('Go to Alerts page')}>
              <ArrowRight size={15} />
            </button>
          </div>

          <div className="panel-list-content">
            {alerts && alerts.length > 0 ? (
              alerts.slice(0, 3).map((alert) => {
                const hasAlertCoords = Boolean(alert.location?.latitude && alert.location?.longitude);
                return (
                  <div 
                    key={alert._id || alert.id} 
                    className="alert-feed-item clickable"
                    onClick={() => {
                      if (hasAlertCoords) {
                        navigateToMapWithLocation(alert.location, alert.location?.name || alert.title);
                      } else {
                        navigate('/alerts');
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (hasAlertCoords) {
                          navigateToMapWithLocation(alert.location, alert.location?.name || alert.title);
                        } else {
                          navigate('/alerts');
                        }
                      }
                    }}
                    title={hasAlertCoords ? t('View alert area on map') : t('View in Early Warning Alerts')}
                  >
                    <div className={`alert-feed-icon-badge ${alert.severity || 'warning'}`}>
                      <AlertTriangle size={15} />
                    </div>
                    <div className="alert-feed-details">
                      <span className="alert-feed-title">{alert.title || t('Landslide Advisory')}</span>
                      <div className="alert-feed-sub">
                        <span className="alert-feed-location">{alert.location?.name || (typeof alert.location === 'string' ? alert.location : t('Regional Zone'))}</span>
                        <span className="bullet-sep">•</span>
                        <span className="alert-feed-time">
                          {alert.createdAt ? new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : t('Recent')}
                        </span>
                      </div>
                    </div>
                    <button
                      className={`alert-mark-read-btn ${alert.isRead ? 'read' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkAlertAsRead(alert._id || alert.id);
                      }}
                      title={alert.isRead ? t('Read') : t('Mark as read')}
                      aria-label={alert.isRead ? t('Read') : t('Mark as read')}
                      disabled={alert.isRead}
                    >
                      <Check size={13} />
                      <span>{alert.isRead ? t('Read') : t('Mark read')}</span>
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="empty-panel-notice">
                <CheckCircle2 size={24} className="empty-notice-icon" />
                <span>{t('No active alerts broadcasted')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Recent Field Reports */}
        <div className="command-glass-panel glass-panel">
          <div className="panel-header-row">
            <h3 className="panel-title">
              {t('Recent Field Reports')}
              {locationData && ` (${locationData.fieldReports.totalCount})`}
            </h3>
            <button className="panel-arrow-btn" onClick={() => navigate('/reports')} aria-label={t('Go to Field Reports page')}>
              <ArrowRight size={15} />
            </button>
          </div>

          <div className="panel-list-content">
            {(locationData ? locationData.fieldReports.reports : fieldReports) && (locationData ? locationData.fieldReports.reports : fieldReports).length > 0 ? (
              (locationData ? locationData.fieldReports.reports : fieldReports).slice(0, 3).map((rep) => {
                const hasReportCoords = Boolean(rep.location?.latitude && rep.location?.longitude);
                return (
                  <div 
                    key={rep._id || rep.id} 
                    className="report-feed-item clickable"
                    onClick={() => {
                      if (hasReportCoords) {
                        navigateToMapWithLocation(rep.location, rep.description || 'Field Report Location');
                      } else {
                        navigate('/reports');
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (hasReportCoords) {
                          navigateToMapWithLocation(rep.location, rep.description || 'Field Report Location');
                        } else {
                          navigate('/reports');
                        }
                      }
                    }}
                    title={hasReportCoords ? t('View report location on map') : t('View in Field Reports')}
                  >
                    <div className="report-feed-thumb">
                      {rep.photoUrl ? (
                        <img src={rep.photoUrl} alt={t('Report ground observation')} className="report-thumb-img" />
                      ) : (
                        <div className="report-thumb-placeholder">
                          <Activity size={16} />
                        </div>
                      )}
                    </div>
                    <div className="report-feed-details">
                      <span className="report-feed-title">{rep.description || t('Field Observation Report')}</span>
                      <div className="report-feed-sub">
                        <MapPin size={11} className="sub-pin-icon" />
                        <span className="report-feed-loc">
                          {rep.distanceKm != null
                            ? `${rep.distanceKm} km away`
                            : (rep.location?.latitude ? `${rep.location.latitude.toFixed(2)}°, ${rep.location.longitude.toFixed(2)}°` : t('Field Sector'))}
                        </span>
                      </div>
                    </div>
                    <span className={`report-status-pill ${rep.status === 'verified' ? 'verified' : 'pending'}`}>
                      {rep.status === 'verified' ? t('Verified') : t('Pending')}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="empty-panel-notice">
                <CheckCircle2 size={24} className="empty-notice-icon" />
                <span>{locationData ? t('No field reports logged in this area') : t('No field reports logged')}</span>
                <span className="empty-notice-sub">{t('Ground observation logs will appear here once submitted.')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Card 3: Infrastructure Priority */}
        <div className="command-glass-panel glass-panel">
          <div className="panel-header-row">
            <h3 className="panel-title">
              {t('Infrastructure Priority')}
              {locationData && ` (${locationData.infrastructure.totalCount})`}
            </h3>
            <button 
              className="panel-arrow-btn" 
              onClick={() => navigate('/map')} 
              disabled={activeInfrastructure.length === 0}
              aria-label={t('Inspect infrastructure routes')}
              title={activeInfrastructure.length > 0 ? t('Inspect infrastructure routes') : t('No infrastructure corridors registered')}
            >
              <ArrowRight size={15} />
            </button>
          </div>

          <div className="infra-table-wrapper">
            {infraLoading || locationLoading ? (
              <div className="empty-panel-notice">
                <span>{t('Loading infrastructure telemetry...')}</span>
              </div>
            ) : activeInfrastructure && activeInfrastructure.length > 0 ? (
              <table className="infra-priority-table">
                <tbody>
                  {activeInfrastructure.slice(0, 5).map((item) => {
                    const hasItemCoords = Boolean(item.location?.latitude && item.location?.longitude);
                    return (
                      <tr 
                        key={item._id || item.id} 
                        className={`infra-row ${hasItemCoords ? 'clickable' : ''}`}
                        onClick={hasItemCoords ? () => navigateToMapWithLocation(item.location, item.name) : undefined}
                        title={hasItemCoords ? `${item.name} ${item.distanceKm != null ? `(${item.distanceKm} km)` : ''}` : undefined}
                      >
                        <td className="infra-name-cell">
                          <span className="infra-name">{item.name}</span>
                          {item.distanceKm != null && (
                            <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', display: 'block' }}>
                              {item.distanceKm} km away
                            </span>
                          )}
                        </td>
                        <td className="infra-badge-cell">
                          <span className={`infra-badge ${item.status === 'closed' ? 'high' : (item.importance >= 4 ? 'moderate' : 'low')}`}>
                            {item.status === 'closed' ? t('Critical') : (item.importance >= 4 ? t('High') : t('Active'))}
                          </span>
                        </td>
                        <td className="infra-action-cell">
                          <span className="infra-action">
                            {item.status === 'closed' ? t('Route Closed') : (item.alternativeAvailable ? t('Detour Available') : t('Normal Flow'))}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="empty-panel-notice">
                <CheckCircle2 size={24} className="empty-notice-icon" />
                <span>{t('No infrastructure corridors registered')}</span>
                <span className="empty-notice-sub">{t('Registered roads and bridges will appear here once telemetry is added.')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Card 4: Incident History (Historical Spatial Records) */}
        <div className="command-glass-panel glass-panel">
          <div className="panel-header-row">
            <h3 className="panel-title">
              <History size={16} style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: '-2px' }} />
              {t('Incident History (50km)')}
            </h3>
            {selectedLocation && (
              <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
                {locationData ? `${locationData.incidentHistory.totalCount} ${t('records')}` : ''}
              </span>
            )}
          </div>

          <div className="panel-list-content">
            {locationData ? (
              locationData.incidentHistory.totalCount > 0 ? (
                <>
                  {locationData.incidentHistory.events.slice(0, 3).map((event, idx) => (
                    <div 
                      key={event._id || idx}
                      className="alert-feed-item clickable"
                      onClick={() => navigateToMapWithLocation(event.location, event.description || t('Historical Landslide'))}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          navigateToMapWithLocation(event.location, event.description || t('Historical Landslide'));
                        }
                      }}
                      title={t('View historical landslide location on map')}
                    >
                      <div className="alert-feed-icon-badge warning">
                        <History size={15} />
                      </div>
                      <div className="alert-feed-details">
                        <span className="alert-feed-title">
                          {event.description || event.eventType || t('Historical Landslide Event')}
                        </span>
                        <div className="alert-feed-sub">
                          <span className="alert-feed-location">
                            {event.distanceKm != null ? `${event.distanceKm} km away` : t('Recorded Site')}
                          </span>
                          <span className="bullet-sep">•</span>
                          <span className="alert-feed-time">
                            {event.eventDate ? new Date(event.eventDate).toLocaleDateString() : t('Historical')}
                          </span>
                        </div>
                      </div>
                      <span className={`report-status-pill pending`} style={{ textTransform: 'capitalize' }}>
                        {event.severity || t('Recorded')}
                      </span>
                    </div>
                  ))}
                  <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', marginTop: 'auto' }}>
                    {t('Historical records provide contextual evidence, NOT active incidents.')}
                  </span>
                </>
              ) : (
                <div className="empty-panel-notice">
                  <CheckCircle2 size={24} className="empty-notice-icon" />
                  <span>{t('No historical landslides found in this area')}</span>
                  <span className="empty-notice-sub">{t('No recorded catalog events within 50km of this location.')}</span>
                </div>
              )
            ) : (
              <div className="empty-panel-notice">
                <Compass size={24} className="empty-notice-icon text-muted" />
                <span>{t('Search a location to view incident history')}</span>
                <span className="empty-notice-sub">{t('Select any place to inspect 50km historical catalogue records.')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
