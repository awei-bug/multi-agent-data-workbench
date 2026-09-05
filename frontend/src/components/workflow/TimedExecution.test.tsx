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

    // Without data, stage gate keeps user on the problem step.
    expect(screen.getAllByText(/说明问题/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/开始分析/).length).toBeGreaterThan(0);
    expect(screen.queryByText('加载示例数据')).not.toBeInTheDocument();
  });
});
