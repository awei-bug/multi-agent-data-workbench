import { act, renderHook, waitFor } from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { WorkbenchShellContext } from '../context/WorkbenchShellContext';
import type { ExportRecord, TaskRecord } from '../types/tasks';
import { defaultWorkbenchContext, type WorkbenchShellContext as WorkbenchShellState } from '../types/workbench';
import { useAsyncWorkspaceSession } from './useAsyncWorkspaceSession';

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    name: 'default task',
    mode: 'live',
    status: '等待启动',
    time: 'now',
    summary: 'default summary',
    request: 'default request',
    snapshot: {
      phase: 'idle',
      logMessage: 'idle',
      nodes: [],
      context: defaultWorkbenchContext,
    },
    exports: [],
    risks: [],
    ...overrides,
  };
}

function createExportRecord(overrides: Partial<ExportRecord> = {}): ExportRecord {
  return {
    format: 'PDF',
    status: 'PDF 导出完成',
    ...overrides,
  };
}

function createWrapper() {
  const fallbackTask = createTask({
    id: 'fallback',
    name: 'fallback',
    summary: 'fallback summary',
    request: 'fallback request',
  });

  return function Wrapper({ children }: PropsWithChildren) {
    const [context, setContext] = useState(defaultWorkbenchContext);
    const [activeTask, setActiveTask] = useState<TaskRecord>(fallbackTask);

    const value: WorkbenchShellState = {
      context,
      setContext,
      activeTask,
      setActiveTask,
    };

    return <WorkbenchShellContext.Provider value={value}>{children}</WorkbenchShellContext.Provider>;
  };
}

describe('useAsyncWorkspaceSession', () => {
  it('loads the active task through the async runtime bridge', async () => {
    const remoteTask = createTask({
      id: 'remote-task',
      name: '远端任务',
      summary: '远端摘要',
      request: '远端需求',
      snapshot: {
        phase: 'idle',
        logMessage: 'idle',
        nodes: [],
        context: {
          ...defaultWorkbenchContext,
          activeAgent: '远端任务 Agent',
        },
      },
    });

    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return remoteTask;
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    expect(result.current.bridge.status).toBe('idle');

    await act(async () => {
      await result.current.loadActiveTask();
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.activeTask.name).toBe('远端任务');
    expect(result.current.reportSummary).toBe('远端摘要');
  });

  it('exposes bridge error state when loading fails', async () => {
    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              throw new Error('server unavailable');
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.loadActiveTask().catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('error');
    });

    expect(result.current.bridge.errorMessage).toBe('server unavailable');
  });

  it('updates the active task through the async runtime bridge', async () => {
    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async updateActiveTask(update) {
              return createTask({
                name: update.name ?? 'updated task',
                summary: update.summary ?? 'updated summary',
                snapshot: update.snapshot ?? createTask().snapshot,
              });
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.updateActiveTask({
        name: 'updated task',
        summary: 'updated summary',
      });
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.activeTask.name).toBe('updated task');
    expect(result.current.reportSummary).toBe('updated summary');
  });

  it('parses requirements and syncs intent state through the async runtime bridge', async () => {
    const request = '分析华东区域月度销售额趋势并输出管理摘要';

    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async updateActiveTask(update) {
              return createTask({
                name: update.name ?? '月度销售额趋势',
                request: update.request ?? request,
                summary: update.summary ?? '围绕月度销售额趋势输出执行摘要。',
                status: update.status ?? '等待启动',
                snapshot: update.snapshot ?? createTask().snapshot,
              });
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleParse({
        request,
        goal: '月度销售额趋势',
        metrics: '同比、环比、区域对比',
        dimensions: '月份、区域、渠道',
        charts: '折线图、分组柱状图、区域排行条形图',
      });
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.parsedIntent?.goal).toBe('月度销售额趋势');
    expect(result.current.composerValue).toBe(request);
    expect(result.current.reportSummary).toBe('围绕月度销售额趋势输出执行摘要。');
    expect(result.current.activeTask.name).toBe('月度销售额趋势');
  });

  it('uses backend intent parsing when the async runtime provides it', async () => {
    const request = '分析华东销售趋势并输出摘要';

    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async parseIntent(input) {
              return {
                request: input,
                goal: '后端解析目标',
                metrics: '销售额',
                dimensions: '月份、区域',
                charts: '趋势图',
              };
            },
            async updateActiveTask(update) {
              return createTask({
                name: update.name ?? '后端解析目标',
                request: update.request ?? request,
                summary: update.summary ?? '围绕后端解析目标输出执行摘要。',
                status: update.status ?? '等待启动',
                snapshot: update.snapshot ?? createTask().snapshot,
              });
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleParse({
        request,
        goal: '本地占位目标',
        metrics: '本地指标',
        dimensions: '本地维度',
        charts: '本地图表',
      });
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.parsedIntent?.goal).toBe('后端解析目标');
    expect(result.current.reportSummary).toBe('围绕后端解析目标输出执行摘要。');
    expect(result.current.activeTask.name).toBe('后端解析目标');
  });

  it('applies manual revision through the async runtime bridge', async () => {
    const baseSummary = '当前会话尚未启动，等待样例数据与分析需求输入。';

    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask({ summary: baseSummary });
            },
            async updateActiveTask(update) {
              return createTask({
                summary: update.summary ?? baseSummary,
                snapshot: update.snapshot ?? createTask().snapshot,
              });
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleManualRevision('3200');
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.reportSummary).toContain('3200');
  });

  it('applies chart title changes through the async runtime bridge', async () => {
    const baseSummary = '当前会话尚未启动，等待样例数据与分析需求输入。';

    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask({ summary: baseSummary });
            },
            async updateActiveTask(update) {
              return createTask({
                summary: update.summary ?? baseSummary,
                snapshot: update.snapshot ?? createTask().snapshot,
              });
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleChartTitleChange('修正后销售趋势');
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.reportSummary).toContain('修正后销售趋势');
  });

  it('loads sample data and syncs input summary through the async runtime bridge', async () => {
    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async updateActiveTask(update) {
              return createTask({
                snapshot: update.snapshot ?? createTask().snapshot,
                risks: update.risks ?? createTask().risks,
              });
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleLoadSampleData();
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.activeTask.snapshot.context.inputSummary).toBe('已加载示例销售数据，准备检查字段映射与缺失值。');
    expect(result.current.activeTask.snapshot.context.latestLog).toBe('示例数据已载入工作台，等待需求解析与后续执行。');
  });

  it('resets the active task through the async runtime bridge', async () => {
    const resetTask = createTask({
      id: 'reset',
      name: 'reset task',
      summary: 'reset summary',
      request: 'reset request',
    });

    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async resetActiveTask() {
              return resetTask;
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.resetActiveTask();
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.activeTask.id).toBe('reset');
    expect(result.current.reportSummary).toBe('reset summary');
  });

  it('creates a live task from replay through the async runtime bridge', async () => {
    const replayTask = createTask({
      id: 'replay-live',
      name: 'replay live task',
      summary: 'replay live summary',
      mode: 'live',
    });

    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask({
                mode: 'replay',
              });
            },
            async createTaskFromReplay() {
              return replayTask;
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.createTaskFromReplay();
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.activeTask.id).toBe('replay-live');
    expect(result.current.activeTask.mode).toBe('live');
    expect(result.current.reportSummary).toBe('replay live summary');
  });

  it('saves the active task to history through the async runtime bridge', async () => {
    const savedTask = createTask({
      id: 'saved',
      summary: 'saved summary',
    });

    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async saveActiveTaskToHistory() {
              return savedTask;
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.saveActiveTaskToHistory();
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.activeTask.id).toBe('saved');
    expect(result.current.reportSummary).toBe('saved summary');
  });

  it('updates export status and persists the live task after export', async () => {
    const exportedTask = createTask({
      id: 'exported',
      summary: 'async report summary',
      status: '已导出 PDF',
      exports: [createExportRecord()],
    });
    const savedTask = createTask({
      id: 'saved-exported',
      summary: 'async report summary',
      status: '已导出 PDF',
      exports: [createExportRecord()],
    });

    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask({
                summary: 'async report summary',
              });
            },
            async updateActiveTask(update) {
              return createTask({
                id: exportedTask.id,
                summary: update.summary ?? exportedTask.summary,
                status: update.status ?? exportedTask.status,
                exports: update.exports ?? exportedTask.exports,
                snapshot: update.snapshot ?? exportedTask.snapshot,
              });
            },
            async saveActiveTaskToHistory() {
              return savedTask;
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.handleExport(createExportRecord());
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('success');
    });

    expect(result.current.exportStatus).toBe('PDF 导出完成');
    expect(result.current.activeTask.id).toBe('saved-exported');
    expect(result.current.activeTask.exports).toEqual([createExportRecord()]);
  });

  it('exposes bridge error state when update fails', async () => {
    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async updateActiveTask() {
              throw new Error('update failed');
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.updateActiveTask({ summary: 'next summary' }).catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('error');
    });

    expect(result.current.bridge.errorMessage).toBe('update failed');
  });

  it('exposes bridge error state when reset fails', async () => {
    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async resetActiveTask() {
              throw new Error('reset failed');
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.resetActiveTask().catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('error');
    });

    expect(result.current.bridge.errorMessage).toBe('reset failed');
  });

  it('exposes bridge error state when replay creation fails', async () => {
    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async createTaskFromReplay() {
              throw new Error('replay failed');
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.createTaskFromReplay().catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('error');
    });

    expect(result.current.bridge.errorMessage).toBe('replay failed');
  });

  it('exposes bridge error state when save fails', async () => {
    const { result } = renderHook(
      () =>
        useAsyncWorkspaceSession({
          runtime: {
            async getActiveTask() {
              return createTask();
            },
            async saveActiveTaskToHistory() {
              throw new Error('save failed');
            },
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await result.current.saveActiveTaskToHistory().catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.bridge.status).toBe('error');
    });

    expect(result.current.bridge.errorMessage).toBe('save failed');
  });
});
