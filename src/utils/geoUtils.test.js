const { calculateDistanceKm } = require('./geoUtils');

describe('geoUtils.calculateDistanceKm', () => {
  it('calculates accurate distance between known coordinates', () => {
    // Distance between Delhi (28.6139, 77.2090) and Shimla (31.1048, 77.1734) is ~277 km
    const dist = calculateDistanceKm(28.6139, 77.2090, 31.1048, 77.1734);
    expect(dist).toBeGreaterThan(270);
    expect(dist).toBeLessThan(285);
  });

  it('returns 0 for identical points', () => {
    expect(calculateDistanceKm(26.16, 91.69, 26.16, 91.69)).toBe(0);
  });

  it('handles invalid or null coordinates gracefully', () => {
    expect(calculateDistanceKm(null, 91.69, 26.16, 91.69)).toBeNull();
    expect(calculateDistanceKm(26.16, undefined, 26.16, 91.69)).toBeNull();
    expect(calculateDistanceKm(26.16, 91.69, 'invalid', 91.69)).toBeNull();
    expect(calculateDistanceKm(NaN, 91.69, 26.16, 91.69)).toBeNull();
  });
});
