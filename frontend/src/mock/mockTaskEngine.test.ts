import { describe, expect, it } from 'vitest';

import { createMockTaskEngine } from './mockTaskEngine';

describe('mock task engine', () => {
  it('starts from the first workflow node', () => {
    const engine = createMockTaskEngine();
    const snapshot = engine.start();

    expect(snapshot.phase).toBe('running');
    expect(snapshot.nodes[0].status).toBe('running');
    expect(snapshot.nodes.slice(1).every((node) => node.status === 'pending')).toBe(true);
    expect(snapshot.logMessage).toContain(snapshot.nodes[0].label);
  });

  it('fails and retries the current node', () => {
    const engine = createMockTaskEngine();
    const failed = engine.fail(engine.start());

    expect(failed.phase).toBe('failed');
    expect(failed.nodes[0].status).toBe('failed');
    expect(failed.logMessage).toContain(failed.nodes[0].label);

    const retried = engine.retryCurrent(failed);

    expect(retried.phase).toBe('running');
    expect(retried.nodes[0].status).toBe('running');
    expect(retried.logMessage).toContain(retried.nodes[0].label);
  });

  it('advances to the next workflow node', () => {
    const engine = createMockTaskEngine();
    const advanced = engine.advance(engine.start().nodes);

    expect(advanced.phase).toBe('running');
    expect(advanced.nodes[0].status).toBe('success');
    expect(advanced.nodes[1].status).toBe('running');
    expect(advanced.context.activeAgent).toBe(advanced.nodes[1].label);
  });

  it('pauses and resumes without moving the running node', () => {
    const engine = createMockTaskEngine();
    const started = engine.start();
    const paused = engine.pause(started);
    const resumed = engine.resume(paused);

    expect(paused.phase).toBe('paused');
    expect(paused.nodes[0].status).toBe('running');
    expect(resumed.phase).toBe('running');
    expect(resumed.nodes[0].status).toBe('running');
  });

  it('stops the task and keeps node states for inspection', () => {
    const engine = createMockTaskEngine();
    const stopped = engine.stop(engine.start());

    expect(stopped.phase).toBe('stopped');
    expect(stopped.nodes[0].status).toBe('running');
  });
});
