import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from '../../App';

describe('workspace app shell', () => {
  it('renders the workspace title and primary navigation', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: /Async Workspace Sandbox/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('switches from workspace to history view', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('link', { name: /历史任务/ }));

    expect(screen.getByRole('region', { name: /任务复盘详情/ })).toBeInTheDocument();
  });

  it('opens data sources and templates from the sidebar', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('link', { name: /数据源管理/ }));
    expect(screen.getByRole('button', { name: /使用 示例销售数据集/ })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /模板库/ }));
    expect(screen.getByRole('button', { name: /使用 经营复盘模板/ })).toBeInTheDocument();
  });

  it('starts a live workspace session from the data sources page and preloads sample data preview', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/data-sources']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /使用 示例销售数据集/ }));

    expect(screen.getByRole('heading', { level: 4, name: /字段概览/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: /样例数据/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/执行摘要/)).toHaveValue(
      '已从数据源页加载示例销售数据，可继续补充分析需求并启动多 Agent 流程。',
    );
  });

  it('imports a csv file in workspace and syncs preview plus context summary', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    const file = new File(['month,region,sales\n2025-04,华中,4100\n2025-05,华北,3900'], 'sales.csv', {
      type: 'text/csv',
    });

    await user.upload(screen.getByLabelText(/上传 CSV 文件/), file);

    expect(await screen.findByRole('heading', { level: 4, name: /字段概览/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: /样例数据/ })).toBeInTheDocument();
    expect(screen.getByText('华中')).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: /上下文面板/ });
    expect(await within(panel).findByText(/已导入 CSV 数据源 sales\.csv/)).toBeInTheDocument();
  });

  it('confirms csv field mappings and writes the mapping summary into context', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    const file = new File(['month,region,sales\n2025-04,华中,4100\n2025-05,华北,3900'], 'sales.csv', {
      type: 'text/csv',
    });

    await user.upload(screen.getByLabelText(/上传 CSV 文件/), file);

    expect(await screen.findByRole('heading', { level: 4, name: /字段映射确认/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /确认字段映射/ }));

    const panel = screen.getByRole('region', { name: /上下文面板/ });
    const taskSummaryBlock = within(panel).getByText('任务摘要').closest('.context-block') as HTMLElement;
    expect(within(taskSummaryBlock).getByText(/字段映射已确认：month->月份，region->区域，sales->销售额/)).toBeInTheDocument();
  });

  it('creates a new live task from the template library and preloads the request draft', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/templates']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /使用 经营复盘模板/ }));

    expect(screen.getByLabelText(/分析需求/)).toHaveValue('分析 2025 年月度销售额趋势并输出管理层月报');
    expect(screen.getByLabelText(/执行摘要/)).not.toHaveValue('');
  });

  it('pins a favorited template to the top of the template library and can cancel the favorite', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/templates']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /收藏 异常波动排查模板/ }));

    const templateCardsAfterFavorite = screen.getAllByRole('article');
    expect(templateCardsAfterFavorite[0]).toHaveTextContent('异常波动排查模板');
    expect(templateCardsAfterFavorite[0]).toHaveTextContent('已收藏');

    await user.click(screen.getByRole('button', { name: /取消收藏 异常波动排查模板/ }));

    const templateCardsAfterReset = screen.getAllByRole('article');
    expect(templateCardsAfterReset[0]).toHaveTextContent('经营复盘模板');
    expect(screen.queryByText('已收藏')).not.toBeInTheDocument();
  });

  it('loads a history task into the workspace replay flow', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/history']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole('button', { name: /复盘详情/ })[1]);
    await user.click(screen.getByRole('button', { name: /载入工作台继续处理/ }));

    expect(screen.getByRole('region', { name: /回放模式操作/ })).toBeInTheDocument();
    const topbar = screen.getByRole('heading', { level: 2 }).closest('.topbar') as HTMLElement;
    expect(within(topbar).getByText(/回放中/)).toBeInTheDocument();
  });

  it('exits replay mode and resets the workspace session', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/history']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole('button', { name: /复盘详情/ })[1]);
    await user.click(screen.getByRole('button', { name: /载入工作台继续处理/ }));

    const replayActions = screen.getByRole('region', { name: /回放模式操作/ });
    await user.click(within(replayActions).getByRole('button', { name: /退出回放/ }));

    expect(screen.queryByRole('region', { name: /回放模式操作/ })).not.toBeInTheDocument();
  });

  it('creates a new live session from replay mode and keeps the replay request draft', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/history']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole('button', { name: /复盘详情/ })[1]);
    await user.click(screen.getByRole('button', { name: /载入工作台继续处理/ }));

    const replayActions = screen.getByRole('region', { name: /回放模式操作/ });
    await user.click(within(replayActions).getByRole('button', { name: /新建任务/ }));

    expect(screen.queryByRole('region', { name: /回放模式操作/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/分析需求/)).toHaveValue('复盘渠道投放 ROI 与异常波动原因，形成周会复盘材料');
  });
});
