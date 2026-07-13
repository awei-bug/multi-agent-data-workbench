import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('workspace shell flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedAuthSession();
  });

  it('keeps the complete navigation active state in sync with clicks', async () => {
    const user = userEvent.setup();
    const { container } = render(<MemoryRouter initialEntries={['/workspace?step=input']}><App /></MemoryRouter>);
    const links = container.querySelectorAll<HTMLAnchorElement>('.sidebar-nav-ops .sidebar-link-ops');
    // 主流程2 + 交付资产3 + 管理3 = 8
    expect(links).toHaveLength(8);
    // 点击“数据源”
    await user.click(links[1]);
    expect(links[1]).toHaveAttribute('aria-current', 'page');
  });
});
