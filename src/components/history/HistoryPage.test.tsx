import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import HistoryPage from '../../pages/HistoryPage';

describe('history page', () => {
  it('shows recent tasks and reusable templates', () => {
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(screen.getAllByRole('article').length).toBeGreaterThanOrEqual(4);
  });

  it('shows task replay details after selecting a history task', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole('button', { name: /复盘详情/ })[0]);

    const detailPanel = screen.getByRole('region', { name: '任务复盘详情' });
    expect(within(detailPanel).getAllByRole('list').length).toBeGreaterThanOrEqual(4);
    expect(within(detailPanel).getByText('回放时间线')).toBeInTheDocument();
  });

  it('filters recent tasks by keyword', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByPlaceholderText('搜索任务名称 / 摘要 / 需求'), '渠道');

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('渠道投放复盘');
    expect(screen.queryByText('华东销售月报')).not.toBeInTheDocument();
  });

  it('shows replay timeline entries from history detail data', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole('button', { name: /复盘详情/ })[0]);

    const detailPanel = screen.getByRole('region', { name: '任务复盘详情' });
    expect(within(detailPanel).getByText(/action · start/i)).toBeInTheDocument();
    expect(within(detailPanel).getByText(/export/i)).toBeInTheDocument();
  });
});
