import { describe, expect, it } from 'vitest';

import {
  buildChartTitleSummary,
  buildExportTaskStatus,
  buildIntentSummary,
  buildManualRevisionSummary,
  buildPauseSummary,
  CHART_TITLE_PREFIX,
  DEFAULT_EXPORT_STATUS,
  DEFAULT_REQUEST,
  DEFAULT_SUMMARY,
  EMPTY_REQUEST,
  MANUAL_REVISION_PREFIX,
} from './workspaceSessionCopy';

describe('workspace session copy helpers', () => {
  it('exposes the default workspace copy', () => {
    expect(DEFAULT_REQUEST).toBe('分析 2025 年月度销售额趋势并输出报告');
    expect(DEFAULT_SUMMARY).toBe('当前会话尚未启动，等待样例数据与分析需求输入。');
    expect(DEFAULT_EXPORT_STATUS).toBe('等待导出');
    expect(EMPTY_REQUEST).toBe('尚未填写分析需求');
  });

  it('builds summary entries for intent, manual revision, and chart title updates', () => {
    expect(buildIntentSummary('华东销售趋势复盘')).toBe('围绕华东销售趋势复盘输出执行摘要。');
    expect(buildManualRevisionSummary('3200')).toBe('已人工修正样例值：0-销售额为 3200。');
    expect(buildChartTitleSummary('修正后销售趋势')).toBe('图表标题已更新为“修正后销售趋势”。');
    expect(MANUAL_REVISION_PREFIX).toBe('已人工修正样例值：0-销售额为 ');
    expect(CHART_TITLE_PREFIX).toBe('图表标题已更新为“');
  });

  it('builds pause and export status copy', () => {
    expect(buildPauseSummary('数据清洗 Agent')).toBe('流程暂停在 数据清洗 Agent，等待人工恢复。');
    expect(buildPauseSummary()).toBe('流程已暂停。');
    expect(buildExportTaskStatus('PDF')).toBe('已导出 PDF');
  });
});
