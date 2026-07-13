import { describe, expect, it } from 'vitest';

import { aggregateComparisonRows, getAnalysisRows, getNumericFields, parseNumericValue } from '../../utils/dataAnalysis';

describe('chart board data aggregation', () => {
  it('sums the selected metric by the selected comparison field', () => {
    expect(
      aggregateComparisonRows(
        [
          { region: '华东', sales: '120' },
          { region: '华北', sales: '80' },
          { region: '华东', sales: '30' },
        ],
        'region',
        'sales',
      ),
    ).toEqual([
      { name: '华东', value: 150 },
      { name: '华北', value: 80 },
    ]);
  });

  it('restores the built-in rows for the persisted sample data source', () => {
    expect(getAnalysisRows({ kind: 'csv', fileName: '2025经营销售样例数据.csv', columnCount: 8, rowCount: 12, fieldMappings: [] })).toHaveLength(12);
  });

  it('parses business values with units and symbols into numeric values', () => {
    expect(parseNumericValue('≥94.5%')).toBe(94.5);
    expect(parseNumericValue('12000+')).toBe(12000);
    expect(parseNumericValue('0.5P')).toBe(0.5);
    expect(parseNumericValue('-')).toBeNaN();
  });

  it('treats unit-suffixed columns as numeric fields', () => {
    expect(
      getNumericFields(
        {
          kind: 'table',
          fileName: '产品参数.xlsx',
          columnCount: 4,
          rowCount: 2,
          fieldMappings: [],
          columns: [
            { name: '型号', type: 'string' },
            { name: '倍率', type: 'string' },
            { name: '效率', type: 'string' },
            { name: '寿命', type: 'string' },
          ],
        },
        [
          { 型号: 'A', 倍率: '0.5P', 效率: '≥94.5%', 寿命: '12000+' },
          { 型号: 'B', 倍率: '1P', 效率: '95%', 寿命: '8000' },
        ],
      ),
    ).toEqual(['倍率', '效率', '寿命']);
  });
});
