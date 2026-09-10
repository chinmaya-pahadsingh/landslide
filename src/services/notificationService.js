const Notification = require('../models/Notification');

/**
 * Validates the notification input data safely.
 */
const validateNotification = (data) => {
  if (!data || typeof data !== 'object') return false;
  if (!data.type || !data.severity || !data.priority || !data.title || !data.message) return false;
  return true;
};

/**
 * Creates a notification safely. Handles deduplication.
 * @param {Object} data 
 */
const createNotification = async (data) => {
  if (!validateNotification(data)) {
    return { success: false, reason: 'Invalid notification data' };
  }

  try {
    // If there is a deduplicationKey, we can use upsert to prevent duplicates
    if (data.deduplicationKey) {
      // Find an existing one that hasn't expired yet
      const existing = await Notification.findOne({ deduplicationKey: data.deduplicationKey });
      if (existing) {
        return { success: true, isDuplicate: true, notification: existing };
      }
    }

    const doc = new Notification(data);
    await doc.save();
    return { success: true, isDuplicate: false, notification: doc };
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate key error from MongoDB (race condition)
      return { success: true, isDuplicate: true, reason: 'Caught duplicate key' };
    }
    console.error('Error creating notification:', err);
    return { success: false, reason: 'Database error' };
  }
};

/**
 * Translates an early warning decision into a notification.
 * @param {Object} decision - output from earlyWarningService
 */
const notifyEarlyWarning = async (decision) => {
  if (!decision || typeof decision !== 'object' || decision.decisionStatus !== 'success') {
    return { success: false, reason: 'Invalid or unsuccessful decision' };
  }

  // Only notify on elevated risks
  const { warningLevel, location, triggers } = decision;
  if (!['watch', 'warning', 'critical'].includes(warningLevel)) {
    return { success: true, reason: 'Warning level not high enough for notification' };
  }

  // Generate deduplication key based on day, level, and location (~110m spatial resolution, approx 10,000 m² area for deduplication)
  const refDate = decision.generatedAt ? new Date(decision.generatedAt) : new Date();
  const today = !isNaN(refDate.getTime()) ? refDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const latStr = typeof location?.latitude === 'number' && isFinite(location.latitude) ? location.latitude.toFixed(3) : 'none';
  const lngStr = typeof location?.longitude === 'number' && isFinite(location.longitude) ? location.longitude.toFixed(3) : 'none';
  const dedupKey = `ew_${warningLevel}_${latStr}_${lngStr}_${today}`;

  let severity = 'info';
  let priority = 'low';

  if (warningLevel === 'watch') {
    severity = 'watch';
    priority = 'medium';
  } else if (warningLevel === 'warning') {
    severity = 'warning';
    priority = 'high';
  } else if (warningLevel === 'critical') {
    severity = 'critical';
    priority = 'critical';
  }

  const primaryTrigger = triggers && triggers.length > 0 ? triggers[0].detail : 'Elevated hazard detected.';

  const notificationData = {
    type: 'warning',
    severity,
    priority,
    title: `Early Warning: ${warningLevel.toUpperCase()}`,
    message: primaryTrigger,
    location: location,
    source: {
      type: 'early_warning_system'
    },
    deduplicationKey: dedupKey
  };

  return await createNotification(notificationData);
};

/**
 * Retrieves notifications based on filters.
 */
const getNotifications = async (filters = {}) => {
  try {
    const query = {};
    if (filters.unreadOnly) query.isRead = false;
    if (filters.severity) query.severity = filters.severity;
    if (filters.type) query.type = filters.type;

    // Filter out expired notifications
    query.$or = [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ];

    const page = parseInt(filters.page, 10) || 1;
    const limit = Math.min(parseInt(filters.limit, 10) || 20, 100);
    const skip = (page - 1) * limit;

    const total = await Notification.countDocuments(query);
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Unread count specifically
    const unreadCount = await Notification.countDocuments({
      isRead: false,
      $or: query.$or
    });

    return {
      success: true,
      data: notifications,
      meta: {
        total,
        page,
        limit,
        unreadCount
      }
    };
  } catch (err) {
    console.error('Error fetching notifications:', err);
    throw new Error('Database fetch failed');
  }
};

/**
 * Marks a single notification as read.
 */
const markAsRead = async (id) => {
  try {
    const doc = await Notification.findByIdAndUpdate(id, { isRead: true }, { new: true });
    if (!doc) return { success: false, reason: 'Not found' };
    return { success: true, notification: doc };
  } catch (err) {
    console.error('Error marking as read:', err);
    throw new Error('Database update failed');
  }
};

/**
 * Marks all appropriate notifications as read.
 */
const markAllAsRead = async () => {
  try {
    await Notification.updateMany({ isRead: false }, { $set: { isRead: true } });
    return { success: true };
  } catch (err) {
    console.error('Error marking all as read:', err);
    throw new Error('Database update failed');
  }
};

module.exports = {
  createNotification,
  notifyEarlyWarning,
  getNotifications,
  markAsRead,
  markAllAsRead
};
