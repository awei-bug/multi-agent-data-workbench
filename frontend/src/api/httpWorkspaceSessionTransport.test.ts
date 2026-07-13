import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpWorkspaceSessionTransport } from './httpWorkspaceSessionTransport';

const mockTask = {
  id: 'task-1',
  name: '后端任务',
  mode: 'live' as const,
  status: '等待启动',
  time: 'now',
  summary: 'summary',
  request: 'request',
  snapshot: {
    phase: 'idle' as const,
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

describe('http workspace session transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the active task from the backend api', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTask,
    });

    vi.stubGlobal('fetch', fetchMock);

    const transport = createHttpWorkspaceSessionTransport({ baseUrl: 'http://localhost:8787' });
    const task = await transport.getActiveTask();

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/api/active-task', expect.any(Object));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe('GET');
    expect((request.headers as Headers).get('Content-Type')).toBe('application/json');
    expect(task).toEqual(mockTask);
  });

  it('posts workflow actions to the backend api', async () => {
    const runningTask = {
      ...mockTask,
      snapshot: {
        ...mockTask.snapshot,
        phase: 'running' as const,
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => runningTask,
    });

    vi.stubGlobal('fetch', fetchMock);

    const transport = createHttpWorkspaceSessionTransport({ baseUrl: 'http://localhost:8787' });
    const task = await transport.workflowAction('start');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/api/workflow/action', expect.any(Object));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(request.body).toBe(JSON.stringify({ action: 'start' }));
    expect((request.headers as Headers).get('Content-Type')).toBe('application/json');
    expect(task).toEqual(runningTask);
  });
});
