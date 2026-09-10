const mongoose = require('mongoose');

const soilMoistureObservationSchema = new mongoose.Schema(
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
    soilMoisture: {
      type: Number,
      required: true,
      min: 0
    },
    recordedAt: {
      type: Date,
      default: Date.now
    },
    source: {
      type: String,
      required: true,
      enum: ['satellite', 'sensor', 'official', 'simulation', 'modelled', 'historical_api']
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

const SoilMoistureObservation = mongoose.model('SoilMoistureObservation', soilMoistureObservationSchema);

module.exports = SoilMoistureObservation;
