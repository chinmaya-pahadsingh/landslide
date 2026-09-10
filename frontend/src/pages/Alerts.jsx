import React, { useState, useEffect, useCallback } from 'react';
import { notificationAPI } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { LoadingSpinner, ErrorState } from '../components/StatusDisplay';
import { 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  RefreshCw, 
  Check, 
  ShieldCheck,
  RotateCcw
} from 'lucide-react';
import './Alerts.css';

export default function Alerts() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [severityFilter, setSeverityFilter] = useState('all'); // 'all' | 'critical' | 'warning' | 'watch' | 'advisory'
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { t } = useLanguage();

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await notificationAPI.getAll({ limit: 100 });
      const list = res.data?.data || [];
      setNotifications(list);
      // Synchronize global alerts state
      window.dispatchEvent(new CustomEvent('alertsUpdated'));
    } catch (err) {
      console.error('Error fetching alerts:', err);
      setError(err.message || 'Failed to load system alerts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await fetchAlerts();
    } finally {
      setRefreshing(false);
    }
  };

  const handleMarkAsRead = async (id) => {
    // Optimistically update UI immediately
    setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
    window.dispatchEvent(new CustomEvent('alertsUpdated'));
    try {
      await notificationAPI.markAsRead(id);
    } catch (err) {
      console.warn('Failed to mark alert as read on server:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    // Optimistically update UI immediately
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    window.dispatchEvent(new CustomEvent('alertsUpdated'));
    try {
      await notificationAPI.markAllAsRead();
    } catch (err) {
      console.warn('Failed to mark all alerts as read on server:', err);
    }
  };

  // Metrics computation
  const totalCount = notifications.length;
  const criticalCount = notifications.filter(n => n.severity === 'critical').length;
  const warningCount = notifications.filter(n => n.severity === 'warning').length;
  const watchCount = notifications.filter(n => n.severity === 'watch').length;
  const advisoryCount = notifications.filter(n => n.severity === 'advisory').length;
  const unreadCount = notifications.filter(n => !n.isRead).length;

  // Filtering
  const filteredAlerts = notifications.filter(n => {
    if (severityFilter !== 'all' && n.severity !== severityFilter) return false;
    if (unreadOnly && n.isRead) return false;
    return true;
  });

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle size={17} className="icon-critical" />;
      case 'warning':
        return <AlertTriangle size={17} className="icon-warning" />;
      case 'watch':
        return <AlertCircle size={17} className="icon-watch" />;
      case 'advisory':
        return <Info size={17} className="icon-advisory" />;
      default:
        return <Info size={17} className="icon-info" />;
    }
  };

  const getSeverityBadge = (severity) => {
    switch (severity) {
      case 'critical':
        return <span className="badge badge-crit">Critical</span>;
      case 'warning':
        return <span className="badge badge-warn">Warning</span>;
      case 'watch':
        return <span className="badge badge-watch">Watch</span>;
      case 'advisory':
        return <span className="badge badge-advisory">Advisory</span>;
      default:
        return <span className="badge badge-info">{severity || 'Info'}</span>;
    }
  };

  const formatSource = (source) => {
    if (!source) return null;
    if (typeof source === 'string') return source.replace(/_/g, ' ');
    if (typeof source === 'object') {
      if (source.name) return source.name;
      const parts = [];
      if (source.type) parts.push(source.type.replace(/_/g, ' '));
      if (source.referenceId) parts.push(source.referenceId);
      return parts.length > 0 ? parts.join(' • ') : 'System';
    }
    return String(source);
  };

  return (
    <div className="page-container animate-fade-in alerts-page-wrapper">
      {/* Header */}
      <div className="alerts-header glass-card">
        <div className="alerts-header-info">
          <h2>{t('System Early Warnings & Alerts')}</h2>
          <p className="text-muted" style={{ marginTop: '0.25rem' }}>
            {t('Automated notifications, multi-source hazard triggers, and regional sensor anomaly telemetry.')}
          </p>
        </div>
        <div className="alerts-header-actions">
          {unreadCount > 0 && (
            <button 
              className="btn btn-outline"
              onClick={handleMarkAllAsRead}
              title="Mark all alerts as read"
            >
              <CheckCircle2 size={15} />
              <span>{t('Mark all read')}</span>
            </button>
          )}
          <button 
            className="btn btn-outline"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Refresh alerts feed"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            <span>{refreshing ? t('Updating...') : t('Refresh')}</span>
          </button>
        </div>
      </div>

      {/* Metrics Summary Grid */}
      <div className="alerts-metrics-grid">
        <div className="alerts-metric-card">
          <div className="metric-card-info">
            <span className="metric-card-label">{t('Total Feed')}</span>
            <span className="metric-card-value">{totalCount}</span>
          </div>
          <div className="metric-card-icon total">
            <Info size={18} />
          </div>
        </div>

        <div className="alerts-metric-card">
          <div className="metric-card-info">
            <span className="metric-card-label">{t('Critical')}</span>
            <span className={`metric-card-value ${criticalCount > 0 ? 'text-danger' : 'text-muted'}`}>
              {criticalCount}
            </span>
          </div>
          <div className={`metric-card-icon ${criticalCount > 0 ? 'critical' : 'neutral'}`}>
            <AlertTriangle size={18} />
          </div>
        </div>

        <div className="alerts-metric-card">
          <div className="metric-card-info">
            <span className="metric-card-label">{t('Warnings')}</span>
            <span 
              className="metric-card-value" 
              style={{ color: warningCount > 0 ? 'hsl(var(--status-warn))' : 'hsl(var(--text-muted))' }}
            >
              {warningCount}
            </span>
          </div>
          <div className={`metric-card-icon ${warningCount > 0 ? 'warning' : 'neutral'}`}>
            <AlertTriangle size={18} />
          </div>
        </div>

        <div className="alerts-metric-card">
          <div className="metric-card-info">
            <span className="metric-card-label">{t('Unread')}</span>
            <span className={`metric-card-value ${unreadCount > 0 ? 'text-primary' : 'text-muted'}`}>
              {unreadCount}
            </span>
          </div>
          <div className={`metric-card-icon ${unreadCount > 0 ? 'unread' : 'neutral'}`}>
            <CheckCircle2 size={18} />
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="alerts-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="Alert severity filters">
          {[
            { id: 'all', label: t('All'), count: totalCount },
            { id: 'critical', label: t('Critical'), count: criticalCount },
            { id: 'warning', label: t('Warning'), count: warningCount },
            { id: 'watch', label: t('Watch'), count: watchCount },
            { id: 'advisory', label: t('Advisory'), count: advisoryCount },
          ].map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={severityFilter === tab.id}
              className={`filter-tab ${severityFilter === tab.id ? 'active' : ''}`}
              onClick={() => setSeverityFilter(tab.id)}
            >
              <span>{tab.label}</span>
              <span className={`filter-count-pill ${tab.count > 0 ? 'has-count' : 'zero'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="read-filter-toggle">
          <button
            className={`btn btn-sm ${unreadOnly ? 'btn-primary' : 'btn-outline'} unread-toggle-btn`}
            onClick={() => setUnreadOnly(!unreadOnly)}
          >
            {unreadOnly ? t('Showing Unread Only') : t('Show Unread Only')}
          </button>
        </div>
      </div>

      {/* Main Alert Feed */}
      {loading ? (
        <div style={{ padding: '4rem 0' }}>
          <LoadingSpinner message="Loading early warning notifications..." />
        </div>
      ) : error ? (
        <ErrorState 
          title="Notification Error" 
          message={error} 
          onRetry={fetchAlerts} 
        />
      ) : totalCount === 0 ? (
        /* Reassuring Operational Empty State without overclaiming */
        <div className="alerts-nominal-banner glass-card">
          <div className="nominal-status-header">
            <div className="nominal-badge">
              <span className="nominal-pulse-dot" />
              <span>{t('MONITORING FEED ACTIVE')}</span>
            </div>
          </div>
          <div className="nominal-content-body">
            <div className="nominal-shield-wrap">
              <ShieldCheck size={48} className="nominal-shield-icon" />
            </div>
            <div className="nominal-text-wrap">
              <h3 className="nominal-title">{t('No Active Alerts')}</h3>
              <p className="nominal-desc">
                {t('There are currently no active alerts in the available monitoring data.')}
              </p>
            </div>
          </div>
          <div className="nominal-details-row">
            <div className="nominal-meta-chip">
              <span className="chip-label">{t('System Status')}:</span>
              <span className="chip-value text-success">{t('Monitoring Active')}</span>
            </div>
            <div className="nominal-meta-chip">
              <span className="chip-label">{t('Last Synchronized')}:</span>
              <span className="chip-value">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
      ) : filteredAlerts.length === 0 ? (
        /* Filtered Empty State */
        <div className="alerts-empty-filtered glass-card">
          <Info size={40} className="empty-filtered-icon text-muted" />
          <h3 className="empty-filtered-title">
            {unreadOnly 
              ? t("No Unread Alerts") 
              : severityFilter === 'critical'
                ? t("No Critical Alerts Found")
                : severityFilter === 'warning'
                  ? t("No Warning Alerts Found")
                  : severityFilter === 'watch'
                    ? t("No Watch Alerts Found")
                    : severityFilter === 'advisory'
                      ? t("No Advisory Alerts Found")
                      : t("No Alerts Matching Criteria")}
          </h3>
          <p className="empty-filtered-msg">
            {unreadOnly 
              ? t("You are all caught up! No unread notifications found.") 
              : t(`There are currently no ${severityFilter} alerts in the available feed.`)}
          </p>
          {(severityFilter !== 'all' || unreadOnly) && (
            <button 
              className="btn btn-outline btn-sm"
              style={{ marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              onClick={() => {
                setSeverityFilter('all');
                setUnreadOnly(false);
              }}
            >
              <RotateCcw size={14} />
              <span>{t('Reset Filters')}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="alerts-feed">
          {filteredAlerts.map((alert) => (
            <div 
              key={alert._id} 
              className={`alert-feed-card severity-${alert.severity || 'info'} ${alert.isRead ? 'read' : 'unread'}`}
            >
              <div className="alert-card-header">
                <div className="alert-card-meta-left">
                  {getSeverityIcon(alert.severity)}
                  {getSeverityBadge(alert.severity)}
                  {!alert.isRead && (
                    <span className="alert-unread-pill">Unread</span>
                  )}
                </div>

                <div className="alert-card-time">
                  <Clock size={13} />
                  <span>
                    {alert.createdAt && !isNaN(new Date(alert.createdAt).getTime())
                      ? new Date(alert.createdAt).toLocaleString()
                      : t('Recent')}
                  </span>
                </div>
              </div>

              <h3 className="alert-card-title">
                {t(alert.title)}
              </h3>

              <p className="alert-card-message">
                {t(alert.message)}
              </p>

              <div className="alert-card-footer">
                <div className="alert-footer-left">
                  {(alert.location?.name || (typeof alert.location === 'string' && alert.location)) && (
                    <span className="alert-location-tag">
                      <MapPin size={13} />
                      {typeof alert.location === 'string' ? alert.location : alert.location.name}
                    </span>
                  )}
                  {formatSource(alert.source) && (
                    <span className="alert-source-tag text-muted">
                      Source: {formatSource(alert.source)}
                    </span>
                  )}
                </div>

                {!alert.isRead && (
                  <button 
                    className="btn btn-outline btn-sm"
                    onClick={() => handleMarkAsRead(alert._id)}
                    title="Mark alert as read"
                  >
                    <Check size={13} />
                    <span>Mark as read</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
