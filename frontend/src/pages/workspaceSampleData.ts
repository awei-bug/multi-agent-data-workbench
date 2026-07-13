import type { PreviewColumn, PreviewDataset, PreviewRow } from '../mock/mockData';
import type { TaskDataSourceRecord } from '../types/tasks';
import type { WorkbenchContext } from '../types/workbench';

export const IMPORTED_DATA_RISK = '导入结果尚未完成业务核验，进入正式分析前需复核字段含义、缺失值或文档上下文。';
export const MAPPING_CONFIRMED_RISK = '字段映射已确认，但仍需结合业务口径复核指标定义与时间范围。';

function inferColumnType(values: string[]) {
  const nonEmpty = values.filter(Boolean);
  if (nonEmpty.length > 0 && nonEmpty.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
    return 'number';
  }

  if (nonEmpty.length > 0 && nonEmpty.every((value) => /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$/.test(value))) {
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

export function buildImportedDataContext(
  context: WorkbenchContext,
  dataSource: Pick<TaskDataSourceRecord, 'fileName' | 'formatLabel' | 'columnCount' | 'rowCount' | 'kind'>,
): WorkbenchContext {
  const formatLabel = dataSource.formatLabel ?? (dataSource.kind === 'document' ? '文档' : 'CSV');
  const inputSummary =
    dataSource.kind === 'document'
      ? `已导入 ${formatLabel} 文档 ${dataSource.fileName}，提取 ${dataSource.rowCount} 段文本预览，可直接进入需求解析。`
      : `已导入 ${formatLabel} 数据源 ${dataSource.fileName}，识别 ${dataSource.columnCount} 个字段，预览 ${dataSource.rowCount} 行样例数据。`;

  return {
    ...context,
    inputSummary,
    latestLog:
      dataSource.kind === 'document'
        ? `${formatLabel} 文档 ${dataSource.fileName} 已接入工作台，等待需求解析与后续分析。`
        : `${formatLabel} 数据源 ${dataSource.fileName} 已载入工作台，等待字段确认与需求解析。`,
    risks: context.risks.includes(IMPORTED_DATA_RISK) ? context.risks : [IMPORTED_DATA_RISK, ...context.risks],
  };
}

export function buildConfirmedCsvMappingContext(context: WorkbenchContext, mappingSummary: string): WorkbenchContext {
  const risks = context.risks.filter((risk) => risk !== IMPORTED_DATA_RISK);

  return {
    ...context,
    inputSummary: mappingSummary,
    latestLog: '字段映射已确认，可以继续进行需求解析与后续执行。',
    risks: risks.includes(MAPPING_CONFIRMED_RISK) ? risks : [MAPPING_CONFIRMED_RISK, ...risks],
  };
}

export function parseCsvPreview(text: string): PreviewDataset {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return { columns: [], rows: [] };
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
