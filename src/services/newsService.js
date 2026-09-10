const crypto = require('crypto');
const NewsItem = require('../models/NewsItem');
const NewsSyncMeta = require('../models/NewsSyncMeta');
const newsApiProvider = require('./newsProviders/newsApiProvider');
const {
  classifyDisasterArticle,
  filterAndPrioritizeDisasterArticles
} = require('../utils/disasterNewsFilter');

// ---------------------------------------------------------------------------
// 1-Hour Refresh Window & Concurrency Protection State
// ---------------------------------------------------------------------------

const REFRESH_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5-minute backoff on provider failure to prevent retry storms

let memoryLastRefreshedAt = null;
let memoryLastAttemptAt = null;
let inFlightRefreshPromise = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic content hash from title and domain for deduplication.
 */
const generateContentHash = (title, domain) => {
  if (!title) return null;
  const raw = `${title.toLowerCase().trim()}|${(domain || '').toLowerCase().trim()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
};

/**
 * Normalises state name for NER (North-East Region).
 */
const NER_STATES = [
  'assam', 'arunachal pradesh', 'meghalaya', 'manipur',
  'mizoram', 'nagaland', 'tripura', 'sikkim'
];

const normaliseState = (stateString) => {
  if (!stateString) return null;
  const lower = stateString.toLowerCase().trim();
  const match = NER_STATES.find(s => lower.includes(s));
  return match ? match.replace(/\b\w/g, c => c.toUpperCase()) : null;
};

/**
 * Determines source type based on known official domains/names.
 */
const OFFICIAL_DOMAINS = ['gov.in', 'nic.in', 'ndma', 'imd', 'sdma'];

const classifySource = (sourceName, domain) => {
  const lowerName = (sourceName || '').toLowerCase();
  const lowerDomain = (domain || '').toLowerCase();

  const isOfficial = OFFICIAL_DOMAINS.some(
    od => lowerDomain.includes(od) || lowerName.includes(od)
  );

  return isOfficial ? 'OFFICIAL' : 'NEWS';
};

/**
 * Normalises raw article data into the standard contract.
 */
const normaliseArticle = (rawArticle) => {
  if (!rawArticle.title || !rawArticle.url || !rawArticle.publishedAt) {
    return null; // Missing critical fields
  }

  const domainMatch = rawArticle.url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:/\n?]+)/img);
  const domain = domainMatch ? domainMatch[0] : '';
  
  const sourceType = classifySource(rawArticle.sourceName, domain);
  const contentHash = generateContentHash(rawArticle.title, domain);

  return {
    title: rawArticle.title.substring(0, 300), // Protect against massive titles
    summary: rawArticle.summary ? rawArticle.summary.substring(0, 500) : '',
    url: rawArticle.url,
    source: {
      name: rawArticle.sourceName || 'Unknown Source',
      domain: domain,
      type: sourceType,
    },
    disasterType: rawArticle.disasterType || (classifyDisasterArticle(rawArticle.title, rawArticle.summary) ? classifyDisasterArticle(rawArticle.title, rawArticle.summary).toLowerCase() : 'other'),
    disasterCategory: classifyDisasterArticle(rawArticle.title, rawArticle.summary) || (rawArticle.disasterType ? rawArticle.disasterType.toUpperCase() : 'OTHER_DISASTER'),
    location: {
      name: rawArticle.locationName || null,
      state: normaliseState(rawArticle.state),
      district: rawArticle.district || null,
      latitude: rawArticle.latitude,
      longitude: rawArticle.longitude,
    },
    publishedAt: new Date(rawArticle.publishedAt),
    verificationStatus: sourceType,
    tags: Array.isArray(rawArticle.tags) ? rawArticle.tags : [],
    contentHash,
  };
};

/**
 * Calculates operational importance (0-100).
 */
const calculateImportance = (article) => {
  let score = 0;

  // 1. Source Trust
  if (article.source.type === 'OFFICIAL') {
    score += 40;
  } else if (article.source.type === 'NEWS') {
    score += 20;
  }

  // 2. Disaster Relevance
  const highImpactTypes = ['landslide', 'flood', 'slope_failure', 'flash_flood', 'cloudburst', 'avalanche', 'earthquake'];
  if (highImpactTypes.includes(article.disasterType)) {
    score += 30;
  } else if (article.disasterType === 'heavy_rain' || article.disasterType === 'road_blockage') {
    score += 20;
  } else {
    score += 10;
  }

  // 3. Recency (Decays over 7 days)
  const ageHours = (Date.now() - article.publishedAt.getTime()) / (1000 * 60 * 60);
  if (ageHours < 24) {
    score += 30;
  } else if (ageHours < 72) {
    score += 20;
  } else if (ageHours < 168) { // 7 days
    score += 10;
  }

  return Math.min(score, 100);
};

// ---------------------------------------------------------------------------
// Main Service Functions
// ---------------------------------------------------------------------------

/**
 * Processes, normalises, ranks, deduplicates, and saves an array of raw articles.
 */
const processAndStoreArticles = async (rawArticles) => {
  if (!Array.isArray(rawArticles)) return [];

  const savedArticles = [];
  const errors = [];

  for (const raw of rawArticles) {
    // Filter out non-disaster articles (e.g. sports, entertainment, tech, stock market, metaphorical)
    const category = classifyDisasterArticle(raw.title, raw.summary);
    if (!category && !raw.disasterType && !raw.disasterCategory) {
      errors.push({ reason: 'Non-disaster article filtered out', data: raw.url || raw.title });
      continue;
    }

    const normalised = normaliseArticle(raw);
    if (!normalised) {
      errors.push({ reason: 'Missing required fields', data: raw });
      continue;
    }

    normalised.importance = calculateImportance(normalised);

    try {
      // Deduplication check: Do we have this URL or Content Hash already?
      const existing = await NewsItem.findOne({
        $or: [
          { url: normalised.url },
          { contentHash: normalised.contentHash }
        ]
      });

      if (!existing) {
        const doc = new NewsItem(normalised);
        await doc.save();
        savedArticles.push(doc);
      } else {
        // We already have it, skip to avoid duplicates.
        // We do not incorrectly merge reports here.
        errors.push({ reason: 'Duplicate article', data: raw.url });
      }
    } catch (err) {
      errors.push({ reason: err.message, data: raw.url });
    }
  }

  return {
    processedCount: rawArticles.length,
    savedCount: savedArticles.length,
    duplicateOrErrorCount: errors.length,
    savedArticles,
    errors
  };
};

/**
 * Retrieves news with optional filters.
 */
const getNews = async (filters = {}) => {
  const query = {};

  if (filters.state) {
    query['location.state'] = normaliseState(filters.state);
  }
  if (filters.disasterType) {
    query.disasterType = filters.disasterType;
  }
  if (filters.sourceType) {
    query['source.type'] = filters.sourceType;
  }

  // Calculate pagination
  const limit = parseInt(filters.limit, 10) || 50;
  const page = parseInt(filters.page, 10) || 1;
  const skip = (page - 1) * limit;

  const total = await NewsItem.countDocuments(query);
  const rawArticles = await NewsItem.find(query)
    .sort({ publishedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const articles = filterAndPrioritizeDisasterArticles(rawArticles);

  return {
    articles,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
};

/**
 * Retrieves the latest recorded provider refresh timestamp from DB or memory.
 */
const getLastRefreshTime = async () => {
  if (memoryLastRefreshedAt) {
    return memoryLastRefreshedAt;
  }

  try {
    const meta = await NewsSyncMeta.findOne({ key: 'news_api_sync' });
    if (meta && meta.lastRefreshedAt) {
      memoryLastRefreshedAt = meta.lastRefreshedAt;
      return memoryLastRefreshedAt;
    }
  } catch (err) {
    // Graceful fallback
  }

  try {
    const latestItem = await NewsItem.findOne().sort({ fetchedAt: -1 });
    if (latestItem && latestItem.fetchedAt) {
      memoryLastRefreshedAt = latestItem.fetchedAt;
      return memoryLastRefreshedAt;
    }
  } catch (err) {
    // Graceful fallback
  }

  return null;
};

/**
 * Checks whether the news feed is eligible for an external provider refresh
 * based on the 1-hour window and failure backoff.
 */
const checkRefreshEligibility = async () => {
  const lastTime = await getLastRefreshTime();
  const now = Date.now();

  if (lastTime) {
    const elapsed = now - new Date(lastTime).getTime();
    if (elapsed < REFRESH_WINDOW_MS) {
      const cooldownRemainingMinutes = Math.ceil((REFRESH_WINDOW_MS - elapsed) / (60 * 1000));
      return {
        isEligible: false,
        cooldownRemainingMinutes,
        lastRefreshedAt: lastTime,
      };
    }
  }

  if (memoryLastAttemptAt) {
    const elapsedAttempt = now - new Date(memoryLastAttemptAt).getTime();
    if (elapsedAttempt < FAILURE_COOLDOWN_MS) {
      const cooldownRemainingMinutes = Math.ceil((FAILURE_COOLDOWN_MS - elapsedAttempt) / (60 * 1000));
      return {
        isEligible: false,
        cooldownRemainingMinutes,
        lastRefreshedAt: lastTime,
      };
    }
  }

  return {
    isEligible: true,
    cooldownRemainingMinutes: 0,
    lastRefreshedAt: lastTime,
  };
};

/**
 * Synchronises stored news with the external provider.
 * Enforces:
 * - 1-hour refresh protection window
 * - Duplicate request lock (piggybacks concurrent callers on one single in-flight promise)
 * - Safe persistence and deduplication without deleting existing news
 * - Graceful failure returning existing news if provider fails
 */
const syncNewsWithProvider = async ({ force = false, isManual = false } = {}) => {
  // If a refresh is already running, return the active promise to avoid duplicate provider calls
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    try {
      const eligibility = await checkRefreshEligibility();

      // For manual refresh, only throttle if within 1-hour window of a successful refresh
      const isThrottled = isManual
        ? (!force && eligibility.lastRefreshedAt && (Date.now() - new Date(eligibility.lastRefreshedAt).getTime() < REFRESH_WINDOW_MS))
        : (!force && !eligibility.isEligible);

      if (isThrottled) {
        const remaining = eligibility.cooldownRemainingMinutes || 60;
        return {
          status: 'cached',
          refreshed: false,
          cooldownRemainingMinutes: remaining,
          message: `News was recently refreshed. Refresh available in ${remaining} minute${remaining === 1 ? '' : 's'}.`,
        };
      }

      const providerResult = await newsApiProvider.fetchRecentDisasterNews(true);

      if (!providerResult.success) {
        memoryLastAttemptAt = new Date();
        try {
          await NewsSyncMeta.findOneAndUpdate(
            { key: 'news_api_sync' },
            {
              lastAttemptAt: memoryLastAttemptAt,
              status: 'failed',
              lastError: providerResult.reason || 'Provider unavailable',
            },
            { upsert: true }
          );
        } catch (dbErr) {
          // Non-fatal
        }

        return {
          status: providerResult.status || 'unavailable',
          refreshed: false,
          reason: providerResult.reason || 'Provider unavailable',
          processedCount: 0,
          savedCount: 0,
        };
      }

      // Process and store into MongoDB (deduplication ensures old news is preserved)
      const storageResult = await processAndStoreArticles(providerResult.articles);

      const now = new Date();
      memoryLastRefreshedAt = now;
      memoryLastAttemptAt = now;

      try {
        await NewsSyncMeta.findOneAndUpdate(
          { key: 'news_api_sync' },
          {
            lastRefreshedAt: now,
            lastAttemptAt: now,
            status: 'success',
            lastError: null,
          },
          { upsert: true }
        );
      } catch (dbErr) {
        // Non-fatal
      }

      return {
        status: 'fetched',
        refreshed: true,
        cooldownRemainingMinutes: 60,
        processedCount: storageResult.processedCount,
        savedCount: storageResult.savedCount,
        duplicateOrErrorCount: storageResult.duplicateOrErrorCount,
      };
    } catch (err) {
      memoryLastAttemptAt = new Date();
      return {
        status: 'error',
        refreshed: false,
        reason: err.message,
        processedCount: 0,
        savedCount: 0,
      };
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
};

const _resetRefreshState = () => {
  memoryLastRefreshedAt = null;
  memoryLastAttemptAt = null;
  inFlightRefreshPromise = null;
};

module.exports = {
  generateContentHash,
  normaliseState,
  classifySource,
  normaliseArticle,
  calculateImportance,
  processAndStoreArticles,
  getNews,
  getLastRefreshTime,
  checkRefreshEligibility,
  syncNewsWithProvider,
  _resetRefreshState,
  REFRESH_WINDOW_MS,
};
