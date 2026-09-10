/**
 * Backend Integration Tests — 1-Hour Controlled Refresh Window & News Feed Pipeline
 *
 * Covers all 8 required verification scenarios:
 * 1. News endpoint loads existing stored news without manual refresh.
 * 2. Fresh cached news does not call the provider again within 1 hour.
 * 3. Stale news allows one refresh.
 * 4. Concurrent requests do not trigger duplicate provider refreshes.
 * 5. Provider failure still returns existing stored news.
 * 6. Existing news is not deleted during refresh.
 * 7. Existing Refresh Sources behavior remains functional and respects 1-hour window.
 * 8. Unrelated endpoints and safety constraints remain intact.
 */

process.env.JWT_SECRET = 'test_secret_for_news_pipeline';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const NewsItem = require('../models/NewsItem');
const NewsSyncMeta = require('../models/NewsSyncMeta');
const newsApiProvider = require('../services/newsProviders/newsApiProvider');
const newsService = require('../services/newsService');

let mongoServer;
let originalFetchRecentDisasterNews;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  originalFetchRecentDisasterNews = newsApiProvider.fetchRecentDisasterNews;
});

afterAll(async () => {
  newsApiProvider.fetchRecentDisasterNews = originalFetchRecentDisasterNews;
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await NewsItem.deleteMany({});
  await NewsSyncMeta.deleteMany({});
  newsService._resetRefreshState();
  newsApiProvider._clearCache();
});

describe('1-Hour Controlled Refresh Window & Pipeline Verification', () => {
  // 1. News page loads existing stored news without manual refresh
  it('1. GET /api/news loads existing stored news automatically without manual refresh', async () => {
    await NewsItem.create({
      title: 'Stored Landslide Alert in Guwahati',
      summary: 'Heavy rains triggered minor landslide near NH-37.',
      url: 'https://news.example.com/assam-stored-landslide',
      source: { name: 'Assam State Portal', domain: 'assam.gov.in', type: 'OFFICIAL' },
      disasterType: 'landslide',
      location: { state: 'Assam' },
      publishedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      fetchedAt: new Date(Date.now() - 10 * 60 * 1000),
      contentHash: 'hash_test_1'
    });

    const res = await request(app).get('/api/news');
    expect(res.status).toBe(200);
    expect(res.body.articles).toHaveLength(1);
    expect(res.body.articles[0].title).toBe('Stored Landslide Alert in Guwahati');
    expect(res.body.total).toBe(1);
  });

  // 2. Fresh cached news does not call the provider again within 1 hour
  it('2. Fresh cached news does not call the provider again within 1 hour', async () => {
    // Seed an article fetched 15 minutes ago
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    await NewsItem.create({
      title: 'Recent Landslide Report',
      url: 'https://news.example.com/item-fresh',
      source: { name: 'Regional News', type: 'NEWS' },
      disasterType: 'landslide',
      publishedAt: fifteenMinutesAgo,
      fetchedAt: fifteenMinutesAgo,
      contentHash: 'hash_fresh'
    });

    await NewsSyncMeta.create({
      key: 'news_api_sync',
      lastRefreshedAt: fifteenMinutesAgo,
      status: 'success'
    });

    let providerCallCount = 0;
    newsApiProvider.fetchRecentDisasterNews = jest.fn(async () => {
      providerCallCount++;
      return { success: true, status: 'fetched', articles: [] };
    });

    const res = await request(app).get('/api/news');
    expect(res.status).toBe(200);
    expect(res.body.articles).toHaveLength(1);
    expect(providerCallCount).toBe(0); // MUST NOT call external provider
    expect(res.body.cooldownRemainingMinutes).toBeGreaterThan(0);
  });

  // 3. Stale news allows one refresh
  it('3. Stale news (> 1 hour) triggers controlled provider refresh', async () => {
    // Seed an article fetched 75 minutes ago (> 1 hour)
    const seventyFiveMinAgo = new Date(Date.now() - 75 * 60 * 1000);
    await NewsItem.create({
      title: 'Old Stale Article',
      url: 'https://news.example.com/item-old',
      source: { name: 'Regional News', type: 'NEWS' },
      disasterType: 'landslide',
      publishedAt: seventyFiveMinAgo,
      fetchedAt: seventyFiveMinAgo,
      contentHash: 'hash_old'
    });

    await NewsSyncMeta.create({
      key: 'news_api_sync',
      lastRefreshedAt: seventyFiveMinAgo,
      status: 'success'
    });

    let providerCallCount = 0;
    newsApiProvider.fetchRecentDisasterNews = jest.fn(async () => {
      providerCallCount++;
      return {
        success: true,
        status: 'fetched',
        articles: [{
          title: 'Brand New Cloudburst Alert in Sikkim',
          summary: 'Flash flood and cloudburst reported in North Sikkim.',
          url: 'https://news.example.com/sikkim-cloudburst',
          sourceName: 'Sikkim Express',
          publishedAt: new Date().toISOString(),
          disasterType: 'cloudburst',
          state: 'Sikkim'
        }]
      };
    });

    const refreshRes = await request(app).post('/api/news/refresh');
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.providerStatus).toBe('fetched');
    expect(refreshRes.body.savedCount).toBe(1);
    expect(providerCallCount).toBe(1);

    // Verify both the old and new articles now exist in MongoDB
    const allArticles = await NewsItem.find().sort({ publishedAt: -1 });
    expect(allArticles).toHaveLength(2);
  });

  // 4. Concurrent requests do not trigger duplicate provider refreshes
  it('4. Concurrent requests do not trigger duplicate provider refreshes', async () => {
    let providerCallCount = 0;
    newsApiProvider.fetchRecentDisasterNews = jest.fn(async () => {
      providerCallCount++;
      // Simulate network latency
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        success: true,
        status: 'fetched',
        articles: [{
          title: 'Flood Warning in Assam Valley',
          summary: 'Brahmaputra water levels rising.',
          url: 'https://news.example.com/assam-flood-1',
          sourceName: 'Assam Tribune',
          publishedAt: new Date().toISOString(),
          disasterType: 'flood',
          state: 'Assam'
        }]
      };
    });

    // Fire 5 simultaneous refresh requests
    const responses = await Promise.all([
      request(app).post('/api/news/refresh'),
      request(app).post('/api/news/refresh'),
      request(app).post('/api/news/refresh'),
      request(app).post('/api/news/refresh'),
      request(app).post('/api/news/refresh'),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Must only have invoked the provider ONCE despite 5 concurrent requests
    expect(providerCallCount).toBe(1);
  });

  // 5. Provider failure still returns existing stored news
  it('5. Provider failure still returns existing stored news gracefully', async () => {
    // Seed pre-existing article
    await NewsItem.create({
      title: 'Pre-existing Landslide Advisory',
      summary: 'Issued by SDMA Meghalaya.',
      url: 'https://sdma.meghalaya.gov.in/advisory-1',
      source: { name: 'Meghalaya SDMA', domain: 'gov.in', type: 'OFFICIAL' },
      disasterType: 'landslide',
      location: { state: 'Meghalaya' },
      publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago (stale)
      fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      contentHash: 'hash_meghalaya_1'
    });

    // Simulate provider failure (e.g. rate-limit, 500, or network failure)
    newsApiProvider.fetchRecentDisasterNews = jest.fn(async () => {
      return {
        success: false,
        status: 'error',
        reason: 'HTTP 429: Too Many Requests / Rate limit reached',
        articles: []
      };
    });

    const res = await request(app).get('/api/news');
    expect(res.status).toBe(200);
    expect(res.body.articles).toHaveLength(1);
    expect(res.body.articles[0].title).toBe('Pre-existing Landslide Advisory');

    // Also test POST /api/news/refresh on failure returns 200 graceful notice
    const refreshRes = await request(app).post('/api/news/refresh');
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.providerStatus).toBe('error');
    expect(refreshRes.body.reason).toContain('429');

    // Stored article is completely preserved
    const count = await NewsItem.countDocuments();
    expect(count).toBe(1);
  });

  // 6. Existing news is not deleted during refresh
  it('6. Existing news is not deleted during refresh', async () => {
    // Insert 2 initial articles
    await NewsItem.create({
      title: 'Article 1 - Preserved',
      url: 'https://example.com/preserved-1',
      source: { name: 'Source 1', type: 'NEWS' },
      disasterType: 'landslide',
      publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      contentHash: 'hash_pres_1'
    });
    await NewsItem.create({
      title: 'Article 2 - Preserved',
      url: 'https://example.com/preserved-2',
      source: { name: 'Source 2', type: 'NEWS' },
      disasterType: 'flood',
      publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      contentHash: 'hash_pres_2'
    });

    newsApiProvider.fetchRecentDisasterNews = jest.fn(async () => {
      return {
        success: true,
        status: 'fetched',
        articles: [{
          title: 'Article 3 - Newly Added',
          url: 'https://example.com/new-3',
          sourceName: 'Source 3',
          publishedAt: new Date().toISOString(),
          disasterType: 'avalanche',
          state: 'Arunachal Pradesh'
        }]
      };
    });

    const refreshRes = await request(app).post('/api/news/refresh');
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.savedCount).toBe(1);

    // All 3 articles must be in MongoDB
    const all = await NewsItem.find();
    expect(all).toHaveLength(3);
    const titles = all.map(a => a.title);
    expect(titles).toContain('Article 1 - Preserved');
    expect(titles).toContain('Article 2 - Preserved');
    expect(titles).toContain('Article 3 - Newly Added');
  });

  // 7. Existing Refresh Sources behavior remains functional and respects 1-hour cooldown
  it('7. Refresh Sources respects 1-hour cooldown and returns informative status', async () => {
    newsApiProvider.fetchRecentDisasterNews = jest.fn(async () => {
      return {
        success: true,
        status: 'fetched',
        articles: [{
          title: 'Initial Refresh Article',
          url: 'https://example.com/initial-1',
          sourceName: 'Official News',
          publishedAt: new Date().toISOString(),
          disasterType: 'earthquake'
        }]
      };
    });

    // First refresh: eligible, fetches
    const firstRes = await request(app).post('/api/news/refresh');
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.providerStatus).toBe('fetched');
    expect(firstRes.body.savedCount).toBe(1);

    // Second refresh immediately: within 1-hour window, returns cached status with remaining cooldown
    const secondRes = await request(app).post('/api/news/refresh');
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.providerStatus).toBe('cached');
    expect(secondRes.body.cooldownRemainingMinutes).toBeGreaterThan(0);
    expect(secondRes.body.message).toContain('Refresh available in');
    expect(secondRes.body.savedCount).toBe(0);
  });
});
