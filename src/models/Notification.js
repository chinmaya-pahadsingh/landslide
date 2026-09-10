const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['warning', 'risk_escalation', 'infrastructure_priority', 'field_report', 'news', 'system', 'other'],
    },
    severity: {
      type: String,
      required: true,
      enum: ['info', 'advisory', 'watch', 'warning', 'critical'],
    },
    priority: {
      type: String,
      required: true,
      enum: ['low', 'medium', 'high', 'critical'],
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      maxlength: 1000,
      trim: true,
    },
    location: {
      latitude: {
        type: Number,
        min: -90,
        max: 90,
      },
      longitude: {
        type: Number,
        min: -180,
        max: 180,
      },
      name: {
        type: String,
        maxlength: 100,
      }
    },
    source: {
      type: {
        type: String,
        enum: ['early_warning_system', 'user', 'external', 'system'],
      },
      referenceId: {
        type: String,
        maxlength: 100,
      }
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
    },
    deduplicationKey: {
      type: String,
      unique: true,
      sparse: true,
      maxlength: 250,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    }
  },
  {
    timestamps: true,
  }
);

// Indexes for querying efficiency
notificationSchema.index({ isRead: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ severity: 1, priority: 1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
