import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from '../../App';
import WorkspacePage from '../../pages/WorkspacePage';

describe('data source uploader', () => {
  it('reveals mock schema and preview rows after loading sample data', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    await user.click(screen.getByRole('button', { name: '加载示例数据' }));

    const schemaCard = screen.getByText('字段概览').closest('.preview-card') as HTMLElement | null;
    const sampleCard = screen.getByText('样例数据').closest('.preview-card') as HTMLElement | null;

    expect(schemaCard).not.toBeNull();
    expect(sampleCard).not.toBeNull();

    expect(within(schemaCard as HTMLElement).getByText('月份')).toBeInTheDocument();
    expect(within(schemaCard as HTMLElement).getByText('销售额')).toBeInTheDocument();
    expect(within(sampleCard as HTMLElement).getByText('华东')).toBeInTheDocument();
  });

  it('parses uploaded csv text and updates the preview cards', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    const file = new File(['month,region,sales\n2025-04,华中,4100\n2025-05,华北,3900'], 'sales.csv', {
      type: 'text/csv',
    });

    await user.upload(screen.getByLabelText('上传 CSV 文件'), file);

    const schemaHeading = await screen.findByRole('heading', { level: 4, name: '字段概览' });
    const sampleHeading = await screen.findByRole('heading', { level: 4, name: '样例数据' });
    const schemaCard = schemaHeading.closest('.preview-card') as HTMLElement;
    const sampleCard = sampleHeading.closest('.preview-card') as HTMLElement;
    expect(within(schemaCard).getByText('month')).toBeInTheDocument();
    expect(within(schemaCard).getByText('region')).toBeInTheDocument();
    expect(within(schemaCard).getByText('sales')).toBeInTheDocument();
    expect(within(sampleCard).getByText('华中')).toBeInTheDocument();
    expect(within(sampleCard).getByText('4100')).toBeInTheDocument();
  });

  it('shows a mapping confirmation panel after csv upload', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    const file = new File(['month,region,sales\n2025-04,华中,4100'], 'sales.csv', {
      type: 'text/csv',
    });

    await user.upload(screen.getByLabelText('上传 CSV 文件'), file);

    expect(await screen.findByRole('heading', { level: 4, name: '字段映射确认' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认字段映射' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('月份')).toBeInTheDocument();
    expect(screen.getByDisplayValue('区域')).toBeInTheDocument();
    expect(screen.getByDisplayValue('销售额')).toBeInTheDocument();
  });
});
