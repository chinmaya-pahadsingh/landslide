import React, { useState, useEffect, useMemo } from 'react';
import { newsAPI } from '../services/api';
import { LoadingSpinner, ErrorState, EmptyState } from '../components/StatusDisplay';
import { RefreshCw, ExternalLink, ShieldCheck, Newspaper, AlertTriangle, Clock, MapPin, CheckCircle2 } from 'lucide-react';
import { filterAndPrioritizeDisasterArticles } from '../utils/disasterNewsFilter';
import './News.css';

export default function News() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'OFFICIAL' | 'NEWS'
  const [cooldownMinutes, setCooldownMinutes] = useState(0);

  const fetchNews = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await newsAPI.getAll({ limit: 50 });
      setArticles(response.data?.articles || []);
      if (response.data?.cooldownRemainingMinutes) {
        setCooldownMinutes(response.data.cooldownRemainingMinutes);
      }
    } catch (err) {
      console.error('Error fetching news:', err);
      setError(err.message || 'Failed to load news and alerts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setRefreshStatus(null);
      const res = await newsAPI.refresh();

      if (res.data?.providerStatus === 'unavailable' || res.data?.providerStatus === 'error') {
        setRefreshStatus({ type: 'warning', text: `Provider Notice: ${res.data.reason || 'Could not fetch live news'}` });
      } else if (res.data?.providerStatus === 'cached') {
        const remaining = res.data?.cooldownRemainingMinutes;
        const msg = remaining
          ? `Refresh available in ${remaining} minute${remaining === 1 ? '' : 's'}. Showing stored alerts.`
          : (res.data?.message || 'Using recently cached alerts (1-hour window active).');
        setRefreshStatus({ type: 'info', text: msg });
        if (remaining) setCooldownMinutes(remaining);
      } else {
        setRefreshStatus({
          type: 'success',
          text: `Success: Found ${res.data?.processedCount || 0}, Saved ${res.data?.savedCount || 0} new articles.`
        });
        setCooldownMinutes(60);
      }

      await fetchNews();
    } catch (err) {
      console.error('Error during refresh:', err);
      // Surface the real error from the backend (e.g. 403 "Access denied. Insufficient privileges.")
      setRefreshStatus({ type: 'error', text: err.message || 'Refresh failed unexpectedly.' });
    } finally {
      setRefreshing(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Recent';
    return new Date(dateString).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const formatDisasterType = (category, fallbackType) => {
    const raw = category || fallbackType;
    if (!raw) return 'OTHER DISASTER';
    return raw.replace(/_/g, ' ').toUpperCase();
  };

  // Disaster-only filtering & NER prioritization before rendering
  const disasterArticles = useMemo(() => {
    return filterAndPrioritizeDisasterArticles(articles);
  }, [articles]);

  const filteredArticles = useMemo(() => {
    return disasterArticles.filter(article => {
      if (activeFilter === 'OFFICIAL') return article.source?.type === 'OFFICIAL';
      if (activeFilter === 'NEWS') return article.source?.type !== 'OFFICIAL';
      return true;
    });
  }, [disasterArticles, activeFilter]);

  const officialCount = useMemo(() => {
    return disasterArticles.filter(a => a.source?.type === 'OFFICIAL').length;
  }, [disasterArticles]);

  const mediaCount = disasterArticles.length - officialCount;

  return (
    <div className="page-container drawer-slide-in">
      {/* Header */}
      <div className="news-header-card glass-card">
        <div className="news-header-info">
          <h2>Disaster News & Situation Feeds</h2>
          <p className="text-muted" style={{ marginTop: '0.25rem' }}>
            Aggregated situational awareness from NDMA, state agencies, and verified regional media sources.
          </p>
        </div>
        <div className="news-header-actions">
          <button
            className="btn btn-outline"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title={cooldownMinutes > 0 ? `Refresh available in ${cooldownMinutes} minutes. Refresh news sources from external providers` : "Refresh news sources from external providers"}
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            <span>{refreshing ? 'Refreshing Feeds...' : 'Refresh Sources'}</span>
          </button>
        </div>
      </div>


      {/* Refresh Status Banner */}
      {refreshStatus && (
        <div className={`news-status-banner banner-${refreshStatus.type}`}>
          {refreshStatus.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{refreshStatus.text}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="news-toolbar glass-card">
        <div className="filter-tabs" role="tablist">
          <button
            className={`filter-tab ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            All Feeds ({disasterArticles.length})
          </button>
          <button
            className={`filter-tab ${activeFilter === 'OFFICIAL' ? 'active' : ''}`}
            onClick={() => setActiveFilter('OFFICIAL')}
          >
            Official Bulletins ({officialCount})
          </button>
          <button
            className={`filter-tab ${activeFilter === 'NEWS' ? 'active' : ''}`}
            onClick={() => setActiveFilter('NEWS')}
          >
            Media Coverage ({mediaCount})
          </button>
        </div>
      </div>

      {/* Content Feed */}
      {loading ? (
        <div style={{ padding: '4rem 0' }}>
          <LoadingSpinner message="Scanning regional news feeds..." />
        </div>
      ) : error ? (
        <ErrorState
          title="Feed Loading Error"
          message={error}
          onRetry={fetchNews}
        />
      ) : disasterArticles.length === 0 ? (
        <EmptyState
          title="No Relevant Disaster News Available"
          message="No relevant disaster news available right now."
        />
      ) : filteredArticles.length === 0 ? (
        <EmptyState
          title="No News or Alerts Available"
          message="No articles or official bulletins found matching your current filter. Try clicking 'Refresh Sources' above."
        />
      ) : (
        <div className="news-grid">
          {filteredArticles.map(article => {
            const isOfficial = article.source?.type === 'OFFICIAL';

            return (
              <div
                key={article._id || article.id}
                className={`news-card ${isOfficial ? 'official-card' : ''}`}
              >
                <div className="news-card-header">
                  <div className="news-badges">
                    {isOfficial ? (
                      <span className="badge badge-crit official-badge">
                        <ShieldCheck size={12} />
                        Official Alert
                      </span>
                    ) : (
                      <span className="badge badge-outline news-badge">
                        <Newspaper size={12} />
                        Media Report
                      </span>
                    )}

                    <span className="badge badge-outline disaster-type-badge">
                      {formatDisasterType(article.disasterCategory, article.disasterType)}
                    </span>
                  </div>

                  {article.importance > 50 && (
                    <span className="importance-chip" title="Calculated situational importance rank">
                      Rank {article.importance}
                    </span>
                  )}
                </div>

                <h3 className="news-card-title">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="news-link"
                  >
                    <span>{article.title}</span>
                    <ExternalLink size={14} className="external-icon" />
                  </a>
                </h3>

                <p className="news-card-summary">
                  {article.summary || 'No detailed summary provided for this bulletin.'}
                </p>

                <div className="news-card-footer">
                  <div className="news-footer-item">
                    <span className="footer-label">Source:</span>
                    <span className="footer-value">{article.source?.name || 'External'}</span>
                  </div>

                  <div className="news-footer-item">
                    <Clock size={12} className="text-muted" />
                    <span>{formatDate(article.publishedAt)}</span>
                  </div>

                  {article.location?.state && (
                    <div className="news-footer-item">
                      <MapPin size={12} className="text-muted" />
                      <span>{article.location.state}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
