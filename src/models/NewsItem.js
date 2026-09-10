const mongoose = require('mongoose');

const newsItemSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    summary: {
      type: String,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (v) {
          return /^(https?):\/\/[^\s/$.?#].[^\s]*$/i.test(v);
        },
        message: 'Invalid URL format',
      },
    },
    source: {
      name: {
        type: String,
        required: true,
      },
      domain: {
        type: String,
      },
      type: {
        type: String,
        enum: ['OFFICIAL', 'NEWS', 'UNKNOWN'],
        default: 'UNKNOWN',
      },
    },
    disasterType: {
      type: String,
      enum: [
        'landslide',
        'flood',
        'flash_flood',
        'cloudburst',
        'avalanche',
        'earthquake',
        'heavy_rain',
        'slope_failure',
        'road_blockage',
        'tsunami',
        'cyclone_storm',
        'extreme_rainfall',
        'wildfire',
        'volcanic',
        'drought',
        'disaster_response',
        'other'
      ],
      default: 'other',
    },
    disasterCategory: {
      type: String,
      trim: true,
    },
    location: {
      name: { type: String },
      state: { type: String },
      district: { type: String },
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
    },
    locationPoint: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
    },
    publishedAt: {
      type: Date,
      required: true,
    },
    importance: {
      type: Number, // Operational ranking value (0-100)
      default: 0,
    },
    verificationStatus: {
      type: String,
      enum: ['OFFICIAL', 'NEWS', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    tags: [
      {
        type: String,
      },
    ],
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
    contentHash: {
      type: String,
      index: true, // Used for deduplication
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for fast querying
newsItemSchema.index({ publishedAt: -1 });
newsItemSchema.index({ 'location.state': 1 });
newsItemSchema.index({ disasterType: 1 });
newsItemSchema.index({ url: 1 }, { unique: true }); // Deduplication by URL
newsItemSchema.index({ locationPoint: '2dsphere' });

// Auto-sync locationPoint for GeoJSON queries
newsItemSchema.pre('save', function () {
  if (this.location && this.location.longitude != null && this.location.latitude != null) {
    this.locationPoint = {
      type: 'Point',
      coordinates: [this.location.longitude, this.location.latitude],
    };
  } else {
    this.locationPoint = undefined;
  }
});

const NewsItem = mongoose.model('NewsItem', newsItemSchema);

module.exports = NewsItem;
