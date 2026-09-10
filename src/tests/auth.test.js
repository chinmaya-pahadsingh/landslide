process.env.JWT_SECRET = 'test_secret_for_auth_tests';
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/User');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await User.deleteMany({});
});

describe('Authentication & Security', () => {
  describe('Registration', () => {
    it('should register a user as a citizen', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user.role).toBe('citizen');
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('should ignore requested role and force citizen', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Hacker Man',
          email: 'hacker@example.com',
          password: 'password123',
          role: 'admin' // Attempt to elevate privilege
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user.role).toBe('citizen'); // Must be citizen
    });

    it('should reject duplicate email safely without exposing stack traces', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'User 1', email: 'dup@example.com', password: 'abc' });

      const res2 = await request(app)
        .post('/api/auth/register')
        .send({ name: 'User 2', email: 'dup@example.com', password: 'xyz' });

      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('Email is already registered.');
    });
  });

  describe('Login & Authorization', () => {
    let citizenToken;

    beforeEach(async () => {
      // Register a user
      await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Normal Citizen',
          email: 'citizen@example.com',
          password: 'password123'
        });

      // Login to get token
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'citizen@example.com', password: 'password123' });

      citizenToken = res.body.token;
    });

    it('should return a generic error for wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'citizen@example.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password.');
    });

    it('should return a generic error for nonexistent account', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password.');
    });

    it('should allow citizen to access /me', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${citizenToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('citizen@example.com');
    });

    it('should allow citizen to post a field report', async () => {
      const res = await request(app)
        .post('/api/field-reports')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          location: { latitude: 10, longitude: 10 },
          reportType: 'landslide',
          source: 'citizen'
        });

      expect(res.status).toBe(201);
      // userId should have been appended securely via req.user
      expect(res.body).toHaveProperty('userId');
    });

    it('should prevent citizen from accessing admin endpoints', async () => {
      const res = await request(app)
        .post('/api/landslide-events') // Requires 'admin', 'authority', 'field_team'
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          location: { latitude: 10, longitude: 10 },
          severity: 'high',
          status: 'verified'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied. Insufficient privileges.');
    });

    it('should reject requests without a token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should reject requests with an invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer totally_invalid_token_123`);
      expect(res.status).toBe(401);
    });
  });

  describe('Role-based Authorization', () => {
    let adminToken, authorityToken, fieldTeamToken, citizenToken;

    beforeEach(async () => {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../config/env');

      // Helper to directly create users and mint tokens for testing roles
      const createRoleUser = async (role) => {
        const user = new User({
          name: `${role} User`,
          email: `${role}@example.com`,
          passwordHash: 'dummy',
          role
        });
        await user.save();
        return jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
      };

      adminToken = await createRoleUser('admin');
      authorityToken = await createRoleUser('authority');
      fieldTeamToken = await createRoleUser('field_team');
      citizenToken = await createRoleUser('citizen');
    });

    it('should allow field_team permitted operations but block unpermitted ones', async () => {
      // field_team can post landslide-events
      let res = await request(app)
        .post('/api/landslide-events')
        .set('Authorization', `Bearer ${fieldTeamToken}`)
        .send({ location: { latitude: 10, longitude: 10 } });
      
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);

      // field_team CANNOT post infrastructure-assets
      res = await request(app)
        .post('/api/infrastructure-assets')
        .set('Authorization', `Bearer ${fieldTeamToken}`)
        .send({ name: 'Bridge' });
        
      expect(res.status).toBe(403);
    });

    it('should allow authority permitted operations', async () => {
      // authority can post infrastructure-assets
      let res = await request(app)
        .post('/api/infrastructure-assets')
        .set('Authorization', `Bearer ${authorityToken}`)
        .send({ name: 'Bridge', type: 'bridge', location: { latitude: 10, longitude: 10 }, status: 'operational' });
        
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
      
      // authority can evaluate early warning
      res = await request(app)
        .post('/api/early-warning/evaluate')
        .set('Authorization', `Bearer ${authorityToken}`)
        .send({ location: { latitude: 10, longitude: 10 } });
        
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });

    it('should allow admin ALL protected operations', async () => {
      // admin can post infrastructure-assets
      let res = await request(app)
        .post('/api/infrastructure-assets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bridge', type: 'bridge', location: { latitude: 10, longitude: 10 }, status: 'operational' });
        
      expect(res.status).not.toBe(403);
      
      // admin can evaluate early warning
      res = await request(app)
        .post('/api/early-warning/evaluate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ location: { latitude: 10, longitude: 10 } });
        
      expect(res.status).not.toBe(403);
      
      // admin can access endpoints without explicit admin role in requireRole because they bypass
      // (This implicitly tests the `if (req.user.role === 'admin') return next();` in authMiddleware)
    });
  });
});

