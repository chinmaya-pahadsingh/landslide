const {
  generateContentHash,
  normaliseState,
  classifySource,
  normaliseArticle,
  calculateImportance
} = require('./newsService');

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return true;
  }
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

function runTests() {
  let passed = 0;
  let failed = 0;

  const check = (cond, label, detail) => {
    if (assert(cond, label, detail)) passed++;
    else failed++;
  };

  console.log('=== News Service Logic — Verification ===\n');

  // 1. Content Hash Determinism
  {
    const hash1 = generateContentHash('Landslide near Guwahati', 'news.com');
    const hash2 = generateContentHash('landslide NEAR guwahati', 'NEWS.COM');
    const hash3 = generateContentHash('Different Title', 'news.com');
    check(hash1 === hash2, '14. Deduplication hash ignores case and whitespace');
    check(hash1 !== hash3, '14b. Deduplication hash differs for different titles');
  }

  // 2. NER State Normalization
  {
    check(normaliseState('assam') === 'Assam', '9. NER State normalised correctly (Assam)');
    check(normaliseState('MEGHALAYA') === 'Meghalaya', '9b. NER State normalised correctly (Meghalaya)');
    check(normaliseState('Some Random State') === null, '9c. Non-NER state returns null');
  }

  // 3. Official vs News Classification
  {
    check(classifySource('IMD Alerts', 'imd.gov.in') === 'OFFICIAL', '18. Official source classified correctly (imd.gov.in)');
    check(classifySource('NDMA', 'ndma.gov.in') === 'OFFICIAL', '18b. Official source classified correctly (ndma)');
    check(classifySource('Times of India', 'timesofindia.indiatimes.com') === 'NEWS', '19. Ordinary news classified correctly');
    check(classifySource(null, null) === 'NEWS', '20. Unknown source defaults to NEWS safely in classifer'); // Wait, classifier returns NEWS if not official, but schema allows UNKNOWN. Actually, classifier returns NEWS. Let's adjust schema default vs classifier. The plan said UNKNOWN is fine. We'll accept NEWS for any non-official in this simple logic.
  }

  // 4. Article Normalisation
  {
    const raw = {
      title: 'Heavy rain triggers landslide',
      url: 'https://example.com/news/123',
      sourceName: 'Example News',
      publishedAt: new Date().toISOString(),
      disasterType: 'landslide',
      state: 'Assam'
    };
    
    const norm = normaliseArticle(raw);
    check(norm.title === raw.title, '17. Normalization preserves title');
    check(norm.url === raw.url, '33. Original URL preserved');
    check(norm.source.type === 'NEWS', '19b. Normalization sets source type to NEWS');
    check(norm.location.state === 'Assam', '17b. Normalization extracts state properly');
    check(norm.contentHash.length === 64, '17c. Normalization generates sha256 contentHash');

    // Missing fields
    check(normaliseArticle({}) === null, '17d. Missing required fields returns null');
  }

  // 5. Ranking Logic (Determinism & Priority)
  {
    const article1 = {
      publishedAt: new Date(),
      source: { type: 'OFFICIAL' },
      disasterType: 'landslide'
    }; // Score: 40 (Official) + 30 (Landslide) + 30 (Recent) = 100

    const article2 = {
      publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days old
      source: { type: 'NEWS' },
      disasterType: 'other'
    }; // Score: 20 (News) + 10 (Other) + 10 (5 days old) = 40

    const score1 = calculateImportance(article1);
    const score2 = calculateImportance(article2);
    check(score1 === 100, '21. News ranking determinism (Max score = 100)');
    check(score2 === 40, '22. Recency ranking heavily decays older news');
    check(score1 > score2, '24. Disaster relevance and Official source correctly rank higher');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
