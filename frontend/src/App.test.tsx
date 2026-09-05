import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import AppShell from './components/layout/AppShell';
import { WorkbenchShellContext } from './context/WorkbenchShellContext';
import { createEmptyTask } from './pages/emptyTask';
import { defaultWorkbenchContext } from './types/workbench';
import { clearAuthSession, saveAuthSession } from './utils/workspaceIdentity';

function seedAuthSession() {
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

function mockAuthenticatedApis(task: ReturnType<typeof createEmptyTask> = createEmptyTask()) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) {
      return new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            id: 'user-test',
            username: 'tester',
            tenantId: 'tenant-test',
            displayName: 'Tester',
            role: 'analyst',
            permissions: ['read', 'write'],
          },
        }),
        { status: 200 },
      );
    }
    if (url.includes('/api/tasks/active') || url.includes('/api/active-task')) {
      return new Response(JSON.stringify(task), { status: 200 });
    }
    if (url.includes('/api/datasets') || url.includes('/api/history') || url.includes('/api/templates')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

describe('app navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedAuthSession();
    mockAuthenticatedApis();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the complete MVP navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );
    // 主流程2 + 交付资产3 + 管理3
    expect(await screen.findAllByRole('link')).toHaveLength(8);
    expect(screen.getByRole('link', { name: '做分析' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '上传数据' })).toHaveAttribute('href', '/data-sources');
    expect(await screen.findByRole('heading', { name: '开始分析', level: 2 })).toBeInTheDocument();
  });

  it('navigates from the shell to data insights', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('link', { name: '图表' }));
    expect(await screen.findByRole('heading', { name: '分析结果总览', level: 3 })).toBeInTheDocument();
  });

  it('redirects the retired async route to the canonical workspace execution page', async () => {
    render(
      <MemoryRouter initialEntries={['/workspace?step=execution']}>
        <App />
      </MemoryRouter>,
    );
    // Without data/intent, stage gate keeps users on input preparation.
    expect(await screen.findByRole('heading', { name: '做分析', level: 2 })).toBeInTheDocument();
    expect(await screen.findAllByText(/未解锁/)).not.toHaveLength(0);
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

    expect(screen.getAllByText(/uploaded-sales\.xlsx/).length).toBeGreaterThan(0);
  });

  it('loads canonical active task state from the API', async () => {
    const fetchMock = mockAuthenticatedApis();
    render(
      <MemoryRouter initialEntries={['/workspace?step=execution']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '做分析', level: 2 })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/tasks/active'))).toBe(true);
  });

  it('redirects unauthenticated users to login', async () => {
    window.localStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ authenticated: false }), { status: 401 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: /登录/, level: 2 })).toBeInTheDocument();
  });

  it('sends authenticated users from root to a smart next-step page', async () => {
    const task = {
      ...createEmptyTask(),
      dataSource: {
        kind: 'table' as const,
        fileName: 'sales.csv',
        columnCount: 1,
        rowCount: 1,
        fieldMappings: [],
      },
      request: '尚未填写分析需求。',
    };
    const fetchMock = mockAuthenticatedApis(task);

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    // With data but no request, smart entry should land on workspace input.
    expect(await screen.findByRole('heading', { name: '做分析', level: 2 })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/tasks/active'))).toBe(true);
  });

  it('allows returning to login after logout', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '开始分析', level: 2 })).toBeInTheDocument();

    clearAuthSession();
    unmount();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ authenticated: false }), { status: 401 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: /登录/, level: 2 })).toBeInTheDocument();
  });
});
