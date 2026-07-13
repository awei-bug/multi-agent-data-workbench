import type { DataSourcePreviewRowRecord, TaskDataSourceRecord } from '../types/tasks';
import { mockDataset } from '../mock/mockData';

export type ComparisonPoint = { name: string; value: number };

export function parseNumericValue(value: string | undefined) {
  const normalized = String(value ?? '')
    .replace(/,/g, '')
    .replace(/×/g, 'x')
    .trim();
  if (!normalized || normalized === '-') {
    return Number.NaN;
  }
  const matched = normalized.match(/-?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : Number.NaN;
}

export function getAnalysisRows(dataSource?: TaskDataSourceRecord): DataSourcePreviewRowRecord[] {
  const rows = dataSource?.analysisRows ?? dataSource?.previewRows ?? [];
  if (rows.length > 0 || !dataSource?.fileName.includes('样例')) {
    return rows;
  }
  return mockDataset.rows;
}

export function aggregateComparisonRows(rows: DataSourcePreviewRowRecord[], dimension: string, metric: string): ComparisonPoint[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const name = row[dimension]?.trim();
    const value = parseNumericValue(row[metric]);
    if (!name || !Number.isFinite(value)) {
      continue;
    }
    totals.set(name, (totals.get(name) ?? 0) + value);
  }

  return [...totals].map(([name, value]) => ({ name, value }));
}

export function getNumericFields(dataSource: TaskDataSourceRecord, rows: DataSourcePreviewRowRecord[]) {
  return (dataSource.columns ?? [])
    .map((column) => column.name)
    .filter((field) => {
      if (dataSource.columns?.find((column) => column.name === field)?.type === 'number') {
        return true;
      }
      const values = rows.map((row) => row[field]).filter(Boolean);
      return values.length > 0 && values.every((value) => Number.isFinite(parseNumericValue(value)));
    });
}
