const mongoose = require('./node_modules/mongoose');
require('./node_modules/dotenv').config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/landslide_monitor');
    console.log('Connected to DB');

    const db = mongoose.connection.db;

    const landslideCount = await db.collection('landslideevents').countDocuments();
    const rainfallCount = await db.collection('rainfallobservations').countDocuments();
    const soilCount = await db.collection('soilmoistureobservations').countDocuments();
    
    // Check how many have valid eventDate
    const landslideValidDate = await db.collection('landslideevents').countDocuments({ eventDate: { $exists: true, $ne: null } });

    console.log(`Landslide Events: ${landslideCount} (Valid eventDate: ${landslideValidDate})`);
    console.log(`Rainfall Observations: ${rainfallCount}`);
    console.log(`Soil Moisture Observations: ${soilCount}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

run();
