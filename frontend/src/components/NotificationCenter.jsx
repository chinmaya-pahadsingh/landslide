import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { notificationAPI } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import './NotificationCenter.css';

const getSeverityIcon = (severity) => {
  switch (severity) {
    case 'critical':
      return <AlertTriangle size={18} className="icon-critical" />;
    case 'warning':
      return <AlertTriangle size={18} className="icon-warning" />;
    case 'watch':
      return <AlertCircle size={18} className="icon-watch" />;
    case 'advisory':
      return <Info size={18} className="icon-advisory" />;
    default:
      return <Info size={18} className="icon-info" />;
  }
};

const getSeverityClass = (severity) => {
  return `notification-item severity-${severity}`;
};

const formatTimeAgo = (dateString, t) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) return t('Just now');
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  return `${Math.floor(diffInSeconds / 86400)}d ago`;
};

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const dropdownRef = useRef(null);
  const { t } = useLanguage();

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await notificationAPI.getAll({ limit: 10 });
      setNotifications(res.data.data || []);
      setUnreadCount(res.data.meta?.unreadCount || 0);
    } catch (err) {
      console.error('Error fetching notifications:', err);
      setError(t('Unable to load notifications. Try again.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      fetchNotifications();
    }
  };

  const handleMarkAsRead = async (id, e) => {
    if (e) e.stopPropagation();
    setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    window.dispatchEvent(new CustomEvent('alertsUpdated'));
    try {
      await notificationAPI.markAsRead(id);
    } catch (err) {
      console.warn('Failed to mark as read on server', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
    window.dispatchEvent(new CustomEvent('alertsUpdated'));
    try {
      await notificationAPI.markAllAsRead();
    } catch (err) {
      console.warn('Failed to mark all as read on server', err);
    }
  };

  return (
    <div className="notification-center" ref={dropdownRef}>
      <button 
        className={`notification-bell ${isOpen ? 'active' : ''}`} 
        onClick={handleToggle}
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="unread-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown">
          <div className="dropdown-header">
            <h3>{t('Notifications')}</h3>
            {unreadCount > 0 && (
              <button className="mark-all-btn" onClick={handleMarkAllAsRead}>
                <CheckCircle2 size={14} />
                {t('Mark all read')}
              </button>
            )}
          </div>
          
          <div className="dropdown-body">
            {loading && notifications.length === 0 ? (
              <div className="dropdown-message">{t('Loading notifications...')}</div>
            ) : error ? (
              <div className="dropdown-message error">{error}</div>
            ) : notifications.length === 0 ? (
              <div className="dropdown-message">{t('No active notifications')}</div>
            ) : (
              <div className="notification-list">
                {notifications.map(notification => (
                  <div 
                    key={notification._id} 
                    className={`${getSeverityClass(notification.severity)} ${notification.isRead ? 'read' : 'unread'}`}
                  >
                    <div className="notification-icon">
                      {getSeverityIcon(notification.severity)}
                    </div>
                    <div className="notification-content">
                      <div className="notification-title-row">
                        <h4>{t(notification.title)}</h4>
                        <span className="notification-time">{formatTimeAgo(notification.createdAt, t)}</span>
                      </div>
                      <p className="notification-message">{t(notification.message)}</p>
                      
                      {notification.location?.name && (
                        <div className="notification-location">
                          📍 {notification.location.name}
                        </div>
                      )}
                    </div>
                    {!notification.isRead && (
                      <button 
                        className="mark-read-single" 
                        onClick={(e) => handleMarkAsRead(notification._id, e)}
                        title="Mark as read"
                        aria-label="Mark as read"
                      >
                        <Check size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="dropdown-footer">
            <Link to="/alerts" className="view-all-btn" onClick={() => setIsOpen(false)}>
              View all alerts &rarr;
            </Link>
            <button className="btn btn-ghost btn-sm" onClick={fetchNotifications} title="Refresh">
              {t('Refresh')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
