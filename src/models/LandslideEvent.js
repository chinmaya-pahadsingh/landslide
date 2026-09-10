const mongoose = require('mongoose');

const landslideEventSchema = new mongoose.Schema(
  {
    location: {
      latitude: {
        type: Number,
        required: true,
        min: -90,
        max: 90,
      },
      longitude: {
        type: Number,
        required: true,
        min: -180,
        max: 180,
      },
    },
    locationPoint: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: {
        type: [Number]
      }
    },
    eventType: {
      type: String,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical', 'unknown'],
    },
    rainfall: {
      type: Number,
    },
    soilMoisture: {
      type: Number,
    },
    elevation: {
      type: Number,
    },
    slope: {
      type: Number,
      min: 0,
      max: 90,
    },
    description: {
      type: String,
    },
    reportedAt: {
      type: Date,
      default: Date.now,
    },
    eventDate: {
      type: Date,
    },
    isHistorical: {
      type: Boolean,
      default: false,
    },
    originalSourceId: {
      type: String,
    },
    source: {
      type: String,
      enum: ['sensor', 'citizen', 'official', 'satellite', 'simulation', 'historical_dataset', 'research', 'GSI', 'gsi', 'NRSC', 'nrsc', 'NASA', 'nasa'],
    },
    state: {
      type: String,
    },
    district: {
      type: String,
    },
    region: {
      type: String,
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
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for historical queries and geospatial performance
landslideEventSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });
landslideEventSchema.index({ eventDate: -1 });
landslideEventSchema.index({ reportedAt: -1 });
landslideEventSchema.index({ locationPoint: '2dsphere' });
landslideEventSchema.index({ originalSourceId: 1 }, { unique: true, sparse: true });

// Auto-sync locationPoint for GeoJSON queries
landslideEventSchema.pre('save', function() {
  if (this.location && this.location.longitude != null && this.location.latitude != null) {
    this.locationPoint = {
      type: 'Point',
      coordinates: [this.location.longitude, this.location.latitude]
    };
  }
});

const LandslideEvent = mongoose.model('LandslideEvent', landslideEventSchema);

module.exports = LandslideEvent;
