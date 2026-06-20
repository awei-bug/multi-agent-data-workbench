import { describe, expect, it } from 'vitest';

import { createWorkspaceSessionRuntime } from './workspaceSessionRuntime';

describe('workspace session runtime', () => {
  it('resets and recreates replay sessions through the repository adapter', () => {
    const runtime = createWorkspaceSessionRuntime();

    const resetTask = runtime.resetActiveTask();
    expect(resetTask.mode).toBe('live');
    expect(resetTask.status).toBe('等待启动');

    const replayTask = runtime.createTaskFromReplay();
    expect(replayTask.mode).toBe('live');
    expect(replayTask.name).toContain('新建任务');
  });

  it('delegates workflow engine transitions', () => {
    const runtime = createWorkspaceSessionRuntime();

    const started = runtime.start();
    expect(started.phase).toBe('running');

    const paused = runtime.pause(started);
    expect(paused.phase).toBe('paused');

    const resumed = runtime.resume(paused);
    expect(resumed.phase).toBe('running');

    const failed = runtime.fail(resumed);
    expect(failed.phase).toBe('failed');

    const retried = runtime.retryCurrent(failed);
    expect(retried.phase).toBe('running');

    const stopped = runtime.stop(retried);
    expect(stopped.phase).toBe('stopped');
  });

  it('saves the active task to history and updates active task state', () => {
    const runtime = createWorkspaceSessionRuntime();

    runtime.resetActiveTask();
    runtime.updateActiveTask({
      name: '当前工作台会话',
      summary: '导出摘要',
      status: '已导出 PDF',
      exports: [{ format: 'PDF', status: 'PDF 导出完成' }],
    });

    const saved = runtime.saveActiveTaskToHistory();
    const active = runtime.getActiveTask();

    expect(saved.summary).toBe('导出摘要');
    expect(saved.exports).toEqual([{ format: 'PDF', status: 'PDF 导出完成' }]);
    expect(active.summary).toBe('导出摘要');
  });

  it('accepts injected repository and engine implementations', () => {
    const calls: string[] = [];
    const runtime = createWorkspaceSessionRuntime({
      repository: {
        getActiveTask() {
          calls.push('getActiveTask');
          return {
            id: 'custom',
            name: 'custom',
            mode: 'live',
            status: 'idle',
            time: 'now',
            summary: 'summary',
            request: 'request',
            snapshot: {
              phase: 'idle',
              logMessage: 'idle',
              nodes: [],
              context: {
                activeAgent: 'agent',
                inputSummary: 'input',
                outputSummary: 'output',
                latestLog: 'log',
                risks: [],
              },
            },
            exports: [],
            risks: [],
          };
        },
        updateActiveTask(update) {
          calls.push(`update:${String(update.status ?? '')}`);
          return this.getActiveTask();
        },
        resetActiveTask() {
          calls.push('reset');
          return this.getActiveTask();
        },
        createTaskFromReplay() {
          calls.push('replay');
          return this.getActiveTask();
        },
        saveActiveTaskToHistory() {
          calls.push('save');
          return this.getActiveTask();
        },
        saveActiveTaskAsTemplate() {
          calls.push('saveTemplate');
          return { id: 'template-1', name: 'template', tag: 'tag', description: 'desc', request: 'request', summary: 'summary', source: 'workspace' as const };
        },
      },
      engine: {
        start() {
          calls.push('start');
          return {
            phase: 'running',
            logMessage: 'running',
            nodes: [],
            context: {
              activeAgent: 'agent',
              inputSummary: 'input',
              outputSummary: 'output',
              latestLog: 'log',
              risks: [],
            },
          };
        },
        advance() {
          calls.push('advance');
          return this.start();
        },
        pause(snapshot) {
          calls.push(`pause:${snapshot.phase}`);
          return snapshot;
        },
        resume(snapshot) {
          calls.push(`resume:${snapshot.phase}`);
          return snapshot;
        },
        restart() {
          calls.push('restart');
          return this.start();
        },
        fail(snapshot) {
          calls.push(`fail:${snapshot.phase}`);
          return snapshot;
        },
        retryCurrent(snapshot) {
          calls.push(`retryCurrent:${snapshot.phase}`);
          return snapshot;
        },
        stop(snapshot) {
          calls.push(`stop:${snapshot.phase}`);
          return snapshot;
        },
      },
    });

    runtime.start();
    runtime.resetActiveTask();
    runtime.saveActiveTaskToHistory();
    runtime.saveActiveTaskAsTemplate({ name: 'template', request: 'request', summary: 'summary' });

    expect(calls).toEqual(['start', 'reset', 'getActiveTask', 'save', 'getActiveTask', 'saveTemplate']);
  });
});
