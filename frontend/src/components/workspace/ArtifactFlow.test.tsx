import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import App from '../../App';
import { saveAuthSession } from '../../utils/workspaceIdentity';

function seedAuthSession() {
  saveAuthSession({
    accessToken: 'test-token',
    user: {
      id: 'user-test',
      username: 'tester',
      tenantId: 'tenant-test',
      displayName: 'Tester',
      role: 'analyst',
    },
  });
}

describe('artifact flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedAuthSession();
  });

  it('exposes persisted-report editing and tangible export actions in the workspace output page', () => {
    render(<MemoryRouter initialEntries={['/workspace?step=output']}><App /></MemoryRouter>);
    expect(screen.getByLabelText('执行摘要')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '导出 Markdown' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '保存为模板' }).length).toBeGreaterThan(0);
  });
});
