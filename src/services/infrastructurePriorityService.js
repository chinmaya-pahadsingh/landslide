/**
 * Infrastructure Priority Service
 *
 * Calculates an OPERATIONAL PRIORITIZATION score for infrastructure assets.
 *
 * This service does NOT calculate:
 *   - landslide probability
 *   - scientific hazard probability
 *   - ML prediction
 *   - disaster certainty
 *
 * It combines available operational factors:
 *   - infrastructure importance
 *   - population served
 *   - availability of alternatives
 *   - current asset status
 *   - externally supplied hazard/evidence level (if available)
 *
 * Design principles:
 *   - Missing information remains explicitly unavailable, not zero or safe.
 *   - The scoring rule is transparent and configurable.
 *   - No fabricated values. No network requests.
 *   - Deterministic output for identical input.
 */

// ---------------------------------------------------------------------------
// Configurable scoring weights (transparent, not scientifically derived)
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS = {
  importance: 0.30,
  population: 0.25,
  alternative: 0.15,
  status: 0.10,
  hazardContext: 0.20,
};

// ---------------------------------------------------------------------------
// Factor normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalises an importance value to a 0–1 scale.
 * @param {number|null|undefined} importance
 * @returns {{ available: boolean, value?: number }}
 */
const normaliseImportance = (importance) => {
  if (importance == null || typeof importance !== 'number' || !isFinite(importance)) {
    return { available: false };
  }
  // Clamp to 0–10 range, then scale to 0–1
  const clamped = Math.min(Math.max(importance, 0), 10);
  return { available: true, value: clamped / 10 };
};

/**
 * Normalises a population-served value to a 0–1 scale.
 * @param {number|null|undefined} population
 * @returns {{ available: boolean, value?: number }}
 */
const normalisePopulation = (population) => {
  if (population == null || typeof population !== 'number' || !isFinite(population) || population < 0) {
    return { available: false };
  }
  // Use a soft cap at 10000 for normalisation
  const SOFT_CAP = 10000;
  const normalised = Math.min(population / SOFT_CAP, 1.0);
  return { available: true, value: normalised };
};

/**
 * Converts alternative-available boolean to a priority factor.
 * No alternative → higher priority (1.0).
 * Alternative available → lower priority (0.2).
 * Unknown → unavailable.
 * @param {boolean|null|undefined} alternativeAvailable
 * @returns {{ available: boolean, value?: number }}
 */
const normaliseAlternative = (alternativeAvailable) => {
  if (alternativeAvailable == null || typeof alternativeAvailable !== 'boolean') {
    return { available: false };
  }
  return { available: true, value: alternativeAvailable ? 0.2 : 1.0 };
};

/**
 * Converts asset status to a priority factor.
 * closed → highest operational urgency (1.0)
 * active → baseline (0.3)
 * unknown → moderate (0.6)
 * @param {string|null|undefined} status
 * @returns {{ available: boolean, value?: number }}
 */
const normaliseStatus = (status) => {
  if (status == null || typeof status !== 'string') {
    return { available: false };
  }
  const map = { closed: 1.0, unknown: 0.6, active: 0.3 };
  if (!(status in map)) {
    return { available: false };
  }
  return { available: true, value: map[status] };
};

/**
 * Maps an externally supplied hazard context level to a 0–1 factor.
 * Acceptable values: 'none', 'low', 'medium', 'high', 'critical'.
 * If unavailable, does NOT default to zero—it remains unavailable.
 * @param {string|null|undefined} hazardLevel
 * @returns {{ available: boolean, value?: number }}
 */
const normaliseHazardContext = (hazardLevel) => {
  if (hazardLevel == null || typeof hazardLevel !== 'string') {
    return { available: false };
  }
  const map = { none: 0.0, low: 0.25, medium: 0.5, high: 0.75, critical: 1.0 };
  if (!(hazardLevel in map)) {
    return { available: false };
  }
  return { available: true, value: map[hazardLevel] };
};

// ---------------------------------------------------------------------------
// Main priority calculation
// ---------------------------------------------------------------------------

/**
 * Calculates operational priority for an infrastructure asset.
 *
 * @param {Object} input
 * @param {number}  [input.importance]           - 0–10 importance rating
 * @param {number}  [input.populationServed]     - non-negative population count
 * @param {boolean} [input.alternativeAvailable] - whether an alternative route/facility exists
 * @param {string}  [input.status]               - 'active' | 'closed' | 'unknown'
 * @param {string}  [input.hazardContext]         - 'none'|'low'|'medium'|'high'|'critical'
 * @param {Object}  [input.weights]              - override default weights
 * @returns {Object} Priority result
 */
const calculateOperationalPriority = (input = {}) => {
  const weights = { ...DEFAULT_WEIGHTS, ...(input.weights || {}) };

  const factors = {
    importance: normaliseImportance(input.importance),
    population: normalisePopulation(input.populationServed),
    alternative: normaliseAlternative(input.alternativeAvailable),
    status: normaliseStatus(input.status),
    hazardContext: normaliseHazardContext(input.hazardContext),
  };

  // Track availability
  const factorAvailability = {};
  for (const [key, factor] of Object.entries(factors)) {
    factorAvailability[key] = factor.available;
  }

  const availableCount = Object.values(factorAvailability).filter(Boolean).length;

  // If nothing is available, we cannot produce a meaningful priority
  if (availableCount === 0) {
    return {
      priorityType: 'operational',
      status: 'insufficient_data',
      factorAvailability,
      availableFactorCount: 0,
      totalFactorCount: 5,
      reasoning: ['No operational factors are available to calculate priority.'],
      limitations: ['All priority factors are missing. Cannot produce a meaningful prioritization.'],
    };
  }

  // Weighted sum over available factors only, re-normalising weights
  let weightedSum = 0;
  let totalWeight = 0;
  const reasoning = [];

  for (const [key, factor] of Object.entries(factors)) {
    if (factor.available) {
      const w = weights[key] || 0;
      weightedSum += factor.value * w;
      totalWeight += w;
      reasoning.push(`Factor "${key}": value=${factor.value.toFixed(2)}, weight=${w.toFixed(2)}.`);
    } else {
      reasoning.push(`Factor "${key}": unavailable (not included in score).`);
    }
  }

  // Normalise to 0–100 scale
  const rawScore = totalWeight > 0 ? (weightedSum / totalWeight) : 0;
  const score = Math.round(rawScore * 100);

  // Limitations
  const limitations = [];
  if (!factors.importance.available) limitations.push('Importance data is unavailable.');
  if (!factors.population.available) limitations.push('Population-served data is unavailable; this does NOT imply zero population.');
  if (!factors.alternative.available) limitations.push('Alternative-availability is unknown.');
  if (!factors.status.available) limitations.push('Asset status is unknown.');
  if (!factors.hazardContext.available) limitations.push('No hazard/evidence context was provided; priority reflects asset properties only.');

  return {
    priorityType: 'operational',
    status: 'calculated',
    score,
    factorAvailability,
    availableFactorCount: availableCount,
    totalFactorCount: 5,
    reasoning,
    limitations,
  };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  calculateOperationalPriority,
  normaliseImportance,
  normalisePopulation,
  normaliseAlternative,
  normaliseStatus,
  normaliseHazardContext,
  DEFAULT_WEIGHTS,
};
