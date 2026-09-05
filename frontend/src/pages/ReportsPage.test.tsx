import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchShellContext } from '../context/WorkbenchShellContext';
import { defaultWorkbenchContext } from '../types/workbench';
import ReportsPage from './ReportsPage';
import { createEmptyTask } from './emptyTask';

function renderReports(task = createEmptyTask()) {
  return render(
    <MemoryRouter>
      <WorkbenchShellContext.Provider
        value={{ context: defaultWorkbenchContext, setContext: () => undefined, activeTask: task, setActiveTask: () => undefined }}
      >
        <ReportsPage />
      </WorkbenchShellContext.Provider>
    </MemoryRouter>,
  );
}

describe('reports page', () => {
  it('shows the current conclusion once and keeps history separate', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const task = {
      ...createEmptyTask(),
      name: '产品数据分析',
      summary: '本月销量环比上升。',
      dataSource: {
        kind: 'table' as const,
        fileName: '产品数据.xlsx',
        columnCount: 1,
        rowCount: 1,
        columns: [{ name: '容量', type: 'number' }],
        previewRows: [{ 容量: '100' }],
        analysisRows: [{ 容量: '100' }],
        fieldMappings: [],
      },
    };

    renderReports(task);

    expect(await screen.findByRole('heading', { name: '看结果', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本次结论', level: 3 })).toBeInTheDocument();
    expect(screen.getAllByText(/产品数据分析/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('article')).toHaveLength(4);
    fetchMock.mockRestore();
  });

  it('deletes a saved report from the report center', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'saved-1', name: '历史报告', summary: '待删除', status: '已导出', exports: [] }]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true, id: 'saved-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    renderReports(createEmptyTask());

    const cardTitle = await screen.findByText('历史报告');
    const card = cardTitle.closest('.history-card');
    expect(card).not.toBeNull();
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '彻底删除' }));
    await waitFor(() => expect(screen.getByText(/已彻底清除\s*历史报告/)).toBeInTheDocument());
    fetchMock.mockRestore();
  });
});
