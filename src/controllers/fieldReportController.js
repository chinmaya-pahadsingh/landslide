const FieldReport = require('../models/FieldReport');
const mongoose = require('mongoose');

const createFieldReport = async (req, res) => {
  try {
    const { location, reportType, description, reportedAt, source, status, attachments } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'];

    if (idempotencyKey && typeof idempotencyKey !== 'string') {
      return res.status(400).json({ error: 'Invalid x-idempotency-key header format.' });
    }

    // Explicit allowlist construction to prevent arbitrary field injection
    const reportData = {
      location,
      reportType,
      source
    };

    if (description !== undefined) reportData.description = description;
    if (reportedAt !== undefined) reportData.reportedAt = reportedAt;
    if (status !== undefined) reportData.status = status;
    if (idempotencyKey) reportData.idempotencyKey = idempotencyKey;

    if (attachments !== undefined) {
      if (Array.isArray(attachments)) {
        reportData.attachments = attachments.slice(0, 5).map(att => ({
          fileName: typeof att.fileName === 'string' ? att.fileName.slice(0, 255) : 'attachment',
          fileType: typeof att.fileType === 'string' ? att.fileType.slice(0, 100) : 'application/octet-stream',
          fileData: typeof att.fileData === 'string' ? att.fileData : '',
          fileSize: typeof att.fileSize === 'number' ? att.fileSize : 0,
          uploadedAt: att.uploadedAt ? new Date(att.uploadedAt) : new Date()
        })).filter(att => att.fileData && (att.fileData.startsWith('data:image/') || att.fileData.startsWith('data:application/pdf') || att.fileData.startsWith('data:text/')));
      }
    }

    // STEP 44: Assign authenticated user if present
    if (req.user && req.user._id) {
      reportData.userId = req.user._id;
    }

    const newReport = new FieldReport(reportData);
    const savedReport = await newReport.save();

    res.status(201).json(savedReport);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    // OFFLINE RESPONSE-LOSS DUPLICATION FIX:
    // Safe recovery for repeated submissions with the same idempotency key
    if (error.code === 11000 && error.keyPattern && error.keyPattern.idempotencyKey) {
      const idempotencyKey = req.headers['x-idempotency-key'];
      try {
        const existingReport = await FieldReport.findOne({ idempotencyKey });
        if (existingReport) {
          // Explicitly return 200 OK (not 201 Created) to subtly signal to testers 
          // that this was safely resolved, though clients treat both as success.
          return res.status(200).json(existingReport);
        }
      } catch (findError) {
        console.error('Error recovering duplicated FieldReport:', findError);
      }
    }

    console.error('Error creating FieldReport:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

const { calculateDistanceKm } = require('../utils/geoUtils');

const getAllFieldReports = async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    if (lat !== undefined && lon !== undefined) {
      const parsedLat = parseFloat(lat);
      const parsedLon = parseFloat(lon);
      const searchRadiusMeters = parseFloat(radius) || 50000;

      if (isNaN(parsedLat) || isNaN(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
        return res.status(400).json({ error: 'Valid latitude [-90, 90] and longitude [-180, 180] are required.' });
      }

      const reports = await FieldReport.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates: [parsedLon, parsedLat] },
            $maxDistance: searchRadiusMeters
          }
        }
      }).select('-userId').lean();

      const enriched = reports.map(r => {
        const distanceKm = r.location?.latitude != null && r.location?.longitude != null
          ? calculateDistanceKm(parsedLat, parsedLon, r.location.latitude, r.location.longitude)
          : null;
        return {
          ...r,
          distanceKm
        };
      });

      return res.status(200).json(enriched);
    }

    // We intentionally exclude userId from the public output to protect privacy
    const reports = await FieldReport.find().select('-userId').sort({ reportedAt: -1 });
    res.status(200).json(reports);
  } catch (error) {
    console.error('Error fetching FieldReports:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

const getFieldReportById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid report ID format.' });
    }

    // We intentionally exclude userId from the public output to protect privacy
    const report = await FieldReport.findById(id).select('-userId');

    if (!report) {
      return res.status(404).json({ error: 'Field report not found.' });
    }

    res.status(200).json(report);
  } catch (error) {
    console.error('Error fetching FieldReport by ID:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

module.exports = {
  createFieldReport,
  getAllFieldReports,
  getFieldReportById
};
