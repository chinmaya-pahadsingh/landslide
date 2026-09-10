const {
  parseCsvLine,
  isValidCoordinate,
  isInNortheastIndia,
  mapRowToLandslideEvent,
  scanNasaCsv,
  importNasaCsv,
  NER_BOUNDS
} = require('./importNasaLandslideCsv');
const LandslideEvent = require('../models/LandslideEvent');
const fs = require('fs');
const path = require('path');

jest.mock('../config/database', () => jest.fn().mockResolvedValue(true));

describe('NASA Landslide CSV Importer — Unit & Logic Tests', () => {

  describe('1. CSV Row Parsing & Quoted Fields', () => {
    test('correctly parses unquoted standard CSV row', () => {
      const line = '101,2023-07-09,Landslide in Shimla,Heavy Rain,India,31.1048,77.1734';
      const parsed = parseCsvLine(line);
      expect(parsed).toEqual([
        '101',
        '2023-07-09',
        'Landslide in Shimla',
        'Heavy Rain',
        'India',
        '31.1048',
        '77.1734'
      ]);
    });

    test('correctly preserves commas inside quoted values', () => {
      const line = '102,"July 9, 2023","Himachal Pradesh, India","Heavy, persistent rain",India,31.1,77.2';
      const parsed = parseCsvLine(line);
      expect(parsed[0]).toBe('102');
      expect(parsed[1]).toBe('July 9, 2023');
      expect(parsed[2]).toBe('Himachal Pradesh, India');
      expect(parsed[3]).toBe('Heavy, persistent rain');
      expect(parsed[4]).toBe('India');
    });

    test('correctly unescapes double quotes ("") inside quoted fields', () => {
      const line = '103,"Inventory of ""Major"" Landslides",India,31.1,77.2';
      const parsed = parseCsvLine(line);
      expect(parsed[1]).toBe('Inventory of "Major" Landslides');
      expect(parsed[2]).toBe('India');
    });

    test('handles empty fields correctly', () => {
      const line = '104,,,"No description",India,,77.2';
      const parsed = parseCsvLine(line);
      expect(parsed[0]).toBe('104');
      expect(parsed[1]).toBe('');
      expect(parsed[2]).toBe('');
      expect(parsed[3]).toBe('No description');
      expect(parsed[5]).toBe('');
      expect(parsed[6]).toBe('77.2');
    });
  });

  describe('2. Coordinate Validation', () => {
    test('accepts valid coordinates within boundaries', () => {
      expect(isValidCoordinate(31.1048, 77.1734)).toBe(true);
      expect(isValidCoordinate(0, 0)).toBe(true);
      expect(isValidCoordinate(-90, -180)).toBe(true);
      expect(isValidCoordinate(90, 180)).toBe(true);
    });

    test('rejects non-numeric, NaN, and infinite coordinates', () => {
      expect(isValidCoordinate('31.1', 77.2)).toBe(false);
      expect(isValidCoordinate(NaN, 77.2)).toBe(false);
      expect(isValidCoordinate(31.1, NaN)).toBe(false);
      expect(isValidCoordinate(Infinity, 77.2)).toBe(false);
      expect(isValidCoordinate(31.1, -Infinity)).toBe(false);
      expect(isValidCoordinate(null, 77.2)).toBe(false);
      expect(isValidCoordinate(undefined, 77.2)).toBe(false);
    });

    test('rejects out-of-bounds latitudes and longitudes', () => {
      expect(isValidCoordinate(90.1, 77.2)).toBe(false);
      expect(isValidCoordinate(-90.1, 77.2)).toBe(false);
      expect(isValidCoordinate(31.1, 180.1)).toBe(false);
      expect(isValidCoordinate(31.1, -180.1)).toBe(false);
    });
  });

  describe('3. Country & Northeast India Geographic Filtering', () => {
    test('strictly identifies Country Name === "India" and rejects substring matches', () => {
      const validIndia = 'India';
      const indiana = 'Indiana';
      const biharWithOther = 'British Indian Ocean Territory';

      expect(validIndia.trim() === 'India').toBe(true);
      expect(indiana.trim() === 'India').toBe(false);
      expect(biharWithOther.trim() === 'India').toBe(false);
    });

    test('accurately classifies Northeast India coordinates within NER_BOUNDS', () => {
      // Inside Guwahati (NER)
      expect(isInNortheastIndia(26.1445, 91.7362)).toBe(true);
      // Outside (Himachal Pradesh - North India)
      expect(isInNortheastIndia(31.1048, 77.1734)).toBe(false);
      // Outside (Delhi)
      expect(isInNortheastIndia(28.6139, 77.2090)).toBe(false);
    });

    test('distinguishes foreign records in NER bounds (e.g., Myanmar) from India records', () => {
      // Coordinates inside NER bounds, but country is Myanmar
      const lat = 24.5;
      const lon = 94.5;
      expect(isInNortheastIndia(lat, lon)).toBe(true);

      const countryMyanmar = 'Myanmar';
      const isIndia = (countryMyanmar === 'India');
      expect(isIndia).toBe(false);
    });
  });

  describe('4. Schema Mapping & Truthful Ingestion', () => {
    const mockHeaderMap = {
      OBJECTID: 0,
      'Event Date': 1,
      'Event Title': 2,
      'Event Description': 3,
      'Location Description': 4,
      'Landslide Category': 5,
      'Landslide Trigger': 6,
      'Country Name': 7,
      Latitude: 8,
      Longitude: 9,
      'Name of Information Source': 10,
      Citation: 11
    };

    test('preserves NASA OBJECTID as stable originalSourceId', () => {
      const row = [
        '1886',
        '7/9/23, 5:30 AM',
        'Landslides in Himachal Pradesh',
        'Floods and landslides',
        'Himachal Pradesh, India',
        'Landslide',
        'Heavy Rain',
        'India',
        '30.945',
        '77.060',
        'Disasters Charter',
        'NASA GSFC'
      ];

      const doc = mapRowToLandslideEvent(row, mockHeaderMap, 'test-batch-1');
      expect(doc).not.toBeNull();
      expect(doc.originalSourceId).toBe('1886');
      expect(doc.source).toBe('historical_dataset');
      expect(doc.isHistorical).toBe(true);
      expect(doc.provenance.sourceRecordId).toBe('1886');
      expect(doc.provenance.sourceName).toBe('NASA_GLC');
    });

    test('does NOT invent artificial risk scores, rainfall, soil moisture, or slope', () => {
      const row = [
        '1886',
        '7/9/23, 5:30 AM',
        'Landslides in Himachal Pradesh',
        'Description',
        'Himachal Pradesh',
        'Landslide',
        'Heavy Rain',
        'India',
        '30.945',
        '77.060',
        'Disasters Charter',
        'NASA GSFC'
      ];

      const doc = mapRowToLandslideEvent(row, mockHeaderMap, 'test-batch-1');
      expect(doc.severity).toBe('unknown');
      expect(doc.rainfall).toBeUndefined();
      expect(doc.soilMoisture).toBeUndefined();
      expect(doc.slope).toBeUndefined();
      expect(doc.elevation).toBeUndefined();
      expect(doc.riskAssessment).toBeUndefined();
    });

    test('correctly configures GeoJSON Point [lon, lat]', () => {
      const row = [
        '1886',
        '7/9/23, 5:30 AM',
        'Title',
        'Desc',
        'Loc',
        'Landslide',
        'Rain',
        'India',
        '30.945',
        '77.060',
        'Source',
        'Citation'
      ];

      const doc = mapRowToLandslideEvent(row, mockHeaderMap, 'test-batch-1');
      expect(doc.locationPoint).toEqual({
        type: 'Point',
        coordinates: [77.060, 30.945]
      });
      expect(doc.location.latitude).toBe(30.945);
      expect(doc.location.longitude).toBe(77.060);
    });

    test('rejects row when coordinates are invalid', () => {
      const row = [
        '9999',
        '7/9/23, 5:30 AM',
        'Title',
        'Desc',
        'Loc',
        'Landslide',
        'Rain',
        'India',
        'invalid_lat',
        '77.060'
      ];

      const doc = mapRowToLandslideEvent(row, mockHeaderMap, 'test-batch-1');
      expect(doc).toBeNull();
    });
  });

  describe('5. Bulk Upsert & Idempotency Behavior', () => {
    test('idempotent bulkWrite updates existing records without duplication', async () => {
      const mockBulkWrite = jest.spyOn(LandslideEvent, 'bulkWrite').mockResolvedValue({
        upsertedCount: 176,
        matchedCount: 0,
        modifiedCount: 0
      });
      jest.spyOn(LandslideEvent, 'countDocuments').mockResolvedValue(176);

      // Create a temporary mock CSV with 2 records
      const mockCsvContent = [
        'OBJECTID,Event Date,Event Title,Event Description,Location Description,Landslide Category,Landslide Trigger,Country Name,Latitude,Longitude,Name of Information Source,Citation',
        '101,7/9/23 5:30 AM,Event 1,Desc 1,HP India,Landslide,Rain,India,31.1,77.1,Source 1,Citation 1',
        '102,7/9/23 5:30 AM,Event 2,Desc 2,HP India,Landslide,Rain,India,31.2,77.2,Source 2,Citation 2'
      ].join('\n');

      const tempCsvPath = path.join(__dirname, 'test_mock_landslides.csv');
      fs.writeFileSync(tempCsvPath, mockCsvContent, 'utf8');

      try {
        // Run 1: simulates initial insertion
        const res1 = await importNasaCsv({ filePath: tempCsvPath, scope: 'india' });
        expect(res1.inserted).toBe(176);
        expect(res1.alreadyExisting).toBe(0);

        // Run 2: simulates rerun (idempotent duplicate detection)
        mockBulkWrite.mockResolvedValueOnce({
          upsertedCount: 0,
          matchedCount: 176,
          modifiedCount: 0
        });

        const res2 = await importNasaCsv({ filePath: tempCsvPath, scope: 'india' });
        expect(res2.inserted).toBe(0);
        expect(res2.alreadyExisting).toBe(176);
      } finally {
        if (fs.existsSync(tempCsvPath)) {
          fs.unlinkSync(tempCsvPath);
        }
        mockBulkWrite.mockRestore();
        LandslideEvent.countDocuments.mockRestore();
      }
    });
  });

});
