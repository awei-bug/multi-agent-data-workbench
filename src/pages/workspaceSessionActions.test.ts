import { describe, expect, it } from 'vitest';

import { TASK_STATUS } from './workspaceSessionState';
import {
  buildChartTitleAction,
  buildExportAction,
  buildManualRevisionAction,
  buildParseAction,
  buildReplayAction,
} from './workspaceSessionActions';
import { DEFAULT_SUMMARY } from './workspaceSessionCopy';

describe('workspace session actions', () => {
  it('builds parse action state for a new live task', () => {
    const result = buildParseAction({
      request: '分析华东销售趋势',
      goal: '华东销售趋势复盘',
      metrics: '销售额',
      dimensions: '月份',
      charts: '趋势图',
    });

    expect(result.summary).toBe('围绕华东销售趋势复盘输出执行摘要。');
    expect(result.taskUpdate).toEqual({
      mode: 'live',
      name: '华东销售趋势复盘',
      request: '分析华东销售趋势',
      summary: '围绕华东销售趋势复盘输出执行摘要。',
      status: TASK_STATUS.idle,
    });
  });

  it('builds summary updates for manual revision and chart title changes', () => {
    const revision = buildManualRevisionAction(DEFAULT_SUMMARY, '3200');
    const chartTitle = buildChartTitleAction(DEFAULT_SUMMARY, '修正后销售趋势');

    expect(revision).toBe(['已人工修正样例值：0-销售额为 3200。', DEFAULT_SUMMARY].join('\n'));
    expect(chartTitle).toBe(['图表标题已更新为“修正后销售趋势”。', DEFAULT_SUMMARY].join('\n'));
  });

  it('builds export action with saved-history flag for live tasks', () => {
    const result = buildExportAction({
      mode: 'live',
      activeExports: [{ format: 'Word', status: 'Word 导出完成' }],
      record: { format: 'PDF', status: 'PDF 导出完成' },
      reportSummary: '导出摘要',
    });

    expect(result.exportStatus).toBe('PDF 导出完成');
    expect(result.shouldSaveHistory).toBe(true);
    expect(result.taskUpdate).toEqual({
      exports: [
        { format: 'PDF', status: 'PDF 导出完成' },
        { format: 'Word', status: 'Word 导出完成' },
      ],
      status: '已导出 PDF',
      summary: '导出摘要',
    });
  });

  it('builds replay action reset payload', () => {
    expect(buildReplayAction()).toEqual({
      parsedIntent: null,
    });
  });
});
