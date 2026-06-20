import type { PreviewColumn, PreviewDataset, PreviewRow } from '../mock/mockData';
import { mockDataset } from '../mock/mockData';
import type { WorkbenchContext } from '../types/workbench';

export const SAMPLE_DATA_INPUT_SUMMARY = '已加载示例销售数据，准备检查字段映射与缺失值。';
export const SAMPLE_DATA_LATEST_LOG = '示例数据已载入工作台，等待需求解析与后续执行。';
export const SAMPLE_DATA_RISK = '示例数据仍需确认统计口径与时间范围，正式输出前应替换为真实业务数据。';
export const CSV_DATA_RISK = 'CSV 导入结果尚未完成字段映射确认，进入正式分析前需复核列含义与缺失值。';
export const CSV_MAPPING_CONFIRMED_RISK = '字段映射已确认，但仍需结合业务口径复核指标定义与时间范围。';

function inferColumnType(values: string[]) {
  if (values.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
    return 'number';
  }

  if (values.every((value) => /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$/.test(value))) {
    return 'date';
  }

  return 'string';
}

function calculateMissingRate(values: string[]) {
  if (values.length === 0) {
    return '0%';
  }

  const missingCount = values.filter((value) => value.trim() === '').length;
  return `${Math.round((missingCount / values.length) * 100)}%`;
}

export function buildSampleDataContext(context: WorkbenchContext): WorkbenchContext {
  return {
    ...context,
    inputSummary: SAMPLE_DATA_INPUT_SUMMARY,
    latestLog: SAMPLE_DATA_LATEST_LOG,
    risks: context.risks.includes(SAMPLE_DATA_RISK) ? context.risks : [SAMPLE_DATA_RISK, ...context.risks],
  };
}

export function buildImportedDataContext(
  context: WorkbenchContext,
  fileName: string,
  columnCount: number,
  rowCount: number,
): WorkbenchContext {
  const inputSummary = `已导入 CSV 数据源 ${fileName}，识别 ${columnCount} 个字段，预览 ${rowCount} 行样例数据。`;

  return {
    ...context,
    inputSummary,
    latestLog: `CSV 数据源 ${fileName} 已载入工作台，等待字段确认与需求解析。`,
    risks: context.risks.includes(CSV_DATA_RISK) ? context.risks : [CSV_DATA_RISK, ...context.risks],
  };
}

export function buildConfirmedCsvMappingContext(context: WorkbenchContext, mappingSummary: string): WorkbenchContext {
  const risks = context.risks.filter((risk) => risk !== CSV_DATA_RISK);

  return {
    ...context,
    inputSummary: mappingSummary,
    latestLog: 'CSV 字段映射已确认，可继续进行需求解析与后续执行。',
    risks: risks.includes(CSV_MAPPING_CONFIRMED_RISK) ? risks : [CSV_MAPPING_CONFIRMED_RISK, ...risks],
  };
}

export function hasLoadedSampleData(inputSummary: string) {
  return inputSummary === SAMPLE_DATA_INPUT_SUMMARY || inputSummary.startsWith('已导入 CSV 数据源');
}

export function getDefaultPreviewDataset(): PreviewDataset {
  return mockDataset;
}

export function parseCsvPreview(text: string): PreviewDataset {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return mockDataset;
  }

  const headers = lines[0].split(',').map((item) => item.trim());
  const rows: PreviewRow[] = lines.slice(1).map((line) => {
    const values = line.split(',').map((item) => item.trim());
    return headers.reduce<PreviewRow>((record, header, index) => {
      record[header] = values[index] ?? '';
      return record;
    }, {});
  });

  const columns: PreviewColumn[] = headers.map((header) => {
    const values = rows.map((row) => row[header] ?? '');
    return {
      name: header,
      type: inferColumnType(values),
      missingRate: calculateMissingRate(values),
    };
  });

  return {
    columns,
    rows,
  };
}
