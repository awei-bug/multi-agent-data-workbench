export type PreviewColumn = {
  name: string;
  type: string;
  missingRate: string;
};

export type PreviewRow = Record<string, string>;

export type PreviewDataset = {
  columns: PreviewColumn[];
  rows: PreviewRow[];
};

export const mockColumns: PreviewColumn[] = [
  { name: '月份', type: 'date', missingRate: '0%' },
  { name: '区域', type: 'string', missingRate: '0%' },
  { name: '销售额', type: 'number', missingRate: '2%' },
];

export const mockRows: PreviewRow[] = [
  { 月份: '2025-01', 区域: '华东', 销售额: '2800' },
  { 月份: '2025-02', 区域: '华南', 销售额: '3200' },
  { 月份: '2025-03', 区域: '华北', 销售额: '3010' },
];

export const mockDataset: PreviewDataset = {
  columns: mockColumns,
  rows: mockRows,
};
