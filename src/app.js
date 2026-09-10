const express = require('express');
const path = require('path');
const fs = require('fs');
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
const geocodingRoutes = require('./routes/geocodingRoutes');

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
    
    let isAllowed = allowedOrigins.indexOf(origin) !== -1;
    if (!isAllowed) {
      try {
        const originUrl = new URL(origin);
        if (
          originUrl.hostname.endsWith('.lhr.life') ||
          originUrl.hostname.endsWith('.serveousercontent.com') ||
          originUrl.hostname.endsWith('.trycloudflare.com') ||
          originUrl.hostname.endsWith('.loca.lt') ||
          originUrl.hostname.endsWith('.pinggy.link') ||
          originUrl.hostname.endsWith('.onrender.com') ||
          originUrl.hostname.endsWith('.railway.app')
        ) {
          isAllowed = true;
        }
      } catch (e) {}
    }
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
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
app.use('/api/geocoding', geocodingRoutes);

// Static frontend serving if built
const frontendDistPath = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(frontendDistPath, 'index.html'));
    }
    next();
  });
} else {
  app.get('/', (req, res) => {
    res.send('Landslide Monitoring Backend is running');
  });
}

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

module.exports = app;
