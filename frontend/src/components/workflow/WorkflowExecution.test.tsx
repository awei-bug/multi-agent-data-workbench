import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkbenchShellContext } from '../../context/WorkbenchShellContext';
import WorkspacePage from '../../pages/WorkspacePage';
import { createEmptyTask } from '../../pages/emptyTask';
import { defaultWorkbenchContext } from '../../types/workbench';
import { saveAuthSession } from '../../utils/workspaceIdentity';

function seedAuth() {
  saveAuthSession({
    user: {
      id: 'user-test',
      username: 'tester',
      tenantId: 'tenant-test',
      displayName: 'Tester',
      role: 'analyst',
    },
  });
}

function buildTask() {
  return {
    ...createEmptyTask(),
    name: '区域销售分析',
    request: '分析各区域销售额并输出趋势',
    intent: {
      request: '分析各区域销售额并输出趋势',
      goal: '区域销售趋势分析',
      metrics: '销售额',
      dimensions: '区域',
      charts: '柱状图',
    },
    dataSource: {
      kind: 'table' as const,
      fileName: 'sales.csv',
      columnCount: 2,
      rowCount: 2,
      columns: [
        { name: 'region', type: 'string' },
        { name: 'sales', type: 'number' },
      ],
      previewRows: [],
      analysisRows: [],
      fieldMappings: [],
      analysisScope: { mode: 'full', rowCount: 2, rowsProcessed: 2 },
    },
  };
}

function renderWorkspace(stage: 'execution' | 'input' = 'execution') {
  const task = buildTask();
  return render(
    <MemoryRouter initialEntries={[`/workspace?step=${stage}`]}>
      <WorkbenchShellContext.Provider
        value={{
          context: defaultWorkbenchContext,
          setContext: () => undefined,
          activeTask: task,
          setActiveTask: (next) => Object.assign(task, typeof next === 'function' ? next(task) : next),
        }}
      >
        <WorkspacePage />
      </WorkbenchShellContext.Provider>
    </MemoryRouter>,
  );
}

describe('workflow execution', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedAuth();
  });

  it('starts the server-backed workflow', async () => {
    const user = userEvent.setup();
    const runningTask = {
      ...buildTask(),
      snapshot: {
        ...createEmptyTask().snapshot,
        phase: 'running',
        logMessage: '数据接入 Agent 执行中',
        nodes: [
          { id: 'source', label: '数据接入 Agent', status: 'running' as const },
          ...createEmptyTask().snapshot.nodes.slice(1),
        ],
      },
      status: '执行中',
      execution: { mode: 'async', status: 'running', jobId: 'job-1' },
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/workflow/action') || (init?.method === 'POST' && String(init.body || '').includes('start'))) {
        return new Response(JSON.stringify(runningTask), { status: 200 });
      }
      if (url.includes('/api/auth/stream-ticket')) {
        return new Response(JSON.stringify({ ticket: 'stream-ticket' }), { status: 200 });
      }
      return new Response(JSON.stringify(runningTask), { status: 200 });
    });

    renderWorkspace('execution');
    // Prefer the sticky action-rail primary CTA.
    const startButtons = await screen.findAllByRole('button', { name: '开始分析' });
    await user.click(startButtons[startButtons.length - 1]);

    await waitFor(() => {
      const hit = fetchMock.mock.calls.some((call) => {
        const url = String(call[0]);
        const body = String((call[1] as RequestInit | undefined)?.body || '');
        return url.includes('/api/workflow/action') || body.includes('"action":"start"') || body.includes('start');
      });
      expect(hit).toBe(true);
    });
    fetchMock.mockRestore();
  });

  it('shows workflow stage shell when unlocked with data and intent', async () => {
    renderWorkspace('execution');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /开始分析/ }).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/可以开始分析了|区域销售分析/).length).toBeGreaterThan(0);
  });
});
