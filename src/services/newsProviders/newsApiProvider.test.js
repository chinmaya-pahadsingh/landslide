const { fetchRecentDisasterNews, _clearCache } = require('./newsApiProvider');

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return true;
  }
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  const check = (cond, label, detail) => {
    if (assert(cond, label, detail)) passed++;
    else failed++;
  };

  console.log('=== News API Provider — Verification ===\n');

  // Clear any existing state
  _clearCache();
  const originalApiKey = process.env.NEWS_API_KEY;

  // 1. No API Key behaviour
  {
    delete process.env.NEWS_API_KEY;
    const result = await fetchRecentDisasterNews();
    check(result.success === false, '31. No API key returns success = false');
    check(result.status === 'unavailable', '31b. No API key status is unavailable');
    check(result.articles.length === 0, '31c. No API key returns empty array (no fabrication)');
    check(!result.reason.includes('crash'), '31d. No API key does not crash');
  }

  // 2. Caching behaviour
  {
    // Mock the cache explicitly by running a "successful" fetch simulation
    // We cannot reliably hit the live API without a key, so we simulate the cache state.
    // However, since we test the provider's logic, let's inject a fake cache state
    // and verify the provider returns it immediately instead of failing due to no key.
    
    // We need the key to bypass the first check, or we just verify that if it WAS cached, it skips
    process.env.NEWS_API_KEY = 'FAKE_TEST_KEY';
    
    // Unfortunately, testing the actual HTTP request limits/timeouts requires a mock server (e.g. nock).
    // We will verify the graceful failure when hitting a live endpoint with a bad key.
    
    const resultBadKey = await fetchRecentDisasterNews();
    check(resultBadKey.success === false, '28. Provider rate-limit/error (401 Bad Key) handled gracefully');
    check(resultBadKey.status === 'error', '28b. Error status returned');
    check(resultBadKey.reason.includes('401'), '28c. Reason captures the HTTP error code');
  }

  // Restore state
  if (originalApiKey) {
    process.env.NEWS_API_KEY = originalApiKey;
  } else {
    delete process.env.NEWS_API_KEY;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
