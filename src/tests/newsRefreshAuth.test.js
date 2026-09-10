/**
 * Backend Integration Tests — News Refresh Public Access & Security Boundaries
 *
 * Verifies that POST /api/news/refresh is publicly callable for everyone:
 *   logged-out / unauthenticated → allowed (passes auth guard, non-401/403)
 *   citizen                      → allowed (passes auth guard, non-401/403)
 *   field_team                   → allowed (passes auth guard, non-401/403)
 *   authority                    → allowed (passes auth guard, non-401/403)
 *   admin                        → allowed (passes auth guard, non-401/403)
 *
 * Also verifies that unrelated protected endpoints remain strictly protected:
 *   POST /api/notifications       → requires authentication (401) & role (403 for citizen)
 *   POST /api/early-warning/evaluate → requires authentication (401) & role (403 for citizen)
 */
process.env.JWT_SECRET = 'test_secret_for_news_refresh_auth';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../app');
const User = require('../models/User');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await User.deleteMany({});
});

/** Creates a DB user with the given role and returns a signed JWT. */
const createRoleToken = async (role) => {
  const user = new User({
    name: `${role} User`,
    email: `${role}@news-test.com`,
    passwordHash: 'dummy_hash_not_used',
    role
  });
  await user.save();
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

describe('POST /api/news/refresh — Public Access for Everyone', () => {
  it('allows logged-out (unauthenticated) visitors to refresh news', async () => {
    const res = await request(app).post('/api/news/refresh');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    // Should hit the news controller
    expect(res.body).not.toHaveProperty('error', 'Authentication required. Missing or malformed token.');
  });

  it('allows citizen to refresh news', async () => {
    const token = await createRoleToken('citizen');
    const res = await request(app)
      .post('/api/news/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('allows field_team to refresh news', async () => {
    const token = await createRoleToken('field_team');
    const res = await request(app)
      .post('/api/news/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('allows authority to refresh news', async () => {
    const token = await createRoleToken('authority');
    const res = await request(app)
      .post('/api/news/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('allows admin to refresh news', async () => {
    const token = await createRoleToken('admin');
    const res = await request(app)
      .post('/api/news/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe('Security Boundaries — Unrelated Protected Endpoints Remain Protected', () => {
  it('denies unauthenticated access to POST /api/notifications with 401', async () => {
    const res = await request(app).post('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('denies citizen role on POST /api/notifications with 403', async () => {
    const token = await createRoleToken('citizen');
    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access denied. Insufficient privileges.');
  });

  it('denies unauthenticated access to POST /api/early-warning/evaluate with 401', async () => {
    const res = await request(app).post('/api/early-warning/evaluate');
    expect(res.status).toBe(401);
  });

  it('denies citizen role on POST /api/early-warning/evaluate with 403', async () => {
    const token = await createRoleToken('citizen');
    const res = await request(app)
      .post('/api/early-warning/evaluate')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access denied. Insufficient privileges.');
  });
});

