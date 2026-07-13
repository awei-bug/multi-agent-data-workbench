import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { WorkbenchShellContext } from '../../context/WorkbenchShellContext';
import WorkspacePage from '../../pages/WorkspacePage';
import { createEmptyTask } from '../../pages/emptyTask';
import { defaultWorkbenchContext } from '../../types/workbench';

describe('server-backed workflow view', () => {
  it('renders the execution page without browser-only sample controls', () => {
    const task = createEmptyTask();

    render(
      <MemoryRouter initialEntries={['/workspace?step=execution']}>
        <WorkbenchShellContext.Provider
          value={{
            context: defaultWorkbenchContext,
            setContext: () => undefined,
            activeTask: task,
            setActiveTask: () => undefined,
          }}
        >
          <WorkspacePage />
        </WorkbenchShellContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getAllByText('审核校验 Agent').length).toBeGreaterThan(0);
    expect(screen.getByText('运行监控')).toBeInTheDocument();
    expect(screen.queryByText('加载示例数据')).not.toBeInTheDocument();
  });
});
