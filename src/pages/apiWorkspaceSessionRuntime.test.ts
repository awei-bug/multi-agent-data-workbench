import { describe, expect, it } from 'vitest';

import { createApiWorkspaceSessionRuntime } from './apiWorkspaceSessionRuntime';

describe('api workspace session runtime', () => {
  it('routes session persistence calls through the provided transport', async () => {
    const calls: string[] = [];
    const runtime = createApiWorkspaceSessionRuntime({
      transport: {
        async getActiveTask() {
          calls.push('getActiveTask');
          return {
            id: 'api-session',
            name: 'API 会话',
            mode: 'live',
            status: '等待启动',
            time: 'now',
            summary: 'summary',
            request: 'request',
            snapshot: {
              phase: 'idle',
              logMessage: 'idle',
              nodes: [],
              context: {
                activeAgent: '等待任务启动',
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
        async updateActiveTask() {
          calls.push('updateActiveTask');
          return this.getActiveTask();
        },
        async resetActiveTask() {
          calls.push('resetActiveTask');
          return this.getActiveTask();
        },
        async createTaskFromReplay() {
          calls.push('createTaskFromReplay');
          return this.getActiveTask();
        },
        async saveActiveTaskToHistory() {
          calls.push('saveActiveTaskToHistory');
          return this.getActiveTask();
        },
        async parseIntent(request) {
          calls.push(`parseIntent:${request}`);
          return {
            request,
            goal: 'goal',
            metrics: 'metrics',
            dimensions: 'dimensions',
            charts: 'charts',
          };
        },
      },
    });

    await runtime.getActiveTask();
    await runtime.updateActiveTask({ status: '执行中' });
    await runtime.resetActiveTask();
    await runtime.createTaskFromReplay();
    await runtime.saveActiveTaskToHistory();
    await runtime.parseIntent('分析需求');

    expect(calls).toEqual([
      'getActiveTask',
      'updateActiveTask',
      'getActiveTask',
      'resetActiveTask',
      'getActiveTask',
      'createTaskFromReplay',
      'getActiveTask',
      'saveActiveTaskToHistory',
      'getActiveTask',
      'parseIntent:分析需求',
    ]);
  });

  it('delegates workflow transitions to the provided engine', () => {
    const calls: string[] = [];
    const runtime = createApiWorkspaceSessionRuntime({
      transport: {
        async getActiveTask() {
          throw new Error('not used');
        },
        async updateActiveTask() {
          throw new Error('not used');
        },
        async resetActiveTask() {
          throw new Error('not used');
        },
        async createTaskFromReplay() {
          throw new Error('not used');
        },
        async saveActiveTaskToHistory() {
          throw new Error('not used');
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

    const started = runtime.start();
    runtime.pause(started);
    runtime.resume(started);
    runtime.restart();
    runtime.fail(started);
    runtime.retryCurrent(started);
    runtime.stop(started);

    expect(calls).toEqual([
      'start',
      'pause:running',
      'resume:running',
      'restart',
      'start',
      'fail:running',
      'retryCurrent:running',
      'stop:running',
    ]);
  });
});
