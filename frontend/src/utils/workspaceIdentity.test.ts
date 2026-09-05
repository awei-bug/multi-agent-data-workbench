import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_CHANGED_EVENT,
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
    expect(init?.credentials).toBe('include');
  });

  it('appends workspace identity to download query without access tokens', () => {
    resetWorkspaceIdentity();

    expect(withWorkspaceQuery('/api/files/1/download')).toBe(
      `/api/files/1/download?workspaceTenantId=${DEFAULT_WORKSPACE_TENANT_ID}&workspaceUserId=${DEFAULT_WORKSPACE_USER_ID}`,
    );
  });

  it('stores user profile without long-lived tokens in localStorage', async () => {
    saveAuthSession({
      accessToken: 'token-abc',
      refreshToken: 'refresh-abc',
      user: {
        id: 'user-jwt',
        username: 'analyst',
        tenantId: 'tenant-jwt',
        displayName: 'Analyst',
        role: 'analyst',
      },
    });
    saveWorkspaceIdentity({ tenantId: 'should-not-win', userId: 'should-not-win' });

    expect(window.localStorage.getItem('workspace.accessToken')).toBeNull();
    expect(window.localStorage.getItem('workspace.refreshToken')).toBeNull();
    expect(getAuthSession()?.user.username).toBe('analyst');
    expect(getAuthSession()?.accessToken).toBeUndefined();

    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await workspaceFetch('/api/demo');

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get('x-workspace-tenant-id')).toBe('tenant-jwt');
    expect(headers.get('x-workspace-user-id')).toBe('user-jwt');
    expect(withWorkspaceQuery('/api/files/1/download')).not.toContain('accessToken=');
    expect(withWorkspaceHeaders().get('x-workspace-tenant-id')).toBe('tenant-jwt');

    clearAuthSession();
    expect(getAuthSession()).toBeNull();
  });

  it('dispatches auth changed event when session is saved or cleared', () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_CHANGED_EVENT, listener);

    saveAuthSession({
      accessToken: 'token-event',
      user: {
        id: 'user-event',
        username: 'event',
        tenantId: 'tenant-event',
        displayName: 'Event',
        role: 'analyst',
      },
    });
    expect(listener).toHaveBeenCalled();
    expect(getAuthSession()?.user.id).toBe('user-event');

    clearAuthSession();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getAuthSession()).toBeNull();

    window.removeEventListener(AUTH_CHANGED_EVENT, listener);
  });
});
