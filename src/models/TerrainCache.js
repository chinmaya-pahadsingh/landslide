const mongoose = require('mongoose');

const terrainCacheSchema = new mongoose.Schema({
  cellKey: {
    type: String,
    required: true,
    unique: true
  },
  elevation: {
    type: Number,
    default: null
  },
  slope: {
    type: Number,
    default: null
  },
  cachedAt: {
    type: Date,
    required: true,
    default: Date.now
  }
});

const TerrainCache = mongoose.model('TerrainCache', terrainCacheSchema);

module.exports = TerrainCache;
