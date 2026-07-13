import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchShellContext } from '../context/WorkbenchShellContext';
import { defaultWorkbenchContext } from '../types/workbench';
import ReportsPage from './ReportsPage';
import { createEmptyTask } from './emptyTask';

describe('reports page', () => {
  it('shows the current report only once in the report list', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const task = {
      ...createEmptyTask(),
      name: '产品数据分析',
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

    render(
      <WorkbenchShellContext.Provider value={{ context: defaultWorkbenchContext, setContext: () => undefined, activeTask: task, setActiveTask: () => undefined }}>
        <ReportsPage />
      </WorkbenchShellContext.Provider>,
    );

    const cards = await screen.findAllByText('产品数据分析');
    expect(cards).toHaveLength(2);
    expect(screen.getAllByRole('article')).toHaveLength(5); // metric cards 4 + report card 1
    fetchMock.mockRestore();
  });

  it('deletes a saved report from the report center', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'saved-1', name: '历史报告', summary: '待删除', status: '已导出', exports: [] }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true, id: 'saved-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    render(
      <WorkbenchShellContext.Provider value={{ context: defaultWorkbenchContext, setContext: () => undefined, activeTask: createEmptyTask(), setActiveTask: () => undefined }}>
        <ReportsPage />
      </WorkbenchShellContext.Provider>,
    );

    const cardTitle = await screen.findByText('历史报告');
    const card = cardTitle.closest('.history-card');
    expect(card).not.toBeNull();
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '彻底删除' }));
    await waitFor(() => expect(screen.getByText('已彻底清除 历史报告。')).toBeInTheDocument());
    fetchMock.mockRestore();
  });
});
