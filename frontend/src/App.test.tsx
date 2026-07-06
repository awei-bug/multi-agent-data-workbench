import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('app navigation', () => {
  it('switches sidebar pages immediately', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    const navButtons = container.querySelectorAll<HTMLButtonElement>('.sidebar-nav .sidebar-link');
    expect(navButtons).toHaveLength(7);
    expect(navButtons[1]).toHaveAttribute('aria-current', 'page');

    await user.click(navButtons[4]);

    expect(navButtons[4]).toHaveAttribute('aria-current', 'page');
    expect(navButtons[1]).not.toHaveAttribute('aria-current');
    expect(container).not.toHaveTextContent('模板库');
    expect(container).not.toHaveTextContent('历史会话');
    expect(container).not.toHaveTextContent('异步沙箱');
  });

  it('exposes the consolidated optimization entry points', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('全局任务上下文')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一键处理' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '查看报告' }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '智能体工作台' }));
    expect(screen.getByText('进度 33%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '异步调试沙箱' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '对话分析' }));
    expect(screen.getByRole('button', { name: '月度复盘' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开实时结果' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '工作流画布' }));
    expect(screen.getByRole('button', { name: '收起组件库' })).toBeInTheDocument();
    expect(screen.getByText('高级配置')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '数据集管理' }));
    expect(screen.getByRole('tab', { name: '本地文件' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '快速新建任务' }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '报告中心' }));
    expect(screen.getByLabelText('报告状态筛选')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '系统设置' }));
    expect(screen.getByRole('tab', { name: '模型配置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑敏感配置' })).toBeInTheDocument();
  });
});
