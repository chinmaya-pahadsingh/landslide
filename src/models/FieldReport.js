const mongoose = require('mongoose');

const fieldReportSchema = new mongoose.Schema(
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
    reportType: {
      type: String,
      required: true,
      enum: ['landslide', 'flood', 'flash_flood', 'road_blockage', 'crack', 'slope_movement', 'rockfall', 'other'],
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    reportedAt: {
      type: Date,
      default: Date.now,
    },
    source: {
      type: String,
      required: true,
      enum: ['citizen', 'field_team'],
    },
    status: {
      type: String,
      default: 'submitted',
      enum: ['submitted', 'reviewed', 'resolved'],
    },
    idempotencyKey: {
      type: String,
      maxlength: 100,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    attachments: [
      {
        fileName: {
          type: String,
          trim: true,
          maxlength: 255
        },
        fileType: {
          type: String,
          trim: true,
          maxlength: 100
        },
        fileData: {
          type: String
        },
        fileSize: {
          type: Number
        },
        uploadedAt: {
          type: Date,
          default: Date.now
        }
      }
    ]
  },
  {
    timestamps: true,
  }
);

// Indexes
fieldReportSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });
fieldReportSchema.index({ locationPoint: '2dsphere' });
fieldReportSchema.index({ reportedAt: -1 });
fieldReportSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

// Auto-sync locationPoint for GeoJSON queries
fieldReportSchema.pre('save', function() {
  if (this.location && this.location.longitude != null && this.location.latitude != null) {
    this.locationPoint = {
      type: 'Point',
      coordinates: [this.location.longitude, this.location.latitude]
    };
  }
});

const FieldReport = mongoose.model('FieldReport', fieldReportSchema);

module.exports = FieldReport;
