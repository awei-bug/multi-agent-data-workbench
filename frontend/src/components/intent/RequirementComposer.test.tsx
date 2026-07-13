import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchShellContext } from '../../context/WorkbenchShellContext';
import WorkspacePage from '../../pages/WorkspacePage';
import { createEmptyTask } from '../../pages/emptyTask';
import { defaultWorkbenchContext } from '../../types/workbench';

describe('workspace intent parsing', () => {
  it('shows server-derived analysis intent for an attached dataset', async () => {
    const user = userEvent.setup();
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
      },
    };

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/intent/parse')) {
        return new Response(
          JSON.stringify({
            request: '分析销售趋势',
            goal: '销售趋势复盘',
            metrics: 'sales',
            dimensions: 'region',
            charts: '排名柱状图',
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          ...task,
          name: '销售趋势复盘',
          request: '分析销售趋势',
          intent: {
            request: '分析销售趋势',
            goal: '销售趋势复盘',
            metrics: 'sales',
            dimensions: 'region',
            charts: '排名柱状图',
          },
        }),
        { status: 200 },
      );
    });

    render(
      <MemoryRouter initialEntries={['/workspace?step=input']}>
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

    await user.type(screen.getByLabelText('分析需求'), '分析销售趋势');
    await user.click(screen.getByRole('button', { name: '解析意图' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/intent/parse', expect.objectContaining({ method: 'POST' }));
    // After successful parse, wizard advances to execution step.
    expect(await screen.findByText('运行监控')).toBeInTheDocument();
    expect(task.name).toBe('销售趋势复盘');
    expect(task.intent?.goal).toBe('销售趋势复盘');
    fetchMock.mockRestore();
  });
});
