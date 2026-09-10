/**
 * Disaster News Filtering & Categorization Utility (Step 40-NEWS-DISASTER-FILTER)
 *
 * Ensures that ONLY genuine disaster-related articles appear in the News section.
 * Filters out sports, entertainment, technology, stock market, general politics,
 * and metaphorical usages (e.g. "flood of criticism", "landslide victory", "storm in parliament").
 *
 * Prioritizes Northeast Region (NER) disaster events while allowing genuine national and global disaster news.
 */

const DISASTER_CATEGORIES = {
  LANDSLIDE: 'LANDSLIDE',
  FLOOD: 'FLOOD',
  FLASH_FLOOD: 'FLASH_FLOOD',
  AVALANCHE: 'AVALANCHE',
  EARTHQUAKE: 'EARTHQUAKE',
  TSUNAMI: 'TSUNAMI',
  CYCLONE_STORM: 'CYCLONE_STORM',
  EXTREME_RAINFALL: 'EXTREME_RAINFALL',
  WILDFIRE: 'WILDFIRE',
  VOLCANIC: 'VOLCANIC',
  DROUGHT: 'DROUGHT',
  DISASTER_RESPONSE: 'DISASTER_RESPONSE',
  OTHER_DISASTER: 'OTHER_DISASTER'
};

const METAPHORICAL_PATTERNS = [
  /\blandslide\s+([a-z0-9_-]+\s+)?(victory|win|wins|election|majority|poll|margin)\b/i,
  /\b(flood|floods|flooding|inundated)\s+(of|with)\s+([a-z0-9_-]+\s+)?(criticism|complaint|complaints|inquir|inquiries|call|calls|message|messages|application|applications|mail|mails|comment|comments|tribute|tributes|protest|protests|post|posts|email|emails|order|orders|response|responses|demand|demands|support|memes|query|queries|requests?)\b/i,
  /\bflood\s+the\s+market\b/i,
  /\bearthquake\s+in\s+([a-z0-9_-]+\s+)*(music|bollywood|hollywood|film|cinema|entertainment|tech|technology|industry|politics|parliament|cabinet|cricket|football|sports)\b/i,
  /\bpolitical\s+earthquake\b/i,
  /\bstorm\s+in\s+([a-z0-9_-]+\s+)*(a\s+teacup|parliament|assembly|politics|court|boardroom|cabinet|party)\b/i,
  /\bfirestorm\s+of\s+([a-z0-9_-]+\s+)?(criticism|controversy|protest|backlash)\b/i,
  /\bavalanche\s+of\s+([a-z0-9_-]+\s+)?(goal|goals|call|calls|message|messages|product|products|request|requests|order|orders|criticism|complaint|complaints|suit|lawsuits|mail|applications?)\b/i,
];

const UNRELATED_TOPICS = [
  /\b(cricket|match|wicket|wickets|innings|test match|t20|ipl|bcci|icc|batsman|bowler|fifa|champions league|premier league|football match|badminton|tennis|scorecard)\b/i,
  /\b(smartphone|smartphones|iphone|android|samsung galaxy|laptop|processor|camera sensor|chipset|software update|app store|play store|gadget|smartwatch)\b/i,
  /\b(stock market|sensex|nifty|wall street|nasdaq|shares rose|shares fell|shares gain|bse|bull run|bear market|quarterly profit|revenue growth|ipo|crypto|bitcoin)\b/i,
  /\b(bollywood|hollywood|actor|actress|box office|movie review|trailer launch|album release|celebrity|bigg boss|cinema|film release)\b/i,
  /\b(election rally|poll campaign|seat sharing|vote bank|cabinet reshuffle|manifesto|politician speech)\b/i,
];

const DISASTER_RULES = [
  { category: DISASTER_CATEGORIES.TSUNAMI, pattern: /\b(tsunami|tsunamis|tidal wave)\b/i },
  { category: DISASTER_CATEGORIES.AVALANCHE, pattern: /\b(avalanche|avalanches|snowslide|snow slide)\b/i },
  { category: DISASTER_CATEGORIES.VOLCANIC, pattern: /\b(volcano|volcanoes|volcanic eruption|volcanic ash|lava flow)\b/i },
  { category: DISASTER_CATEGORIES.WILDFIRE, pattern: /\b(wildfire|wildfires|forest fire|forest fires|bushfire|bushfires|jungle fire)\b/i },
  { category: DISASTER_CATEGORIES.EARTHQUAKE, pattern: /\b(earthquake|earthquakes|richter scale|epicenter|epicentre|magnitude\s+\d+(\.\d+)?|seismic tremor|seismic activity|aftershocks?|tremors?)\b/i },
  { category: DISASTER_CATEGORIES.LANDSLIDE, pattern: /\b(landslide|landslides|mudslide|mudslides|rockslide|rockslides|rockfall|rockfalls|slope failure|debris flow|hill collapse|mudflow)\b/i },
  { category: DISASTER_CATEGORIES.FLASH_FLOOD, pattern: /\b(flash\s*floods?|flash-floods?)\b/i },
  { category: DISASTER_CATEGORIES.CYCLONE_STORM, pattern: /\b(cyclone|cyclones|cyclonic|tropical storm|severe storm|super cyclone|typhoon|hurricane|storm surge|gale-force winds?)\b/i },
  { category: DISASTER_CATEGORIES.EXTREME_RAINFALL, pattern: /\b(cloudburst|cloudbursts|extreme rain(fall)?|torrential rain(fall)?|torrential downpour|heavy rainfall|heavy downpour|incessant rain(fall)?|record rainfall|monsoon fury|rain havoc|rain fury|sudden deluge)\b/i },
  { category: DISASTER_CATEGORIES.FLOOD, pattern: /\b(flood|floods|flooding|flooded|inundat(ed|ion)|submerged villages?|submerged homes?|rising water levels?|swollen rivers?|river flowing above danger (level|mark)|embankment breach|waterlogging|waterlogged)\b/i },
  { category: DISASTER_CATEGORIES.DROUGHT, pattern: /\b(drought|droughts|acute water crisis|arid spell|famine-like|severe dry spell)\b/i },
  { category: DISASTER_CATEGORIES.DISASTER_RESPONSE, pattern: /\b(disaster (management|response|relief|rescue|warning|alert)|ndrf|sdrf|relief camp|disaster toll|flood warning|landslide warning)\b/i },
  { category: DISASTER_CATEGORIES.OTHER_DISASTER, pattern: /\b(natural disaster|natural calamity|calamity|catastrophe|disaster warning)\b/i }
];

const NER_KEYWORDS = [
  'assam', 'arunachal', 'manipur', 'meghalaya', 'mizoram',
  'nagaland', 'sikkim', 'tripura', 'northeast', 'north-east',
  'north east', 'ner', 'brahmaputra', 'barak', 'subansiri',
  'guwahati', 'shillong', 'itanagar', 'aizawl', 'imphal',
  'kohima', 'gangtok', 'agartala', 'dima hasao'
];

/**
 * Checks if text is an NER-related location.
 */
function isNerRelated(text = '') {
  const lower = text.toLowerCase();
  return NER_KEYWORDS.some(k => lower.includes(k));
}

/**
 * Classifies an article into a disaster category, or returns null if not disaster-related.
 *
 * @param {string} title
 * @param {string} [summary='']
 * @returns {string|null} Disaster category (from DISASTER_CATEGORIES) or null
 */
function classifyDisasterArticle(title = '', summary = '') {
  const text = `${title} ${summary}`.trim();
  if (!text) return null;

  // 1. Explicit metaphorical check
  for (const pat of METAPHORICAL_PATTERNS) {
    if (pat.test(text)) {
      return null;
    }
  }

  // 2. Identify candidate disaster category
  let matchedCategory = null;
  for (const rule of DISASTER_RULES) {
    if (rule.pattern.test(text)) {
      matchedCategory = rule.category;
      break;
    }
  }

  if (!matchedCategory) {
    return null;
  }

  // 3. Reject unrelated topics unless there is unequivocal physical disaster context
  for (const pat of UNRELATED_TOPICS) {
    if (pat.test(text)) {
      const strongDisaster = /\b(landslide|flood|cyclone|earthquake|avalanche|tsunami|cloudburst|wildfire|evacuat|ndrf|casualties|death toll|fatalities|submerged)\b/i;
      if (!strongDisaster.test(title)) {
        return null;
      }
    }
  }

  return matchedCategory;
}

/**
 * Checks whether an article is genuinely disaster-related.
 */
function isDisasterArticle(article) {
  if (!article) return false;
  const title = article.title || '';
  const summary = article.summary || article.description || '';
  return classifyDisasterArticle(title, summary) !== null;
}

/**
 * Filters an array of articles to only genuine disaster news, assigns the
 * normalized disaster category, and prioritizes NER-related disaster news.
 *
 * @param {Array} articles
 * @returns {Array} Filtered and prioritized disaster articles
 */
function filterAndPrioritizeDisasterArticles(articles = []) {
  if (!Array.isArray(articles)) return [];

  const validDisasterArticles = [];

  for (const article of articles) {
    const title = article.title || '';
    const summary = article.summary || article.description || '';
    let category = classifyDisasterArticle(title, summary);

    // Fallback if disasterCategory is already set and article is not metaphorical/unrelated
    if (!category && article.disasterCategory && DISASTER_CATEGORIES[article.disasterCategory.toUpperCase()]) {
      const fullText = `${title} ${summary}`.trim();
      const isMetaphorical = METAPHORICAL_PATTERNS.some(p => p.test(fullText));
      const isUnrelated = UNRELATED_TOPICS.some(p => p.test(fullText));
      if (!isMetaphorical && !isUnrelated) {
        category = article.disasterCategory.toUpperCase();
      }
    }

    if (category) {
      const fullText = `${title} ${summary} ${article.location?.state || ''} ${article.source?.name || ''}`;
      const ner = isNerRelated(fullText);

      validDisasterArticles.push({
        ...article,
        disasterCategory: category,
        isNerRelated: ner
      });
    }
  }

  // Sort with NER-related disaster news prioritized first, then by publishedAt/importance
  return validDisasterArticles.sort((a, b) => {
    if (a.isNerRelated && !b.isNerRelated) return -1;
    if (!a.isNerRelated && b.isNerRelated) return 1;
    const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return timeB - timeA;
  });
}

module.exports = {
  DISASTER_CATEGORIES,
  classifyDisasterArticle,
  isDisasterArticle,
  filterAndPrioritizeDisasterArticles,
  isNerRelated
};
