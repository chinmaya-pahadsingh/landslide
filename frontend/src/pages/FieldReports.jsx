import { useState, useEffect } from 'react';
import { fieldReportService } from '../services/fieldReportService';
import { offlineQueueService } from '../services/offlineQueueService';
import { useNetwork } from '../contexts/NetworkContext';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner, ErrorState, EmptyState } from '../components/StatusDisplay';
import { 
  MapPin, 
  Navigation, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  UploadCloud, 
  FileText, 
  Send, 
  Radio, 
  Compass, 
  ShieldAlert,
  Activity
} from 'lucide-react';
import './FieldReports.css';

const REPORT_TYPES = [
  { value: 'landslide', label: 'Landslide' },
  { value: 'flood', label: 'Flood' },
  { value: 'flash_flood', label: 'Flash Flood' },
  { value: 'road_blockage', label: 'Road Blockage' },
  { value: 'crack', label: 'Crack' },
  { value: 'slope_movement', label: 'Slope Movement' },
  { value: 'rockfall', label: 'Rockfall' },
  { value: 'other', label: 'Other' }
];

export default function FieldReports() {
  const [reports, setReports] = useState([]);
  const [queuedReports, setQueuedReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const { isOnline } = useNetwork();
  const { user, openAuthModal } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  // Form State
  const [formData, setFormData] = useState({
    reportType: 'landslide',
    latitude: '',
    longitude: '',
    description: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);

  const fetchReports = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fieldReportService.getAllReports();
      setReports(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to fetch field reports');
    } finally {
      setLoading(false);
    }
  };

  const fetchQueuedReports = async () => {
    try {
      const queued = await offlineQueueService.getQueuedReports();
      setQueuedReports(queued);
    } catch (err) {
      console.error('Failed to load queued reports:', err);
    }
  };

  const handleSyncQueue = async () => {
    if (isSyncing || queuedReports.length === 0 || !isOnline) return;
    
    setIsSyncing(true);
    setSyncError(null);
    let allSuccessful = true;

    try {
      for (const item of queuedReports) {
        try {
          // Send the specific queued item ID as the idempotency key
          await fieldReportService.submitReport(item.payload, item.id);
          // Only remove if it succeeds (or gracefully recovers via 200 OK from backend duplication catch)
          await offlineQueueService.removeReport(item.id);
        } catch (err) {
          console.error(`Failed to sync queued report ${item.id}:`, err);
          allSuccessful = false;
        }
      }
    } finally {
      setIsSyncing(false);
      fetchQueuedReports();
      fetchReports();
      
      if (!allSuccessful) {
        setSyncError('Some reports could not be synchronized. They remain in the queue to try again later.');
      }
    }
  };

  useEffect(() => {
    fetchReports();
    fetchQueuedReports();
  }, []);

  // Background Sync when network returns
  useEffect(() => {
    if (isOnline && queuedReports.length > 0 && !isSyncing) {
      handleSyncQueue();
    }
  }, [isOnline]); // Intentionally omitting queuedReports/isSyncing to avoid constant triggering

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Reset success/error messages on input change
    setSubmitError(null);
    setSubmitSuccess(false);
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setSubmitError('Geolocation is not supported by your browser.');
      return;
    }
    
    setLocationLoading(true);
    setSubmitError(null);
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormData(prev => ({
          ...prev,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6)
        }));
        setLocationLoading(false);
      },
      (err) => {
        setSubmitError(`Failed to get location: ${err.message}`);
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user) {
      openAuthModal();
      return;
    }

    setSubmitError(null);
    setSubmitSuccess(false);

    // Basic frontend validation to match backend
    const lat = parseFloat(formData.latitude);
    const lng = parseFloat(formData.longitude);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      setSubmitError('Invalid latitude. Must be between -90 and 90.');
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      setSubmitError('Invalid longitude. Must be between -180 and 180.');
      return;
    }
    if (formData.description.length > 1000) {
      setSubmitError('Description cannot exceed 1000 characters.');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        location: { latitude: lat, longitude: lng },
        reportType: formData.reportType,
        source: 'citizen',
      };
      
      if (formData.description.trim()) {
        payload.description = formData.description.trim();
      }

      // OFFLINE RESPONSE-LOSS DUPLICATION FIX:
      // Generate a single stable idempotency key for this specific submission attempt.
      // Whether it goes live or into the queue, this exact key ensures it is never saved twice.
      const idempotencyKey = crypto.randomUUID();

      if (!isOnline) {
        // Force offline queuing
        await offlineQueueService.queueReport(payload, idempotencyKey);
        setSubmitSuccess('Report queued offline. It will synchronize automatically when connection is restored.');
        fetchQueuedReports();
      } else {
        try {
          // Attempt live submission
          await fieldReportService.submitReport(payload, idempotencyKey);
          setSubmitSuccess('Report submitted successfully! Thank you for your contribution.');
          fetchReports();
        } catch (networkErr) {
          // If the network failed during request, queue it using the SAME idempotency key
          if (networkErr.message.includes('Failed to fetch') || !navigator.onLine) {
            await offlineQueueService.queueReport(payload, idempotencyKey);
            setSubmitSuccess('Network error during submission. Report has been safely queued offline.');
            fetchQueuedReports();
          } else {
            throw networkErr; // Throw other validation errors
          }
        }
      }
      
      setFormData({
        reportType: 'landslide',
        latitude: '',
        longitude: '',
        description: ''
      });
      
    } catch (err) {
      setSubmitError(err.message || 'Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    if (status === 'resolved') return 'badge-low';
    if (status === 'reviewed') return 'badge-mod';
    return 'badge-high'; // submitted
  };

  const getStatusLabel = (status) => {
    if (status === 'resolved') return 'Verified';
    if (status === 'reviewed') return 'Reviewed';
    return 'Pending';
  };

  return (
    <div className="page-container animate-fade-in field-reports-page">
      {/* Command Center Header */}
      <div className="field-reports-header glass-panel">
        <div className="field-reports-header-content">
          <div className="field-reports-title-group">
            <div className="field-reports-badge-row">
              <span className="location-pill">
                <Compass size={13} className="pill-icon" />
                <span>Ground Verification Grid</span>
              </span>
              <span className="badge badge-outline">
                <Radio size={12} />
                <span>Community & Field Sensing</span>
              </span>
              {isOnline ? (
                <span className="badge badge-low">
                  <span className="pulse-dot" />
                  <span>Telemetry Live</span>
                </span>
              ) : (
                <span className="badge badge-crit">
                  <span>Offline / Local Queue</span>
                </span>
              )}
              {queuedReports.length > 0 && (
                <span className="badge badge-warn">
                  <Clock size={12} />
                  <span>{queuedReports.length} Queued Offline</span>
                </span>
              )}
            </div>
            <h2 className="field-reports-title">Field & Citizen Observations</h2>
            <p className="field-reports-subtitle text-muted">
              Real-time ground-truth empirical evidence, slope instability reports, and community alerts across Northeast India.
            </p>
          </div>

          <div className="field-reports-header-actions">
            <button 
              className="btn btn-outline refresh-button-unified" 
              onClick={() => { fetchReports(); fetchQueuedReports(); }} 
              disabled={loading || isSyncing}
              title="Refresh reports and local queue"
              aria-label="Refresh reports and local queue"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              <span>{loading ? 'Refreshing...' : 'Refresh Feed'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="field-reports-layout">
        
        {/* Left Column: Report Submission Form */}
        <div className="report-form-panel glass-panel">
          <div className="panel-header-compact">
            <div className="panel-title-group">
              <h3 className="panel-title">
                <FileText size={18} className="panel-title-icon" />
                <span>Submit Field Observation</span>
              </h3>
              <span className="panel-subtitle">Record active hazard signs, cracks, or blockages</span>
            </div>
          </div>
          
          {submitError && (
            <div className="error-message">
              <AlertCircle size={16} className="error-icon" />
              <span>{submitError}</span>
            </div>
          )}
          
          {submitSuccess && (
            <div className={`success-message ${typeof submitSuccess === 'string' && submitSuccess.includes('queued') ? 'queued-message' : ''}`}>
              <CheckCircle2 size={16} className="success-icon" />
              <span>{typeof submitSuccess === 'string' ? submitSuccess : 'Report submitted successfully! Thank you for your contribution.'}</span>
            </div>
          )}

          <form className="report-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="reportType" className="form-label">
                Observation Type <span className="required-star">*</span>
              </label>
              <select 
                id="reportType" 
                name="reportType" 
                className="form-select"
                value={formData.reportType}
                onChange={handleInputChange}
                required
                disabled={isSubmitting}
              >
                {REPORT_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label">
                  Location Coordinates <span className="required-star">*</span>
                </label>
                <button 
                  type="button" 
                  className="btn btn-outline btn-locate" 
                  onClick={handleGetLocation}
                  disabled={isSubmitting || locationLoading}
                  title="Detect coordinates from device GPS"
                >
                  {locationLoading ? <LoadingSpinner size="small" /> : <Navigation size={13} />}
                  <span>{locationLoading ? 'Locating...' : 'Use My GPS'}</span>
                </button>
              </div>
              <div className="coordinates-row">
                <div className="coordinate-input-wrap">
                  <input 
                    type="number" 
                    id="latitude"
                    name="latitude"
                    placeholder="Latitude (e.g. 26.20)" 
                    className="form-input" 
                    step="any"
                    min="-90"
                    max="90"
                    value={formData.latitude}
                    onChange={handleInputChange}
                    required
                    disabled={isSubmitting}
                  />
                  <div className="form-hint">-90° to 90°</div>
                </div>
                <div className="coordinate-input-wrap">
                  <input 
                    type="number" 
                    id="longitude"
                    name="longitude"
                    placeholder="Longitude (e.g. 92.93)" 
                    className="form-input" 
                    step="any"
                    min="-180"
                    max="180"
                    value={formData.longitude}
                    onChange={handleInputChange}
                    required
                    disabled={isSubmitting}
                  />
                  <div className="form-hint">-180° to 180°</div>
                </div>
              </div>
            </div>

            <div className="form-group">
              <div className="form-label-row">
                <label htmlFor="description" className="form-label">
                  Observation Details <span className="optional-tag">(Optional)</span>
                </label>
                <span className={`char-count ${formData.description.length > 1000 ? 'limit-reached' : ''}`}>
                  {formData.description.length}/1000
                </span>
              </div>
              <textarea 
                id="description" 
                name="description" 
                className="form-textarea" 
                placeholder="Describe slope movement, cracks, road obstruction, water runoff, or affected infrastructure..."
                value={formData.description}
                onChange={handleInputChange}
                maxLength={1000}
                disabled={isSubmitting}
              ></textarea>
            </div>

            <div className="form-actions">
              <button 
                type="submit" 
                className="btn btn-primary btn-submit-report" 
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <LoadingSpinner size="small" />
                    <span>Submitting Report...</span>
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    <span>{!isOnline ? 'Queue Report Offline' : 'Submit Field Report'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Reports Feed & Offline Queue */}
        <div className="reports-feed-panel glass-panel">
          
          {/* Offline Queue Section */}
          {queuedReports.length > 0 && (
            <div className="offline-queue-box">
              <div className="queue-box-header">
                <div className="queue-title-wrap">
                  <Clock size={16} className="text-warn" />
                  <span className="queue-title">Pending Offline Queue</span>
                  <span className="queue-pill">{queuedReports.length}</span>
                </div>
                {isOnline && (
                  <button 
                    className="btn btn-primary btn-sync" 
                    onClick={handleSyncQueue}
                    disabled={isSyncing}
                    title="Upload queued reports now"
                  >
                    {isSyncing ? <LoadingSpinner size="small" /> : <UploadCloud size={14} />}
                    <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                  </button>
                )}
              </div>
              
              {syncError && (
                <div className="error-message sync-error">
                  <AlertCircle size={14} />
                  <span>{syncError}</span>
                </div>
              )}
              
              <div className="queued-cards-list">
                {queuedReports.map(report => (
                  <div key={report.id} className="report-card queued-card">
                    <div className="report-card-header">
                      <div className="report-type-wrap">
                        <Activity size={15} className="text-warn" />
                        <span className="report-type-name">
                          {report.payload.reportType ? report.payload.reportType.replace(/_/g, ' ') : 'Unknown'}
                        </span>
                      </div>
                      <span className="badge badge-mod">Pending Sync</span>
                    </div>
                    <div className="report-meta-row">
                      <div className="meta-pill" title="Date Queued">
                        <Clock size={12} className="meta-icon" />
                        <span>Queued {new Date(report.queuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="meta-pill" title="Coordinates">
                        <MapPin size={12} className="meta-icon" />
                        <span className="mono">{report.payload.location.latitude.toFixed(4)}°, {report.payload.location.longitude.toFixed(4)}°</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="feed-header-bar">
            <div className="feed-title-wrap">
              <h3 className="feed-title">
                <ShieldAlert size={18} className="panel-title-icon" />
                <span>Recent Ground Reports</span>
              </h3>
              <span className="feed-count-pill">{reports.length} Reports</span>
            </div>
            <span className="text-muted feed-hint">Chronological field telemetry</span>
          </div>

          {loading ? (
            <div className="feed-loading-state">
              <LoadingSpinner message="Fetching field reports feed..." />
            </div>
          ) : error ? (
            <div className="feed-error-state">
              <ErrorState 
                title="Feed Telemetry Unavailable" 
                message={error} 
                onRetry={fetchReports}
              />
            </div>
          ) : reports.length === 0 ? (
            <div className="feed-empty-state">
              <EmptyState 
                title="No Field Reports Logged" 
                message="No citizen or field team observations have been recorded yet. Submit the first report to help ground verification."
              />
            </div>
          ) : (
            <div className="reports-list">
              {reports.map(report => (
                <div key={report._id || report.id} className="report-card">
                  <div className="report-card-header">
                    <div className="report-type-wrap">
                      <ShieldAlert size={16} className="report-type-icon" />
                      <span className="report-type-name">
                        {report.reportType ? report.reportType.replace(/_/g, ' ') : 'General Incident'}
                      </span>
                    </div>
                    <span className={`badge ${getStatusBadgeClass(report.status)}`}>
                      {getStatusLabel(report.status)}
                    </span>
                  </div>
                  
                  <div className="report-meta-row">
                    <div className="meta-pill" title="Date Reported">
                      <Clock size={12} className="meta-icon" />
                      <span>{new Date(report.reportedAt).toLocaleDateString()} at {new Date(report.reportedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="meta-pill" title="Location Coordinates">
                      <MapPin size={12} className="meta-icon" />
                      <span className="mono">{report.location.latitude.toFixed(4)}°, {report.location.longitude.toFixed(4)}°</span>
                    </div>
                    <div className="meta-pill source-pill" title="Reporting Source">
                      <span className="source-dot" />
                      <span>{report.source ? report.source.replace(/_/g, ' ') : 'citizen'}</span>
                    </div>
                  </div>

                  {report.description && (
                    <div className="report-desc-box">
                      <p className="report-desc-text">{report.description}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        
      </div>
    </div>
  );
}
