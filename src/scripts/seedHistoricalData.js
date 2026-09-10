/**
 * Step 51C: Real ML Dataset Acquisition & Population Script
 * Fetches NASA GLC and Open-Meteo Historical data to seed the database.
 */
const mongoose = require('mongoose');
const axios = require('axios');
const { randomUUID } = require('crypto');
const LandslideEvent = require('../models/LandslideEvent');
const RainfallObservation = require('../models/RainfallObservation');
const SoilMoistureObservation = require('../models/SoilMoistureObservation');
require('dotenv').config();

// Configuration
const BATCH_ID = randomUUID();
const NASA_GLC_URL = 'https://data.nasa.gov/resource/dd9e-wu2v.json'; // SODA API for GLC
const OPEN_METEO_HISTORICAL_URL = 'https://archive-api.open-meteo.com/v1/archive';
const NER_BOUNDS = {
  latMin: 21.9, latMax: 29.5,
  lonMin: 89.8, lonMax: 97.4
};

// Utilities
const delay = (ms) => new Promise(res => setTimeout(res, ms));

const calculateRainfall24h = (hourlyPrecipitation, targetHourIndex) => {
  if (!hourlyPrecipitation || hourlyPrecipitation.length === 0) return 0;
  if (targetHourIndex < 24) return 0; // Not enough history

  let sum = 0;
  for (let i = targetHourIndex - 24; i < targetHourIndex; i++) {
    sum += hourlyPrecipitation[i] || 0;
  }
  return sum;
};

// 1. Source Verification
const verifySource = async () => {
  console.log(`[VERIFICATION] Checking NASA GLC API availability...`);
  try {
    const response = await axios.get(NASA_GLC_URL, {
      params: {
        $limit: 1
      },
      timeout: 5000
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new Error(`Invalid response status: ${response.status}`);
    }

    console.log(`[VERIFICATION] Checking NER coverage...`);
    // Check how many records exist for NER
    // In SODA API we can use SoQL
    const countResponse = await axios.get(NASA_GLC_URL, {
      params: {
        $select: 'count(id)',
        $where: `latitude >= ${NER_BOUNDS.latMin} AND latitude <= ${NER_BOUNDS.latMax} AND longitude >= ${NER_BOUNDS.lonMin} AND longitude <= ${NER_BOUNDS.lonMax} AND event_date IS NOT NULL`
      },
      timeout: 5000
    });

    const count = parseInt(countResponse.data[0].count_id, 10);
    console.log(`[VERIFICATION] Found ${count} valid NER records with event_date in NASA GLC.`);

    if (count < 200) {
      const msg = `[DEFICIENCY] Northeast India currently lacks 200 high-quality historical GLC events (Found: ${count}). Inaccessible/insufficient source.`;
      console.error(msg);
      throw new Error(msg);
    }

    return { status: 'VERIFIED', count };
  } catch (error) {
    console.error(`[VERIFICATION FAILED] NASA GLC is inaccessible:`, error.message);
    throw error;
  }
};

// Fetch GLC Data
const fetchNasaGLC = async (limit = 1000) => {
  console.log(`[FETCH] Downloading NASA GLC data for NER...`);
  const response = await axios.get(NASA_GLC_URL, {
    params: {
      $where: `latitude >= ${NER_BOUNDS.latMin} AND latitude <= ${NER_BOUNDS.latMax} AND longitude >= ${NER_BOUNDS.lonMin} AND longitude <= ${NER_BOUNDS.lonMax} AND event_date IS NOT NULL`,
      $limit: limit,
      $order: 'event_date DESC'
    },
    timeout: 10000
  });
  return response.data;
};

// Fetch Open-Meteo Data
const fetchOpenMeteo = async (lat, lon, startDate, endDate) => {
  try {
    const response = await axios.get(OPEN_METEO_HISTORICAL_URL, {
      params: {
        latitude: lat,
        longitude: lon,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        hourly: 'precipitation,soil_moisture_0_to_7cm',
        timezone: 'UTC'
      },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      throw new Error('RATE_LIMIT');
    }
    throw error;
  }
};

// Generate Negative Candidates
const generateNegativeCandidates = async (validPositives) => {
  const negatives = [];
  const LandslideEvent = require('../models/LandslideEvent');

  for (const pos of validPositives) {
    const negDate = new Date(pos.originalEventDate);
    // Use a random offset between 30 and 1000 days to avoid a simplistic fixed offset
    const randomDays = Math.floor(Math.random() * 970) + 30;
    negDate.setDate(negDate.getDate() - randomDays);

    const startWindow = new Date(negDate.getTime() - 72 * 60 * 60 * 1000);
    const endWindow = new Date(negDate.getTime() + 72 * 60 * 60 * 1000);

    const conflictingEvents = await LandslideEvent.find({
      eventDate: { $gte: startWindow, $lte: endWindow },
      locationPoint: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [pos.longitude, pos.latitude]
          },
          $maxDistance: 50000
        }
      }
    });

    if (conflictingEvents.length === 0) {
      negatives.push({
        latitude: pos.latitude,
        longitude: pos.longitude,
        anchorDate: negDate
      });
    }
  }
  return negatives;
};

// Import Logic
const processGLCEvent = async (record, isDryRun) => {
  if (!record.latitude || !record.longitude || !record.event_date) {
    return { status: 'rejected', reason: 'Missing required fields' };
  }

  const lat = parseFloat(record.latitude);
  const lon = parseFloat(record.longitude);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { status: 'rejected', reason: 'Invalid coordinates' };
  }

  const eventDate = new Date(record.event_date);
  if (isNaN(eventDate.getTime())) {
    return { status: 'rejected', reason: 'Invalid eventDate' };
  }

  // Idempotency check
  if (!isDryRun) {
    const existing = await LandslideEvent.findOne({ originalSourceId: record.id });
    if (existing) {
      return { status: 'duplicate', id: record.id };
    }
  }

  const provenance = {
    sourceName: 'NASA_GLC',
    sourceRecordId: record.id,
    sourceUrlVersion: NASA_GLC_URL,
    sourceAccessDate: new Date(),
    originalEventDate: eventDate,
    importBatchId: BATCH_ID,
    importedAt: new Date(),
    transformationNotes: 'Event date precision exactly as provided. No alignment time fabricated.'
  };

  const eventDoc = {
    location: { latitude: lat, longitude: lon },
    eventType: record.landslide_category || 'unknown',
    severity: 'unknown',
    description: record.landslide_trigger || '',
    eventDate: eventDate,
    reportedAt: eventDate,
    isHistorical: true,
    originalSourceId: record.id,
    source: 'historical_dataset',
    provenance
  };

  if (!isDryRun) {
    await LandslideEvent.create(eventDoc);
  }

  return { status: 'inserted', id: record.id, doc: eventDoc };
};

const processEnvironmental = async (lat, lon, anchorDate, isDryRun) => {
  // Fetch 72 hours preceding the anchor date + some buffer to align 00:00 UTC
  const endDate = new Date(anchorDate);
  const startDate = new Date(anchorDate);
  startDate.setDate(startDate.getDate() - 4); // 4 days buffer to cover the 72h precisely

  let meteoData;
  let retries = 3;
  while (retries > 0) {
    try {
      meteoData = await fetchOpenMeteo(lat, lon, startDate, endDate);
      break;
    } catch (err) {
      if (err.message === 'RATE_LIMIT') {
        console.warn(`Rate limited. Waiting 5 seconds...`);
        await delay(5000);
        retries--;
        if (retries === 0) throw new Error('Open-Meteo Rate Limit Exceeded');
      } else {
        return { status: 'rejected', reason: 'Open-Meteo API Error: ' + err.message };
      }
    }
  }

  if (!meteoData || !meteoData.hourly || !meteoData.hourly.time) {
    return { status: 'rejected', reason: 'Invalid Open-Meteo response' };
  }

  // Find target index (closest hour <= anchorDate)
  const anchorTime = anchorDate.getTime();
  let targetIndex = -1;
  for (let i = meteoData.hourly.time.length - 1; i >= 0; i--) {
    const t = new Date(meteoData.hourly.time[i] + 'Z').getTime();
    if (t <= anchorTime) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex < 24) {
    return { status: 'rejected', reason: 'Insufficient historical data array' };
  }

  const rain24h = calculateRainfall24h(meteoData.hourly.precipitation, targetIndex);
  const soilMoisture = meteoData.hourly.soil_moisture_0_to_7cm[targetIndex] || 0;

  const provenance = {
    sourceName: 'Open_Meteo',
    sourceUrlVersion: OPEN_METEO_HISTORICAL_URL,
    sourceAccessDate: new Date(),
    originalEventDate: anchorDate,
    importBatchId: BATCH_ID,
    importedAt: new Date(),
    transformationNotes: `Alignment: Fetched closest hourly reading prior to anchor. rainfall_24h_mm strictly calculated over preceding 24h.`
  };

  if (!isDryRun) {
    // Upsert Rainfall
    await RainfallObservation.findOneAndUpdate(
      { 'location.latitude': lat, 'location.longitude': lon, recordedAt: anchorDate },
      {
        $setOnInsert: {
          location: { latitude: lat, longitude: lon },
          recordedAt: anchorDate,
          rainfall: rain24h,
          source: 'historical_api',
          provenance
        }
      },
      { upsert: true, new: true }
    );

    // Upsert Soil Moisture
    await SoilMoistureObservation.findOneAndUpdate(
      { 'location.latitude': lat, 'location.longitude': lon, recordedAt: anchorDate },
      {
        $setOnInsert: {
          location: { latitude: lat, longitude: lon },
          recordedAt: anchorDate,
          soilMoisture: soilMoisture,
          source: 'historical_api',
          provenance
        }
      },
      { upsert: true, new: true }
    );
  }

  return { status: 'inserted', rain24h, soilMoisture };
};

// CLI Command logic
const run = async () => {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;
  const rollbackArg = args.find(a => a.startsWith('--rollback='));

  if (rollbackArg) {
    const rId = rollbackArg.split('=')[1];
    console.log(`[ROLLBACK] Rolling back batch ID: ${rId}`);
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/landslide_monitor');
    const lDel = await LandslideEvent.deleteMany({ 'provenance.importBatchId': rId });
    const rDel = await RainfallObservation.deleteMany({ 'provenance.importBatchId': rId });
    const sDel = await SoilMoistureObservation.deleteMany({ 'provenance.importBatchId': rId });
    console.log(`[ROLLBACK] Deleted ${lDel.deletedCount} Landslides, ${rDel.deletedCount} Rainfall, ${sDel.deletedCount} SoilMoisture.`);
    process.exit(0);
  }

  console.log(`[INIT] Starting Seed Process | Batch ID: ${BATCH_ID} | DryRun: ${isDryRun} | Limit: ${limit}`);

  try {
    if (!isDryRun) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/landslide_monitor');
    }

    await verifySource();

    const glcData = await fetchNasaGLC(limit);
    console.log(`[INFO] Fetched ${glcData.length} records from NASA GLC.`);

    let insertedPos = 0, duplicatePos = 0, rejectedPos = 0;
    const validPositives = [];

    // Process Positives
    for (const record of glcData) {
      const result = await processGLCEvent(record, isDryRun);
      if (result.status === 'inserted') {
        insertedPos++;
        validPositives.push(result.doc.provenance);
        // Process corresponding environmental data
        const envResult = await processEnvironmental(result.doc.location.latitude, result.doc.location.longitude, result.doc.eventDate, isDryRun);
        if (envResult.status === 'rejected') rejectedPos++;
        await delay(isDryRun ? 0 : 500); // 500ms API rate limit spacing
      } else if (result.status === 'duplicate') {
        duplicatePos++;
      } else {
        rejectedPos++;
      }
    }

    // Process Negatives
    const negativeCandidates = await generateNegativeCandidates(validPositives);
    let insertedNeg = 0;

    console.log(`[INFO] Processing ${negativeCandidates.length} negative candidates...`);
    for (const neg of negativeCandidates) {
      const result = await processEnvironmental(neg.latitude, neg.longitude, neg.anchorDate, isDryRun);
      if (result.status === 'inserted') {
        insertedNeg++;
        await delay(isDryRun ? 0 : 500);
      }
    }

    console.log(`[MANIFEST] Import Batch ID: ${BATCH_ID}`);
    console.log(`[MANIFEST] Positives - Inserted: ${insertedPos}, Duplicates: ${duplicatePos}, Rejected/Failed: ${rejectedPos}`);
    console.log(`[MANIFEST] Negatives - Inserted: ${insertedNeg}`);

  } catch (error) {
    console.error(`[FATAL] Pipeline failed:`, error.message);
  } finally {
    if (!isDryRun) await mongoose.disconnect();
  }
};

if (require.main === module) {
  run();
}

module.exports = {
  verifySource,
  fetchNasaGLC,
  calculateRainfall24h,
  generateNegativeCandidates,
  processGLCEvent,
  processEnvironmental,
  NER_BOUNDS
};
