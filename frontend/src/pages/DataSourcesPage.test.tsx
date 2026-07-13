import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchShellContext } from '../context/WorkbenchShellContext';
import { defaultWorkbenchContext } from '../types/workbench';
import { saveAuthSession } from '../utils/workspaceIdentity';
import DataSourcesPage from './DataSourcesPage';
import { createEmptyTask } from './emptyTask';

function seedWriteSession() {
  saveAuthSession({
    accessToken: 'test-token',
    user: {
      id: 'user-test',
      username: 'tester',
      tenantId: 'tenant-test',
      displayName: 'Tester',
      role: 'admin',
    },
  });
}

const sampleDataset = {
  id: 'dataset-1',
  name: 'sales.csv',
  fileName: 'sales.csv',
  kind: 'table',
  formatLabel: 'CSV',
  columnCount: 2,
  rowCount: 2,
  columns: [
    { name: 'region', type: 'string' },
    { name: 'sales', type: 'number' },
  ],
  previewRows: [],
  analysisRows: [],
  fieldMappings: [],
  originalFileSize: 42,
  analysisScope: { mode: 'full', rowCount: 2, rowsProcessed: 2 },
};

describe('data sources page', () => {
  it('binds a persisted dataset to the active task', async () => {
    window.localStorage.clear();
    seedWriteSession();
    const user = userEvent.setup();
    const activeTask = createEmptyTask();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/datasets') || url.includes('/api/datasets?')) {
        return new Response(JSON.stringify([sampleDataset]), { status: 200 });
      }
      if (url.includes('/api/connections')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes('/api/connectors/types')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response(
        JSON.stringify({ ...activeTask, dataSource: sampleDataset, status: '等待需求解析' }),
        { status: 200 },
      );
    });

    render(
      <MemoryRouter>
        <WorkbenchShellContext.Provider
          value={{
            context: defaultWorkbenchContext,
            setContext: () => undefined,
            activeTask,
            setActiveTask: (task) => Object.assign(activeTask, task),
          }}
        >
          <DataSourcesPage />
        </WorkbenchShellContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('sales.csv')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '用于新分析' }));
    expect(activeTask.dataSource?.fileName).toBe('sales.csv');
    expect(screen.getByText('已绑定 sales.csv，可以进入工作台配置需求。')).toBeInTheDocument();
    fetchMock.mockRestore();
  });

  it('starts analysis immediately after binding dataset', async () => {
    window.localStorage.clear();
    seedWriteSession();
    const user = userEvent.setup();
    const activeTask = createEmptyTask();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/datasets') || url.includes('/api/datasets?')) {
        return new Response(JSON.stringify([sampleDataset]), { status: 200 });
      }
      if (url.includes('/api/connections')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes('/api/connectors/types')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response(
        JSON.stringify({ ...activeTask, dataSource: sampleDataset, status: '等待需求解析' }),
        { status: 200 },
      );
    });

    render(
      <MemoryRouter initialEntries={['/data-sources']}>
        <WorkbenchShellContext.Provider
          value={{
            context: defaultWorkbenchContext,
            setContext: () => undefined,
            activeTask,
            setActiveTask: (task) => Object.assign(activeTask, task),
          }}
        >
          <Routes>
            <Route path="/data-sources" element={<DataSourcesPage />} />
            <Route path="/workspace" element={<div>workspace-input-ready</div>} />
          </Routes>
        </WorkbenchShellContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('sales.csv')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '立即开始分析' }));
    expect(activeTask.dataSource?.fileName).toBe('sales.csv');
    expect(await screen.findByText('workspace-input-ready')).toBeInTheDocument();
    fetchMock.mockRestore();
  });

  it('deletes a persisted dataset from the list', async () => {
    window.localStorage.clear();
    seedWriteSession();
    const user = userEvent.setup();
    const activeTask = createEmptyTask();
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if ((url.endsWith('/api/datasets') || url.includes('/api/datasets?')) && (!init || !init.method)) {
        return new Response(JSON.stringify([sampleDataset]), { status: 200 });
      }
      if (url.includes('/api/datasets/dataset-1') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ deleted: true, id: 'dataset-1' }), { status: 200 });
      }
      if (url.includes('/api/connections')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes('/api/connectors/types')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response(
        JSON.stringify({ ...activeTask, dataSource: sampleDataset, status: '等待需求解析' }),
        { status: 200 },
      );
    });

    render(
      <MemoryRouter>
        <WorkbenchShellContext.Provider
          value={{
            context: defaultWorkbenchContext,
            setContext: () => undefined,
            activeTask,
            setActiveTask: (task) => Object.assign(activeTask, task),
          }}
        >
          <DataSourcesPage />
        </WorkbenchShellContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('sales.csv')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByText('已删除 sales.csv。')).toBeInTheDocument();
    expect(screen.queryByText('sales.csv')).not.toBeInTheDocument();
    confirmMock.mockRestore();
    fetchMock.mockRestore();
  });
});
