import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HistoryPage from '../../pages/HistoryPage';
import { createEmptyTask } from '../../pages/emptyTask';

const historyTask = {
  ...createEmptyTask(),
  id: 'history-1',
  name: '渠道投放复盘',
  status: '已完成',
  request: '复盘渠道 ROI',
  summary: '渠道投放复盘摘要',
  snapshot: {
    ...createEmptyTask().snapshot,
    nodes: createEmptyTask().snapshot.nodes.map((node, index) => ({
      ...node,
      status: index < 3 ? 'success' : 'pending',
    })),
  },
};

function mockHistoryFetch(tasks: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/api/history/tasks/') && url.includes('/activate') && init?.method === 'POST') {
      return new Response(JSON.stringify({ ...historyTask, mode: 'replay' }), { status: 200 });
    }
    if (url.includes('/api/history/tasks')) {
      return new Response(JSON.stringify(tasks), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
}

describe('history page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads history from API and activates a task', async () => {
    const user = userEvent.setup();
    const fetchMock = mockHistoryFetch([historyTask]);

    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findAllByRole('heading', { name: '渠道投放复盘', level: 4 })).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '查看详情' }));
    expect(screen.getByText('数据接入 Agent')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '回放到执行编排' }));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/api/history/tasks/history-1/activate') && init?.method === 'POST')).toBe(true);
  });

  it('filters recent tasks by keyword', async () => {
    const user = userEvent.setup();
    mockHistoryFetch([
      historyTask,
      { ...historyTask, id: 'history-2', name: '华东销售月报', summary: '华东销售月报摘要', request: '销售月报' },
    ]);

    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findAllByRole('heading', { name: '渠道投放复盘', level: 4 })).not.toHaveLength(0);
    expect(screen.getAllByRole('heading', { name: '华东销售月报', level: 4 }).length).toBeGreaterThan(0);
    const searchBox = screen.getByPlaceholderText('输入任务名、摘要、需求或状态');
    await user.clear(searchBox);
    await user.type(searchBox, '渠道投放');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '华东销售月报', level: 4 })).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole('heading', { name: '渠道投放复盘', level: 4 }).length).toBeGreaterThan(0);
  });
});
