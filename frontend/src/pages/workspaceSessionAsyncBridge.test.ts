import { describe, expect, it } from 'vitest';

import { createWorkspaceSessionAsyncBridge } from './workspaceSessionAsyncBridge';

describe('workspace session async bridge', () => {
  it('tracks idle to success state for async runtime calls', async () => {
    const bridge = createWorkspaceSessionAsyncBridge();

    expect(bridge.getState()).toEqual({
      status: 'idle',
      errorMessage: null,
    });

    const pendingPromise = bridge.run(() =>
      Promise.resolve({
        id: 'task-1',
      }),
    );

    expect(bridge.getState()).toEqual({
      status: 'pending',
      errorMessage: null,
    });

    await expect(pendingPromise).resolves.toEqual({ id: 'task-1' });
    expect(bridge.getState()).toEqual({
      status: 'success',
      errorMessage: null,
    });
  });

  it('captures error state when async runtime calls fail', async () => {
    const bridge = createWorkspaceSessionAsyncBridge();

    await expect(
      bridge.run(async () => {
        throw new Error('network unavailable');
      }),
    ).rejects.toThrow('network unavailable');

    expect(bridge.getState()).toEqual({
      status: 'error',
      errorMessage: 'network unavailable',
    });
  });

  it('allows resetting the bridge state after a failure', async () => {
    const bridge = createWorkspaceSessionAsyncBridge();

    await bridge.run(async () => {
      throw new Error('timeout');
    }).catch(() => undefined);

    bridge.reset();

    expect(bridge.getState()).toEqual({
      status: 'idle',
      errorMessage: null,
    });
  });
});
