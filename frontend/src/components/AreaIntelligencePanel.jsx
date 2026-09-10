import { useState, useEffect } from 'react';
import { X, Map, CloudRain, Droplets, Activity, FileText, Building, AlertTriangle, Mountain, Lock, Cpu, ShieldAlert, Satellite, RefreshCw } from 'lucide-react';
import { areaIntelligenceService } from '../services/areaIntelligenceService';
import { satelliteService } from '../services/satelliteService';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner, ErrorState } from './StatusDisplay';
import './AreaIntelligencePanel.css';

export function AreaIntelligencePanel({ selectedLocation, onClose }) {
  const auth = useAuth?.() || {};
  const [data, setData] = useState(null);
  const [satellite, setSatellite] = useState(null);
  const [loading, setLoading] = useState(false);
  const [satelliteLoading, setSatelliteLoading] = useState(false);
  const [error, setError] = useState(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // Refresh trigger: incrementing this re-runs the intelligence fetch for the same location
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!selectedLocation) {
      setData(null);
      setSatellite(null);
      setError(null);
      setAuthRequired(false);
      setPermissionDenied(false);
      return;
    }

    const currentToken = auth.token || (typeof localStorage !== 'undefined' ? localStorage.getItem('jwt_token') : null);

    // If auth state is still loading from storage, wait and do not flash authRequired
    if (!currentToken) {
      if (auth.loading) {
        setLoading(true);
        return;
      }
      setData(null);
      setSatellite(null);
      setError(null);
      setLoading(false);
      setSatelliteLoading(false);
      setAuthRequired(true);
      setPermissionDenied(false);
      return;
    }

    const abortController = new AbortController();

    const fetchIntelligence = async () => {
      setData(null); // Clear stale data from previous location immediately
      setSatellite(null);
      setLoading(true);
      setSatelliteLoading(true);
      setError(null);
      setAuthRequired(false);
      setPermissionDenied(false);

      // Concurrently query satellite land-cover (Step 54D); fail-safe catch ensures it never blocks core intelligence
      Promise.resolve()
        .then(() => satelliteService?.getLandCover?.(selectedLocation.lat, selectedLocation.lon, abortController.signal))
        .then((satData) => {
          if (!abortController.signal.aborted) {
            setSatellite(satData || { available: false });
            setSatelliteLoading(false);
          }
        })
        .catch(() => {
          if (!abortController.signal.aborted) {
            setSatellite({ available: false });
            setSatelliteLoading(false);
          }
        });

      try {
        // Main intelligence call — already includes satelliteEvidence in response (no duplicate call needed)
        const result = await areaIntelligenceService.getIntelligence(
          selectedLocation.lat,
          selectedLocation.lon,
          abortController.signal
        );
        setData(result);
      } catch (err) {
        if (err.message !== 'AbortError') {
          const is403 = err.status === 403 || /403|access denied|insufficient privileges|forbidden/i.test(err.message || '');
          const is401 = err.status === 401 || (!currentToken && /401|authentication required|token/i.test(err.message || ''));

          if (is403) {
            setPermissionDenied(true);
            setAuthRequired(false);
            setError(null);
            setData(null);
          } else if (is401) {
            setAuthRequired(true);
            setPermissionDenied(false);
            setError(null);
            setData(null);
          } else {
            setError(err.message || 'Failed to fetch area intelligence.');
            setAuthRequired(false);
            setPermissionDenied(false);
          }
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchIntelligence();

    return () => {
      abortController.abort();
    };
  // refreshKey allows the Refresh button to re-trigger fetch for the same coordinates
  }, [selectedLocation?.lat, selectedLocation?.lon, auth.token, auth.loading, refreshKey]);

  if (!selectedLocation) return null;

  return (
    <div className="area-intelligence-panel glass-panel drawer-slide-in">
      <div className="ai-panel-header">
        <h3 className="ai-panel-title">
          <Map size={18} />
          Area Intelligence
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {/* Refresh button: re-triggers intelligence fetch for the current location */}
          {selectedLocation && !loading && (
            <button
              className="ai-panel-close"
              onClick={() => setRefreshKey(k => k + 1)}
              aria-label="Refresh area intelligence"
              title="Refresh intelligence data"
            >
              <RefreshCw size={15} />
            </button>
          )}
          {loading && (
            <button className="ai-panel-close" disabled aria-label="Loading..." title="Loading...">
              <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />
            </button>
          )}
          {onClose && (
            <button className="ai-panel-close" onClick={onClose} aria-label="Close panel">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="ai-panel-content">
        {loading && (
          <div style={{ padding: '2rem 0' }}>
            <LoadingSpinner message="Gathering local intelligence..." />
          </div>
        )}

        {!loading && authRequired && (
          <div className="ai-auth-required animate-fade-in" style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              backgroundColor: 'hsla(var(--status-warn), 0.15)',
              color: 'hsl(var(--status-warn))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.75rem auto'
            }}>
              <Lock size={20} />
            </div>

            <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.95rem', fontWeight: 600, color: 'hsl(var(--text-primary))' }}>
              Authentication Required
            </h4>

            <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: 'hsl(var(--text-secondary))', lineHeight: 1.45 }}>
              Detailed multi-hazard environmental telemetry, slope analysis, and infrastructure exposure for this area require an authorized session.
            </p>

            <div style={{
              padding: '0.65rem 0.75rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'hsla(var(--bg-secondary), 0.5)',
              border: '1px solid var(--glass-border)',
              marginBottom: '1rem',
              fontSize: '0.75rem',
              color: 'hsl(var(--text-muted))',
              textAlign: 'left'
            }}>
              <div><strong>Location:</strong> {selectedLocation.name || `${selectedLocation.lat?.toFixed(4)}°, ${selectedLocation.lon?.toFixed(4)}°`}</div>
              <div style={{ marginTop: '0.25rem' }}>Map viewing, satellite telemetry, and location search remain fully accessible.</div>
            </div>

            {auth?.openAuthModal ? (
              <button 
                type="button"
                className="btn btn-primary"
                onClick={auth.openAuthModal}
                style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.82rem' }}
              >
                <Lock size={14} />
                <span>Log In to View Intelligence</span>
              </button>
            ) : (
              <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                Please log in from the header to view this data.
              </div>
            )}
          </div>
        )}

        {!loading && permissionDenied && (
          <div className="ai-auth-required animate-fade-in" style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              backgroundColor: 'hsla(var(--status-warn), 0.15)',
              color: 'hsl(var(--status-warn))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.75rem auto'
            }}>
              <ShieldAlert size={20} />
            </div>

            <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.95rem', fontWeight: 600, color: 'hsl(var(--text-primary))' }}>
              Access Restricted
            </h4>

            <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: 'hsl(var(--text-secondary))', lineHeight: 1.45 }}>
              Your account does not have sufficient role privileges to view operational intelligence for this coordinate.
            </p>

            <div style={{
              padding: '0.65rem 0.75rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'hsla(var(--bg-secondary), 0.5)',
              border: '1px solid var(--glass-border)',
              marginBottom: '1rem',
              fontSize: '0.75rem',
              color: 'hsl(var(--text-muted))',
              textAlign: 'left'
            }}>
              <div><strong>Location:</strong> {selectedLocation.name || `${selectedLocation.lat?.toFixed(4)}°, ${selectedLocation.lon?.toFixed(4)}°`}</div>
              <div style={{ marginTop: '0.25rem' }}>Map viewing and satellite telemetry remain fully accessible.</div>
            </div>
          </div>
        )}

        {!loading && !authRequired && !permissionDenied && error && (
          <div style={{ padding: '1rem 0' }}>
            <ErrorState
              title="Intelligence Error"
              message={error}
              onRetry={() => setRefreshKey(k => k + 1)}
            />
          </div>
        )}

        {!loading && !authRequired && !permissionDenied && !error && data && (
          <>
            {/* Simulation Mode Alert Banner */}
            {Boolean(data.providerStatus?.rainfall?.dataMode === 'simulation' || data.providerStatus?.soilMoisture?.dataMode === 'simulation') && (
              <div className="ai-simulation-banner">
                <AlertTriangle size={16} />
                <span>
                  <strong>SIMULATION MODE ACTIVE:</strong> Telemetry is simulated for testing/demonstration and does not reflect real-world observations.
                </span>
              </div>
            )}

            {/* Overall Status & Location */}
            <div className="ai-section">
              <div className="ai-item">
                <span className="ai-item-label">Location</span>
                <span className="ai-item-value" style={{ fontSize: '0.8rem' }}>
                  {selectedLocation?.name ? `${selectedLocation.name} • ` : ''}
                  {data.selectedLocation?.latitude?.toFixed(4)}, {data.selectedLocation?.longitude?.toFixed(4)}
                </span>
              </div>
              <div className="ai-item">
                <span className="ai-item-label">Evidence-Based Risk Assessment</span>
                <span className={`ai-status-badge ${data.evidenceFusion?.overallStatus === 'available' ? 'ai-status-available' : 'ai-status-unavailable'}`}>
                  {(data.evidenceFusion?.overallStatus || 'unknown').replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* Early Warning Status */}
            {data.earlyWarning && (
              <div className="ai-section">
                <div className="ai-section-header-row">
                  <h4 className="ai-section-title">
                    <ShieldAlert size={16} /> Early Warning Status
                  </h4>
                  <span className="ai-provenance-tag">Decision Engine</span>
                </div>
                <div className="ai-item">
                  <span className="ai-item-label">Warning Level</span>
                  <span className={`ai-warning-badge ai-warning-${data.earlyWarning.warningLevel || 'no_warning'}`}>
                    {(data.earlyWarning.warningLevel || 'no_warning').replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                {data.earlyWarning.dataStatus === 'insufficient' && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.74rem', color: 'hsl(var(--status-warn))' }}>
                    Advisory issued due to incomplete/unknown baseline data.
                  </div>
                )}
                {data.earlyWarning.recommendedActions && data.earlyWarning.recommendedActions.length > 0 && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.2rem', color: 'hsl(var(--text-secondary))' }}>Recommended Actions:</div>
                    <ul style={{ margin: '0 0 0 1.2rem', padding: 0 }}>
                      {data.earlyWarning.recommendedActions.map((action, idx) => (
                        <li key={idx} style={{ marginBottom: '0.15rem' }}>{action}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Machine Learning Prediction (Strictly Truthful) */}
            <div className="ai-section">
              <div className="ai-section-header-row">
                <h4 className="ai-section-title">
                  <Cpu size={16} /> Machine Learning Prediction
                </h4>
                <span className="ai-provenance-tag">XGBoost (ml/predict.py)</span>
              </div>

              <div className="ai-item">
                <span className="ai-item-label">Prediction Status</span>
                {data.evidenceAvailability?.mlPrediction && data.mlPrediction?.status === 'success' ? (
                  <span className="ai-item-value" style={{ color: 'hsl(142, 71%, 45%)', fontWeight: 600 }}>
                    Active (v{data.mlPrediction.modelVersion || '1.0.0'}) • Class {data.mlPrediction.prediction?.class}
                  </span>
                ) : (
                  <span className="ai-item-value text-muted">AI Prediction: Unavailable</span>
                )}
              </div>

              {data.evidenceAvailability?.mlPrediction && data.mlPrediction?.status === 'success' && (
                <>
                  {data.mlPrediction.prediction?.probability != null && (
                    <div className="ai-item">
                      <span className="ai-item-label">Susceptibility Risk</span>
                      <span className="ai-item-value" style={{
                        fontWeight: 700,
                        color: data.mlPrediction.prediction.probability >= 0.75 ? 'hsl(346, 87%, 55%)' :
                               data.mlPrediction.prediction.probability >= 0.50 ? 'hsl(48, 96%, 53%)' : 'hsl(142, 71%, 45%)'
                      }}>
                        {(data.mlPrediction.prediction.riskLevel || (data.mlPrediction.prediction.probability >= 0.5 ? 'HIGH' : 'LOW')).toUpperCase()} ({(data.mlPrediction.prediction.probability * 100).toFixed(1)}%)
                      </span>
                    </div>
                  )}

                  {data.mlPrediction.trigger && (
                    <div className="ai-item">
                      <span className="ai-item-label">Dynamic Trigger</span>
                      <span className="ai-item-value" style={{ fontSize: '0.78rem' }}>
                        {data.mlPrediction.trigger.status === 'success' ? (
                          <strong style={{
                            color: data.mlPrediction.trigger.probability >= 0.7 ? 'hsl(346, 87%, 55%)' : 'hsl(142, 71%, 45%)'
                          }}>
                            {(data.mlPrediction.trigger.probability * 100).toFixed(1)}% probability
                          </strong>
                        ) : (
                          <span className="text-muted">Skipped (multi-scale precipitation incomplete)</span>
                        )}
                      </span>
                    </div>
                  )}

                  <div style={{ marginTop: '0.35rem', fontSize: '0.71rem', color: 'hsl(var(--text-muted))' }}>
                    Static terrain model trained on 20,472 GSI landslide records (Copernicus DEM 90m features).
                  </div>
                </>
              )}

              {(!data.evidenceAvailability?.mlPrediction || data.mlPrediction?.status !== 'success') && (
                <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', lineHeight: 1.45 }} className="text-muted">
                  <div>
                    <strong>Reason:</strong> {data.mlPrediction?.reason || 'No trained ML model is currently operational.'}
                  </div>
                  <div style={{ marginTop: '0.25rem', fontSize: '0.71rem', color: 'hsl(var(--text-muted))' }}>
                    Model artifact not present in <code>ml/artifacts/</code> (training gate requires 1,000 genuine samples). No fake predictions or manufactured confidence scores are produced.
                  </div>
                </div>
              )}
            </div>

            {/* Environmental Telemetry */}
            <div className="ai-section">
              <div className="ai-section-header-row">
                <h4 className="ai-section-title">
                  <CloudRain size={16} /> Environmental Telemetry
                </h4>
                <span className="ai-provenance-tag">Open-Meteo model data</span>
              </div>
              
              <div className="ai-item">
                <span className="ai-item-label">Rainfall (24h)</span>
                {data.evidenceAvailability?.rainfall && typeof data.evidenceFusion?.evidence?.rainfall?.rainfall24h === 'number' && !isNaN(data.evidenceFusion.evidence.rainfall.rainfall24h) ? (
                  <span className="ai-item-value">{data.evidenceFusion.evidence.rainfall.rainfall24h} mm</span>
                ) : (
                  <span className="ai-item-value text-muted">Unavailable</span>
                )}
              </div>

              {data.evidenceAvailability?.rainfall && typeof data.evidenceFusion?.evidence?.rainfall?.currentIntervalPrecipitation === 'number' && !isNaN(data.evidenceFusion.evidence.rainfall.currentIntervalPrecipitation) && (
                <div className="ai-item">
                  <span className="ai-item-label">Current Precipitation</span>
                  <span className="ai-item-value">{data.evidenceFusion.evidence.rainfall.currentIntervalPrecipitation} mm</span>
                </div>
              )}

              <div className="ai-item">
                <span className="ai-item-label">Soil Moisture</span>
                {data.evidenceAvailability?.soilMoisture && typeof data.evidenceFusion?.evidence?.soilMoisture?.latestValue === 'number' && !isNaN(data.evidenceFusion.evidence.soilMoisture.latestValue) ? (
                  <span className="ai-item-value">{data.evidenceFusion.evidence.soilMoisture.latestValue}%</span>
                ) : (
                  <span className="ai-item-value text-muted">Unavailable</span>
                )}
              </div>

              {data.weather && (
                <div className="ai-weather-grid">
                  {data.weather.temperature != null && (
                    <div className="ai-weather-cell">
                      <span className="text-muted">Temperature:</span> <strong>{data.weather.temperature} °C</strong>
                    </div>
                  )}
                  {data.weather.humidity != null && (
                    <div className="ai-weather-cell">
                      <span className="text-muted">Humidity:</span> <strong>{data.weather.humidity}%</strong>
                    </div>
                  )}
                  {data.weather.windSpeed != null && (
                    <div className="ai-weather-cell">
                      <span className="text-muted">Wind Speed:</span> <strong>{data.weather.windSpeed} km/h</strong>
                    </div>
                  )}
                  {data.weather.precipitationProbability != null && (
                    <div className="ai-weather-cell">
                      <span className="text-muted">Rain Probability:</span> <strong>{data.weather.precipitationProbability}%</strong>
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: '0.35rem', fontSize: '0.71rem' }} className="text-muted">
                Numerical forecast & analysis from Open-Meteo. Physical rain-gauges are not deployed at these coordinates.
              </div>
            </div>

            {/* Terrain Features */}
            <div className="ai-section">
              <div className="ai-section-header-row">
                <h4 className="ai-section-title">
                  <Mountain size={16} /> Terrain Features
                </h4>
                <span className="ai-provenance-tag">Copernicus DEM (90m)</span>
              </div>
              
              <div className="ai-item">
                <span className="ai-item-label">Elevation</span>
                {data.evidenceAvailability?.terrain && data.evidenceFusion?.evidence?.terrain?.elevation != null ? (
                  <span className="ai-item-value">{data.evidenceFusion.evidence.terrain.elevation} m</span>
                ) : (
                  <span className="ai-item-value text-muted">Unavailable</span>
                )}
              </div>

              <div className="ai-item">
                <span className="ai-item-label">Slope</span>
                {data.evidenceAvailability?.terrain && data.evidenceFusion?.evidence?.terrain?.slope != null ? (
                  <span className="ai-item-value">{data.evidenceFusion.evidence.terrain.slope.toFixed(1)}&deg;</span>
                ) : (
                  <span className="ai-item-value text-muted">Unavailable</span>
                )}
              </div>
            </div>

            {/* Satellite Evidence */}
            {(() => {
              const activeSatellite = satellite || data?.satelliteEvidence || (data?.evidence?.satellite ? {
                available: true,
                source: data.evidence.satellite.source,
                classCode: data.evidence.satellite.classCode,
                className: data.evidence.satellite.className,
                category: data.evidence.satellite.category,
                contributionPoints: data.evidence.satellite.contributionPoints
              } : null);

              const isAvailable = Boolean(activeSatellite && activeSatellite.available && activeSatellite.category !== 'unknown');

              return (
                <div className="ai-section">
                  <div className="ai-section-header-row">
                    <h4 className="ai-section-title">
                      <Satellite size={16} /> Satellite Evidence
                    </h4>
                    <span className="ai-provenance-tag">
                      Sentinel-2 10m
                    </span>
                  </div>

                  {satelliteLoading ? (
                    <div style={{ padding: '0.4rem 0', fontSize: '0.78rem' }} className="text-muted">
                      Querying satellite observations...
                    </div>
                  ) : isAvailable ? (
                    <>
                      <div className="ai-item">
                        <span className="ai-item-label">Source</span>
                        <span className="ai-item-value">{activeSatellite.source || 'Sentinel-2 10m Land Cover'}</span>
                      </div>
                      <div className="ai-item">
                        <span className="ai-item-label">Land Cover</span>
                        <span className="ai-item-value">{activeSatellite.className || 'Classified'}</span>
                      </div>
                      <div className="ai-item">
                        <span className="ai-item-label">Category</span>
                        <span className="ai-item-value" style={{ textTransform: 'capitalize' }}>
                          {activeSatellite.category}
                        </span>
                      </div>
                      <div className="ai-item">
                        <span className="ai-item-label">Risk Context</span>
                        <span className="ai-item-value">
                          {activeSatellite.category === 'bare'
                            ? 'Increased surface vulnerability'
                            : activeSatellite.category === 'vegetation'
                            ? 'Contextual root anchoring & stabilization'
                            : activeSatellite.category === 'cropland'
                            ? 'Managed agricultural drainage'
                            : activeSatellite.category === 'built_up'
                            ? 'Human infrastructure footprint'
                            : activeSatellite.category === 'water'
                            ? 'Aquatic surface environment'
                            : 'Contextual observation'}
                        </span>
                      </div>
                      <div className="ai-item">
                        <span className="ai-item-label">Contribution</span>
                        <span className="ai-item-value">
                          {activeSatellite.contributionPoints != null
                            ? `${activeSatellite.contributionPoints > 0 ? '+' : ''}${activeSatellite.contributionPoints} points`
                            : activeSatellite.category === 'bare'
                            ? '+5 points'
                            : activeSatellite.category === 'vegetation'
                            ? '-3 points'
                            : activeSatellite.category === 'cropland'
                            ? '+2 points'
                            : activeSatellite.category === 'built_up'
                            ? '+1 point'
                            : '0 points'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="ai-item">
                      <span className="ai-item-label">Status</span>
                      <span className="ai-item-value text-muted">Satellite evidence unavailable</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Historical Landslide Catalogue */}
            <div className="ai-section">
              <div className="ai-section-header-row">
                <h4 className="ai-section-title">
                  <Activity size={16} /> Historical Landslide Catalogue
                </h4>
                <span className="ai-provenance-tag">NASA Global Landslide Catalog</span>
              </div>
              <div className="ai-item">
                <span className="ai-item-label">Nearby Landslides</span>
                {data.evidenceAvailability?.historical && data.evidenceFusion?.evidence?.historical?.eventCount > 0 ? (
                  <span className="ai-item-value">
                    {data.evidenceFusion.evidence.historical.eventCount} recorded
                    {data.contextualData?.historicalEvents?.[0]?.distanceKm != null ? ` • nearest ${data.contextualData.historicalEvents[0].distanceKm} km` : ''}
                  </span>
                ) : (
                  <span className="ai-item-value text-muted">No historical landslides found in this area</span>
                )}
              </div>
              <div style={{ marginTop: '0.4rem', fontSize: '0.74rem' }} className="text-muted">
                Historical catalogue events for contextual awareness (not active hazards).
              </div>
            </div>

            {/* Field Reports */}
            <div className="ai-section">
              <div className="ai-section-header-row">
                <h4 className="ai-section-title">
                  <FileText size={16} /> Field Reports
                </h4>
                <span className="ai-provenance-tag">Ground field reports</span>
              </div>
              <div className="ai-item">
                <span className="ai-item-label">Nearby Reports</span>
                {data.evidenceAvailability?.fieldReports && data.evidenceFusion?.evidence?.fieldReports?.reportCount > 0 ? (
                  <span className="ai-item-value">
                    {data.evidenceFusion.evidence.fieldReports.reportCount} total
                    {data.contextualData?.fieldReports?.[0]?.distanceKm != null ? ` • nearest ${data.contextualData.fieldReports[0].distanceKm} km` : ''}
                  </span>
                ) : (
                  <span className="ai-item-value text-muted">No field reports logged in this area</span>
                )}
              </div>
              <div style={{ marginTop: '0.4rem', fontSize: '0.74rem' }} className="text-muted">
                Citizen & field-team observations (unverified observational evidence).
              </div>
            </div>

            {/* Infrastructure Exposure */}
            <div className="ai-section">
              <div className="ai-section-header-row">
                <h4 className="ai-section-title">
                  <Building size={16} /> Infrastructure Exposure
                </h4>
                <span className="ai-provenance-tag">Infrastructure database</span>
              </div>
              <div className="ai-item">
                <span className="ai-item-label">Critical Assets (50km)</span>
                <span className="ai-item-value">
                  {data.nearbyInfrastructure && data.nearbyInfrastructure.length > 0 
                    ? `${data.nearbyInfrastructure.length} assets` 
                    : <span className="text-muted">No infrastructure assets recorded in this area</span>}
                </span>
              </div>
              {data.nearbyInfrastructure && data.nearbyInfrastructure.length > 0 && (
                <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {data.nearbyInfrastructure.slice(0, 5).map((asset, idx) => (
                    <div 
                      key={asset._id || idx} 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '0.35rem 0.5rem', 
                        backgroundColor: 'hsla(var(--bg-secondary), 0.5)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--glass-border)',
                        fontSize: '0.8rem' 
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{asset.name}</div>
                        <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'capitalize' }}>
                          {asset.assetType?.replace('_', ' ')} {asset.status ? `• ${asset.status}` : ''} {asset.distanceKm != null ? `• ${asset.distanceKm} km` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {asset.operationalPriority?.score != null ? (
                          <span style={{ 
                            fontWeight: 700,
                            color: asset.operationalPriority.score >= 70 ? 'hsl(346, 87%, 55%)' : asset.operationalPriority.score >= 40 ? 'hsl(48, 96%, 53%)' : 'hsl(142, 71%, 45%)'
                          }}>
                            Priority {asset.operationalPriority.score}/100
                          </span>
                        ) : (
                          <span className="text-muted" style={{ fontSize: '0.75rem' }}>Operational</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Limitations / Reasoning */}
            {data.evidenceFusion?.limitations && data.evidenceFusion.limitations.length > 0 && (
              <div className="ai-section">
                <h4 className="ai-section-title" style={{ color: 'hsl(48, 96%, 43%)' }}>
                  <AlertTriangle size={16} /> Data Limitations
                </h4>
                <div className="ai-limitations">
                  <ul>
                    {data.evidenceFusion.limitations.map((limit, idx) => (
                      <li key={idx}>{limit}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            
            <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
              Intelligence gathered {new Date(data.retrievedAt).toLocaleTimeString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
