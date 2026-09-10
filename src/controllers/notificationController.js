const mongoose = require('mongoose');
const { getNotifications, markAsRead, markAllAsRead, createNotification } = require('../services/notificationService');
const Notification = require('../models/Notification');

/**
 * GET /api/notifications
 */
const getAllNotifications = async (req, res) => {
  try {
    const filters = {
      unreadOnly: req.query.unread === 'true',
      severity: req.query.severity,
      type: req.query.type,
      page: req.query.page,
      limit: req.query.limit
    };

    const result = await getNotifications(filters);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

/**
 * GET /api/notifications/:id
 */
const getNotificationById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid notification ID format.' });
    }

    const doc = await Notification.findById(id);

    if (!doc) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    res.status(200).json(doc);
  } catch (error) {
    console.error('Error fetching notification by ID:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

/**
 * PATCH /api/notifications/:id/read
 */
const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid notification ID format.' });
    }

    const result = await markAsRead(id);
    if (!result.success) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    res.status(200).json(result.notification);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

/**
 * PATCH /api/notifications/read-all
 */
const markAllNotificationsRead = async (req, res) => {
  try {
    await markAllAsRead();
    res.status(200).json({ message: 'All unread notifications marked as read.' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

/**
 * POST /api/notifications
 * Controlled internal/test creation
 */
const createNewNotification = async (req, res) => {
  try {
    const input = req.body;
    
    // In a real application, you'd protect this with roles.
    // For now, we allow structured creation for testing.
    const result = await createNotification(input);
    
    if (!result.success) {
      return res.status(400).json({ error: result.reason || 'Invalid notification data' });
    }
    
    if (result.isDuplicate) {
      return res.status(200).json({ 
        message: 'Duplicate notification suppressed', 
        notification: result.notification || null 
      });
    }

    res.status(201).json(result.notification);
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

module.exports = {
  getAllNotifications,
  getNotificationById,
  markNotificationRead,
  markAllNotificationsRead,
  createNewNotification
};
