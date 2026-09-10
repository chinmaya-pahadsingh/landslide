const mongoose = require('mongoose');

const infrastructureAssetSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    assetType: {
      type: String,
      required: true,
      enum: ['road', 'village', 'bridge', 'hospital', 'school', 'public_facility', 'other'],
    },
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
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
      },
    },
    importance: {
      type: Number,
    },
    populationServed: {
      type: Number,
      min: 0,
    },
    alternativeAvailable: {
      type: Boolean,
    },
    status: {
      type: String,
      enum: ['active', 'closed', 'unknown'],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
infrastructureAssetSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });
infrastructureAssetSchema.index({ locationPoint: '2dsphere' });
infrastructureAssetSchema.index({ assetType: 1 });

// Auto-sync locationPoint for GeoJSON queries
infrastructureAssetSchema.pre('save', function () {
  if (this.location && this.location.longitude != null && this.location.latitude != null) {
    this.locationPoint = {
      type: 'Point',
      coordinates: [this.location.longitude, this.location.latitude],
    };
  }
});

const InfrastructureAsset = mongoose.model('InfrastructureAsset', infrastructureAssetSchema);

module.exports = InfrastructureAsset;
