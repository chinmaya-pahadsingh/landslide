const mongoose = require('mongoose');

const newsSyncMetaSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'news_api_sync',
    },
    lastRefreshedAt: {
      type: Date,
      default: null,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['idle', 'in_progress', 'success', 'failed'],
      default: 'idle',
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const NewsSyncMeta = mongoose.model('NewsSyncMeta', newsSyncMetaSchema);

module.exports = NewsSyncMeta;
