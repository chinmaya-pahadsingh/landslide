const mongoose = require('mongoose');

const rainfallObservationSchema = new mongoose.Schema(
  {
    location: {
      latitude: {
        type: Number,
        required: true,
        min: -90,
        max: 90
      },
      longitude: {
        type: Number,
        required: true,
        min: -180,
        max: 180
      }
    },
    rainfall: {
      type: Number,
      required: true,
      min: 0
    },
    rainfall24h: {
      type: Number,
      min: 0,
      default: null
    },
    currentIntervalPrecipitation: {
      type: Number,
      min: 0,
      default: null
    },
    recordedAt: {
      type: Date,
      default: Date.now
    },
    source: {
      type: String,
      required: true,
      enum: ['sensor', 'weather_api', 'official', 'simulation', 'historical_api']
    },
    provenance: {
      sourceName: String,
      sourceRecordId: String,
      sourceUrlVersion: String,
      sourceAccessDate: Date,
      originalEventDate: Date,
      importBatchId: String,
      importedAt: Date,
      transformationNotes: String
    }
  },
  {
    timestamps: true
  }
);

const RainfallObservation = mongoose.model('RainfallObservation', rainfallObservationSchema);

module.exports = RainfallObservation;
