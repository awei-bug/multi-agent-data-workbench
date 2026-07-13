import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchShellContext } from '../../context/WorkbenchShellContext';
import WorkspacePage from '../../pages/WorkspacePage';
import { createEmptyTask } from '../../pages/emptyTask';
import { defaultWorkbenchContext } from '../../types/workbench';

function renderWorkspace(stage: 'execution' | 'input' = 'execution') {
  const task = {
    ...createEmptyTask(),
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

  return render(
    <MemoryRouter initialEntries={[`/workspace?step=${stage}`]}>
      <WorkbenchShellContext.Provider
        value={{
          context: defaultWorkbenchContext,
          setContext: () => undefined,
          activeTask: task,
          setActiveTask: (next) => Object.assign(task, next),
        }}
      >
        <WorkspacePage />
      </WorkbenchShellContext.Provider>
    </MemoryRouter>,
  );
}

describe('workflow execution', () => {
  it('starts the server-backed workflow', async () => {
    const user = userEvent.setup();
    const runningTask = {
      ...createEmptyTask(),
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
      snapshot: {
        ...createEmptyTask().snapshot,
        phase: 'running',
        logMessage: '数据接入 Agent 执行中',
        nodes: [{ id: 'source', label: '数据接入 Agent', status: 'running' }, ...createEmptyTask().snapshot.nodes.slice(1)],
      },
      status: '执行中',
      execution: { mode: 'async', status: 'running', jobId: 'job-1' },
    };
    const completedTask = {
      ...runningTask,
      snapshot: {
        ...runningTask.snapshot,
        phase: 'completed',
        logMessage: '审核校验 Agent 已完成',
        nodes: runningTask.snapshot.nodes.map((node) => ({ ...node, status: 'success' as const })),
      },
      status: '已完成',
      execution: { mode: 'async', status: 'succeeded', jobId: 'job-1' },
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(runningTask), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify(completedTask), { status: 200 }));

    renderWorkspace('execution');
    await user.click(screen.getAllByRole('button', { name: '启动任务' })[0]);

    expect(fetchMock).toHaveBeenCalledWith('/api/workflow/action', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/workflow/action'))).toBe(true);
    fetchMock.mockRestore();
  });

  it('shows all persisted workflow nodes and correction action', () => {
    renderWorkspace('execution');
    expect(screen.getAllByText('审核校验 Agent').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '应用修改' })).toBeInTheDocument();
    expect(screen.getByText('当前产物：尚未生成')).toBeInTheDocument();
  });
});
