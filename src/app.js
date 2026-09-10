const express = require('express');
const cors = require('cors');
const landslideEventRoutes = require('./routes/landslideEventRoutes');
const riskAssessmentRoutes = require('./routes/riskAssessmentRoutes');
const rainfallObservationRoutes = require('./routes/rainfallObservationRoutes');
const soilMoistureRoutes = require('./routes/soilMoistureRoutes');
const fieldReportRoutes = require('./routes/fieldReportRoutes');
const infrastructureAssetRoutes = require('./routes/infrastructureAssetRoutes');
const earlyWarningRoutes = require('./routes/earlyWarningRoutes');
const newsRoutes = require('./routes/newsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const authRoutes = require('./routes/authRoutes');
const areaIntelligenceRoutes = require('./routes/areaIntelligenceRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const mlRoutes = require('./routes/mlRoutes');
const satelliteRoutes = require('./routes/satelliteRoutes');

const app = express();

const { FRONTEND_URL } = require('./config/env');

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [FRONTEND_URL].filter(Boolean);
    
    if (process.env.NODE_ENV !== 'production') {
      allowedOrigins.push('http://localhost:5173');
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};

app.use(cors(corsOptions));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Landslide Monitoring Backend is running');
});

app.use('/api/landslide-events', landslideEventRoutes);
app.use('/api/risk-assessment', riskAssessmentRoutes);
app.use('/api/rainfall', rainfallObservationRoutes);
app.use('/api/soil-moisture', soilMoistureRoutes);
app.use('/api/field-reports', fieldReportRoutes);
app.use('/api/infrastructure-assets', infrastructureAssetRoutes);
app.use('/api/early-warning', earlyWarningRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/area-intelligence', areaIntelligenceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/satellite', satelliteRoutes);

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

module.exports = app;
