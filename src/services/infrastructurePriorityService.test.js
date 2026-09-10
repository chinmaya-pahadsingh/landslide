const {
  calculateOperationalPriority,
  normaliseImportance,
  normalisePopulation,
  normaliseAlternative,
  normaliseStatus,
  normaliseHazardContext,
  DEFAULT_WEIGHTS,
} = require('./infrastructurePriorityService');

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

  console.log('=== Infrastructure Priority Service — Verification ===\n');

  // -----------------------------------------------------------------------
  // Normalisation helpers
  // -----------------------------------------------------------------------

  // Importance
  check(normaliseImportance(5).available === true && normaliseImportance(5).value === 0.5,
    '1. Importance 5 → 0.5');
  check(normaliseImportance(0).available === true && normaliseImportance(0).value === 0,
    '2. Importance 0 → 0');
  check(normaliseImportance(10).available === true && normaliseImportance(10).value === 1.0,
    '3. Importance 10 → 1.0');
  check(normaliseImportance(15).available === true && normaliseImportance(15).value === 1.0,
    '4. Importance 15 clamped to 1.0');
  check(normaliseImportance(-3).available === true && normaliseImportance(-3).value === 0,
    '5. Importance -3 clamped to 0');
  check(normaliseImportance(null).available === false,
    '6. Importance null → unavailable');
  check(normaliseImportance(undefined).available === false,
    '7. Importance undefined → unavailable');
  check(normaliseImportance(NaN).available === false,
    '8. Importance NaN → unavailable');

  // Population
  check(normalisePopulation(5000).available === true && normalisePopulation(5000).value === 0.5,
    '9. Population 5000 → 0.5');
  check(normalisePopulation(0).available === true && normalisePopulation(0).value === 0,
    '10. Population 0 → 0');
  check(normalisePopulation(20000).available === true && normalisePopulation(20000).value === 1.0,
    '11. Population 20000 clamped to 1.0');
  check(normalisePopulation(null).available === false,
    '12. Population null → unavailable');
  check(normalisePopulation(-500).available === false,
    '13. Population -500 → unavailable');

  // Alternative
  check(normaliseAlternative(true).available === true && normaliseAlternative(true).value === 0.2,
    '14. Alternative true → 0.2 (lower priority)');
  check(normaliseAlternative(false).available === true && normaliseAlternative(false).value === 1.0,
    '15. Alternative false → 1.0 (higher priority)');
  check(normaliseAlternative(null).available === false,
    '16. Alternative null → unavailable');

  // Status
  check(normaliseStatus('closed').available === true && normaliseStatus('closed').value === 1.0,
    '17. Status closed → 1.0');
  check(normaliseStatus('active').available === true && normaliseStatus('active').value === 0.3,
    '18. Status active → 0.3');
  check(normaliseStatus('unknown').available === true && normaliseStatus('unknown').value === 0.6,
    '19. Status unknown → 0.6');
  check(normaliseStatus('demolished').available === false,
    '20. Status demolished → unavailable');
  check(normaliseStatus(null).available === false,
    '21. Status null → unavailable');

  // Hazard context
  check(normaliseHazardContext('none').available === true && normaliseHazardContext('none').value === 0.0,
    '22. HazardContext none → 0.0');
  check(normaliseHazardContext('critical').available === true && normaliseHazardContext('critical').value === 1.0,
    '23. HazardContext critical → 1.0');
  check(normaliseHazardContext('medium').available === true && normaliseHazardContext('medium').value === 0.5,
    '24. HazardContext medium → 0.5');
  check(normaliseHazardContext(null).available === false,
    '25. HazardContext null → unavailable');
  check(normaliseHazardContext('extreme').available === false,
    '26. HazardContext extreme → unavailable');

  // -----------------------------------------------------------------------
  // Full priority calculations
  // -----------------------------------------------------------------------

  // All factors available
  {
    const result = calculateOperationalPriority({
      importance: 8,
      populationServed: 5000,
      alternativeAvailable: false,
      status: 'closed',
      hazardContext: 'high',
    });
    check(result.priorityType === 'operational',
      '27. Priority type is "operational"');
    check(result.status === 'calculated',
      '28. Status is "calculated" with full data');
    check(typeof result.score === 'number' && result.score >= 0 && result.score <= 100,
      '29. Score is 0–100');
    check(result.availableFactorCount === 5,
      '30. All 5 factors available');
    check(result.limitations.length === 0,
      '31. No limitations with full data');
  }

  // No factors available
  {
    const result = calculateOperationalPriority({});
    check(result.status === 'insufficient_data',
      '32. No factors → insufficient_data');
    check(result.score === undefined,
      '33. No score when insufficient data');
    check(result.availableFactorCount === 0,
      '34. Available count is 0');
  }

  // Partial factors
  {
    const result = calculateOperationalPriority({
      importance: 7,
      status: 'active',
    });
    check(result.status === 'calculated',
      '35. Partial factors → calculated');
    check(result.availableFactorCount === 2,
      '36. Available count is 2');
    check(result.limitations.some(l => l.includes('Population-served data is unavailable')),
      '37. Missing population noted in limitations');
    check(result.limitations.some(l => l.includes('does NOT imply zero population')),
      '38. Missing population does NOT imply zero');
  }

  // Deterministic
  {
    const input = {
      importance: 6,
      populationServed: 3000,
      alternativeAvailable: true,
      status: 'active',
      hazardContext: 'medium',
    };
    const r1 = calculateOperationalPriority(input);
    const r2 = calculateOperationalPriority(input);
    check(JSON.stringify(r1) === JSON.stringify(r2),
      '39. Deterministic output for identical input');
  }

  // No fabricated probability
  {
    const result = calculateOperationalPriority({
      importance: 10,
      populationServed: 10000,
      alternativeAvailable: false,
      status: 'closed',
      hazardContext: 'critical',
    });
    check(result.probability === undefined,
      '40. No fabricated probability');
    check(result.riskLevel === undefined,
      '41. No fabricated riskLevel');
    check(result.priorityType === 'operational',
      '42. Priority type remains operational, not scientific');
  }

  // Hazard context absent → limitation noted
  {
    const result = calculateOperationalPriority({
      importance: 5,
    });
    check(result.limitations.some(l => l.includes('No hazard/evidence context')),
      '43. Missing hazard context noted as limitation');
    check(result.factorAvailability.hazardContext === false,
      '44. Hazard context explicitly unavailable');
  }

  // Closed + no alternative = high priority
  {
    const withAlt = calculateOperationalPriority({
      alternativeAvailable: true,
      status: 'closed',
    });
    const withoutAlt = calculateOperationalPriority({
      alternativeAvailable: false,
      status: 'closed',
    });
    check(withoutAlt.score > withAlt.score,
      '45. No alternative + closed > alternative + closed');
  }

  // Active + alternative = lower priority
  {
    const result = calculateOperationalPriority({
      alternativeAvailable: true,
      status: 'active',
      importance: 2,
    });
    check(result.score < 50,
      '46. Active + alternative + low importance → low priority score');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
