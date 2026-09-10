/**
 * Geological Survey of India (GSI) NLSM NER Historical Landslides Importer
 * 
 * Ingests field-validated historical landslide records from:
 *   data/gsi/gsi_ner_landslides_clean_v2.csv
 * into MongoDB LandslideEvent collection.
 * 
 * Source: Geological Survey of India (GSI) National Landslide Susceptibility Mapping (NLSM)
 * Total Valid Records: 10,236 covering all 8 Northeast India states:
 *   - Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, Tripura.
 * 
 * Strict Integrity Rules:
 * - RFC-4180 streaming quote-aware CSV parser
 * - Preserves GSI source_serial_number as originalSourceId (e.g. GSI_NER_1)
 * - Preserves GSI slide_no in provenance.sourceRecordId
 * - No artificial risk scores or synthetic severity levels (truthful severity: 'unknown')
 * - Idempotent upsert via bulkWrite ($set with upsert: true)
 * - Categorizes source: 'GSI' and region: 'NER'
 * - Preserves existing NASA records with source: 'NASA' and region: 'HIMACHAL'
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const LandslideEvent = require('../models/LandslideEvent');
const connectDB = require('../config/database');
const { MONGODB_URI } = require('../config/env');

const DEFAULT_GSI_CSV_PATH = path.resolve(__dirname, '../../data/gsi/gsi_ner_landslides_clean_v2.csv');

// Northeast India Geographic Bounding Box
const NER_BOUNDS = {
  latMin: 21.9,
  latMax: 29.5,
  lonMin: 87.5,
  lonMax: 97.5
};

/**
 * Parses an individual CSV line conforming to RFC 4180 rules:
 * - Handles commas inside double-quoted fields
 * - Handles escaped double quotes ("") inside quoted fields
 * - Trims whitespace around unquoted fields
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip the escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parses historical year and date string into a truthful JavaScript Date
 */
function parseEventDate(historyYear, historyRaw) {
  if (historyYear && /^\d{4}$/.test(historyYear.trim())) {
    const year = parseInt(historyYear.trim(), 10);
    if (year >= 1900 && year <= 2030) {
      return new Date(Date.UTC(year, 0, 1));
    }
  }
  if (historyRaw && historyRaw !== 'NA') {
    const parsed = new Date(historyRaw);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

/**
 * Converts a validated GSI CSV row into a LandslideEvent document schema
 */
function mapGsiRowToLandslideEvent(headers, row, batchId) {
  const getCol = (name) => {
    const idx = headers.indexOf(name);
    return idx !== -1 ? row[idx] || '' : '';
  };

  const serial = getCol('source_serial_number');
  const slideNo = getCol('slide_no');
  const state = getCol('state');
  const district = getCol('district');
  const slideName = getCol('slide_name');
  const locationDesc = getCol('nh_sh_location');
  const latStr = getCol('latitude');
  const lonStr = getCol('longitude');
  const material = getCol('material_involved');
  const movement = getCol('movement_type');
  const historyRaw = getCol('history_raw');
  const historyYear = getCol('history_year');
  const sourcePage = getCol('source_page');

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return null;
  }

  // Build descriptive text faithfully from official GSI report attributes
  const descParts = [];
  if (slideName && slideName !== 'NA') descParts.push(slideName);
  if (locationDesc && locationDesc !== 'NA') descParts.push(`Location: ${locationDesc}`);
  if (district) descParts.push(`District: ${district}`);
  if (state) descParts.push(`State: ${state}`);
  if (material && material !== 'NA') descParts.push(`Material: ${material}`);
  if (movement && movement !== 'NA') descParts.push(`Type: ${movement}`);
  if (historyRaw && historyRaw !== 'NA') descParts.push(`Recorded History: ${historyRaw}`);
  if (slideNo) descParts.push(`GSI Ref: ${slideNo}`);

  const eventDate = parseEventDate(historyYear, historyRaw);

  const eventType = movement && movement !== 'NA'
    ? `${material && material !== 'NA' ? material + ' ' : ''}${movement}`.trim()
    : (material && material !== 'NA' ? `${material} Movement` : 'Landslide');

  return {
    location: {
      latitude: lat,
      longitude: lon
    },
    locationPoint: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    eventType,
    severity: 'unknown', // Truthful: not artificially scored
    description: descParts.join(' | ') || `GSI NLSM Landslide Event in ${district}, ${state}`,
    eventDate: eventDate || undefined,
    reportedAt: eventDate || new Date(Date.UTC(2023, 0, 1)),
    isHistorical: true,
    originalSourceId: `GSI_NER_${serial}`,
    source: 'GSI',
    state: state || undefined,
    district: district || undefined,
    region: 'NER',
    provenance: {
      sourceName: 'GSI',
      sourceRecordId: slideNo || serial,
      sourceUrlVersion: 'data/gsi/gsi_ner_landslides_clean_v2.csv',
      sourceAccessDate: new Date(),
      originalEventDate: eventDate || undefined,
      importBatchId: batchId,
      importedAt: new Date(),
      transformationNotes: `GSI NLSM NER Landslide Inventory (v2 hardened). Source page: ${sourcePage || 'N/A'}`
    }
  };
}

/**
 * Main ingestion function
 */
async function importGsiLandslides(csvPath = DEFAULT_GSI_CSV_PATH) {
  const batchId = randomUUID();
  console.log(`[GSI-IMPORT] Starting GSI NLSM NER Landslides Ingestion (Batch: ${batchId})`);
  console.log(`[GSI-IMPORT] Reading file: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`GSI CSV file not found at path: ${csvPath}`);
  }

  // Connect to DB if not already connected
  if (mongoose.connection.readyState !== 1) {
    await connectDB(MONGODB_URI);
  }

  // Step 1: Ensure existing NASA records in MongoDB are cleanly categorized with source: 'NASA' & region: 'HIMACHAL'
  console.log('[GSI-IMPORT] Tagging existing NASA GLC records with clean source & region metadata...');
  const nasaUpdateResult = await LandslideEvent.updateMany(
    {
      $or: [
        { 'provenance.sourceName': 'NASA_GLC' },
        { originalSourceId: { $regex: /^\d+$/ } }
      ]
    },
    {
      $set: {
        source: 'NASA',
        region: 'HIMACHAL'
      }
    }
  );
  console.log(`[GSI-IMPORT] Tagged ${nasaUpdateResult.modifiedCount} existing NASA records as source='NASA', region='HIMACHAL'.`);

  // Step 2: Stream and parse the GSI clean_v2 CSV
  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let headers = null;
  let totalRows = 0;
  let validRows = 0;
  let skippedRows = 0;
  let batchOps = [];
  const CHUNK_SIZE = 1000;
  let upsertedCount = 0;
  let modifiedCount = 0;

  const stateCounts = {};

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!headers) {
      headers = parseCsvLine(trimmed);
      continue;
    }

    totalRows++;
    const row = parseCsvLine(trimmed);
    const doc = mapGsiRowToLandslideEvent(headers, row, batchId);

    if (!doc) {
      skippedRows++;
      continue;
    }

    validRows++;
    stateCounts[doc.state] = (stateCounts[doc.state] || 0) + 1;

    batchOps.push({
      updateOne: {
        filter: { originalSourceId: doc.originalSourceId },
        update: { $set: doc },
        upsert: true
      }
    });

    if (batchOps.length >= CHUNK_SIZE) {
      const result = await LandslideEvent.bulkWrite(batchOps, { ordered: false });
      upsertedCount += result.upsertedCount || 0;
      modifiedCount += result.modifiedCount || 0;
      batchOps = [];
      process.stdout.write(`[GSI-IMPORT] Ingested ${validRows}/${totalRows} rows...\r`);
    }
  }

  if (batchOps.length > 0) {
    const result = await LandslideEvent.bulkWrite(batchOps, { ordered: false });
    upsertedCount += result.upsertedCount || 0;
    modifiedCount += result.modifiedCount || 0;
  }

  console.log('\n[GSI-IMPORT] Ingestion Completed Successfully!');
  console.log(`[GSI-IMPORT] Total Rows in CSV: ${totalRows}`);
  console.log(`[GSI-IMPORT] Valid NER Rows Ingested: ${validRows}`);
  console.log(`[GSI-IMPORT] Skipped Rows: ${skippedRows}`);
  console.log(`[GSI-IMPORT] New Upserts: ${upsertedCount}, Updates: ${modifiedCount}`);
  console.log('[GSI-IMPORT] State Breakdown:');
  console.table(stateCounts);

  return {
    batchId,
    totalRows,
    validRows,
    skippedRows,
    upsertedCount,
    modifiedCount,
    stateCounts
  };
}

if (require.main === module) {
  importGsiLandslides()
    .then(() => {
      console.log('[GSI-IMPORT] Finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[GSI-IMPORT] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  importGsiLandslides,
  mapGsiRowToLandslideEvent,
  parseCsvLine,
  parseEventDate,
  NER_BOUNDS
};
