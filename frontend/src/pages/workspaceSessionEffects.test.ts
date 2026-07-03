import { describe, expect, it } from 'vitest';

import type { WorkflowSnapshot } from '../mock/mockTaskEngine';
import {
  buildActiveTaskSyncUpdate,
  buildRunningTickUpdate,
  shouldStartRunningTimer,
} from './workspaceSessionEffects';
import { TASK_STATUS } from './workspaceSessionState';

describe('workspace session effects helpers', () => {
  it('builds active task sync update from the latest snapshot or summary', () => {
    const snapshot: WorkflowSnapshot = {
      phase: 'idle',
      logMessage: '等待执行',
      nodes: [],
      context: {
        activeAgent: '等待任务启动',
        inputSummary: '输入',
        outputSummary: '输出',
        latestLog: '日志',
        risks: ['风险A'],
      },
    };

    expect(buildActiveTaskSyncUpdate({ snapshot })).toEqual({ snapshot });
    expect(buildActiveTaskSyncUpdate({ summary: '最新摘要' })).toEqual({ summary: '最新摘要' });
  });

  it('decides whether the running timer should start', () => {
    expect(shouldStartRunningTimer('running')).toBe(true);
    expect(shouldStartRunningTimer('paused')).toBe(false);
    expect(shouldStartRunningTimer('completed')).toBe(false);
  });

  it('builds running tick update from the advanced snapshot', () => {
    const nextSnapshot: WorkflowSnapshot = {
      phase: 'completed',
      logMessage: '审核校验 Agent 已完成',
      nodes: [],
      context: {
        activeAgent: '审核校验 Agent',
        inputSummary: '输入',
        outputSummary: '输出',
        latestLog: '日志',
        risks: ['风险B'],
      },
    };

    expect(buildRunningTickUpdate(nextSnapshot)).toEqual({
      snapshot: nextSnapshot,
      status: TASK_STATUS.completed,
      risks: ['风险B'],
    });
  });
});
