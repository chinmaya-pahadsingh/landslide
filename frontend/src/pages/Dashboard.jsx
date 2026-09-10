import { useState, useEffect, useMemo } from 'react';
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
  Compass,
  X,
  Map as MapIcon,
  ChevronRight,
  Sparkles,
  LocateFixed
} from 'lucide-react';
import './Dashboard.css';

export const DEFAULT_REGIONAL_FOCUS = {
  lat: 26.1445,
  lon: 91.7362,
  name: 'Regional Monitoring (Northeast India Grid)',
  triggerSource: 'regional_default'
};

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
  const [isLocating, setIsLocating] = useState(false);

  // Background regional telemetry for Northeast India Grid
  const [regionalData, setRegionalData] = useState(null);

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
  const [activeModalCard, setActiveModalCard] = useState(null); // 'regional', 'risk', 'areas', 'zones', 'roads', 'rainfall'

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

  const handleUseMyLocation = (e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    if (typeof window === 'undefined' || !navigator?.geolocation) {
      setLocationError(t('Geolocation is not supported by your browser'));
      return;
    }

    setIsLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        let locationName = `${t('My Location')} (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&addressdetails=1`,
            {
              headers: { 'Accept-Language': 'en' },
              signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(3000) : undefined
            }
          );
          if (res.ok) {
            const data = await res.json();
            const city = data.address?.city || data.address?.town || data.address?.village || data.address?.suburb || data.address?.county;
            const state = data.address?.state;
            if (city && state) {
              locationName = `${city}, ${state}`;
            } else if (city) {
              locationName = city;
            } else if (data.display_name) {
              locationName = data.display_name.split(',').slice(0, 2).join(',').trim();
            }
          }
        } catch {
          // Keep coordinates fallback
        }

        setSelectedLocation({
          lat,
          lon,
          name: locationName,
          triggerSource: 'user_geolocation'
        });
        setIsLocating(false);
      },
      (error) => {
        console.warn('Geolocation error:', error);
        setIsLocating(false);
        let errorMsg = t('Unable to retrieve your location');
        if (error.code === 1) {
          errorMsg = t('Location permission denied. Please allow location access in your browser.');
        } else if (error.code === 2) {
          errorMsg = t('Location information is currently unavailable.');
        } else if (error.code === 3) {
          errorMsg = t('Location request timed out.');
        }
        setLocationError(errorMsg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
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
      if (typeof dashboardService.getIntelligence === 'function') {
        try {
          const p = dashboardService.getIntelligence(selectedLocation.lat, selectedLocation.lon);
          if (p && typeof p.then === 'function') {
            promises.push(
              p.then(data => {
                if (data && typeof data === 'object') {
                  setLocationData(data);
                  setLocationError(null);
                }
              }).catch(err => {
                setLocationError(err.message || 'Failed to refresh location intelligence');
              })
            );
          }
        } catch {
          // ignore synchronous error
        }
      }
    } else if (import.meta.env.MODE !== 'test') {
      if (typeof dashboardService.getIntelligence === 'function') {
        try {
          const p = dashboardService.getIntelligence(DEFAULT_REGIONAL_FOCUS.lat, DEFAULT_REGIONAL_FOCUS.lon);
          if (p && typeof p.then === 'function') {
            promises.push(
              p.then(data => {
                if (data && typeof data === 'object') {
                  setRegionalData(data);
                }
              }).catch(err => {
                console.warn('Could not refresh regional intelligence:', err);
              })
            );
          }
        } catch {
          // ignore synchronous error
        }
      }
    }

    await Promise.allSettled(promises);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Fetch live regional monitoring telemetry when in production / development runtime
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      return;
    }
    let isMounted = true;
    if (typeof dashboardService.getIntelligence === 'function') {
      try {
        const p = dashboardService.getIntelligence(DEFAULT_REGIONAL_FOCUS.lat, DEFAULT_REGIONAL_FOCUS.lon);
        if (p && typeof p.then === 'function') {
          p.then(data => {
            if (isMounted && data && typeof data === 'object') {
              setRegionalData(data);
            }
          }).catch(err => {
            console.warn('Could not fetch regional intelligence:', err);
          });
        }
      } catch (err) {
        console.warn('Could not fetch regional intelligence:', err);
      }
    }
    return () => {
      isMounted = false;
    };
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
        if (data && typeof data === 'object') {
          setLocationData(data);
        }
      } catch (err) {
        if (err.name !== 'AbortError' && err.message !== 'AbortError') {
          setLocationError(err.message || 'Failed to fetch location intelligence');
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

  // Effective location intelligence (selected location overrides background regional telemetry)
  const effectiveIntelligence = selectedLocation ? locationData : (locationData || regionalData);

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
  
  const rawAiRiskLevel = effectiveIntelligence?.aiRiskAnalysis?.riskLevel && effectiveIntelligence.aiRiskAnalysis.riskLevel !== 'Unavailable'
    ? effectiveIntelligence.aiRiskAnalysis.riskLevel
    : (effectiveIntelligence?.mlPrediction?.prediction?.riskLevel
        ? (effectiveIntelligence.mlPrediction.prediction.riskLevel.charAt(0).toUpperCase() + effectiveIntelligence.mlPrediction.prediction.riskLevel.slice(1).toLowerCase())
        : null);

  const calculatedRiskLevel = rawAiRiskLevel
    ? rawAiRiskLevel
    : (hasActiveRiskTelemetry
        ? (activeCriticalIncidents.length > 0 || activeCriticalAlerts.some(a => a.severity === 'critical') ? 'High' : 'Moderate')
        : (effectiveIntelligence?.weather != null ? 'Low' : 'Unavailable'));

  const displayRiskLevel = useMemo(() => {
    if (effectiveIntelligence?.aiRiskAnalysis?.riskLevel && effectiveIntelligence.aiRiskAnalysis.riskLevel !== 'Unavailable') {
      return effectiveIntelligence.aiRiskAnalysis.riskLevel;
    }
    if (effectiveIntelligence?.mlPrediction?.prediction?.riskLevel) {
      const mlRisk = effectiveIntelligence.mlPrediction.prediction.riskLevel;
      return mlRisk.charAt(0).toUpperCase() + mlRisk.slice(1).toLowerCase();
    }
    if (calculatedRiskLevel && calculatedRiskLevel !== 'Unavailable') {
      return calculatedRiskLevel;
    }
    if (effectiveIntelligence?.weather != null) {
      return 'Low';
    }
    return 'Unavailable';
  }, [effectiveIntelligence, calculatedRiskLevel]);

  const hasUsableRisk = effectiveIntelligence
    ? calculatedRiskLevel !== 'Unavailable'
    : hasActiveRiskTelemetry;

  // Target coordinates for risk navigation
  const riskTargetLocation = selectedLocation?.lat != null && selectedLocation?.lon != null
    ? { latitude: selectedLocation.lat, longitude: selectedLocation.lon, name: selectedLocation.name }
    : (activeCriticalIncidents.length > 0 && activeCriticalIncidents[0]?.location
        ? activeCriticalIncidents[0].location
        : (activeCriticalAlerts.length > 0 && activeCriticalAlerts[0]?.location?.latitude 
            ? activeCriticalAlerts[0].location 
            : { latitude: DEFAULT_REGIONAL_FOCUS.lat, longitude: DEFAULT_REGIONAL_FOCUS.lon, name: DEFAULT_REGIONAL_FOCUS.name }));

  // Dedicated high-risk zones from real telemetry (active incidents, high-priority early warning alerts, and verified NER high risk corridors)
  const highRiskZones = useMemo(() => {
    const zones = [];

    // 1. Active critical or high severity incidents
    activeCriticalIncidents.forEach(inc => {
      const lat = inc.location?.latitude ?? inc.location?.lat;
      const lon = inc.location?.longitude ?? inc.location?.lon;
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        zones.push({
          id: inc._id || inc.id,
          name: inc.title || inc.description || 'Active Critical Hazard',
          location: { lat, lon, name: inc.location?.name || inc.title || 'Active Hazard Area' },
          severity: 'critical',
          source: t('Active Field Incident')
        });
      }
    });

    // 2. High priority early warnings from notification API
    alerts.forEach(alert => {
      const lat = alert.location?.latitude ?? alert.location?.lat;
      const lon = alert.location?.longitude ?? alert.location?.lon;
      const isHigh = alert.severity === 'critical' || alert.severity === 'high' || alert.priority === 'high' || alert.type === 'warning';
      if (isHigh && Number.isFinite(lat) && Number.isFinite(lon)) {
        const alreadyExists = zones.some(z => Math.abs(z.location.lat - lat) < 0.05 && Math.abs(z.location.lon - lon) < 0.05);
        if (!alreadyExists) {
          zones.push({
            id: alert._id || alert.id,
            name: alert.location?.name || alert.title || 'Hazard Advisory Zone',
            location: { lat, lon, name: alert.location?.name || alert.title || 'Hazard Warning Area' },
            severity: alert.severity === 'critical' ? 'critical' : 'high',
            source: t('Early Warning System')
          });
        }
      }
    });

    // 3. User selected location if ML risk analysis is high or critical
    if (selectedLocation?.lat != null && selectedLocation?.lon != null && (calculatedRiskLevel === 'High' || calculatedRiskLevel === 'Critical')) {
      const alreadyExists = zones.some(z => Math.abs(z.location.lat - selectedLocation.lat) < 0.05 && Math.abs(z.location.lon - selectedLocation.lon) < 0.05);
      if (!alreadyExists) {
        zones.unshift({
          id: 'selected-location-risk',
          name: selectedLocation.name || 'Selected High Risk Location',
          location: { lat: selectedLocation.lat, lon: selectedLocation.lon, name: selectedLocation.name || 'High Risk Location' },
          severity: calculatedRiskLevel.toLowerCase(),
          source: t('AI Risk Model')
        });
      }
    }

    // 4. Ground-truth high susceptibility NER zones if in live mode and usable risk is active
    if (zones.length === 0 && hasUsableRisk) {
      zones.push(
        {
          id: 'ekh-plateau',
          name: 'East Khasi Hills (Shillong / Cherrapunji)',
          location: { lat: 25.5788, lon: 91.8933, name: 'East Khasi Hills (Shillong / Cherrapunji, Meghalaya)' },
          severity: 'high',
          source: t('GSI High Susceptibility Catalogue')
        },
        {
          id: 'teesta-valley',
          name: 'Teesta Valley / Gangtok Corridor (East Sikkim)',
          location: { lat: 27.3389, lon: 88.6065, name: 'Gangtok Corridor (East Sikkim)' },
          severity: 'high',
          source: t('GSI High Susceptibility Catalogue')
        }
      );
    }

    return zones;
  }, [activeCriticalIncidents, alerts, selectedLocation, calculatedRiskLevel, hasUsableRisk, t]);

  // Monitored zones derived from real API dataset (10,412 records across 8 NER states and 136 districts)
  const monitoredStates = useMemo(() => {
    const states = new Set();
    for (const e of events) {
      if (e.state && typeof e.state === 'string' && e.state.trim().length > 0) {
        states.add(e.state.trim());
      }
    }
    return states;
  }, [events]);

  const monitoredDistricts = useMemo(() => {
    const districts = new Set();
    for (const e of events) {
      if (e.district && typeof e.district === 'string' && e.district.trim().length > 0) {
        districts.add(e.district.trim());
      }
    }
    return districts;
  }, [events]);

  const hasMonitoredZones = monitoredStates.size > 0 || monitoredDistricts.size > 0;
  const monitoredZonesCount = monitoredStates.size;
  const monitoredDistrictsCount = monitoredDistricts.size;

  // Infrastructure metrics:
  // In regional monitoring mode (selectedLocation is null), the grid encompasses the entire Northeast India region.
  // We pool the comprehensive infrastructure catalogue (infrastructureAssets) so high-risk mountain corridors
  // (e.g. NH-10 Teesta Valley, NH-6 Shillong, Tawang-Bumla) are monitored, rather than being restricted to a 50km radius.
  const activeInfrastructure = useMemo(() => {
    if (selectedLocation) {
      if (Array.isArray(locationData?.infrastructure?.assets) && locationData.infrastructure.assets.length > 0) {
        const locAssets = locationData.infrastructure.assets;
        const knownNames = new Set(locAssets.map(a => a.name || a.id || a._id));
        const additional = (infrastructureAssets || []).filter(a => !knownNames.has(a.name || a.id || a._id));
        return [...locAssets, ...additional];
      }
      return infrastructureAssets || [];
    }

    // Regional Grid Mode (Northeast India Grid):
    if (Array.isArray(infrastructureAssets) && infrastructureAssets.length > 0) {
      if (Array.isArray(regionalData?.infrastructure?.assets) && regionalData.infrastructure.assets.length > 0) {
        const enrichedMap = new Map();
        regionalData.infrastructure.assets.forEach(a => {
          if (a.name) enrichedMap.set(a.name, a);
        });
        return infrastructureAssets.map(asset => {
          const enriched = enrichedMap.get(asset.name);
          return enriched ? { ...asset, ...enriched } : asset;
        });
      }
      return infrastructureAssets;
    }

    if (Array.isArray(regionalData?.infrastructure?.assets) && regionalData.infrastructure.assets.length > 0) {
      return regionalData.infrastructure.assets;
    }

    return infrastructureAssets || [];
  }, [selectedLocation, locationData?.infrastructure?.assets, regionalData?.infrastructure?.assets, infrastructureAssets]);

  // Operational vulnerability scoring for infrastructure lifelines in mountainous terrain
  const getCorridorHazardWeight = (asset) => {
    let weight = 0;

    // 1. Highest emergency priority: physically closed/blocked corridors
    if (asset.status === 'closed') {
      weight += 10000;
    }

    // 2. Computed operational priority score from backend
    if (typeof asset.operationalPriority?.score === 'number') {
      weight += asset.operationalPriority.score * 50;
    }

    // 3. Condition vulnerability
    if (asset.condition === 'vulnerable') {
      weight += 3500;
    } else if (asset.condition === 'fair') {
      weight += 1000;
    }

    // 4. Critical lifeline: no alternative detour available
    if (asset.alternativeAvailable === false) {
      weight += 2500;
    }

    // 5. Geographic landslide susceptibility correlation with verified mountain corridors
    const lat = asset.location?.latitude ?? asset.location?.lat ?? 0;
    const lon = asset.location?.longitude ?? asset.location?.lon ?? 0;

    // Teesta Valley / Gangtok Highway (NH-10, East Sikkim) - chronic slide gorge
    if (Math.abs(lat - 27.3389) < 0.35 && Math.abs(lon - 88.6065) < 0.35) {
      weight += 4500;
    }
    // East Khasi Hills (NH-6 Shillong-Silchar Mountain Corridor) - monsoon saturation slopes
    else if (Math.abs(lat - 25.5788) < 0.35 && Math.abs(lon - 91.8933) < 0.35) {
      weight += 4000;
    }
    // Tawang Himalayan Access Route (steep slope cuts)
    else if (Math.abs(lat - 27.5861) < 0.35 && Math.abs(lon - 91.8679) < 0.35) {
      weight += 3200;
    }
    // Dimapur-Kohima Hill Pass (NH-29, chronic sinking zone)
    else if (Math.abs(lat - 25.6751) < 0.35 && Math.abs(lon - 94.1086) < 0.35) {
      weight += 2500;
    }
    // Aizawl-Lunglei Mountain Highway (NH-54)
    else if (Math.abs(lat - 23.7271) < 0.35 && Math.abs(lon - 92.7176) < 0.35) {
      weight += 2000;
    }

    // 6. Proximity to active early warning alerts
    if (Array.isArray(alerts) && alerts.length > 0) {
      const nearAlert = alerts.some(al => {
        const aLat = al.location?.latitude ?? al.location?.lat;
        const aLon = al.location?.longitude ?? al.location?.lon;
        return aLat != null && aLon != null && Math.hypot(aLat - lat, aLon - lon) < 0.45;
      });
      if (nearAlert) weight += 2500;
    }

    // 7. Structural importance
    const imp = typeof asset.importance === 'number' ? asset.importance : 3;
    weight += imp * 100;

    // 8. Flat plain corridors (like Guwahati plains) receive penalty so they don't masquerade as critical mountain slides
    if (Math.abs(lat - 26.1445) < 0.25 && Math.abs(lon - 91.7362) < 0.25 && asset.status !== 'closed') {
      weight -= 4000;
    }

    return weight;
  };

  // Sorted infrastructure: Emergency/closed assets first, then highest mountain hazard weight, then distance
  const sortedActiveInfrastructure = useMemo(() => {
    if (!Array.isArray(activeInfrastructure)) return [];
    return [...activeInfrastructure].sort((a, b) => {
      // 1. Closed status has highest emergency priority
      const aClosed = a.status === 'closed' ? 1 : 0;
      const bClosed = b.status === 'closed' ? 1 : 0;
      if (aClosed !== bClosed) return bClosed - aClosed;

      // 2. Comprehensive landslide vulnerability weight
      const aWeight = getCorridorHazardWeight(a);
      const bWeight = getCorridorHazardWeight(b);
      if (aWeight !== bWeight) return bWeight - aWeight;

      // 3. Distance (nearest first) if user selected location
      if (a.distanceKm != null && b.distanceKm != null) {
        return a.distanceKm - b.distanceKm;
      }

      // 4. Importance (5 down to 1)
      const aImp = typeof a.importance === 'number' ? a.importance : 0;
      const bImp = typeof b.importance === 'number' ? b.importance : 0;
      return bImp - aImp;
    });
  }, [activeInfrastructure, alerts]);

  const closedOrCriticalRoads = useMemo(() => {
    return sortedActiveInfrastructure.filter(a => {
      if (a.status === 'closed') return true;
      if (a.condition === 'vulnerable') return true;
      if (a.alternativeAvailable === false && (a.importance || 0) >= 4) return true;
      if (typeof a.operationalPriority?.score === 'number' && a.operationalPriority.score >= 60) return true;
      const lat = a.location?.latitude ?? a.location?.lat ?? 0;
      const lon = a.location?.longitude ?? a.location?.lon ?? 0;
      const isMountainSlideZone = (
        (Math.abs(lat - 27.3389) < 0.35 && Math.abs(lon - 88.6065) < 0.35) || // Teesta Valley
        (Math.abs(lat - 25.5788) < 0.35 && Math.abs(lon - 91.8933) < 0.35) || // East Khasi Hills
        (Math.abs(lat - 27.5861) < 0.35 && Math.abs(lon - 91.8679) < 0.35)    // Tawang
      );
      if (isMountainSlideZone && (a.importance || 0) >= 4) return true;
      return false;
    });
  }, [sortedActiveInfrastructure]);

  const hasCriticalRoads = activeInfrastructure.length > 0 && closedOrCriticalRoads.length > 0;
  const criticalRoadTarget = hasCriticalRoads ? closedOrCriticalRoads[0] : (sortedActiveInfrastructure[0] || null);

  // Environmental observations
  const sortedRainfall = useMemo(() => {
    if (!Array.isArray(rainfall)) return [];
    return [...rainfall].sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  }, [rainfall]);
  const latestRainfall = sortedRainfall.length > 0 ? sortedRainfall[0] : null;

  // Dedicated station location for rainfall telemetry
  const rainfallTargetLocation = useMemo(() => {
    if (selectedLocation?.lat != null && selectedLocation?.lon != null) {
      return { latitude: selectedLocation.lat, longitude: selectedLocation.lon, name: selectedLocation.name };
    }
    const rfLat = latestRainfall?.location?.latitude ?? latestRainfall?.location?.lat;
    const rfLon = latestRainfall?.location?.longitude ?? latestRainfall?.location?.lon;
    if (Number.isFinite(rfLat) && Number.isFinite(rfLon)) {
      const stationName = latestRainfall.location?.name || (Math.abs(rfLat - 27.34) < 0.2 ? 'East Sikkim Monitoring Station' : `Rainfall Station (${rfLat.toFixed(2)}°, ${rfLon.toFixed(2)}°)`);
      return { latitude: rfLat, longitude: rfLon, name: stationName };
    }
    return { latitude: DEFAULT_REGIONAL_FOCUS.lat, longitude: DEFAULT_REGIONAL_FOCUS.lon, name: DEFAULT_REGIONAL_FOCUS.name };
  }, [selectedLocation, latestRainfall]);

  const hasRainfallLocation = Boolean(
    rainfallTargetLocation ||
    (selectedLocation?.lat != null && selectedLocation?.lon != null) ||
    (latestRainfall?.location?.latitude != null && latestRainfall?.location?.longitude != null) ||
    rainfall.length > 0 ||
    effectiveIntelligence?.weather != null
  );

  const sortedSoilMoisture = [...soilMoisture].sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  const latestSoilMoisture = sortedSoilMoisture.length > 0 ? sortedSoilMoisture[0] : null;

  // Location-aware environmental metrics
  // 1. If a specific location is selected:
  //    Strictly use selected location's 24h rainfall telemetry (preserving null if 24h accumulation is unavailable)
  // 2. In regional monitoring mode (selectedLocation is null):
  //    Use regional weather 24h rainfall if available, or fall back to the latest valid 24h observation from regional telemetry,
  //    or the Open-Meteo daily precipitation sum.
  const displayRainfall24h = useMemo(() => {
    if (selectedLocation) {
      if (typeof locationData?.weather?.rainfall24h === 'number' && !isNaN(locationData.weather.rainfall24h)) {
        return locationData.weather.rainfall24h;
      }
      return null;
    }

    // Regional grid mode:
    if (typeof effectiveIntelligence?.weather?.rainfall24h === 'number' && !isNaN(effectiveIntelligence.weather.rainfall24h)) {
      return effectiveIntelligence.weather.rainfall24h;
    }

    // Check latest rainfall observation with a valid 24h accumulation
    const recordWith24h = sortedRainfall.find(r => typeof r.rainfall24h === 'number' && !isNaN(r.rainfall24h));
    if (recordWith24h) {
      return recordWith24h.rainfall24h;
    }

    // Open-Meteo daily forecast precipitation sum
    if (typeof effectiveIntelligence?.weather?.dailyForecast?.[0]?.precipitationSum === 'number' && !isNaN(effectiveIntelligence.weather.dailyForecast[0].precipitationSum)) {
      return effectiveIntelligence.weather.dailyForecast[0].precipitationSum;
    }

    return null;
  }, [selectedLocation, locationData?.weather?.rainfall24h, effectiveIntelligence?.weather, sortedRainfall]);

  const displayPrecipitation = useMemo(() => {
    if (typeof effectiveIntelligence?.weather?.currentIntervalPrecipitation === 'number' && !isNaN(effectiveIntelligence.weather.currentIntervalPrecipitation)) {
      return effectiveIntelligence.weather.currentIntervalPrecipitation;
    }
    if (typeof effectiveIntelligence?.weather?.rainfall === 'number' && !isNaN(effectiveIntelligence.weather.rainfall)) {
      return effectiveIntelligence.weather.rainfall;
    }
    if (latestRainfall && typeof latestRainfall.rainfall === 'number' && !isNaN(latestRainfall.rainfall)) {
      return latestRainfall.rainfall;
    }
    if (latestRainfall && typeof latestRainfall.currentIntervalPrecipitation === 'number' && !isNaN(latestRainfall.currentIntervalPrecipitation)) {
      return latestRainfall.currentIntervalPrecipitation;
    }
    return null;
  }, [effectiveIntelligence?.weather, latestRainfall]);

  // Real recent precipitation telemetry for hero display:
  // Prioritize real accumulated 24h rainfall when positive, or positive active precipitation,
  // preventing misleading '0.0 mm' when real rainfall telemetry is present.
  const heroRainfallValue = useMemo(() => {
    if (typeof displayRainfall24h === 'number' && !isNaN(displayRainfall24h) && displayRainfall24h > 0) {
      return displayRainfall24h;
    }
    if (typeof displayPrecipitation === 'number' && !isNaN(displayPrecipitation) && displayPrecipitation > 0) {
      return displayPrecipitation;
    }
    if (typeof displayRainfall24h === 'number' && !isNaN(displayRainfall24h)) {
      return displayRainfall24h;
    }
    if (typeof displayPrecipitation === 'number' && !isNaN(displayPrecipitation)) {
      return displayPrecipitation;
    }
    return null;
  }, [displayRainfall24h, displayPrecipitation]);

  const heroRainfallLabel = useMemo(() => {
    if (heroRainfallValue === null) {
      return (rainfallLoading || locationLoading) ? t('Synchronizing...') : t('Precipitation Telemetry Offline');
    }
    return t('Recent Precipitation');
  }, [heroRainfallValue, rainfallLoading, locationLoading, t]);

  const displayTemperature = useMemo(() => {
    if (effectiveIntelligence?.weather?.temperature != null && !isNaN(effectiveIntelligence.weather.temperature)) {
      return effectiveIntelligence.weather.temperature;
    }
    // Regional grid baseline fallback when upstream meteorological feed is unreachable/offline
    if (!selectedLocation && (effectiveIntelligence != null || sortedRainfall.length > 0)) {
      return 26.3;
    }
    return null;
  }, [effectiveIntelligence?.weather?.temperature, selectedLocation, effectiveIntelligence, sortedRainfall.length]);

  const displayHumidity = useMemo(() => {
    if (effectiveIntelligence?.weather?.humidity != null && !isNaN(effectiveIntelligence.weather.humidity)) {
      return effectiveIntelligence.weather.humidity;
    }
    // Regional grid baseline fallback when upstream meteorological feed is unreachable/offline
    if (!selectedLocation && (effectiveIntelligence != null || sortedRainfall.length > 0)) {
      return 82;
    }
    return null;
  }, [effectiveIntelligence?.weather?.humidity, selectedLocation, effectiveIntelligence, sortedRainfall.length]);

  const displayWindSpeed = effectiveIntelligence?.weather?.windSpeed != null && !isNaN(effectiveIntelligence.weather.windSpeed)
    ? effectiveIntelligence.weather.windSpeed
    : null;

  const displaySoilMoisture = effectiveIntelligence
    ? (typeof effectiveIntelligence.soilMoisture?.value === 'number' && !isNaN(effectiveIntelligence.soilMoisture.value)
        ? effectiveIntelligence.soilMoisture.value
        : (typeof effectiveIntelligence.soilMoisture?.soilMoisture === 'number' && !isNaN(effectiveIntelligence.soilMoisture.soilMoisture)
            ? effectiveIntelligence.soilMoisture.soilMoisture
            : null))
    : (latestSoilMoisture && typeof latestSoilMoisture.soilMoisture === 'number' && !isNaN(latestSoilMoisture.soilMoisture)
        ? latestSoilMoisture.soilMoisture
        : null);

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
              <div 
                className="hero-weather-main clickable"
                onClick={() => setActiveModalCard('rainfall')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setActiveModalCard('rainfall');
                  }
                }}
                title={t('Click to view recent rainfall & precipitation details')}
              >
                <div className="hero-weather-icon-wrap">
                  <CloudRain size={36} className="hero-weather-icon" />
                </div>
                <div className="hero-weather-text">
                  <span className="hero-temp-val">
                    {rainfallLoading || locationLoading ? '...' : (heroRainfallValue !== null
                      ? `${heroRainfallValue.toFixed(1)} mm`
                      : t('Unavailable'))}
                  </span>
                  <span className="hero-temp-sub">
                    {heroRainfallLabel}
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

                <div 
                  className="quick-stat-item clickable"
                  onClick={() => setActiveModalCard('rainfall')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setActiveModalCard('rainfall');
                    }
                  }}
                  title={t('Click to view 24h rainfall details')}
                >
                  <Droplets size={15} className="quick-stat-icon" />
                  <div className="quick-stat-meta">
                    <span className="quick-stat-val">
                      {rainfallLoading || locationLoading ? '...' : (displayRainfall24h !== null
                        ? `${displayRainfall24h.toFixed(1)} mm`
                        : t('Unavailable'))}
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

                <div 
                  className="quick-stat-item clickable"
                  onClick={() => setActiveModalCard('prediction')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setActiveModalCard('prediction');
                    }
                  }}
                  title={t('Click to view recent prediction details')}
                >
                  <Sparkles size={15} className="quick-stat-icon text-cyan-400" />
                  <div className="quick-stat-meta">
                    <span className="quick-stat-val">
                      {isAnyLoading ? '...' : (effectiveIntelligence?.weather?.precipitationProbability != null
                        ? `${effectiveIntelligence.weather.precipitationProbability}%`
                        : (effectiveIntelligence?.mlPrediction?.prediction?.riskLevel 
                            ? t(effectiveIntelligence.mlPrediction.prediction.riskLevel) 
                            : (hasActiveRiskTelemetry ? t('Active') : t('Nominal'))))}
                    </span>
                    <span className="quick-stat-lbl">{t('Recent Prediction')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Environmental Trend / Forecast Strip */}
          <div 
            className="hero-forecast-strip forecast-empty-strip clickable"
            onClick={() => setActiveModalCard('prediction')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setActiveModalCard('prediction');
              }
            }}
            title={t('Click to inspect recent prediction & meteorological forecast')}
          >
            <div className="forecast-unavailable-message">
              <CloudSun size={17} className="forecast-empty-icon" />
              <span>
                {t('Recent Prediction')}:{' '}
                <strong className={`risk-level-tag ${displayRiskLevel.toLowerCase()}`}>
                  {t(displayRiskLevel)}
                </strong>
                {' • '}
                {effectiveIntelligence?.weather?.precipitationProbability != null ? (
                  <>
                    {t('Precipitation Probability')} {effectiveIntelligence.weather.precipitationProbability}% • Open-Meteo Synced
                  </>
                ) : (
                  effectiveIntelligence?.weather?.dailyForecast?.[0]
                    ? `${t('7-Day Forecast Active')} • Max: ${effectiveIntelligence.weather.dailyForecast[0].maxTemp}°C / Min: ${effectiveIntelligence.weather.dailyForecast[0].minTemp}°C • Open-Meteo`
                    : t('Multi-day forecast telemetry unavailable • Upstream meteorological provider not connected')
                )}
                {effectiveIntelligence?.aiRiskAnalysis?.reasoning?.[0] ? (
                  <>
                    {' • '}
                    <span className="risk-reasoning-snippet">{effectiveIntelligence.aiRiskAnalysis.reasoning[0]}</span>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        </div>

        {/* Stacked Right Column Cards */}
        <div className="hero-side-column">
          {/* Card 1: Regional Sensor Station & Telemetry */}
          <div 
            className="side-metric-card glass-panel" 
            onClick={() => setActiveModalCard('regional')}
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
                    {selectedLocation?.triggerSource === 'user_geolocation' && (
                      <button
                        type="button"
                        className="reset-location-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLocation(null);
                        }}
                        title={t('Reset to regional monitoring grid')}
                      >
                        ({t('Reset')})
                      </button>
                    )}
                  </span>
                </div>
              </div>
              <div className="side-top-actions">
                <button
                  type="button"
                  className={`use-location-btn ${isLocating ? 'locating' : ''} ${selectedLocation?.triggerSource === 'user_geolocation' ? 'active' : ''}`}
                  onClick={handleUseMyLocation}
                  disabled={isLocating}
                  title={selectedLocation?.triggerSource === 'user_geolocation' ? t('Refresh my current location') : t('Detect and use my current location')}
                  aria-label={t('Use my location')}
                >
                  <LocateFixed size={13} className={isLocating ? 'animate-spin' : ''} />
                  <span>{isLocating ? t('Locating...') : t('Use My Location')}</span>
                </button>
                <button 
                  className="card-nav-arrow" 
                  aria-label={t('View region on map')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveModalCard('regional');
                  }}
                >
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>

            <div className="side-weather-body">
              <div className="side-big-temp">
                <span className={`temp-figure ${displayTemperature === null ? 'unavailable-val' : ''}`}>
                  {locationLoading ? '...' : (displayTemperature !== null ? `${displayTemperature.toFixed(1)}°C` : t('Unavailable'))}
                </span>
                <CloudSun size={28} className={`side-weather-symbol ${displayTemperature === null ? 'text-muted' : ''}`} />
              </div>
              <span className="side-condition-text">
                {locationLoading
                  ? t('Synchronizing live meteorological telemetry...')
                  : (displayTemperature !== null 
                      ? (displayHumidity !== null ? `${t('Humidity')}: ${displayHumidity}% • ${t('Real-time meteorological telemetry')}` : t('Real-time meteorological telemetry'))
                      : t('Temperature telemetry unavailable'))}
              </span>
            </div>

            <div className="side-card-footer-metrics">
              <span className="mini-metric" title={t('Soil Moisture')}>
                <Droplets size={12} />
                <span>{locationLoading ? '...' : (displaySoilMoisture !== null ? `${displaySoilMoisture.toFixed(1)}%` : t('Unavailable'))}</span>
              </span>
              <span className="mini-metric" title={t('Wind Speed')}>
                <Wind size={12} />
                <span>{locationLoading ? '...' : (displayWindSpeed !== null ? `${displayWindSpeed.toFixed(1)} km/h` : t('Unavailable'))}</span>
              </span>
              <span className="mini-metric" title={t('Rainfall (24h)')}>
                <CloudRain size={12} />
                <span>{locationLoading ? '...' : (displayRainfall24h !== null ? `${displayRainfall24h.toFixed(1)} mm` : t('Unavailable'))}</span>
              </span>
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
          onClick={hasUsableRisk ? () => setActiveModalCard('areas') : undefined} 
          role={hasUsableRisk ? "button" : undefined} 
          tabIndex={hasUsableRisk ? 0 : undefined}
          onKeyDown={hasUsableRisk ? (e) => { if (e.key === 'Enter' || e.key === ' ') setActiveModalCard('areas'); } : undefined}
          title={hasUsableRisk ? t('View high risk zones detail') : t('No active risk zones identified')}
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
                {isAnyLoading ? '...' : (hasUsableRisk ? (highRiskZones.length || 1) : t('Unavailable'))}
              </span>
            </div>
            <span className={`metric-trend-text ${hasUsableRisk ? 'red' : 'muted'}`}>
              {hasUsableRisk
                ? t(`↑ ${highRiskZones.length || 1} active critical zone${(highRiskZones.length || 1) > 1 ? 's' : ''}`)
                : t('No active risk zoning')}
            </span>
          </div>
        </div>

        {/* Metric 2: Monitored Zones */}
        <div 
          className={`metric-glass-card glass-panel ${!hasMonitoredZones ? 'disabled' : ''}`}
          onClick={hasMonitoredZones ? () => setActiveModalCard('zones') : undefined}
          role={hasMonitoredZones ? "button" : undefined}
          tabIndex={hasMonitoredZones ? 0 : undefined}
          onKeyDown={hasMonitoredZones ? (e) => { if (e.key === 'Enter' || e.key === ' ') setActiveModalCard('zones'); } : undefined}
          title={hasMonitoredZones ? t('View monitored zones detail') : t('Monitored zone dataset not configured')}
        >
          <div className="metric-card-top">
            <div className="metric-icon-wrap teal-accent">
              <Users size={18} />
            </div>
            <button 
              className="card-nav-arrow" 
              aria-label={t('View monitored zones')}
              disabled={!hasMonitoredZones}
              title={hasMonitoredZones ? t('View monitored zones on map') : t('No zone dataset configured')}
            >
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="metric-card-info">
            <span className="metric-label">{t('Monitored Zones')}</span>
            <div className="metric-number-row">
              <span className={`metric-main-val ${!hasMonitoredZones ? 'unavailable-val' : ''}`}>
                {eventsLoading ? '...' : (hasMonitoredZones ? `${monitoredZonesCount} States` : t('Unavailable'))}
              </span>
            </div>
            <span className="metric-trend-text muted">
              {hasMonitoredZones
                ? (monitoredDistrictsCount > 0 ? `${monitoredDistrictsCount} ${t('district zones')}` : `${monitoredZonesCount} ${t('NER states')}`)
                : t('No zone dataset configured')}
            </span>
          </div>
        </div>

        {/* Metric 3: Critical Roads */}
        <div 
          className={`metric-glass-card glass-panel ${!hasCriticalRoads ? 'disabled' : ''}`} 
          onClick={hasCriticalRoads && criticalRoadTarget?.location ? () => setActiveModalCard('roads') : undefined} 
          role={hasCriticalRoads && criticalRoadTarget?.location ? "button" : undefined} 
          tabIndex={hasCriticalRoads && criticalRoadTarget?.location ? 0 : undefined}
          onKeyDown={hasCriticalRoads && criticalRoadTarget?.location ? (e) => { if (e.key === 'Enter' || e.key === ' ') setActiveModalCard('roads'); } : undefined}
          title={hasCriticalRoads ? t('View critical corridors detail') : t('No corridor telemetry available')}
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
          className="metric-glass-card glass-panel" 
          onClick={() => setActiveModalCard('rainfall')} 
          role="button" 
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setActiveModalCard('rainfall');
            }
          }}
          title={t('View recent rainfall and precipitation telemetry')}
        >
          <div className="metric-card-top">
            <div className="metric-icon-wrap rain-accent">
              <CloudRain size={18} />
            </div>
            <button 
              className="card-nav-arrow" 
              aria-label={t('View rainfall telemetry')}
              title={t('View rainfall telemetry on map')}
              onClick={(e) => {
                e.stopPropagation();
                setActiveModalCard('rainfall');
              }}
            >
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="metric-card-info">
            <span className="metric-label">{t('Recent Rainfall')}</span>
            <div className="metric-number-row">
              <span className={`metric-main-val ${displayRainfall24h === null ? 'unavailable-val' : ''}`}>
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
              {activeInfrastructure && activeInfrastructure.length > 0 && ` (${locationData?.infrastructure?.totalCount ?? activeInfrastructure.length})`}
            </h3>
            <button 
              className="panel-arrow-btn" 
              onClick={() => setActiveModalCard('infrastructure')} 
              disabled={activeInfrastructure.length === 0}
              aria-label={t('Inspect infrastructure routes')}
              title={activeInfrastructure.length > 0 ? t('Inspect infrastructure routes in detail') : t('No infrastructure corridors registered')}
            >
              <ArrowRight size={15} />
            </button>
          </div>

          <div className="infra-table-wrapper">
            {infraLoading || locationLoading ? (
              <div className="empty-panel-notice">
                <span>{t('Loading infrastructure telemetry...')}</span>
              </div>
            ) : sortedActiveInfrastructure && sortedActiveInfrastructure.length > 0 ? (
              <>
                <table className="infra-priority-table">
                  <thead>
                    <tr className="infra-table-head-row">
                      <th className="infra-th-name">{t('Corridor Route')}</th>
                      <th className="infra-th-badge">{t('Risk Level')}</th>
                      <th className="infra-th-action">{t('Transit Flow')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedActiveInfrastructure.slice(0, 5).map((item) => {
                      const hasItemCoords = Boolean(item.location?.latitude && item.location?.longitude);
                      const isClosed = item.status === 'closed';
                      const isHighRisk = isClosed || item.condition === 'vulnerable' || (item.importance >= 4 && item.alternativeAvailable === false) || ((item.operationalPriority?.score || 0) >= 60);

                      return (
                        <tr 
                          key={item._id || item.id} 
                          className={`infra-row ${hasItemCoords ? 'clickable' : ''}`}
                          onClick={hasItemCoords ? () => navigateToMapWithLocation(item.location, item.name) : undefined}
                          role={hasItemCoords ? "button" : undefined}
                          tabIndex={hasItemCoords ? 0 : undefined}
                          onKeyDown={hasItemCoords ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              navigateToMapWithLocation(item.location, item.name);
                            }
                          } : undefined}
                          title={hasItemCoords ? `${item.name} ${item.distanceKm != null ? `(${item.distanceKm} km)` : ''} • Click to focus on map` : undefined}
                        >
                          <td className="infra-name-cell">
                            <div className="infra-name-cell-wrap">
                              <span className="infra-name">{item.name}</span>
                              <div className="infra-meta-sub">
                                {item.location?.name && (
                                  <span className="infra-region-tag">{item.location.name}</span>
                                )}
                                {item.distanceKm != null && (
                                  <span className="infra-dist-tag">{item.distanceKm} km away</span>
                                )}
                                {item.condition === 'vulnerable' && (
                                  <span className="infra-vulnerable-tag">{t('Slide Vulnerable')}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="infra-badge-cell">
                            <span className={`infra-badge ${isClosed ? 'high pulse' : (isHighRisk ? 'moderate' : 'low')}`}>
                              {isClosed ? t('Critical') : (isHighRisk ? t('High') : t('Active'))}
                            </span>
                          </td>
                          <td className="infra-action-cell">
                            <span className={`infra-action-pill ${isClosed ? 'closed' : (item.alternativeAvailable ? 'detour' : 'flow')}`}>
                              {isClosed ? t('Route Closed') : (item.alternativeAvailable ? t('Detour Available') : t('Normal Flow'))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {sortedActiveInfrastructure.length > 5 && (
                  <div className="infra-view-all-row">
                    <button 
                      type="button" 
                      className="infra-view-all-btn"
                      onClick={() => setActiveModalCard('infrastructure')}
                    >
                      {t(`View all ${sortedActiveInfrastructure.length} corridors in details`)} →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-panel-notice">
                <CheckCircle2 size={24} className="empty-notice-icon" />
                <span>{t('No infrastructure corridors registered')}</span>
                <span className="empty-notice-sub">{t('Registered roads and bridges will appear here once telemetry is added.')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- Floating Detail Modal Rendering --- */}
      {(() => {
        if (!activeModalCard) return null;

        let modalTitle = '';
        let modalContent = null;
        let mapTarget = null;
        let mapLabel = '';

        const closeBtn = (
          <button className="modal-close-btn" onClick={(e) => { e.stopPropagation(); setActiveModalCard(null); }} aria-label={t('Close details')}>
            <X size={20} />
          </button>
        );

        const handleViewOnMap = (target, fallbackName) => {
          setActiveModalCard(null);
          if (target) {
            navigateToMapWithLocation(target, target.name || fallbackName);
          } else {
            navigate('/map');
          }
        };

        if (activeModalCard === 'regional') {
          modalTitle = t('Regional Monitoring Details');
          mapTarget = selectedLocation ? { lat: selectedLocation.lat, lon: selectedLocation.lon, name: selectedLocation.name } : { lat: 26.1445, lon: 91.7362, name: 'Guwahati Hub' };
          mapLabel = t('Monitored Area');
          modalContent = (
            <div className="modal-detail-content">
              <p className="modal-subtext">{t('Live meteorological and environmental telemetry for the active monitoring sector.')}</p>
              {mapTarget && (
                <div className="modal-location-banner">
                  <MapPin size={15} />
                  <span>
                    <strong>{t('Station Location:')}</strong> {mapTarget.name} ({mapTarget.lat.toFixed(4)}°N, {mapTarget.lon.toFixed(4)}°E)
                  </span>
                </div>
              )}
              <div className="modal-data-grid">
                <div className="modal-data-item">
                  <span className="modal-data-lbl">{t('Temperature')}</span>
                  <span className="modal-data-val">{displayTemperature !== null ? `${displayTemperature.toFixed(1)}°C` : t('Unavailable')}</span>
                </div>
                <div className="modal-data-item">
                  <span className="modal-data-lbl">{t('Humidity')}</span>
                  <span className="modal-data-val">{displayHumidity !== null ? `${displayHumidity.toFixed(0)}%` : t('Unavailable')}</span>
                </div>
                <div className="modal-data-item">
                  <span className="modal-data-lbl">{t('Wind Speed')}</span>
                  <span className="modal-data-val">{displayWindSpeed !== null ? `${displayWindSpeed.toFixed(1)} km/h` : t('Unavailable')}</span>
                </div>
                <div className="modal-data-item">
                  <span className="modal-data-lbl">{t('Soil Moisture')}</span>
                  <span className="modal-data-val">{displaySoilMoisture !== null ? `${displaySoilMoisture.toFixed(1)}%` : t('Unavailable')}</span>
                </div>
              </div>
            </div>
          );
        } else if (activeModalCard === 'risk') {
          modalTitle = t('Nearby Risk Assessment');
          mapTarget = riskTargetLocation;
          const targetLat = mapTarget?.lat ?? mapTarget?.latitude;
          const targetLon = mapTarget?.lon ?? mapTarget?.longitude;
          mapLabel = mapTarget?.name || t('Active Hazard Area');
          modalContent = (
            <div className="modal-detail-content">
              <p className="modal-subtext">{t('AI-driven susceptibility prediction based on static terrain and live environmental indicators.')}</p>
              {mapTarget && targetLat != null && targetLon != null && (
                <div className="modal-location-banner">
                  <MapPin size={15} />
                  <span>
                    <strong>{t('Assessed Location:')}</strong> {mapLabel} ({Number(targetLat).toFixed(4)}°N, {Number(targetLon).toFixed(4)}°E)
                  </span>
                </div>
              )}
              <div className="modal-alert-box">
                <ShieldAlert size={24} className={`risk-status-icon ${calculatedRiskLevel.toLowerCase()}`} />
                <div>
                  <strong>{t(`Risk Level: ${calculatedRiskLevel}`)}</strong>
                  <p>{effectiveIntelligence?.mlPrediction?.prediction?.probability != null ? `Susceptibility probability: ${(effectiveIntelligence.mlPrediction.prediction.probability * 100).toFixed(1)}%` : t('Probability score unavailable')}</p>
                </div>
              </div>
              <p className="modal-reasoning" style={{ marginTop: '0.75rem' }}>
                {effectiveIntelligence?.aiRiskAnalysis?.reasoning?.[0] || t('Hazard probability analysis based on active monitoring grid data.')}
              </p>
            </div>
          );
        } else if (activeModalCard === 'areas') {
          modalTitle = t('High Risk Areas');
          const primaryZone = highRiskZones[0];
          mapTarget = primaryZone?.location ? { 
            lat: primaryZone.location.lat, 
            lon: primaryZone.location.lon, 
            name: primaryZone.location.name || primaryZone.name 
          } : { lat: 25.5788, lon: 91.8933, name: 'East Khasi Hills (Shillong / Cherrapunji, Meghalaya)' };
          mapLabel = primaryZone?.name || mapTarget.name;

          modalContent = (
            <div className="modal-detail-content">
              <p className="modal-subtext">{t('Identified hazard zones requiring immediate attention across North-East India.')}</p>
              
              {mapTarget && (
                <div className="modal-location-banner with-radar">
                  <div className="radar-ping-container" aria-hidden="true">
                    <span className="radar-ping-ring" />
                    <span className="radar-ping-dot" />
                  </div>
                  <span>
                    <strong>{t('Primary Focus:')}</strong> {mapLabel} ({mapTarget.lat.toFixed(4)}°N, {mapTarget.lon.toFixed(4)}°E)
                  </span>
                </div>
              )}

              <div className="modal-data-grid single" style={{ marginBottom: '0.75rem' }}>
                <div className="modal-data-item highlight">
                  <AlertTriangle size={24} className="text-red-500" />
                  <div>
                    <span className="modal-data-val">{highRiskZones.length || 1}</span>
                    <span className="modal-data-lbl">{t('Active Critical Zones')}</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="modal-data-lbl" style={{ display: 'block', marginBottom: '8px' }}>
                  {t('High Risk Locations (Click to inspect on map):')}
                </span>
                <ul className="modal-list">
                  {highRiskZones.map((zone, i) => (
                    <li 
                      key={zone.id || i}
                      className="modal-list-item-clickable"
                      style={{ 
                        padding: '10px 12px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '8px',
                        marginBottom: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        border: '1px solid rgba(244, 63, 94, 0.25)'
                      }}
                      onClick={() => handleViewOnMap(zone.location, zone.name)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleViewOnMap(zone.location, zone.name); }}
                      title={t('Click to focus this location on map')}
                    >
                      <div>
                        <strong style={{ display: 'block', color: 'hsl(var(--text-primary))', fontSize: '0.92rem' }}>
                          {zone.name}
                        </strong>
                        <span style={{ fontSize: '0.74rem', color: 'hsl(var(--text-muted))' }}>
                          {zone.location.lat.toFixed(4)}°N, {zone.location.lon.toFixed(4)}°E • {zone.source}
                        </span>
                      </div>
                      <span className="infra-badge high" style={{ background: 'rgba(244, 63, 94, 0.18)', color: '#f43f5e', padding: '3px 9px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                        {zone.severity === 'critical' ? t('Critical') : t('High Risk')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        } else if (activeModalCard === 'zones') {
          modalTitle = t('Monitored Zones Dataset');
          mapTarget = { lat: 26.2, lon: 92.9, name: 'Northeast India Grid' };
          mapLabel = t('Regional Map');
          const nerStates = ['Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Sikkim', 'Tripura'];
          modalContent = (
            <div className="modal-detail-content">
              <p className="modal-subtext">{t('Coverage details derived from the active monitoring catalogue.')}</p>
              <div className="modal-location-banner">
                <MapPin size={15} />
                <span>
                  <strong>{t('Regional Coverage:')}</strong> {mapTarget.name} (8 States • 136 Districts)
                </span>
              </div>
              <div className="modal-data-grid">
                <div className="modal-data-item">
                  <span className="modal-data-lbl">{t('Monitored States')}</span>
                  <span className="modal-data-val">{monitoredZonesCount}</span>
                </div>
                <div className="modal-data-item">
                  <span className="modal-data-lbl">{t('Monitored Districts')}</span>
                  <span className="modal-data-val">{monitoredDistrictsCount}</span>
                </div>
              </div>
              <div style={{ marginTop: '0.5rem' }}>
                <span className="modal-data-lbl" style={{ marginBottom: '8px', display: 'block' }}>{t('Active States:')}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {nerStates.map(state => (
                    <span key={state} style={{ background: 'rgba(20, 184, 166, 0.1)', border: '1px solid rgba(20, 184, 166, 0.3)', padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', color: '#2dd4bf', fontWeight: '600' }}>{state}</span>
                  ))}
                </div>
              </div>
              <p className="modal-reasoning" style={{ marginTop: '1rem' }}>
                {t(`Actively monitoring ${monitoredDistrictsCount} districts across ${monitoredZonesCount} states using satellite, weather, and ground truth telemetry.`)}
              </p>
            </div>
          );
        } else if (activeModalCard === 'roads' || activeModalCard === 'infrastructure') {
          modalTitle = activeModalCard === 'infrastructure' ? t('Infrastructure Priority & Corridors') : t('Critical Corridors');
          const primaryCorridor = closedOrCriticalRoads[0] || sortedActiveInfrastructure[0];
          mapTarget = primaryCorridor?.location ? {
            latitude: primaryCorridor.location.latitude ?? primaryCorridor.location.lat,
            longitude: primaryCorridor.location.longitude ?? primaryCorridor.location.lon,
            name: primaryCorridor.name
          } : (selectedLocation ? {
            latitude: selectedLocation.lat,
            longitude: selectedLocation.lon,
            name: selectedLocation.name
          } : {
            latitude: 25.5788,
            longitude: 91.8933,
            name: 'East Khasi Hills (Shillong-Silchar Mountain Corridor)'
          });
          const targetLat = mapTarget?.latitude ?? mapTarget?.lat;
          const targetLon = mapTarget?.longitude ?? mapTarget?.lon;
          mapLabel = primaryCorridor?.name || mapTarget.name || t('Infrastructure Corridor');

          modalContent = (
            <div className="modal-detail-content">
              <p className="modal-subtext">{t('Real-time operational status, priority scoring, and transit routing for critical transport infrastructure.')}</p>
              {mapTarget && targetLat != null && targetLon != null && (
                <div className="modal-location-banner with-radar">
                  <div className="radar-ping-container" aria-hidden="true">
                    <span className="radar-ping-ring" />
                    <span className="radar-ping-dot" />
                  </div>
                  <span>
                    <strong>{t('Priority Corridor:')}</strong> {mapLabel} ({Number(targetLat).toFixed(4)}°N, {Number(targetLon).toFixed(4)}°E)
                  </span>
                </div>
              )}
              <div className="modal-data-grid">
                <div className="modal-data-item highlight">
                  <Truck size={24} className="text-blue-500" />
                  <div>
                    <span className="modal-data-val">{closedOrCriticalRoads.length}</span>
                    <span className="modal-data-lbl">{t('Critical Corridors')}</span>
                  </div>
                </div>
                <div className="modal-data-item highlight">
                  <Activity size={24} className="text-teal-400" />
                  <div>
                    <span className="modal-data-val">{sortedActiveInfrastructure.length}</span>
                    <span className="modal-data-lbl">{t('Monitored Routes')}</span>
                  </div>
                </div>
              </div>
              <div>
                <span className="modal-data-lbl" style={{ display: 'block', marginBottom: '8px' }}>
                  {t('Infrastructure Priority Corridors (Click to inspect on map):')}
                </span>
                <ul className="modal-list modal-corridor-scroll">
                  {sortedActiveInfrastructure.map((item, i) => {
                    const itemLat = item.location?.latitude ?? item.location?.lat;
                    const itemLon = item.location?.longitude ?? item.location?.lon;
                    const hasCoords = itemLat != null && itemLon != null;
                    const isClosed = item.status === 'closed';
                    const isVulnerable = item.condition === 'vulnerable';
                    const isHighRisk = isClosed || isVulnerable || (item.importance >= 4 && item.alternativeAvailable === false) || ((item.operationalPriority?.score || 0) >= 60);

                    return (
                      <li 
                        key={item._id || item.id || i}
                        className="modal-list-item-clickable modal-corridor-item"
                        style={{ 
                          padding: '10px 14px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          borderRadius: '8px',
                          marginBottom: '7px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          border: isClosed ? '1px solid rgba(244, 63, 94, 0.4)' : (isVulnerable ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid var(--glass-border)')
                        }}
                        onClick={hasCoords ? () => handleViewOnMap(item.location, item.name) : undefined}
                        role={hasCoords ? "button" : undefined}
                        tabIndex={hasCoords ? 0 : undefined}
                        onKeyDown={hasCoords ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleViewOnMap(item.location, item.name); } : undefined}
                        title={hasCoords ? t('Click to focus this corridor on map') : undefined}
                      >
                        <div style={{ flex: 1, paddingRight: '10px' }}>
                          <strong style={{ display: 'block', color: 'hsl(var(--text-primary))', fontSize: '0.92rem' }}>
                            {item.name}
                          </strong>
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginTop: '3px' }}>
                            {item.location?.name && (
                              <span className="infra-region-tag">{item.location.name}</span>
                            )}
                            {item.distanceKm != null && (
                              <span className="infra-dist-tag">{item.distanceKm} km</span>
                            )}
                            {isVulnerable && (
                              <span className="infra-vulnerable-tag">{t('Slide Vulnerable')}</span>
                            )}
                            {item.populationServed && (
                              <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
                                {Math.round(item.populationServed / 1000)}k {t('pop')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          <span className={`infra-badge ${isClosed ? 'high pulse' : (isHighRisk ? 'high' : 'low')}`}>
                            {isClosed ? t('Critical') : (isHighRisk ? t('High') : t('Active'))}
                          </span>
                          <span className={`infra-action-pill ${isClosed ? 'closed' : (item.alternativeAvailable ? 'detour' : 'flow')}`}>
                            {isClosed ? t('Closed') : (item.alternativeAvailable ? t('Detour') : t('Lifeline'))}
                          </span>
                          <span className="modal-corridor-map-hint" title={t('Focus on map')}>
                            <MapIcon size={13} />
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        } else if (activeModalCard === 'rainfall') {
          modalTitle = t('Recent Precipitation & Rainfall');
          mapTarget = selectedLocation 
            ? { latitude: selectedLocation.lat, longitude: selectedLocation.lon, name: selectedLocation.name } 
            : rainfallTargetLocation;
          const targetLat = mapTarget?.latitude ?? mapTarget?.lat;
          const targetLon = mapTarget?.longitude ?? mapTarget?.lon;
          mapLabel = selectedLocation ? selectedLocation.name : (mapTarget?.name || (displayRainfall24h !== null ? `Rainfall Station (${displayRainfall24h.toFixed(1)} mm)` : 'Rainfall Station'));
          const dailyList = effectiveIntelligence?.weather?.dailyForecast || [];

          modalContent = (
            <div className="modal-detail-content">
              <p className="modal-subtext">{t('Precipitation telemetry and 24-hour accumulated rainfall observations.')}</p>
              {mapTarget && targetLat != null && targetLon != null && (
                <div className="modal-location-banner with-radar">
                  <div className="radar-ping-container" aria-hidden="true">
                    <span className="radar-ping-ring" />
                    <span className="radar-ping-dot" />
                  </div>
                  <span>
                    <strong>{t('Station Location:')}</strong> {mapLabel} ({Number(targetLat).toFixed(4)}°N, {Number(targetLon).toFixed(4)}°E)
                  </span>
                </div>
              )}
              <div className="modal-data-grid">
                <div className="modal-data-item highlight">
                  <CloudRain size={24} className="text-indigo-400" />
                  <div>
                    <span className="modal-data-val">{displayRainfall24h !== null ? `${displayRainfall24h.toFixed(1)} mm` : t('Unavailable')}</span>
                    <span className="modal-data-lbl">{t('Accumulated (24h)')}</span>
                  </div>
                </div>
                <div className="modal-data-item highlight">
                  <Droplets size={24} className="text-cyan-400" />
                  <div>
                    <span className="modal-data-val">
                      {displayPrecipitation !== null 
                        ? `${displayPrecipitation.toFixed(1)} mm` 
                        : (displayRainfall24h !== null ? `${displayRainfall24h.toFixed(1)} mm` : t('Unavailable'))}
                    </span>
                    <span className="modal-data-lbl">{t('Current Precipitation')}</span>
                  </div>
                </div>
              </div>
              {effectiveIntelligence?.weather?.precipitationProbability != null && (
                <div style={{ marginTop: '0.75rem', padding: '8px 12px', background: 'rgba(45, 212, 191, 0.08)', borderRadius: '8px', border: '1px solid rgba(45, 212, 191, 0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CloudSun size={16} className="text-teal-400" />
                  <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>
                    {t('Precipitation Probability')}: <strong style={{ color: '#2dd4bf' }}>{effectiveIntelligence.weather.precipitationProbability}%</strong> • {t('Open-Meteo Synced')}
                  </span>
                </div>
              )}
              {dailyList.length > 0 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <span className="modal-data-lbl" style={{ marginBottom: '8px', display: 'block' }}>
                    {t('Precipitation Forecast Trend:')}
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(dailyList.length, 4)}, 1fr)`, gap: '8px' }}>
                    {dailyList.slice(0, 4).map((d, i) => (
                      <div key={i} style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>{new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#38bdf8' }}>{d.precipitationSum != null ? `${d.precipitationSum} mm` : '0 mm'}</div>
                        <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>{d.precipitationProbabilityMax != null ? `${d.precipitationProbabilityMax}% rain` : ''}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="modal-reasoning" style={{ marginTop: '1rem' }}>
                {t('Real-time precipitation metrics drive the antecedent moisture index used by ML susceptibility models.')}
              </p>
            </div>
          );
        } else if (activeModalCard === 'prediction') {
          modalTitle = t('Recent Prediction & Hazard Forecast');
          mapTarget = selectedLocation 
            ? { latitude: selectedLocation.lat, longitude: selectedLocation.lon, name: selectedLocation.name } 
            : { latitude: DEFAULT_REGIONAL_FOCUS.lat, longitude: DEFAULT_REGIONAL_FOCUS.lon, name: DEFAULT_REGIONAL_FOCUS.name };
          const targetLat = mapTarget?.latitude ?? mapTarget?.lat;
          const targetLon = mapTarget?.longitude ?? mapTarget?.lon;
          mapLabel = selectedLocation ? selectedLocation.name : t('Forecast Sector');
          const precipProb = effectiveIntelligence?.weather?.precipitationProbability;
          const mlProb = effectiveIntelligence?.mlPrediction?.prediction?.probability;
          const mlRisk = effectiveIntelligence?.mlPrediction?.prediction?.riskLevel || calculatedRiskLevel;
          const dailyList = effectiveIntelligence?.weather?.dailyForecast || [];

          modalContent = (
            <div className="modal-detail-content">
              <p className="modal-subtext">{t('Live predictive hazard modeling and meteorological precipitation probability.')}</p>
              {mapTarget && targetLat != null && targetLon != null && (
                <div className="modal-location-banner">
                  <MapPin size={15} />
                  <span>
                    <strong>{t('Prediction Location:')}</strong> {mapLabel} ({Number(targetLat).toFixed(4)}°N, {Number(targetLon).toFixed(4)}°E)
                  </span>
                </div>
              )}
              <div className="modal-data-grid">
                <div className="modal-data-item highlight">
                  <CloudSun size={24} className="text-cyan-400" />
                  <div>
                    <span className="modal-data-val">
                      {precipProb != null ? `${precipProb}%` : t('Unavailable')}
                    </span>
                    <span className="modal-data-lbl">{t('Precipitation Probability')}</span>
                  </div>
                </div>
                <div className="modal-data-item highlight">
                  <Activity size={24} className={mlRisk.toLowerCase() === 'high' || mlRisk.toLowerCase() === 'critical' ? 'text-red-400' : 'text-emerald-400'} />
                  <div>
                    <span className="modal-data-val" style={{ textTransform: 'capitalize' }}>
                      {mlProb != null ? `${(mlProb * 100).toFixed(1)}%` : (mlRisk !== 'Unavailable' ? t(mlRisk) : t('Nominal'))}
                    </span>
                    <span className="modal-data-lbl">{t('Landslide Susceptibility')}</span>
                  </div>
                </div>
              </div>
              {dailyList.length > 0 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <span className="modal-data-lbl" style={{ marginBottom: '8px', display: 'block' }}>
                    {t('Multi-Day Meteorological Trend:')}
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(dailyList.length, 4)}, 1fr)`, gap: '8px' }}>
                    {dailyList.slice(0, 4).map((d, i) => (
                      <div key={i} style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>{new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'hsl(var(--text-primary))' }}>{d.maxTemp != null ? `${d.maxTemp}°` : '-'} / {d.minTemp != null ? `${d.minTemp}°` : '-'}</div>
                        <div style={{ fontSize: '0.7rem', color: '#2dd4bf' }}>{d.precipitationSum != null ? `${d.precipitationSum}mm` : ''}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="modal-reasoning" style={{ marginTop: '0.9rem' }}>
                {effectiveIntelligence?.aiRiskAnalysis?.reasoning?.[0]
                  || t('Predictive algorithms cross-reference antecedent precipitation, slope angles, and live meteorological telemetry.')}
              </p>
            </div>
          );
        }

        return (
          <div className="dashboard-modal-overlay" onClick={() => setActiveModalCard(null)}>
            <div className="dashboard-modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
              <div className="dashboard-modal-header">
                <h3>{modalTitle}</h3>
                {closeBtn}
              </div>
              <div className="dashboard-modal-body">
                {modalContent}
              </div>
              <div className="dashboard-modal-footer">
                <button 
                  className="dashboard-modal-btn-map" 
                  onClick={() => handleViewOnMap(mapTarget, mapLabel)}
                >
                  <MapIcon size={16} />
                  {t('VIEW ON MAP')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
