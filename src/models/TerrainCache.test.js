const mongoose = require('mongoose');
const TerrainCache = require('./TerrainCache');

describe('TerrainCache Model', () => {
  it('TerrainCache schema accepts valid data', () => {
    const doc = new TerrainCache({
      cellKey: 'cell_27.123_88.456',
      elevation: 1500.5,
      slope: 12.3
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  it('TerrainCache rejects missing required cellKey', () => {
    const doc = new TerrainCache({
      elevation: 1500
    });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors.cellKey).toBeDefined();
  });

  it('TerrainCache accepts null/omitted elevation and slope', () => {
    const doc = new TerrainCache({
      cellKey: 'cell_27.123_88.456'
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.elevation).toBeNull();
    expect(doc.slope).toBeNull();
    expect(doc.cachedAt).toBeDefined();
  });

  it('cellKey has a unique schema/index definition', () => {
    const unique = TerrainCache.schema.path('cellKey').options.unique;
    expect(unique).toBe(true);
  });
});
