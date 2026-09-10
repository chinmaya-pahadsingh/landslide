require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const startupErrors = [];

let MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  if (isProd) {
    startupErrors.push('MONGODB_URI environment variable is missing.');
  } else {
    MONGODB_URI = 'mongodb://localhost:27017/landslide-monitoring';
  }
}

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (isProd) {
    startupErrors.push('JWT_SECRET environment variable is missing.');
  } else {
    console.warn('WARNING: JWT_SECRET is missing in development. Using an insecure fallback.');
    JWT_SECRET = 'insecure_development_secret';
  }
}

if (startupErrors.length > 0) {
  console.error('CRITICAL STARTUP ERROR: Missing required configuration:');
  startupErrors.forEach(err => console.error(` - ${err}`));
  process.exit(1);
}

module.exports = {
  PORT: process.env.PORT || 5000,
  MONGODB_URI,
  NODE_ENV,
  JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  FRONTEND_URL: process.env.FRONTEND_URL
};
