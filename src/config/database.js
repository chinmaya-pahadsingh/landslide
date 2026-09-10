const mongoose = require('mongoose');

const connectDB = async (uri) => {
  try {
    if (!uri || uri === 'YOUR_MONGODB_CONNECTION_STRING') {
      throw new Error('Configuration Error: MONGODB_URI is not properly configured. Please provide a real MongoDB connection string.');
    }
    await mongoose.connect(uri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    throw error;
  }
};

module.exports = connectDB;
