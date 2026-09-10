const https = require('https');

// ---------------------------------------------------------------------------
// Provider State & Caching
// ---------------------------------------------------------------------------

let cache = {
  timestamp: 0,
  data: null
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour window to prevent rate limits
const REQUEST_TIMEOUT_MS = 5000; // 5 seconds timeout
const MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// NER States & Disaster Category Detection Helpers
// ---------------------------------------------------------------------------

const NER_STATES = [
  'assam', 'arunachal pradesh', 'meghalaya', 'manipur',
  'mizoram', 'nagaland', 'tripura', 'sikkim'
];

const detectDisasterType = (title = '', description = '') => {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes('landslide')) return 'landslide';
  if (text.includes('slope failure') || text.includes('slope')) return 'slope_failure';
  if (text.includes('flash flood')) return 'flash_flood';
  if (text.includes('cloudburst')) return 'cloudburst';
  if (text.includes('flood') || text.includes('inundat')) return 'flood';
  if (text.includes('avalanche')) return 'avalanche';
  if (text.includes('earthquake') || text.includes('tremor') || text.includes('seismic')) return 'earthquake';
  if (text.includes('heavy rainfall') || text.includes('heavy rain') || text.includes('downpour') || text.includes('torrential')) return 'heavy_rain';
  if (text.includes('road blockage') || text.includes('highway blocked') || text.includes('blockage') || text.includes('traffic halted')) return 'road_blockage';
  return 'other';
};

const detectNerState = (title = '', description = '') => {
  const text = `${title} ${description}`.toLowerCase();
  for (const st of NER_STATES) {
    if (text.includes(st)) {
      return st.replace(/\b\w/g, c => c.toUpperCase());
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// HTTP Helper with Retries & Timeout
// ---------------------------------------------------------------------------

const makeRequest = (url, options, retries = MAX_RETRIES, backoff = 1000) => {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Malformed JSON response from provider'));
          }
        } else if (res.statusCode === 429 || res.statusCode >= 500) {
          // Retryable errors
          if (retries > 0) {
            setTimeout(() => {
              makeRequest(url, options, retries - 1, backoff * 2).then(resolve).catch(reject);
            }, backoff);
          } else {
            reject(new Error(`Provider error: ${res.statusCode}`));
          }
        } else {
          // Non-retryable errors (e.g. 401 Unauthorized, 400 Bad Request)
          reject(new Error(`Provider error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      if (retries > 0) {
        setTimeout(() => {
          makeRequest(url, options, retries - 1, backoff * 2).then(resolve).catch(reject);
        }, backoff);
      } else {
        reject(err);
      }
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.abort();
      if (retries > 0) {
        setTimeout(() => {
          makeRequest(url, options, retries - 1, backoff * 2).then(resolve).catch(reject);
        }, backoff);
      } else {
        reject(new Error('Provider request timed out'));
      }
    });

    req.end();
  });
};

// ---------------------------------------------------------------------------
// Provider Interface
// ---------------------------------------------------------------------------

/**
 * Fetches recent disaster/landslide news from NewsAPI.
 * Enforces API key safety, caching, and graceful failure.
 */
const fetchRecentDisasterNews = async (forceRefresh = false) => {
  const apiKey = process.env.NEWS_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      status: 'unavailable',
      reason: 'NEWS_API_KEY is not configured.',
      articles: []
    };
  }

  // Check cache to prevent request storms
  if (!forceRefresh && cache.data && (Date.now() - cache.timestamp < CACHE_TTL_MS)) {
    return {
      success: true,
      status: 'cached',
      articles: cache.data
    };
  }

  try {
    // Construct query targeting NER disaster categories in India
    const query = encodeURIComponent('(landslide OR "slope failure" OR "flash flood" OR flood OR cloudburst OR avalanche OR earthquake OR "heavy rainfall" OR "heavy rain" OR "road blockage") AND India');
    const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=20`;
    
    const options = {
      headers: {
        'X-Api-Key': apiKey,
        'User-Agent': 'LandslideEarlyWarningSystem/1.0'
      }
    };

    const response = await makeRequest(url, options);

    if (response.status !== 'ok' || !Array.isArray(response.articles)) {
      throw new Error('Provider returned unexpected status or structure');
    }

    // Map provider-specific format to our generic raw article format
    const rawArticles = response.articles.map(article => ({
      title: article.title,
      summary: article.description,
      url: article.url,
      sourceName: article.source ? article.source.name : 'Unknown',
      publishedAt: article.publishedAt,
      disasterType: detectDisasterType(article.title, article.description),
      state: detectNerState(article.title, article.description),
      district: null,
      latitude: null,
      longitude: null,
    }));

    // Update Cache
    cache.timestamp = Date.now();
    cache.data = rawArticles;

    return {
      success: true,
      status: 'fetched',
      articles: rawArticles
    };

  } catch (error) {
    return {
      success: false,
      status: 'error',
      reason: error.message,
      articles: [] // Graceful failure, never crash
    };
  }
};

module.exports = {
  fetchRecentDisasterNews,
  _clearCache: () => { cache.timestamp = 0; cache.data = null; } // For testing
};
