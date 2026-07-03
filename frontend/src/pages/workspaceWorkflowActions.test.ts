import { describe, expect, it } from 'vitest';

import type { WorkflowSnapshot } from '../mock/mockTaskEngine';
import {
  buildFailAction,
  buildPauseAction,
  buildResumeAction,
  buildRetryAction,
  buildRetryCurrentAction,
  buildStartAction,
  buildStopAction,
} from './workspaceWorkflowActions';

const baseSnapshot: WorkflowSnapshot = {
  phase: 'running',
  logMessage: '执行中',
  nodes: [
    { id: 'source', label: '数据接入 Agent', status: 'success' },
    { id: 'clean', label: '数据清洗 Agent', status: 'running' },
  ],
  context: {
    activeAgent: '数据清洗 Agent',
    inputSummary: '输入',
    outputSummary: '输出',
    latestLog: '日志',
    risks: ['风险A'],
  },
};

describe('workspace workflow actions', () => {
  it('builds start, resume, retry, and stop summary entries', () => {
    expect(buildStartAction(baseSnapshot)).toEqual({
      snapshot: baseSnapshot,
      summaryEntry: '已启动多 Agent 执行流程。',
    });
    expect(buildResumeAction(baseSnapshot)).toEqual({
      snapshot: baseSnapshot,
      summaryEntry: '已恢复当前执行流程。',
    });
    expect(buildRetryAction(baseSnapshot)).toEqual({
      snapshot: baseSnapshot,
      summaryEntry: '已从首节点重新启动执行流程。',
    });
    expect(buildStopAction(baseSnapshot)).toEqual({
      snapshot: baseSnapshot,
      summaryEntry: '任务已终止，保留当前中间产物供人工检查。',
    });
  });

  it('builds pause action summary from the running node label', () => {
    expect(buildPauseAction(baseSnapshot)).toEqual({
      snapshot: baseSnapshot,
      summaryEntry: '流程暂停在 数据清洗 Agent，等待人工恢复。',
    });
  });

  it('builds fail and retry-current summaries from current workflow nodes', () => {
    const failedSnapshot: WorkflowSnapshot = {
      ...baseSnapshot,
      phase: 'failed',
      nodes: [
        { id: 'source', label: '数据接入 Agent', status: 'success' },
        { id: 'clean', label: '数据清洗 Agent', status: 'failed' },
      ],
    };

    expect(buildFailAction(baseSnapshot)).toEqual({
      snapshot: baseSnapshot,
      summaryEntry: '流程在 数据清洗 Agent 失败，等待人工处理。',
    });
    expect(buildRetryCurrentAction(failedSnapshot)).toEqual({
      snapshot: failedSnapshot,
      summaryEntry: '已对 数据清洗 Agent 发起单节点重试。',
    });
  });
});
