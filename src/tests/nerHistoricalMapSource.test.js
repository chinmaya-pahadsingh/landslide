process.env.JWT_SECRET = 'test_secret_for_ner_historical';
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const LandslideEvent = require('../models/LandslideEvent');
const User = require('../models/User');

let mongoServer;
let token;
let user;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  user = await User.create({
    name: 'NER GIS Analyst',
    email: 'gis@ner.gov.in',
    passwordHash: 'fakehash123',
    role: 'authority'
  });

  token = jwt.sign(
    { id: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await LandslideEvent.deleteMany({});
});

describe('STEP 54D-NER-HISTORICAL Backend API Tests', () => {
  test('1 & 2: Ingests and returns real NER historical records with valid coordinates', async () => {
    await LandslideEvent.create([
      {
        eventType: 'Landslide',
        location: { latitude: 25.5788, longitude: 91.8933, address: 'Shillong, Meghalaya' },
        severity: 'low',
        status: 'investigating',
        source: 'GSI',
        state: 'Meghalaya',
        district: 'East Khasi Hills',
        region: 'NER',
        isHistorical: true,
        reportedBy: user._id
      },
      {
        eventType: 'Rock_Fall',
        location: { latitude: 27.3314, longitude: 88.6138, address: 'Gangtok, Sikkim' },
        severity: 'medium',
        status: 'investigating',
        source: 'GSI',
        state: 'Sikkim',
        district: 'East Sikkim',
        region: 'NER',
        isHistorical: true,
        reportedBy: user._id
      }
    ]);

    const res = await request(app)
      .get('/api/landslide-events?region=NER')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    res.body.forEach(ev => {
      expect(ev.location.latitude).toBeGreaterThanOrEqual(-90);
      expect(ev.location.latitude).toBeLessThanOrEqual(90);
      expect(ev.location.longitude).toBeGreaterThanOrEqual(-180);
      expect(ev.location.longitude).toBeLessThanOrEqual(180);
      expect(ev.region).toBe('NER');
      expect(ev.source).toBe('GSI');
    });
  });

  test('3: Preserves NER state coverage across all 8 states', async () => {
    const states = [
      'Assam', 'Arunachal Pradesh', 'Manipur', 'Meghalaya',
      'Mizoram', 'Nagaland', 'Sikkim', 'Tripura'
    ];

    const records = states.map((st, idx) => ({
      eventType: 'Landslide',
      location: { latitude: 24.0 + idx * 0.4, longitude: 92.0 + idx * 0.3, address: `${st} location` },
      severity: 'low',
      status: 'investigating',
      source: 'GSI',
      state: st,
      region: 'NER',
      isHistorical: true,
      reportedBy: user._id
    }));

    await LandslideEvent.insertMany(records);

    const res = await request(app)
      .get('/api/landslide-events?region=NER')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(8);
    const returnedStates = new Set(res.body.map(e => e.state));
    states.forEach(st => expect(returnedStates.has(st)).toBe(true));
  });

  test('4: NASA Himachal records are excluded from region=NER query and distinguished by source', async () => {
    await LandslideEvent.create([
      {
        eventType: 'Landslide',
        location: { latitude: 31.1048, longitude: 77.1734, address: 'Shimla, Himachal Pradesh' },
        severity: 'high',
        status: 'investigating',
        source: 'NASA',
        state: 'Himachal Pradesh',
        region: 'HIMACHAL',
        isHistorical: true,
        reportedBy: user._id
      },
      {
        eventType: 'Landslide',
        location: { latitude: 23.7271, longitude: 92.7176, address: 'Aizawl, Mizoram' },
        severity: 'low',
        status: 'investigating',
        source: 'GSI',
        state: 'Mizoram',
        region: 'NER',
        isHistorical: true,
        reportedBy: user._id
      }
    ]);

    // Query region=NER
    const nerRes = await request(app)
      .get('/api/landslide-events?region=NER')
      .set('Authorization', `Bearer ${token}`);

    expect(nerRes.statusCode).toBe(200);
    expect(Array.isArray(nerRes.body)).toBe(true);
    expect(nerRes.body.length).toBe(1);
    expect(nerRes.body[0].state).toBe('Mizoram');
    expect(nerRes.body[0].source).toBe('GSI');

    // Query source=NASA
    const nasaRes = await request(app)
      .get('/api/landslide-events?source=NASA')
      .set('Authorization', `Bearer ${token}`);

    expect(nasaRes.statusCode).toBe(200);
    expect(Array.isArray(nasaRes.body)).toBe(true);
    expect(nasaRes.body.length).toBe(1);
    expect(nasaRes.body[0].state).toBe('Himachal Pradesh');
    expect(nasaRes.body[0].source).toBe('NASA');
  });

  test('5 & 6: Historical records represent past activity and do not alter current mode queries', async () => {
    // 1 historical event and 1 active live report
    await LandslideEvent.create([
      {
        eventType: 'Landslide',
        location: { latitude: 25.67, longitude: 94.11 },
        severity: 'low',
        status: 'investigating',
        source: 'GSI',
        state: 'Nagaland',
        region: 'NER',
        isHistorical: true,
        reportedBy: user._id
      },
      {
        eventType: 'Mudslide',
        location: { latitude: 26.15, longitude: 91.77 },
        severity: 'critical',
        status: 'verified',
        source: 'citizen',
        state: 'Assam',
        region: 'NER',
        isHistorical: false,
        reportedBy: user._id
      }
    ]);

    // Query isHistorical=false (Current Mode)
    const currentRes = await request(app)
      .get('/api/landslide-events?isHistorical=false')
      .set('Authorization', `Bearer ${token}`);

    expect(currentRes.statusCode).toBe(200);
    expect(Array.isArray(currentRes.body)).toBe(true);
    expect(currentRes.body.length).toBe(1);
    expect(currentRes.body[0].eventType).toBe('Mudslide');
    expect(currentRes.body[0].isHistorical).toBe(false);

    // Query isHistorical=true (Historical Mode)
    const histRes = await request(app)
      .get('/api/landslide-events?isHistorical=true')
      .set('Authorization', `Bearer ${token}`);

    expect(histRes.statusCode).toBe(200);
    expect(Array.isArray(histRes.body)).toBe(true);
    expect(histRes.body.length).toBe(1);
    expect(histRes.body[0].eventType).toBe('Landslide');
    expect(histRes.body[0].isHistorical).toBe(true);
  });
});
