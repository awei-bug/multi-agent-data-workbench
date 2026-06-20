import { describe, expect, it } from 'vitest';

import { createMockTaskEngine } from './mockTaskEngine';

describe('mock task engine', () => {
  it('creates a running workflow snapshot from the first node', () => {
    const engine = createMockTaskEngine();
    const snapshot = engine.start();

    expect(snapshot.phase).toBe('running');
    expect(snapshot.logMessage).toBe('数据接入 Agent 运行中');
    expect(snapshot.nodes[0].status).toBe('running');
    expect(snapshot.nodes[1].status).toBe('pending');
  });

  it('marks the running node as failed and supports retrying that node', () => {
    const engine = createMockTaskEngine();
    const started = engine.start();
    const failed = engine.fail(started);

    expect(failed.phase).toBe('failed');
    expect(failed.nodes[0].status).toBe('failed');
    expect(failed.logMessage).toBe('数据接入 Agent 执行失败，请检查字段映射后重试');

    const retried = engine.retryCurrent(failed);

    expect(retried.phase).toBe('running');
    expect(retried.nodes[0].status).toBe('running');
    expect(retried.logMessage).toBe('数据接入 Agent 已单节点重试，正在重新执行');
  });

  it('advances to the next workflow node and updates context', () => {
    const engine = createMockTaskEngine();
    const started = engine.start();
    const advanced = engine.advance(started.nodes);

    expect(advanced.phase).toBe('running');
    expect(advanced.nodes[0].status).toBe('success');
    expect(advanced.nodes[1].status).toBe('running');
    expect(advanced.context.activeAgent).toBe('数据清洗 Agent');
  });
  it('pauses and resumes the current running node without changing node position', () => {
    const engine = createMockTaskEngine();
    const started = engine.start();
    const paused = engine.pause(started);

    expect(paused.phase).toBe('paused');
    expect(paused.nodes[0].status).toBe('running');

    const resumed = engine.resume(paused);

    expect(resumed.phase).toBe('running');
    expect(resumed.nodes[0].status).toBe('running');
    expect(resumed.context.activeAgent).toBe(started.context.activeAgent);
  });

  it('stops the current task and preserves node states for manual inspection', () => {
    const engine = createMockTaskEngine();
    const started = engine.start();
    const stopped = engine.stop(started);

    expect(stopped.phase).toBe('stopped');
    expect(stopped.nodes[0].status).toBe('running');
    expect(stopped.context.activeAgent).toBe('任务已终止');
  });
});
