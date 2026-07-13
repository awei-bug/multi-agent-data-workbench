import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import AppShell from './components/layout/AppShell';
import { WorkbenchShellContext } from './context/WorkbenchShellContext';
import { createEmptyTask } from './pages/emptyTask';
import { defaultWorkbenchContext } from './types/workbench';
import { saveAuthSession } from './utils/workspaceIdentity';

function seedAuthSession() {
  saveAuthSession({
    accessToken: 'test-token',
    user: {
      id: 'user-test',
      username: 'tester',
      tenantId: 'tenant-test',
      displayName: 'Tester',
      role: 'analyst',
    },
  });
}

describe('app navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedAuthSession();
  });

  it('exposes the complete MVP navigation', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );
    // 主流程2 + 交付资产3 + 管理3
    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.getByRole('link', { name: '分析工作台' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '数据源' })).toHaveAttribute('href', '/data-sources');
    expect(screen.getByRole('heading', { name: '总览仪表盘', level: 2 })).toBeInTheDocument();
  });

  it('navigates from the shell to data insights', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('link', { name: '数据洞察' }));
    expect(screen.getByRole('heading', { name: '分析结果总览', level: 3 })).toBeInTheDocument();
  });

  it('redirects the retired async route to the canonical workspace execution page', () => {
    render(
      <MemoryRouter initialEntries={['/workspace?step=execution']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Agent 任务流预览', level: 3 })).toBeInTheDocument();
  });

  it('shows an attached dataset in the shell metadata', () => {
    const task = {
      ...createEmptyTask(),
      dataSource: { kind: 'table' as const, fileName: 'uploaded-sales.xlsx', columnCount: 1, rowCount: 1, fieldMappings: [] },
    };

    render(
      <MemoryRouter>
        <WorkbenchShellContext.Provider
          value={{ context: defaultWorkbenchContext, setContext: () => undefined, activeTask: task, setActiveTask: () => undefined }}
        >
          <AppShell>内容</AppShell>
        </WorkbenchShellContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/uploaded-sales\.xlsx/)).toBeInTheDocument();
  });

  it('loads canonical active task state from the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(createEmptyTask()), { status: 200 }));
    render(
      <MemoryRouter initialEntries={['/workspace?step=execution']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Agent 任务流预览', level: 3 })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/active', expect.any(Object));
    fetchMock.mockRestore();
  });

  it('redirects unauthenticated users to login', () => {
    window.localStorage.clear();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '接入分析指挥台', level: 2 })).toBeInTheDocument();
  });

  it('sends authenticated users from root to a smart next-step page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ...createEmptyTask(),
          dataSource: {
            kind: 'table',
            fileName: 'sales.csv',
            columnCount: 1,
            rowCount: 1,
            fieldMappings: [],
          },
          request: '尚未填写分析需求。',
        }),
        { status: 200 },
      ),
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    // With data but no request, smart entry should land on workspace input.
    expect(await screen.findByRole('heading', { name: '分析工作台', level: 2 })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/active', expect.any(Object));
    fetchMock.mockRestore();
  });
});
