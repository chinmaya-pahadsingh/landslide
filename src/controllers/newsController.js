const {
  getNews,
  checkRefreshEligibility,
  syncNewsWithProvider
} = require('../services/newsService');
const mongoose = require('mongoose');
const NewsItem = require('../models/NewsItem');

/**
 * GET /api/news
 * Fetches stored news from the database with optional filters.
 * Automatically checks 1-hour refresh eligibility:
 * - Serves existing stored news from MongoDB immediately
 * - Triggers controlled provider refresh if stale (> 1 hour)
 * - If MongoDB is empty, awaits refresh so first-time visitors see news automatically
 */
const getAllNews = async (req, res) => {
  try {
    const filters = {
      state: req.query.state,
      disasterType: req.query.disasterType,
      sourceType: req.query.sourceType,
      page: req.query.page,
      limit: req.query.limit
    };

    // First fetch existing stored news from MongoDB
    let result = await getNews(filters);

    // Check 1-hour refresh window eligibility
    const eligibility = await checkRefreshEligibility();

    if (eligibility.isEligible) {
      if (result.total === 0) {
        // When MongoDB is empty, perform the controlled provider refresh first
        // so that the initial page load automatically displays stored news
        await syncNewsWithProvider();
        result = await getNews(filters);
      } else {
        // When stored news already exists, trigger controlled background refresh
        // without creating duplicate provider requests or blocking the response
        syncNewsWithProvider().catch(err => {
          console.error('Background news refresh error:', err);
        });
      }
    }

    const latestEligibility = await checkRefreshEligibility();

    res.status(200).json({
      ...result,
      lastRefreshedAt: latestEligibility.lastRefreshedAt,
      cooldownRemainingMinutes: latestEligibility.cooldownRemainingMinutes,
      isRefreshEligible: latestEligibility.isEligible
    });
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

/**
 * GET /api/news/:id
 * Fetches a single news item by its Mongo Object ID.
 */
const getNewsById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid news ID format.' });
    }

    const article = await NewsItem.findById(id);

    if (!article) {
      return res.status(404).json({ error: 'News article not found.' });
    }

    res.status(200).json(article);
  } catch (error) {
    console.error('Error fetching news by ID:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

/**
 * POST /api/news/refresh
 * Manually triggers a fetch from external providers.
 * Strictly respects the 1-hour refresh window and prevents duplicate calls.
 */
const refreshNews = async (req, res) => {
  try {
    const refreshResult = await syncNewsWithProvider({ isManual: true });

    if (!refreshResult.refreshed) {
      if (refreshResult.status === 'cached') {
        const remaining = refreshResult.cooldownRemainingMinutes;
        return res.status(200).json({
          message: `News was recently refreshed. Refresh available in ${remaining} minute${remaining === 1 ? '' : 's'}.`,
          providerStatus: 'cached',
          cooldownRemainingMinutes: remaining,
          processedCount: 0,
          savedCount: 0
        });
      }

      // Return 200 with warning for provider errors (graceful failure)
      return res.status(200).json({
        message: 'Could not fetch live news.',
        providerStatus: refreshResult.status,
        reason: refreshResult.reason,
        processedCount: 0,
        savedCount: 0
      });
    }

    res.status(200).json({
      message: 'News refreshed successfully.',
      providerStatus: 'fetched',
      cooldownRemainingMinutes: 60,
      processedCount: refreshResult.processedCount,
      savedCount: refreshResult.savedCount,
      duplicateOrErrorCount: refreshResult.duplicateOrErrorCount
    });

  } catch (error) {
    console.error('Error refreshing news:', error);
    res.status(500).json({ error: 'An unexpected server error occurred during refresh.' });
  }
};

module.exports = {
  getAllNews,
  getNewsById,
  refreshNews
};
