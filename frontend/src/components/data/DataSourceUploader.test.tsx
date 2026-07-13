import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import DataSourceUploader from './DataSourceUploader';

describe('data source uploader', () => {
  it('allows CSV, legacy Excel, and modern Excel files', () => {
    render(<DataSourceUploader />);
    const accept = screen.getByLabelText('上传文件').getAttribute('accept') ?? '';
    expect(accept).toMatch(/(^|,)\.xls(,|$)/);
    expect(accept).toMatch(/(^|,)\.xlsx(,|$)/);
    expect(accept).toMatch(/(^|,)\.csv(,|$)/);
  });

  it('posts the selected file as multipart data and passes server metadata onward', async () => {
    const user = userEvent.setup();
    const imported = vi.fn();
    const response = { id: 'dataset-1', kind: 'table', fileName: 'sales.csv', columnCount: 2, rowCount: 1, columns: [{ name: 'region', type: 'string' }, { name: 'sales', type: 'number' }], previewRows: [{ region: 'East', sales: '120' }], analysisRows: [{ region: 'East', sales: '120' }], fieldMappings: [], analysisScope: { mode: 'full', rowCount: 1, rowsProcessed: 1 } };
    vi.stubEnv('VITE_WORKSPACE_API_BASE_URL', 'http://127.0.0.1:8788');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    render(<DataSourceUploader onImportDataSource={imported} />);
    await user.upload(screen.getByLabelText('上传文件'), new File(['region,sales\nEast,120'], 'sales.csv', { type: 'text/csv' }));
    expect(await screen.findByText('East')).toBeInTheDocument();
    expect(imported).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'sales.csv' }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/data-source\/upload$/), expect.objectContaining({ method: 'POST' }));
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
  });
});
