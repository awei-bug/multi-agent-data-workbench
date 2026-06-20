import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import WorkspacePage from '../../pages/WorkspacePage';

describe('workspace source and intent steps', () => {
  it('shows parsed analysis intent after submitting a requirement', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    await user.type(screen.getByLabelText('分析需求'), '分析 2025 年月度销售额趋势并输出报告');
    await user.click(screen.getByRole('button', { name: '预解析' }));

    expect(screen.getByText('分析目标')).toBeInTheDocument();
    expect(screen.getByText('月度销售额趋势')).toBeInTheDocument();
    expect(screen.getByText('同比、环比、区域对比')).toBeInTheDocument();
  });

  it('uses confirmed csv field mappings in parsed intent metrics and dimensions', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    const file = new File(['month,region,sales\n2025-04,华中,4100\n2025-05,华北,3900'], 'sales.csv', {
      type: 'text/csv',
    });

    await user.upload(screen.getByLabelText('上传 CSV 文件'), file);
    await user.click(await screen.findByRole('button', { name: '确认字段映射' }));
    await user.type(screen.getByLabelText('分析需求'), '分析销售趋势并输出报告');
    await user.click(screen.getByRole('button', { name: '预解析' }));

    const summarySection = screen.getByRole('heading', { level: 3, name: '预解析结果' }).closest('section') as HTMLElement;
    expect(summarySection).not.toBeNull();
    expect(screen.getByText('核心指标')).toBeInTheDocument();
    expect(summarySection).toHaveTextContent('销售额');
    expect(screen.getByText('分析维度')).toBeInTheDocument();
    expect(summarySection).toHaveTextContent('月份、区域');
  });
});
