import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ContextPanel from './ContextPanel';
import { createMockTaskRepository } from '../../mock/mockTaskRepository';
import { defaultWorkbenchContext } from '../../types/workbench';

const repository = createMockTaskRepository();

describe('context panel refresh', () => {
  it('shows latest model output and log emphasis blocks', () => {
    render(<ContextPanel context={defaultWorkbenchContext} activeTask={repository.getActiveTask()} />);

    const panel = screen.getByRole('region', { name: '上下文面板' });
    expect(within(panel).getByText('输出摘要')).toBeInTheDocument();
    expect(within(panel).getByText('最新日志')).toBeInTheDocument();
  });

  it('collapses body content when context panel is toggled closed', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(<ContextPanel collapsed context={defaultWorkbenchContext} activeTask={repository.getActiveTask()} onToggle={onToggle} />);

    const panel = screen.getByRole('region', { name: '上下文面板' });
    expect(panel).toHaveAttribute('data-collapsed', 'true');

    await user.click(screen.getByRole('button', { name: '展开上下文面板' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
