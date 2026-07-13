import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAuthSession,
  DEFAULT_WORKSPACE_TENANT_ID,
  DEFAULT_WORKSPACE_USER_ID,
  getAuthSession,
  resetWorkspaceIdentity,
  saveAuthSession,
  saveWorkspaceIdentity,
  withWorkspaceHeaders,
  withWorkspaceQuery,
  workspaceFetch,
} from './workspaceIdentity';

describe('workspaceIdentity', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('adds workspace identity to request headers', async () => {
    saveWorkspaceIdentity({ tenantId: 'tenant-a', userId: 'user-a' });
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await workspaceFetch('/api/demo', { method: 'GET' });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get('x-workspace-tenant-id')).toBe('tenant-a');
    expect(headers.get('x-workspace-user-id')).toBe('user-a');
  });

  it('appends workspace identity to download query', () => {
    resetWorkspaceIdentity();

    expect(withWorkspaceQuery('/api/files/1/download')).toBe(
      `/api/files/1/download?workspaceTenantId=${DEFAULT_WORKSPACE_TENANT_ID}&workspaceUserId=${DEFAULT_WORKSPACE_USER_ID}`,
    );
  });

  it('prefers jwt session identity and authorization header', async () => {
    saveAuthSession({
      accessToken: 'token-abc',
      user: {
        id: 'user-jwt',
        username: 'analyst',
        tenantId: 'tenant-jwt',
        displayName: 'Analyst',
        role: 'analyst',
      },
    });
    saveWorkspaceIdentity({ tenantId: 'should-not-win', userId: 'should-not-win' });

    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await workspaceFetch('/api/demo');

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer token-abc');
    expect(headers.get('x-workspace-tenant-id')).toBe('tenant-jwt');
    expect(headers.get('x-workspace-user-id')).toBe('user-jwt');
    expect(withWorkspaceHeaders().get('authorization')).toBe('Bearer token-abc');
    expect(withWorkspaceQuery('/api/files/1/download')).toContain('accessToken=token-abc');
    expect(getAuthSession()?.user.username).toBe('analyst');

    clearAuthSession();
    expect(getAuthSession()).toBeNull();
  });
});
