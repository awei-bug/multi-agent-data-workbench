import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from '../../App';

describe('artifact flow', () => {
  it('syncs report summary and export result into the active task metadata', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    await user.clear(screen.getByLabelText('样例值 0-销售额'));
    await user.type(screen.getByLabelText('样例值 0-销售额'), '3200');
    await user.click(screen.getByRole('button', { name: '应用修改' }));

    await user.clear(screen.getByLabelText('图表标题'));
    await user.type(screen.getByLabelText('图表标题'), '修正后销售趋势');

    await user.clear(screen.getByLabelText('执行摘要'));
    await user.type(screen.getByLabelText('执行摘要'), '销售额在第二季度显著回升。');

    await user.click(screen.getByRole('button', { name: '导出 PDF' }));

    expect(screen.getByText('已标记下游节点重跑')).toBeInTheDocument();
    expect(screen.getByDisplayValue('修正后销售趋势')).toBeInTheDocument();
    expect(screen.getByDisplayValue('销售额在第二季度显著回升。')).toBeInTheDocument();
    const exportSection = screen.getByRole('heading', { level: 3, name: '导出中心' }).closest('section') as HTMLElement;
    expect(within(exportSection).getByText('PDF 导出完成')).toBeInTheDocument();

    const topbar = screen.getByRole('heading', { level: 2, name: '多 Agent 主流程' }).closest('.topbar') as HTMLElement;
    expect(within(topbar).getByText('已导出 PDF')).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: '上下文面板' });
    expect(within(panel).getByText('任务摘要')).toBeInTheDocument();
    expect(within(panel).getByText('销售额在第二季度显著回升。')).toBeInTheDocument();
    expect(within(panel).getByText('导出记录')).toBeInTheDocument();
    expect(within(panel).getByText('PDF 导出完成')).toBeInTheDocument();
  });

  it('syncs manual revision and chart title changes into the task summary', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    await user.clear(screen.getByLabelText('样例值 0-销售额'));
    await user.type(screen.getByLabelText('样例值 0-销售额'), '3200');
    await user.click(screen.getByRole('button', { name: '应用修改' }));

    await user.clear(screen.getByLabelText('图表标题'));
    await user.type(screen.getByLabelText('图表标题'), '修正后销售趋势');

    const panel = screen.getByRole('region', { name: '上下文面板' });
    expect(within(panel).getByText('任务摘要')).toBeInTheDocument();
    expect(within(panel).getByText('已人工修正样例值：0-销售额为 3200。')).toBeInTheDocument();
    expect(within(panel).getByText('图表标题已更新为“修正后销售趋势”。')).toBeInTheDocument();
  });

  it('saves the current workspace session as a reusable template', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    await user.clear(screen.getByLabelText('分析需求'));
    await user.type(screen.getByLabelText('分析需求'), '分析华东区域客单价变化并形成复盘模板');
    await user.clear(screen.getByLabelText('执行摘要'));
    await user.type(screen.getByLabelText('执行摘要'), '沉淀一个适合客单价波动复盘的模板。');
    await user.click(screen.getByRole('button', { name: '保存为模板' }));
    await user.click(screen.getByRole('link', { name: '模板库' }));

    const firstTemplateCard = screen.getAllByRole('article')[0];
    expect(firstTemplateCard).toHaveTextContent('分析华东区域客单价变化并形成复盘模板');
    expect(firstTemplateCard).toHaveTextContent('来自工作台');
  });
});
