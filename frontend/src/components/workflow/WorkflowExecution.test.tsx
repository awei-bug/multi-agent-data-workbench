import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import WorkspacePage from '../../pages/WorkspacePage';

async function switchToExecution(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '02 执行编排' }));
}

describe('workflow execution', () => {
  it('starts the workflow and exposes running log entries', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    await switchToExecution(user);
    await user.click(screen.getByRole('button', { name: '启动任务' }));

    const logCard = screen.getByText('运行日志').closest('.log-card') as HTMLElement | null;
    const workflowSection = screen
      .getByRole('heading', { level: 3, name: 'Agent 任务流预览' })
      .closest('section') as HTMLElement | null;

    expect(logCard).not.toBeNull();
    expect(workflowSection).not.toBeNull();

    expect(within(logCard!).getByText('数据接入 Agent 执行中')).toBeInTheDocument();
    expect(within(workflowSection!).getByText('07 审核校验 Agent')).toBeInTheDocument();
    expect(within(workflowSection!).getAllByText('待执行').length).toBeGreaterThan(0);
  });

  it('blocks workflow start when csv mapping is not confirmed yet', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    const file = new File(['month,region,sales\n2025-04,华中,4100\n2025-05,华北,3900'], 'sales.csv', {
      type: 'text/csv',
    });

    await user.upload(screen.getByLabelText('上传 CSV'), file);
    await switchToExecution(user);
    await user.click(screen.getByRole('button', { name: '启动任务' }));

    const logCard = screen.getByText('运行日志').closest('.log-card') as HTMLElement;
    expect(within(logCard).getByText('字段映射尚未确认，暂不能启动多 Agent 流程。')).toBeInTheDocument();
  });

  it('blocks workflow start with a node-specific validation message when required metric mapping is missing', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    const file = new File(['month,region,sales\n2025-04,华中,4100\n2025-05,华北,3900'], 'sales.csv', {
      type: 'text/csv',
    });

    await user.upload(screen.getByLabelText('上传 CSV'), file);
    await user.selectOptions(screen.getByRole('combobox', { name: '映射 sales' }), 'sales');
    await user.click(screen.getByRole('button', { name: '确认字段映射' }));
    await switchToExecution(user);
    await user.click(screen.getByRole('button', { name: '启动任务' }));

    const logCard = screen.getByText('运行日志').closest('.log-card') as HTMLElement;
    expect(within(logCard).getByText('销售额字段缺少数值列映射，请将数值字段映射为“销售额”。')).toBeInTheDocument();
  });
  it('shows a visible recovery hint when the current agent fails', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    await switchToExecution(user);
    await user.click(screen.getByRole('button', { name: '启动任务' }));
    await user.click(screen.getByRole('button', { name: '模拟失败' }));

    expect(screen.getByRole('alert')).toHaveTextContent('当前节点执行失败');
    expect(screen.getByRole('button', { name: '重试当前节点' })).toBeEnabled();
  });
});
