import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../App';
import { createEmptyTask } from '../../pages/emptyTask';
import { saveAuthSession } from '../../utils/workspaceIdentity';

function seedAuthSession() {
  saveAuthSession({
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: {
              id: 'user-test',
              username: 'tester',
              tenantId: 'tenant-test',
              displayName: 'Tester',
              role: 'analyst',
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/api/tasks/active') || url.includes('/api/active-task')) {
        return new Response(JSON.stringify(createEmptyTask()), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
  });

  it('gates output stage until workflow results are ready', async () => {
    render(
      <MemoryRouter initialEntries={['/workspace?step=output']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '做分析', level: 2 })).toBeInTheDocument();
    });
    expect(screen.getAllByText(/未解锁|先完成|查看结果|说明问题|上传数据|等待/).length).toBeGreaterThan(0);
  });
});
