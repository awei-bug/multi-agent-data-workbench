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
      request: 'analyze sales',
      goal: 'sales review',
      metrics: 'sales',
      dimensions: 'month',
      charts: 'trend',
    });

    expect(result.summary).toContain('sales review');
    expect(result.taskUpdate).toEqual({
      mode: 'live',
      name: 'sales review',
      request: 'analyze sales',
      summary: result.summary,
      status: TASK_STATUS.idle,
    });
  });

  it('prepends manual revision and chart title entries', () => {
    const revision = buildManualRevisionAction(DEFAULT_SUMMARY, '3200');
    const chartTitle = buildChartTitleAction(DEFAULT_SUMMARY, 'chart title');

    expect(revision).toContain('3200');
    expect(revision).toContain(DEFAULT_SUMMARY);
    expect(chartTitle).toContain('chart title');
    expect(chartTitle).toContain(DEFAULT_SUMMARY);
  });

  it('builds export action with saved-history flag for live tasks', () => {
    const result = buildExportAction({
      mode: 'live',
      activeExports: [{ format: 'Word', status: 'Word done' }],
      record: { format: 'PDF', status: 'PDF done' },
      reportSummary: 'summary',
    });

    expect(result.exportStatus).toBe('PDF done');
    expect(result.shouldSaveHistory).toBe(true);
    expect(result.taskUpdate).toEqual({
      exports: [
        { format: 'PDF', status: 'PDF done' },
        { format: 'Word', status: 'Word done' },
      ],
      status: expect.stringContaining('PDF'),
      summary: 'summary',
    });
  });

  it('builds replay action reset payload', () => {
    expect(buildReplayAction()).toEqual({
      parsedIntent: null,
    });
  });
});
