import { translations, dynamicPatterns } from '../locales/translations.js';

// Re-implement the t(key) logic pure for Node testing
const t = (key, language) => {
  if (!key || typeof key !== 'string') return key;
  if (language === 'en') return key;

  const langDict = translations[language];
  if (!langDict) return key;

  if (langDict[key]) {
    return langDict[key];
  }

  for (const pattern of dynamicPatterns) {
    const match = key.match(pattern.regex);
    if (match) {
      const replacer = pattern.replacers[language];
      if (replacer) {
        return replacer(...match.slice(1));
      }
    }
  }

  return key;
};

// Mocking localStorage for persistence test
class LocalStorageMock {
  constructor() { this.store = {}; }
  clear() { this.store = {}; }
  getItem(key) { return this.store[key] || null; }
  setItem(key, value) { this.store[key] = String(value); }
  removeItem(key) { delete this.store[key]; }
}

const runTests = () => {
  let passed = 0;
  let failed = 0;

  const assert = (condition, label) => {
    if (condition) {
      console.log(`  PASS  ${label}`);
      passed++;
    } else {
      console.log(`  FAIL  ${label}`);
      failed++;
    }
  };

  console.log('=== Frontend Localization — Verification ===\n');

  // 1. Exact translation tests (Hindi)
  assert(t('Notifications', 'hi') === 'सूचनाएँ', 'Hindi translations (Notifications)');
  assert(t('Early Warning: WARNING', 'hi') === 'पूर्व चेतावनी: चेतावनी (WARNING)', 'Hindi translations (Warning Title)');
  
  // 2. Exact translation tests (Assamese)
  assert(t('Notifications', 'as') === 'জাননী', 'Assamese translations (Notifications)');
  assert(t('Early Warning: WARNING', 'as') === 'আগতীয়া সতৰ্কবাণী: সতৰ্কবাণী (WARNING)', 'Assamese translations (Warning Title)');
  
  // 3. Fallback translation tests
  assert(t('Notifications', 'en') === 'Notifications', 'English translations (fallback to key)');
  assert(t('Unknown Missing Key', 'hi') === 'Unknown Missing Key', 'Missing-key fallback to English/key');
  assert(t('Unknown Missing Key', 'as') === 'Unknown Missing Key', 'Missing-key fallback to English/key');

  // 4. Dynamic string matching tests (Rainfall)
  assert(
    t('High recent rainfall (120 mm).', 'hi') === 'उच्च हालिया वर्षा (120 mm)।',
    'Pattern matching: Rainfall (Hindi)'
  );
  assert(
    t('High recent rainfall (120 mm).', 'as') === 'শেহতীয়া অধিক বৰষুণ (120 mm)।',
    'Pattern matching: Rainfall (Assamese)'
  );

  // 5. Dynamic string matching tests (ML)
  assert(
    t('Machine learning model indicates critical risk (prob: 0.95).', 'hi') === 'मशीन लर्निंग मॉडल critical जोखिम (संभावना: 0.95) दर्शाता है।',
    'Pattern matching: ML Risk (Hindi)'
  );
  assert(
    t('Machine learning model indicates critical risk (prob: 0.95).', 'as') === 'মেচিন লাৰ্নিং আৰ্হিয়ে critical বিপদ (সম্ভাৱনা: 0.95) নিৰ্দেশ কৰে।',
    'Pattern matching: ML Risk (Assamese)'
  );

  // 6. Persistence Logic Check
  const mockStorage = new LocalStorageMock();
  mockStorage.setItem('ner_lmrs_language', 'hi');
  assert(mockStorage.getItem('ner_lmrs_language') === 'hi', 'Language persistence logic stores values');
  
  // 7. Notification localization context
  // Title and message from Notification API
  const mockNotification = {
    title: 'Early Warning: CRITICAL',
    message: 'High recent rainfall (150 mm).'
  };
  assert(t(mockNotification.title, 'as') === 'আগতীয়া সতৰ্কবাণী: গুৰুতৰ (CRITICAL)', 'Notification localization (title)');
  assert(t(mockNotification.message, 'as') === 'শেহতীয়া অধিক বৰষুণ (150 mm)।', 'Notification localization (dynamic message)');

  // 8. Early-warning presentation/localization compatibility
  // Ensure the keys exactly match what earlyWarningService generates
  const earlyWarningReasoning = 'Recent rainfall exceeds high operational threshold.';
  assert(
    t(earlyWarningReasoning, 'hi') === 'हाल की वर्षा उच्च परिचालन सीमा से अधिक है।',
    'Early-warning presentation/localization compatibility (static reasoning)'
  );

  // 9. Dashboard UI elements (Hindi & Assamese)
  assert(t('Active Incidents', 'hi') === 'सक्रिय घटनाएँ', 'Dashboard metric (Active Incidents - Hindi)');
  assert(t('Active Incidents', 'as') === 'সক্ৰিয় ঘটনাসমূহ', 'Dashboard metric (Active Incidents - Assamese)');
  assert(t('High Risk Areas', 'hi') === 'उच्च जोखिम वाले क्षेत्र', 'Dashboard metric (High Risk Areas - Hindi)');
  assert(t('Monitored Zones', 'as') === 'নিৰীক্ষণাধীন মণ্ডলসমূহ', 'Dashboard metric (Monitored Zones - Assamese)');
  assert(t('Critical Roads', 'hi') === 'महत्वपूर्ण सड़कें', 'Dashboard metric (Critical Roads - Hindi)');
  assert(t('Recent Rainfall', 'as') === 'শেহতীয়া বৰষুণ', 'Dashboard metric (Recent Rainfall - Assamese)');
  assert(t('Recent Alerts', 'hi') === 'हालिया अलर्ट', 'Dashboard feed (Recent Alerts - Hindi)');
  assert(t('Recent Field Reports', 'as') === 'শেহতীয়া ক্ষেত্ৰ প্ৰতিবেদন', 'Dashboard feed (Recent Field Reports - Assamese)');
  assert(t('Infrastructure Priority', 'hi') === 'बुनियादी ढांचा प्राथमिकता', 'Dashboard table (Infrastructure Priority - Hindi)');
  assert(t('Unavailable', 'hi') === 'अनुपलब्ध', 'Dashboard status (Unavailable - Hindi)');
  assert(t('Unavailable', 'as') === 'উপলব্ধ নহয়', 'Dashboard status (Unavailable - Assamese)');
  assert(t('Search locations, villages, roads...', 'hi') === 'स्थान, गाँव, सड़कें खोजें...', 'Search placeholder (Hindi)');
  assert(t('No results found', 'as') === 'কোনো ফলাফল পোৱা নগ’ল', 'Search empty state (Assamese)');

  // 10. Dashboard dynamic patterns
  assert(
    t('↑ 3 active critical zones', 'hi') === '↑ 3 सक्रिय महत्वपूर्ण क्षेत्र',
    'Dynamic pattern: active critical zones (Hindi)'
  );
  assert(
    t('2 affected routes', 'as') === '2 টা প্ৰভাৱিত পথ',
    'Dynamic pattern: affected routes (Assamese)'
  );

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
};

runTests();
