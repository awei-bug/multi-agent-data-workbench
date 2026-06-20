import { describe, expect, it } from 'vitest';

import { deriveTaskStatus, mergeSummaryEntries, TASK_STATUS } from './workspaceSessionState';

describe('workspace session state helpers', () => {
  it('merges a new summary entry to the front and removes duplicate prefixed entries', () => {
    const currentSummary = [
      '图表标题已更新为“旧标题”。',
      '已人工修正样例值：0-销售额为 2800。',
      '当前会话尚未启动。',
    ].join('\n');

    const nextSummary = mergeSummaryEntries(
      currentSummary,
      '图表标题已更新为“新标题”。',
      '图表标题已更新为“',
    );

    expect(nextSummary.split('\n')).toEqual([
      '图表标题已更新为“新标题”。',
      '已人工修正样例值：0-销售额为 2800。',
      '当前会话尚未启动。',
    ]);
  });

  it('keeps at most four summary entries', () => {
    const currentSummary = ['A', 'B', 'C', 'D'].join('\n');

    const nextSummary = mergeSummaryEntries(currentSummary, 'E');

    expect(nextSummary.split('\n')).toEqual(['E', 'A', 'B', 'C']);
  });

  it('maps workflow phases to task statuses', () => {
    expect(deriveTaskStatus('running', TASK_STATUS.idle)).toBe(TASK_STATUS.running);
    expect(deriveTaskStatus('paused', TASK_STATUS.running)).toBe(TASK_STATUS.paused);
    expect(deriveTaskStatus('completed', TASK_STATUS.running)).toBe(TASK_STATUS.completed);
    expect(deriveTaskStatus('failed', TASK_STATUS.running)).toBe(TASK_STATUS.failed);
    expect(deriveTaskStatus('stopped', TASK_STATUS.running)).toBe(TASK_STATUS.stopped);
    expect(deriveTaskStatus('idle', TASK_STATUS.idle)).toBe(TASK_STATUS.idle);
  });
});
