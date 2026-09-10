/**
 * NASA Global Landslide Catalog CSV Importer
 * 
 * Safely, idempotently ingests local NASA landslide event records from:
 *   data/nasa/Landslide Events.csv
 * into MongoDB LandslideEvent collection.
 * 
 * Preserves source integrity:
 * - Streaming RFC 4180 quote-aware CSV parser (low memory footprint)
 * - Strict Country Name === 'India' checking (no fuzzy substring matches)
 * - Strict coordinate range and finiteness validation
 * - Preserves NASA OBJECTID as originalSourceId
 * - No artificial risk scores, rainfall, soil moisture, or ML probabilities
 * - Idempotent upsert via bulkWrite ($setOnInsert)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const LandslideEvent = require('../models/LandslideEvent');
const connectDB = require('../config/database');
const { MONGODB_URI } = require('../config/env');

// Northeast India Geographic Bounding Box (established in seedHistoricalData.js)
const NER_BOUNDS = {
  latMin: 21.9,
  latMax: 29.5,
  lonMin: 89.8,
  lonMax: 97.4
};

const DEFAULT_CSV_PATH = path.resolve(__dirname, '../../data/nasa/Landslide Events.csv');

/**
 * Parses an individual CSV line conforming to RFC 4180 rules:
 * - Correctly handles commas inside double-quoted fields
 * - Handles escaped double quotes ("") inside quoted fields
 * - Trims whitespace around unquoted fields while preserving quoted strings
 * 
 * @param {string} line
 * @returns {string[]}
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
 * Validates latitude and longitude strictly.
 * - Must be finite numbers
 * - Lat in [-90, 90]
 * - Lon in [-180, 180]
 * 
 * @param {any} lat
 * @param {any} lon
 * @returns {boolean}
 */
function isValidCoordinate(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  return true;
}

/**
 * Checks if coordinates fall inside the Northeast India bounding box.
 * 
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
function isInNortheastIndia(lat, lon) {
  return (
    lat >= NER_BOUNDS.latMin &&
    lat <= NER_BOUNDS.latMax &&
    lon >= NER_BOUNDS.lonMin &&
    lon <= NER_BOUNDS.lonMax
  );
}

/**
 * Maps raw CSV row data to LandslideEvent schema document.
 * Truthful mapping: does NOT invent severity, rainfall, soil moisture, or risk score.
 * 
 * @param {string[]} rowValues
 * @param {Record<string, number>} headerMap
 * @param {string} batchId
 * @returns {object|null}
 */
function mapRowToLandslideEvent(rowValues, headerMap, batchId) {
  const getCol = (name) => {
    const idx = headerMap[name];
    if (idx === undefined || idx < 0 || idx >= rowValues.length) return '';
    return rowValues[idx] || '';
  };

  const objectIdStr = getCol('OBJECTID');
  if (!objectIdStr) return null;

  const latRaw = parseFloat(getCol('Latitude'));
  const lonRaw = parseFloat(getCol('Longitude'));

  if (!isValidCoordinate(latRaw, lonRaw)) return null;

  const dateStr = getCol('Event Date');
  let eventDate = new Date(dateStr);
  if (isNaN(eventDate.getTime())) {
    eventDate = new Date();
  }

  const category = getCol('Landslide Category');
  const trigger = getCol('Landslide Trigger');
  const title = getCol('Event Title');
  const desc = getCol('Event Description');
  const locDesc = getCol('Location Description');
  const infoSource = getCol('Name of Information Source');
  const citation = getCol('Citation');

  // Build descriptive text without fabricating facts
  const descParts = [];
  if (title) descParts.push(title);
  if (desc && desc !== title) descParts.push(desc);
  if (locDesc) descParts.push(`Location: ${locDesc}`);
  if (trigger) descParts.push(`Trigger: ${trigger}`);

  const combinedDesc = descParts.join(' | ');

  return {
    location: {
      latitude: latRaw,
      longitude: lonRaw
    },
    locationPoint: {
      type: 'Point',
      coordinates: [lonRaw, latRaw]
    },
    eventType: category || 'Landslide',
    severity: 'unknown', // Truthful: not classified in NASA GLC
    description: combinedDesc,
    eventDate: eventDate,
    reportedAt: eventDate,
    isHistorical: true,
    originalSourceId: String(objectIdStr),
    source: 'historical_dataset',
    provenance: {
      sourceName: 'NASA_GLC',
      sourceRecordId: String(objectIdStr),
      sourceUrlVersion: 'data/nasa/Landslide Events.csv',
      sourceAccessDate: new Date(),
      originalEventDate: eventDate,
      importBatchId: batchId,
      importedAt: new Date(),
      transformationNotes: `NASA GLC CSV import. Source: ${infoSource || 'NASA COOLR'}${citation ? ` | Citation: ${citation.slice(0, 100)}` : ''}`
    }
  };
}

/**
 * Scans the CSV file in streaming mode and parses candidate records.
 * 
 * @param {object} options
 * @param {string} options.filePath
 * @param {'india'|'ner'} [options.scope='india']
 * @returns {Promise<{
 *   rowsScanned: number,
 *   indiaRows: number,
 *   northeastRowsEligible: number,
 *   foreignNerRowsSkipped: number,
 *   validCoordinates: number,
 *   invalidCoordinates: number,
 *   eligibleRecords: object[]
 * }>}
 */
async function scanNasaCsv({ filePath = DEFAULT_CSV_PATH, scope = 'india', batchId = randomUUID() } = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at path: ${filePath}`);
  }

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headerMap = null;
  let rowsScanned = 0;
  let indiaRows = 0;
  let northeastRowsEligible = 0;
  let foreignNerRowsSkipped = 0;
  let validCoordinates = 0;
  let invalidCoordinates = 0;
  const eligibleRecords = [];

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (!headerMap) {
      const headers = parseCsvLine(line);
      headerMap = {};
      headers.forEach((h, idx) => {
        headerMap[h] = idx;
      });
      continue;
    }

    rowsScanned++;
    const rowValues = parseCsvLine(line);
    const countryName = (rowValues[headerMap['Country Name']] || '').trim();
    const lat = parseFloat(rowValues[headerMap['Latitude']]);
    const lon = parseFloat(rowValues[headerMap['Longitude']]);

    const isCoordValid = isValidCoordinate(lat, lon);
    const isIndia = (countryName === 'India');
    const isInNer = isCoordValid && isInNortheastIndia(lat, lon);

    if (isIndia) {
      indiaRows++;
      if (isCoordValid) {
        validCoordinates++;
        if (isInNer) {
          northeastRowsEligible++;
        }
      } else {
        invalidCoordinates++;
      }
    } else if (isInNer) {
      // Foreign records within NER bounding box (e.g., Myanmar, Bangladesh)
      foreignNerRowsSkipped++;
    }

    // Determine eligibility based on requested scope
    let isEligible = false;
    if (scope === 'ner') {
      isEligible = isIndia && isInNer && isCoordValid;
    } else {
      // 'india' scope: genuine India events from NASA GLC
      isEligible = isIndia && isCoordValid;
    }

    if (isEligible) {
      const doc = mapRowToLandslideEvent(rowValues, headerMap, batchId);
      if (doc) {
        eligibleRecords.push(doc);
      }
    }
  }

  return {
    rowsScanned,
    indiaRows,
    northeastRowsEligible,
    foreignNerRowsSkipped,
    validCoordinates,
    invalidCoordinates,
    eligibleRecords
  };
}

/**
 * Executes the full ingestion process idempotently.
 * 
 * @param {object} options
 * @param {string} [options.filePath]
 * @param {'india'|'ner'} [options.scope='india']
 * @param {boolean} [options.dryRun=false]
 * @param {string} [options.mongoUri]
 * @returns {Promise<{
 *   rowsScanned: number,
 *   indiaRows: number,
 *   northeastRowsEligible: number,
 *   validCoordinates: number,
 *   inserted: number,
 *   alreadyExisting: number,
 *   invalidSkipped: number,
 *   failed: number,
 *   finalMongoCount: number
 * }>}
 */
async function importNasaCsv({
  filePath = DEFAULT_CSV_PATH,
  scope = 'india',
  dryRun = false,
  mongoUri = MONGODB_URI
} = {}) {
  const batchId = randomUUID();

  console.log(`[INFO] Scanning NASA Landslide CSV: ${filePath}`);
  console.log(`[INFO] Target scope: ${scope} | Dry run: ${dryRun} | Batch: ${batchId}`);

  const scanResult = await scanNasaCsv({ filePath, scope, batchId });

  console.log(`[SAFETY CHECK] Rows scanned: ${scanResult.rowsScanned}`);
  console.log(`[SAFETY CHECK] India rows: ${scanResult.indiaRows}`);
  console.log(`[SAFETY CHECK] Northeast India eligible: ${scanResult.northeastRowsEligible}`);
  console.log(`[SAFETY CHECK] Foreign records in NER bounds safely skipped: ${scanResult.foreignNerRowsSkipped}`);
  console.log(`[SAFETY CHECK] Eligible candidate records to process: ${scanResult.eligibleRecords.length}`);

  // Safeguard: Ensure we don't unexpectedly insert thousands of unintended records
  if (scanResult.eligibleRecords.length > 500) {
    throw new Error(`SAFETY HALT: Eligible record count (${scanResult.eligibleRecords.length}) exceeded expected threshold (500). Aborting import.`);
  }

  let inserted = 0;
  let alreadyExisting = 0;
  let failed = 0;
  let finalMongoCount = 0;

  const shouldConnect = !mongoose.connection.readyState;
  if (shouldConnect) {
    await connectDB(mongoUri);
  }

  try {
    if (!dryRun && scanResult.eligibleRecords.length > 0) {
      // Build bulk operations using updateOne with $setOnInsert for pure idempotency
      const bulkOps = scanResult.eligibleRecords.map(doc => ({
        updateOne: {
          filter: { originalSourceId: doc.originalSourceId },
          update: { $setOnInsert: doc },
          upsert: true
        }
      }));

      const bulkResult = await LandslideEvent.bulkWrite(bulkOps, { ordered: false });

      inserted = bulkResult.upsertedCount || 0;
      alreadyExisting = bulkResult.matchedCount || 0;
    } else if (dryRun) {
      console.log('[INFO] Dry run mode enabled — no database writes executed.');
      inserted = scanResult.eligibleRecords.length;
      alreadyExisting = 0;
    }

    finalMongoCount = await LandslideEvent.countDocuments();
  } catch (err) {
    console.error('[ERROR] Database operation failed during import:', err.message);
    failed = scanResult.eligibleRecords.length - (inserted + alreadyExisting);
    throw err;
  } finally {
    if (shouldConnect) {
      await mongoose.disconnect();
    }
  }

  const summary = {
    rowsScanned: scanResult.rowsScanned,
    indiaRows: scanResult.indiaRows,
    northeastRowsEligible: scanResult.northeastRowsEligible,
    validCoordinates: scanResult.validCoordinates,
    inserted,
    alreadyExisting,
    invalidSkipped: scanResult.invalidCoordinates,
    failed,
    finalMongoCount
  };

  printSummary(summary);
  return summary;
}

/**
 * Formats and prints the final execution summary as required.
 * 
 * @param {object} s
 */
function printSummary(s) {
  console.log('\n========================================');
  console.log('NASA HISTORICAL IMPORT COMPLETE');
  console.log('========================================');
  console.log(`CSV rows scanned: ${s.rowsScanned}`);
  console.log(`India rows: ${s.indiaRows}`);
  console.log(`Northeast India rows eligible: ${s.northeastRowsEligible}`);
  console.log(`Valid coordinates: ${s.validCoordinates}`);
  console.log(`Inserted: ${s.inserted}`);
  console.log(`Already existing/skipped: ${s.alreadyExisting}`);
  console.log(`Invalid/skipped: ${s.invalidSkipped}`);
  console.log(`Failed: ${s.failed}`);
  console.log(`Final MongoDB LandslideEvent count: ${s.finalMongoCount}`);
  console.log('========================================\n');
}

/**
 * CLI Entrypoint
 */
async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const scopeArg = args.find(a => a.startsWith('--scope='));
  const scope = scopeArg ? scopeArg.split('=')[1].toLowerCase() : 'india';
  const fileArg = args.find(a => a.startsWith('--file='));
  const filePath = fileArg ? path.resolve(fileArg.split('=')[1]) : DEFAULT_CSV_PATH;

  try {
    await importNasaCsv({ filePath, scope, dryRun });
    process.exit(0);
  } catch (err) {
    console.error('Import execution failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  parseCsvLine,
  isValidCoordinate,
  isInNortheastIndia,
  mapRowToLandslideEvent,
  scanNasaCsv,
  importNasaCsv,
  NER_BOUNDS
};
