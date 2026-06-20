import { describe, expect, it } from 'vitest';

import type { WorkflowSnapshot } from '../mock/mockTaskEngine';
import { TASK_STATUS } from './workspaceSessionState';
import {
  buildExportSessionState,
  buildSnapshotSessionState,
  buildSummarySessionState,
  getComposerValue,
} from './workspaceSessionController';
import { DEFAULT_REQUEST, DEFAULT_SUMMARY, EMPTY_REQUEST } from './workspaceSessionCopy';

describe('workspace session controller helpers', () => {
  it('builds summary state with merged entries', () => {
    const nextSummary = buildSummarySessionState({
      currentSummary: DEFAULT_SUMMARY,
      nextEntry: '已人工修正样例值：0-销售额为 3200。',
      replacePrefix: '已人工修正样例值：0-销售额为 ',
    });

    expect(nextSummary).toBe([ '已人工修正样例值：0-销售额为 3200。', DEFAULT_SUMMARY ].join('\n'));
  });

  it('builds snapshot state and derived task update for completed workflow', () => {
    const snapshot: WorkflowSnapshot = {
      phase: 'completed',
      logMessage: '审核校验 Agent 已完成',
      nodes: [],
      context: {
        activeAgent: '审核校验 Agent',
        inputSummary: '输入',
        outputSummary: '输出',
        latestLog: '日志',
        risks: ['风险A'],
      },
    };

    const result = buildSnapshotSessionState({
      activeStatus: TASK_STATUS.running,
      currentSummary: DEFAULT_SUMMARY,
      nextSnapshot: snapshot,
      summaryEntry: '已启动多 Agent 执行流程。',
    });

    expect(result.nextSummary).toBe(['已启动多 Agent 执行流程。', DEFAULT_SUMMARY].join('\n'));
    expect(result.taskUpdate).toEqual({
      snapshot,
      status: TASK_STATUS.completed,
      risks: ['风险A'],
      summary: ['已启动多 Agent 执行流程。', DEFAULT_SUMMARY].join('\n'),
    });
  });

  it('builds export state and filters duplicate formats', () => {
    const result = buildExportSessionState({
      activeExports: [
        { format: 'PDF', status: '旧 PDF' },
        { format: 'Word', status: 'Word 导出完成' },
      ],
      record: { format: 'PDF', status: 'PDF 导出完成' },
      reportSummary: '导出摘要',
    });

    expect(result.exportStatus).toBe('PDF 导出完成');
    expect(result.taskUpdate).toEqual({
      exports: [
        { format: 'PDF', status: 'PDF 导出完成' },
        { format: 'Word', status: 'Word 导出完成' },
      ],
      status: '已导出 PDF',
      summary: '导出摘要',
    });
  });

  it('falls back to the default request when the active request is empty', () => {
    expect(getComposerValue(EMPTY_REQUEST)).toBe(DEFAULT_REQUEST);
    expect(getComposerValue('分析华东销售趋势')).toBe('分析华东销售趋势');
  });
});
