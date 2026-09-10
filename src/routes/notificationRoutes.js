const express = require('express');
const router = express.Router();
const { 
  getAllNotifications, 
  getNotificationById, 
  markNotificationRead, 
  markAllNotificationsRead,
  createNewNotification 
} = require('../controllers/notificationController');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

router.get('/', getAllNotifications);
router.post('/', authenticate, requireRole('admin', 'authority'), createNewNotification);
router.patch('/read-all', authenticate, requireRole('admin', 'authority'), markAllNotificationsRead);
router.get('/:id', getNotificationById);
router.patch('/:id/read', authenticate, requireRole('admin', 'authority'), markNotificationRead);

module.exports = router;
