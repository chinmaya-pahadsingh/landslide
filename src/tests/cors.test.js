const request = require('supertest');

describe('CORS Configuration', () => {
  let app;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    jest.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('Development: allows localhost:5173', async () => {
    process.env.NODE_ENV = 'development';
    jest.doMock('../config/env', () => ({
      FRONTEND_URL: 'http://configured-frontend.com'
    }));
    app = require('../app');

    const res = await request(app)
      .get('/')
      .set('Origin', 'http://localhost:5173');

    // CORS logic passes, so we expect the route to be hit
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('Production: rejects localhost:5173 if not configured', async () => {
    process.env.NODE_ENV = 'production';
    jest.doMock('../config/env', () => ({
      FRONTEND_URL: 'http://configured-frontend.com'
    }));
    app = require('../app');

    const res = await request(app)
      .get('/')
      .set('Origin', 'http://localhost:5173');

    // CORS logic rejects the request
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('An unexpected server error occurred.');
  });

  it('Production: allows configured frontend origin', async () => {
    process.env.NODE_ENV = 'production';
    jest.doMock('../config/env', () => ({
      FRONTEND_URL: 'https://production-frontend.com'
    }));
    app = require('../app');

    const res = await request(app)
      .get('/')
      .set('Origin', 'https://production-frontend.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://production-frontend.com');
  });

  it('Production: rejects unconfigured random origin', async () => {
    process.env.NODE_ENV = 'production';
    jest.doMock('../config/env', () => ({
      FRONTEND_URL: 'https://production-frontend.com'
    }));
    app = require('../app');

    const res = await request(app)
      .get('/')
      .set('Origin', 'https://evil-site.com');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('An unexpected server error occurred.');
  });

  it('Production: handles safely when no FRONTEND_URL is configured', async () => {
    process.env.NODE_ENV = 'production';
    jest.doMock('../config/env', () => ({
      FRONTEND_URL: undefined
    }));
    app = require('../app');

    const res = await request(app)
      .get('/')
      .set('Origin', 'https://any-site.com');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('An unexpected server error occurred.');
  });
});
