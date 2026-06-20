import type { ExportRecord } from '../types/tasks';

export const DEFAULT_REQUEST = '分析 2025 年月度销售额趋势并输出报告';
export const DEFAULT_SUMMARY = '当前会话尚未启动，等待样例数据与分析需求输入。';
export const DEFAULT_EXPORT_STATUS = '等待导出';
export const EMPTY_REQUEST = '尚未填写分析需求';

export const MANUAL_REVISION_PREFIX = '已人工修正样例值：';
export const CHART_TITLE_PREFIX = '图表标题已更新为：';

export function buildIntentSummary(goal: string) {
  return `围绕${goal}输出执行摘要。`;
}

export function buildManualRevisionSummary(value: string) {
  return `${MANUAL_REVISION_PREFIX}${value}。`;
}

export function buildChartTitleSummary(title: string) {
  return `${CHART_TITLE_PREFIX}${title}。`;
}

export function buildPauseSummary(runningLabel?: string | null) {
  return runningLabel ? `流程暂停在 ${runningLabel}，等待人工恢复。` : '流程已暂停。';
}

export function buildExportTaskStatus(format: ExportRecord['format']) {
  return `已导出 ${format}`;
}
