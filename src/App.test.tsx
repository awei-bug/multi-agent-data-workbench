import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import App from './App';
import AppShell from './components/layout/AppShell';
import { WorkbenchShellContext } from './context/WorkbenchShellContext';
import { createMockTaskRepository } from './mock/mockTaskRepository';
import { defaultWorkbenchContext } from './types/workbench';

const repository = createMockTaskRepository();

describe('app shell ui refresh', () => {
  it('shows breadcrumb and primary quick actions in workspace topbar', () => {
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <WorkbenchShellContext.Provider
          value={{
            context: defaultWorkbenchContext,
            setContext: vi.fn(),
            activeTask: repository.getActiveTask(),
            setActiveTask: vi.fn(),
          }}
        >
          <AppShell>
            <div />
          </AppShell>
        </WorkbenchShellContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText('任务工作区 / 新建任务 / 多 Agent 主流程')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /加载示例数据/i })).toBeInTheDocument();
    expect(screen.getByText(/Alt\+S/)).toBeInTheDocument();
  });

  it('switches sidebar page immediately without refresh', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 2, name: '多 Agent 主流程' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '数据源管理' }));

    expect(screen.getByRole('heading', { level: 2, name: '数据源管理' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '数据源管理' })).toBeInTheDocument();
  });
});
