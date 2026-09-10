const { generateTerrainCellKey } = require('./terrainUtils');

describe('terrainUtils - generateTerrainCellKey', () => {
  it('generates valid cell-key', () => {
    expect(generateTerrainCellKey(27.123, 88.456)).toBe('cell_27.123_88.456');
  });

  it('produces deterministic output', () => {
    expect(generateTerrainCellKey(27.123, 88.456)).toBe('cell_27.123_88.456');
    expect(generateTerrainCellKey(27.123, 88.456)).toBe('cell_27.123_88.456');
  });

  it('correctly normalizes to 3 decimals', () => {
    expect(generateTerrainCellKey(27.1, 88.4)).toBe('cell_27.100_88.400');
    expect(generateTerrainCellKey(27, 88)).toBe('cell_27.000_88.000');
  });

  it('normalizes nearby coordinates to the same expected key', () => {
    expect(generateTerrainCellKey(27.1231, 88.4564)).toBe('cell_27.123_88.456');
    expect(generateTerrainCellKey(27.1229, 88.4559)).toBe('cell_27.123_88.456');
  });

  it('handles negative zero', () => {
    expect(generateTerrainCellKey(-0.0001, -0.0002)).toBe('cell_0.000_0.000');
  });

  it('rejects invalid latitude > 90', () => {
    expect(() => generateTerrainCellKey(90.1, 0)).toThrow('Latitude out of bounds');
  });

  it('rejects invalid latitude < -90', () => {
    expect(() => generateTerrainCellKey(-90.1, 0)).toThrow('Latitude out of bounds');
  });

  it('rejects invalid longitude > 180', () => {
    expect(() => generateTerrainCellKey(0, 180.1)).toThrow('Longitude out of bounds');
  });

  it('rejects invalid longitude < -180', () => {
    expect(() => generateTerrainCellKey(0, -180.1)).toThrow('Longitude out of bounds');
  });

  it('rejects missing latitude/longitude', () => {
    expect(() => generateTerrainCellKey(null, 0)).toThrow('Coordinates missing');
    expect(() => generateTerrainCellKey(0, undefined)).toThrow('Coordinates missing');
    expect(() => generateTerrainCellKey()).toThrow('Coordinates missing');
  });

  it('rejects non-numeric coordinates', () => {
    expect(() => generateTerrainCellKey('27', 0)).toThrow('Coordinates must be numeric');
    expect(() => generateTerrainCellKey(0, '88')).toThrow('Coordinates must be numeric');
  });

  it('rejects NaN', () => {
    expect(() => generateTerrainCellKey(NaN, 0)).toThrow('Coordinates must be valid numbers (not NaN)');
    expect(() => generateTerrainCellKey(0, NaN)).toThrow('Coordinates must be valid numbers (not NaN)');
  });

  it('rejects Infinity / -Infinity', () => {
    expect(() => generateTerrainCellKey(Infinity, 0)).toThrow('Coordinates must be finite numbers');
    expect(() => generateTerrainCellKey(0, -Infinity)).toThrow('Coordinates must be finite numbers');
  });
});
