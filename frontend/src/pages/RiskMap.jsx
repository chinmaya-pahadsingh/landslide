import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { landslideEventService } from '../services/landslideEventService';
import { useNetwork } from '../contexts/NetworkContext';
import { LoadingSpinner, ErrorState } from '../components/StatusDisplay';
import { AreaSearch } from '../components/AreaSearch';
import { AreaIntelligencePanel } from '../components/AreaIntelligencePanel';
import { MapUpdater } from '../components/MapUpdater';
import { MapFloatingControls } from '../components/MapFloatingControls';
import { RefreshCw, MapPin, Layers, ShieldAlert, Compass, History, Activity } from 'lucide-react';
import { preclassifyHistoricalEvents, classifyHistoricalEventDensity, HISTORICAL_COLORS } from '../utils/historicalRiskDensity';
import './RiskMap.css';

// Center on Northeast India approximately
const MAP_CENTER = [26.20, 92.93];
const DEFAULT_ZOOM = 6;

// Basemap layer options - OpenStreetMap Standard & Esri World Imagery (satellite)
const BASEMAPS = {
  osm: {
    id: 'osm',
    name: 'OpenStreetMap Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: 'abc'
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite Imagery (Esri World Imagery)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    subdomains: ['server', 'services']
  }
};

// Legitimate geographic reference & place-name label overlay for satellite basemap (Step 54D-RISK-MAP-VISUAL-FINAL)
const SATELLITE_REFERENCE_LAYER = {
  id: 'satellite-reference-labels',
  name: 'Esri World Boundaries and Places Reference',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles &copy; Esri &mdash; Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, (c) OpenStreetMap contributors, and the GIS User Community',
  subdomains: ['server', 'services']
};

// Helper to handle clicks anywhere on the Leaflet map viewport
function MapClickHandler({ onLocationSelect }) {
  useMapEvents({
    click(e) {
      // Guard against events originating from control buttons, HUD, legend, or popups
      const origEvent = e?.originalEvent;
      const target = origEvent?.target;
      if (
        target &&
        (target.closest('.map-floating-controls') ||
         target.closest('.leaflet-control') ||
         target.closest('.basemap-badge-btn') ||
         target.closest('.map-legend') ||
         target.closest('.area-intelligence-panel') ||
         target.closest('button') ||
         target.closest('a') ||
         target.closest('.leaflet-popup'))
      ) {
        return;
      }

      if (e?.latlng && onLocationSelect) {
        onLocationSelect({
          lat: e.latlng.lat,
          lon: e.latlng.lng,
          name: `Location (${e.latlng.lat.toFixed(4)}°, ${e.latlng.lng.toFixed(4)}°)`
        }, 'map_click');
      }
    }
  });
  return null;
}

// Helper to extract explicit coordinate location from URL query params (Case 6)
function getUrlLocation(search) {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search);
    const latStr = params.get('lat');
    const lonStr = params.get('lon');
    const nameStr = params.get('name');
    if (latStr !== null && lonStr !== null) {
      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return {
          lat,
          lon,
          name: nameStr || `Location (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)`,
          triggerSource: 'url'
        };
      }
    }
  } catch {}
  return null;
}

// Safely remove only selectedLocation from window.history.state, preserving all unrelated state fields
function clearRouterSelectedLocation() {
  if (typeof window === 'undefined' || !window.history?.state) return;
  try {
    const currentState = window.history.state;
    if (currentState?.usr && typeof currentState.usr === 'object' && 'selectedLocation' in currentState.usr) {
      const { selectedLocation: _omitted, ...remainingUsr } = currentState.usr;
      const nextState = {
        ...currentState,
        usr: Object.keys(remainingUsr).length > 0 ? remainingUsr : undefined
      };
      window.history.replaceState(nextState, '');
    }
  } catch {}
}

// Detect if current document was loaded via a browser reload (F5 / reload button)
function isDocumentReload() {
  if (typeof window === 'undefined' || !window.performance) return false;
  try {
    const navEntries = window.performance.getEntriesByType?.('navigation');
    if (navEntries && navEntries.length > 0) {
      return navEntries[0].type === 'reload';
    }
    return window.performance.navigation?.type === 1;
  } catch {
    return false;
  }
}

export default function RiskMap() {
  const routerLocation = useLocation();
  const navigationType = typeof useNavigationType === 'function' ? useNavigationType() : 'POP';
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Explicit URL query location takes precedence if encoded in URL (Case 6)
  const [selectedLocation, setSelectedLocation] = useState(() => {
    return getUrlLocation(routerLocation?.search);
  });
  const [showIntelligence, setShowIntelligence] = useState(() => {
    return Boolean(getUrlLocation(routerLocation?.search));
  });
  const [activeBasemap, setActiveBasemap] = useState('osm');
  const userSelectedModeRef = useRef(false);
  const [riskDataMode, setRiskDataMode] = useState(() => {
    if (routerLocation?.state?.riskDataMode) return routerLocation.state.riskDataMode;
    const params = new URLSearchParams(routerLocation?.search || '');
    if (params.get('mode') === 'current') return 'current';
    if (params.get('mode') === 'historical') return 'historical';
    return 'historical';
  });
  
  const { isOnline } = useNetwork();
  const lastConsumedLocationKeyRef = useRef(null);

  // Distinguish selection triggers: 'search', 'router', 'map_click', 'marker_click', or 'url'
  const handleLocationSelect = useCallback((location, triggerSource = 'search') => {
    if (!location) {
      setSelectedLocation(null);
      setShowIntelligence(false);
      return;
    }
    setSelectedLocation({
      ...location,
      triggerSource
    });
    setShowIntelligence(true);
  }, []);

  // Sync explicit URL query parameters if they change dynamically
  useEffect(() => {
    const urlLoc = getUrlLocation(routerLocation?.search);
    if (urlLoc) {
      handleLocationSelect(urlLoc, 'url');
    }
  }, [routerLocation?.search, handleLocationSelect]);

  // Sync selected location from intentional router navigation state (e.g. from Dashboard click)
  // Hardened logic: Distinguishes between document reload and client-side SPA router navigation
  useEffect(() => {
    if (navigationType === 'PUSH' || navigationType === 'REPLACE') {
      if (typeof window !== 'undefined') {
        window.__ner_spa_navigated__ = true;
      }
    }

    // Only treat as reload if on initial document mount before any SPA transitions,
    // Navigation Timing says 'reload', AND router action is 'POP' (not a client-side push/replace)
    const isReload = typeof window !== 'undefined' && 
      !window.__ner_spa_navigated__ && 
      isDocumentReload() && 
      navigationType === 'POP';

    if (isReload) {
      clearRouterSelectedLocation();
      if (typeof window !== 'undefined') {
        window.__ner_spa_navigated__ = true;
      }
      return;
    }

    if (routerLocation?.state?.selectedLocation) {
      const loc = routerLocation.state.selectedLocation;
      if (Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
        const key = `${loc.lat.toFixed(5)},${loc.lon.toFixed(5)},${loc.name || ''}`;
        if (lastConsumedLocationKeyRef.current !== key) {
          lastConsumedLocationKeyRef.current = key;
          handleLocationSelect(loc, 'router');
          clearRouterSelectedLocation();
        }
      }
    }

    if (typeof window !== 'undefined') {
      window.__ner_spa_navigated__ = true;
    }
  }, [routerLocation?.state, navigationType, handleLocationSelect]);

  const fetchEvents = useCallback(async (signal) => {
    try {
      setLoading(true);
      setError(null);
      const data = await landslideEventService.getAllEvents({ region: 'NER' });
      if (signal?.aborted) return;

      // Ensure data is array and filter out events without valid coordinates
      const validEvents = (Array.isArray(data) ? data : []).filter(e => {
        const lat = e?.location?.latitude;
        const lon = e?.location?.longitude;
        return (
          Number.isFinite(lat) &&
          lat >= -90 &&
          lat <= 90 &&
          Number.isFinite(lon) &&
          lon >= -180 &&
          lon <= 180
        );
      });
      setEvents(validEvents);
      if (!userSelectedModeRef.current && !routerLocation?.state?.riskDataMode) {
        const histCount = validEvents.filter(e => Boolean(e.isHistorical) && e.region !== 'HIMACHAL').length;
        const currCount = validEvents.filter(e => !e.isHistorical).length;
        if (currCount > 0) {
          setRiskDataMode('current');
        } else if (histCount > 0) {
          setRiskDataMode('historical');
        }
      }
    } catch (err) {
      if (signal?.aborted) return;
      setError(err.message || 'Failed to fetch landslide events for the map.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchEvents(controller.signal);
    return () => controller.abort();
  }, [fetchEvents]);

  const getSeverityColor = (severity, isHistorical = false) => {
    if (isHistorical) {
      return 'hsl(215, 16%, 65%)'; // unclassified / historical grey
    }
    const s = (severity || '').toLowerCase().trim();
    switch (s) {
      case 'critical':
      case 'high':
        return 'hsl(346, 87%, 43%)'; // critical red
      case 'medium':
        return 'hsl(48, 96%, 53%)'; // moderate amber
      case 'low':
        return 'hsl(142, 71%, 45%)'; // low green
      default:
        return 'hsl(215, 16%, 65%)'; // unclassified / unknown grey
    }
  };

  const getSeverityBadgeClass = (severity) => {
    const s = (severity || '').toLowerCase().trim();
    if (s === 'critical') return 'badge-crit';
    if (s === 'high') return 'badge-high';
    if (s === 'medium') return 'badge-mod';
    if (s === 'low') return 'badge-low';
    return 'badge-outline';
  };

  const toggleBasemap = useCallback(() => {
    setActiveBasemap(prev => (prev === 'osm' ? 'satellite' : 'osm'));
  }, []);

  // Strict separation of Historical and Current data (exclude any non-NER records such as Himachal)
  const historicalEvents = useMemo(() => {
    return events.filter(e => Boolean(e.isHistorical) && e.region !== 'HIMACHAL');
  }, [events]);

  const currentEvents = useMemo(() => {
    return events.filter(e => !e.isHistorical);
  }, [events]);

  // Precompute spatial concentration / density for historical records
  const classifiedHistoricalEvents = useMemo(() => {
    return preclassifyHistoricalEvents(historicalEvents);
  }, [historicalEvents]);

  // Auto-adapt if test/router provided only one category and user hasn't explicitly clicked a mode
  useEffect(() => {
    if (!userSelectedModeRef.current && !routerLocation?.state?.riskDataMode) {
      if (historicalEvents.length === 0 && currentEvents.length > 0) {
        setRiskDataMode('current');
      } else if (historicalEvents.length > 0 && currentEvents.length === 0) {
        setRiskDataMode('historical');
      }
    }
  }, [historicalEvents.length, currentEvents.length, routerLocation?.state?.riskDataMode]);

  const activeEventsCount = useMemo(() => {
    return currentEvents.length;
  }, [currentEvents]);

  const historicalEventsCount = useMemo(() => {
    return historicalEvents.length;
  }, [historicalEvents]);

  // Precompute and memoize rendered event markers based strictly on selected data mode
  const renderedMarkers = useMemo(() => {
    if (riskDataMode === 'historical') {
      // VISUAL ONLY (Step 54D-RISK-MAP-VISUAL-FINAL):
      // Only locations classified as HIGH (red), MEDIUM (yellow/amber), and LOW (green)
      // produce visible historical markers. Insufficient (< 10) records remain intact in the dataset,
      // but do NOT produce visible grey dots on the map canvas.
      const visibleHistoricalEvents = classifiedHistoricalEvents.filter(event => {
        const level = event?.historicalDensity?.level;
        return level === 'high' || level === 'medium' || level === 'low';
      });

      return visibleHistoricalEvents.map((event) => {
        const density = event.historicalDensity || {
          color: HISTORICAL_COLORS.LOW,
          label: 'Low Historical Landslide Activity',
          shortLabel: 'Low Past Activity',
          level: 'low',
          neighborCount: 10,
          meaning: 'Documented past landslide activity.'
        };
        const markerColor = density.color;
        const radius = 7;

        return (
          <CircleMarker
            key={`hist-${event._id || event.id}`}
            center={[event.location.latitude, event.location.longitude]}
            radius={radius}
            pathOptions={{
              fillColor: markerColor,
              fillOpacity: 0.85,
              color: '#ffffff',
              weight: 1.5
            }}
          >
            <Popup>
              <div className="popup-content">
                <div className="popup-header">
                  <ShieldAlert size={14} style={{ color: markerColor }} />
                  <span>Historical Landslide Event</span>
                </div>
                <div className="popup-historical-tag" style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', margin: '0.2rem 0 0.4rem 0', fontStyle: 'italic' }}>
                  {event.source === 'GSI' || event.source === 'gsi'
                    ? 'GSI NLSM NER Landslide Inventory (Historical Evidence)'
                    : (event.source?.toLowerCase().includes('nasa') || event.description?.toLowerCase().includes('nasa') || event.source === 'historical_dataset'
                        ? 'NASA Global Landslide Catalog (Historical Evidence)'
                        : `${event.source ? event.source.replace('_', ' ') : 'Historical'} Inventory (Historical Evidence)`)}
                </div>
                <div className="popup-row">
                  <span className="popup-label">Past Activity</span>
                  <span className="badge" style={{ backgroundColor: markerColor, color: '#ffffff', fontWeight: 600 }}>
                    {density.label}
                  </span>
                </div>
                <div className="popup-row">
                  <span className="popup-label">Local Concentration</span>
                  <span className="popup-value" style={{ fontSize: '0.78rem' }}>
                    {density.neighborCount} records within 10 km
                  </span>
                </div>
                {event.state && (
                  <div className="popup-row">
                    <span className="popup-label">State</span>
                    <span className="popup-value">{event.state}</span>
                  </div>
                )}
                {event.district && (
                  <div className="popup-row">
                    <span className="popup-label">District</span>
                    <span className="popup-value">{event.district}</span>
                  </div>
                )}
                <div className="popup-row">
                  <span className="popup-label">Event Date</span>
                  <span className="popup-value">
                    {event.eventDate ? new Date(event.eventDate).toLocaleDateString() : (event.reportedAt ? new Date(event.reportedAt).toLocaleDateString() : 'N/A')}
                  </span>
                </div>
                <div className="popup-row">
                  <span className="popup-label">Type</span>
                  <span className="popup-value">{event.eventType ? event.eventType.replace('_', ' ') : 'Landslide'}</span>
                </div>
                <div className="popup-row">
                  <span className="popup-label">Source</span>
                  <span className="popup-value">{event.source ? event.source.replace('_', ' ') : 'GSI NLSM'}</span>
                </div>
                <div className="popup-row">
                  <span className="popup-label">Coordinates</span>
                  <span className="popup-value mono">
                    {event.location.latitude.toFixed(4)}°, {event.location.longitude.toFixed(4)}°
                  </span>
                </div>
                {event.description && (
                  <div className="popup-description">
                    {event.description}
                  </div>
                )}
                <div style={{ marginTop: '0.4rem', fontSize: '0.68rem', color: 'hsl(var(--text-muted))', borderTop: '1px solid var(--glass-border)', paddingTop: '0.35rem', fontStyle: 'italic' }}>
                  Reflects past documented activity only — NOT a current hazard, prediction, or early warning.
                </div>
                <button
                  type="button"
                  className="map-popup-intel-btn"
                  onClick={() => handleLocationSelect({
                    lat: event.location.latitude,
                    lon: event.location.longitude,
                    name: `Historical: ${event.eventType || 'Landslide'} (${event.location.latitude.toFixed(2)}°, ${event.location.longitude.toFixed(2)}°)`
                  }, 'marker_click')}
                >
                  Analyze Area Intelligence
                </button>
              </div>
            </Popup>
          </CircleMarker>
        );
      });
    }

    // CURRENT MODE: Render strictly real active risk assessments
    return currentEvents.map((event) => {
      const rawSeverity = event.severity || event.riskLevel || event.riskAssessment?.riskLevel;
      const markerColor = getSeverityColor(rawSeverity, false);
      const radius = 8;

      return (
        <CircleMarker
          key={`curr-${event._id || event.id}`}
          center={[event.location.latitude, event.location.longitude]}
          radius={radius}
          pathOptions={{
            fillColor: markerColor,
            fillOpacity: 0.85,
            color: '#ffffff',
            weight: 2
          }}
        >
          <Popup>
            <div className="popup-content">
              <div className="popup-header">
                <ShieldAlert size={14} style={{ color: markerColor }} />
                <span>Current Risk Assessment</span>
              </div>
              <div className="popup-row">
                <span className="popup-label">Recorded</span>
                <span className="popup-value">
                  {event.eventDate ? new Date(event.eventDate).toLocaleDateString() : (event.reportedAt ? new Date(event.reportedAt).toLocaleDateString() : 'N/A')}
                </span>
              </div>
              <div className="popup-row">
                <span className="popup-label">Severity</span>
                <span className={`badge ${getSeverityBadgeClass(event.severity || event.riskLevel)}`}>
                  {event.severity || event.riskLevel || 'Unknown'}
                </span>
              </div>
              <div className="popup-row">
                <span className="popup-label">Type</span>
                <span className="popup-value">{event.eventType ? event.eventType.replace('_', ' ') : 'Unknown'}</span>
              </div>
              {event.source && (
                <div className="popup-row">
                  <span className="popup-label">Source</span>
                  <span className="popup-value">{event.source.replace('_', ' ')}</span>
                </div>
              )}
              <div className="popup-row">
                <span className="popup-label">Coordinates</span>
                <span className="popup-value mono">
                  {event.location.latitude.toFixed(4)}°, {event.location.longitude.toFixed(4)}°
                </span>
              </div>
              {event.description && (
                <div className="popup-description">
                  {event.description}
                </div>
              )}
              <button
                type="button"
                className="map-popup-intel-btn"
                onClick={() => handleLocationSelect({
                  lat: event.location.latitude,
                  lon: event.location.longitude,
                  name: event.eventType ? `${event.eventType.replace('_', ' ')} incident` : `Incident (${event.location.latitude.toFixed(2)}°, ${event.location.longitude.toFixed(2)}°)`
                }, 'marker_click')}
              >
                Analyze Area Intelligence
              </button>
            </div>
          </Popup>
        </CircleMarker>
      );
    });
  }, [riskDataMode, classifiedHistoricalEvents, currentEvents, handleLocationSelect]);

  return (
    <div className="page-container animate-fade-in risk-map-page">
      {/* Page Header */}
      <div className="risk-map-header glass-panel">
        <div className="risk-map-header-content">
          <div className="risk-map-title-group">
            <div className="risk-map-badge-row">
              <span className="location-pill">
                <Compass size={13} className="pill-icon" />
                <span>Northeast India GIS Grid</span>
              </span>
              <button
                type="button"
                className="badge badge-outline basemap-badge-btn"
                onClick={toggleBasemap}
                title={`Active: ${BASEMAPS[activeBasemap]?.name}. Click to switch basemap.`}
                aria-label={`Switch basemap. Current: ${BASEMAPS[activeBasemap]?.name}`}
                style={{ cursor: 'pointer', background: 'transparent', border: '1px solid var(--glass-border)' }}
              >
                <Layers size={12} />
                <span>{BASEMAPS[activeBasemap]?.name || 'OpenStreetMap Standard'}</span>
              </button>
              {isOnline ? (
                <span className="badge badge-low">
                  <span className="pulse-dot" />
                  <span>Telemetry Live</span>
                </span>
              ) : (
                <span className="badge badge-crit">
                  <span>Offline Mode</span>
                </span>
              )}
            </div>
            <h2 className="risk-map-title">Geospatial Hazard & Risk Map</h2>
            <p className="risk-map-subtitle text-muted">
              Spatial telemetry, active landslide incidence mapping, and multi-hazard terrain intelligence.
            </p>
          </div>

          <div className="risk-map-header-actions">
            <button 
              type="button"
              className="btn btn-outline refresh-button-unified" 
              onClick={() => fetchEvents()} 
              disabled={loading}
              title="Refresh map telemetry"
              aria-label="Refresh map telemetry"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              <span>{loading ? 'Syncing GIS...' : 'Refresh Map'}</span>
            </button>
          </div>
        </div>
      </div>
      
      {/* Map Command Workspace Frame */}
      <div className="risk-map-frame glass-panel">
        {/* Command Toolbar */}
        <div className="risk-map-toolbar">
          <div className="toolbar-search-section">
            <AreaSearch onLocationSelect={(loc) => handleLocationSelect(loc, 'search')} />
          </div>

          {/* Risk Data Layer Mode Control */}
          <div className="risk-data-mode-control" role="group" aria-label="Risk data layer mode">
            <span className="risk-mode-title">RISK DATA:</span>
            <div className="segmented-button-group">
              <button
                type="button"
                className={`segmented-btn ${riskDataMode === 'historical' ? 'active' : ''}`}
                onClick={() => {
                  userSelectedModeRef.current = true;
                  setRiskDataMode('historical');
                }}
                aria-pressed={riskDataMode === 'historical'}
                title="Past landslide activity from historical inventory"
              >
                <History size={13} />
                <span>Historical</span>
              </button>
              <button
                type="button"
                className={`segmented-btn ${riskDataMode === 'current' ? 'active' : ''}`}
                onClick={() => {
                  userSelectedModeRef.current = true;
                  setRiskDataMode('current');
                }}
                aria-pressed={riskDataMode === 'current'}
                title="Current AI risk assessment from live telemetry & ML models"
              >
                <Activity size={13} />
                <span>Current</span>
              </button>
            </div>
            <span className="mode-helper-text">
              {riskDataMode === 'historical' ? 'Past landslide activity' : 'Current AI risk assessment'}
            </span>
          </div>

          <div className="toolbar-status-pills">
            <div className="gis-metric-pill" title={riskDataMode === 'historical' ? "Total verified historical landslide catalog records" : "Total active verified risk assessment markers"}>
              <ShieldAlert size={14} className="text-muted" />
              <span className="metric-label">Mapped Incidents:</span>
              <span className="metric-val">{riskDataMode === 'historical' ? historicalEvents.length : currentEvents.length}</span>
            </div>
            {selectedLocation && (
              <div 
                className="gis-metric-pill active-location" 
                title={showIntelligence ? "Current focused coordinate" : "Click to view Area Intelligence"}
                onClick={() => setShowIntelligence(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setShowIntelligence(true);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <MapPin size={14} className="text-accent" />
                <span className="metric-val">{selectedLocation.name}</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Map Viewport Area */}
        <div className="map-wrapper">
          {loading && (
            <div className="map-overlay">
              <LoadingSpinner message="Loading geospatial risk data..." />
            </div>
          )}

          {!loading && error && (
            <div className="map-overlay error-overlay">
              <ErrorState 
                title={!isOnline ? "Offline - Map Data Unavailable" : "Map Data Error"} 
                message={!isOnline ? "Cannot fetch live mapping data while offline. Environmental map risk layers are currently unavailable." : error} 
                onRetry={() => fetchEvents()} 
              />
            </div>
          )}

          <MapContainer 
            center={MAP_CENTER} 
            zoom={DEFAULT_ZOOM} 
            className="map-container"
            preferCanvas={true}
            zoomControl={false}
            zoomAnimation={true}
            markerZoomAnimation={true}
            fadeAnimation={true}
            wheelDebounceTime={40}
            wheelPxPerZoomLevel={120}
            zoomSnap={0.5}
            zoomDelta={1}
            inertia={true}
            inertiaDeceleration={3000}
          >
            <TileLayer
              key={activeBasemap}
              attribution={BASEMAPS[activeBasemap].attribution}
              url={BASEMAPS[activeBasemap].url}
              updateWhenIdle={false}
              updateWhenZooming={true}
              keepBuffer={8}
              maxZoom={19}
              minZoom={4}
            />

            {activeBasemap === 'satellite' && (
              <TileLayer
                key="satellite-reference-labels"
                data-testid="satellite-labels-layer"
                pane="overlayPane"
                className="satellite-reference-layer"
                attribution={SATELLITE_REFERENCE_LAYER.attribution}
                url={SATELLITE_REFERENCE_LAYER.url}
                updateWhenIdle={false}
                updateWhenZooming={true}
                keepBuffer={8}
                maxZoom={19}
                minZoom={4}
                zIndex={300}
              />
            )}

            <MapFloatingControls 
              onReset={() => {}}
              onToggleBasemap={toggleBasemap}
              activeBasemap={activeBasemap}
            />
            
            <MapUpdater selectedLocation={selectedLocation} />
            <MapClickHandler onLocationSelect={handleLocationSelect} />
            
            {selectedLocation && (
              <CircleMarker
                center={[selectedLocation.lat, selectedLocation.lon]}
                radius={9}
                pathOptions={{
                  fillColor: 'hsl(217, 91%, 60%)', // Distinct Blue
                  fillOpacity: 0.9,
                  color: '#ffffff',
                  weight: 3
                }}
              >
                <Popup>
                  <div className="popup-content">
                    <div className="popup-header">
                      <MapPin size={14} />
                      <span>Searched Location</span>
                    </div>
                    <div className="popup-row">
                      <span className="popup-value bold">{selectedLocation.name}</span>
                    </div>
                    <div className="popup-row">
                      <span className="popup-label">Coordinates</span>
                      <span className="popup-value mono">
                        {selectedLocation.lat.toFixed(4)}°, {selectedLocation.lon.toFixed(4)}°
                      </span>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            )}
            
            {renderedMarkers}
          </MapContainer>

          {/* Floating Risk Legend HUD (Bottom-Left) */}
          <div className="map-legend">
            {riskDataMode === 'historical' ? (
              <>
                <div className="legend-header">
                  <span className="legend-title">Historical Activity Density</span>
                  <span className="legend-count">{historicalEvents.length} records</span>
                </div>
                <div className="legend-subtitle text-muted" style={{ fontSize: '0.72rem', marginBottom: '0.4rem' }}>
                  Past landslide activity (10km cluster concentration)
                </div>
                <div className="legend-items">
                  <div className="legend-item">
                    <span className="legend-color-dot crit" />
                    <span className="legend-label">High Historical Landslide Activity</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-color-dot mod" />
                    <span className="legend-label">Medium Historical Landslide Activity</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-color-dot low" />
                    <span className="legend-label">Low Historical Landslide Activity</span>
                  </div>
                </div>

                <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', marginTop: '0.35rem', fontStyle: 'italic' }}>
                  Only locations with sufficient historical evidence are shown.
                </div>

                <div style={{ marginTop: '0.45rem', fontSize: '0.68rem', color: 'hsl(var(--text-muted))', lineHeight: 1.35, borderTop: '1px solid var(--glass-border)', paddingTop: '0.35rem' }}>
                  Past activity only — NOT a current hazard, prediction, or early warning. Historical catalogue records provide contextual evidence and are not active hazards.
                </div>
              </>
            ) : (
              <>
                <div className="legend-header">
                  <span className="legend-title">Hazard Severity</span>
                  <span className="legend-count">{currentEvents.length} mapped</span>
                </div>
                <div className="legend-subtitle text-muted" style={{ fontSize: '0.72rem', marginBottom: '0.4rem' }}>
                  Current AI risk assessment
                </div>
                <div className="legend-items">
                  <div className="legend-item">
                    <span className="legend-color-dot crit" />
                    <span className="legend-label">High / Critical</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-color-dot mod" />
                    <span className="legend-label">Medium</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-color-dot low" />
                    <span className="legend-label">Low Risk</span>
                  </div>
                </div>

                {currentEvents.length === 0 && !loading && (
                  <div className="legend-empty-notice" style={{ marginTop: '0.45rem', fontSize: '0.74rem', color: 'hsl(var(--status-warn))', background: 'hsla(var(--status-warn), 0.1)', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid hsla(var(--status-warn), 0.2)' }}>
                    No active risk assessments available for this area.
                  </div>
                )}

                <div style={{ marginTop: '0.45rem', fontSize: '0.68rem', color: 'hsl(var(--text-muted))', lineHeight: 1.35, borderTop: '1px solid var(--glass-border)', paddingTop: '0.35rem' }}>
                  Historical catalogue records provide contextual evidence and are not active hazards.
                </div>
              </>
            )}

            {!loading && events.length === 0 && !error && (
              <div className="legend-empty-notice">
                No events currently recorded.
              </div>
            )}
          </div>
          
          {showIntelligence && selectedLocation && (
            <AreaIntelligencePanel 
              selectedLocation={selectedLocation} 
              onClose={() => setShowIntelligence(false)} 
            />
          )}
        </div>
      </div>
    </div>
  );
}
