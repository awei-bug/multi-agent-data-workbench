import type { APIRequestContext, Page } from '@playwright/test';

const API_BASE = 'http://127.0.0.1:8787';

export type E2EAuthSession = {
  accessToken: string;
  user: {
    id: string;
    username: string;
    tenantId: string;
    displayName: string;
    role: string;
  };
};

export async function registerE2ESession(request: APIRequestContext, suffix = `${Date.now()}`): Promise<E2EAuthSession> {
  const username = `e2e_${suffix}`.slice(0, 32);
  const response = await request.post(`${API_BASE}/api/auth/register`, {
    data: {
      username,
      password: 'password123',
      tenantId: 'e2e-tenant',
      displayName: 'E2E User',
    },
  });
  if (!response.ok()) {
    throw new Error(`failed to register e2e user: ${response.status()}`);
  }
  const payload = await response.json();
  return {
    accessToken: payload.accessToken,
    user: payload.user,
  };
}

export async function installAuthSession(page: Page, session: E2EAuthSession) {
  // Cookie is preferred in production; tests still seed user profile for shell UI.
  // Also set Authorization-compatible profile and inject access cookie via document for local e2e.
  await page.addInitScript((nextSession) => {
    window.localStorage.setItem('workspace.authUser', JSON.stringify(nextSession.user));
    window.localStorage.setItem('workspace.tenantId', nextSession.user.tenantId);
    window.localStorage.setItem('workspace.userId', nextSession.user.id);
    // Clear any legacy token storage.
    window.localStorage.removeItem('workspace.accessToken');
    window.localStorage.removeItem('workspace.refreshToken');
    document.cookie = `workspace_access_token=${encodeURIComponent(nextSession.accessToken)}; path=/`;
    document.cookie = `workspace_csrf_token=e2e-csrf; path=/`;
  }, session);
}

export function authHeaders(session: E2EAuthSession) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    'x-csrf-token': 'e2e-csrf',
  };
}

export async function installFakeAuthSession(page: Page) {
  await installAuthSession(page, {
    accessToken: 'e2e-ui-only-token',
    user: {
      id: 'e2e-user',
      username: 'e2e',
      tenantId: 'e2e-tenant',
      displayName: 'E2E',
      role: 'analyst',
    },
  });
}
