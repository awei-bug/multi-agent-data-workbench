const ACCESS_TOKEN_KEY = 'workspace.accessToken';
const AUTH_USER_KEY = 'workspace.authUser';

const WORKSPACE_TENANT_KEY = 'workspace.tenantId';
const WORKSPACE_USER_KEY = 'workspace.userId';

export const DEFAULT_WORKSPACE_TENANT_ID = 'local-tenant';
export const DEFAULT_WORKSPACE_USER_ID = 'local-user';

export type WorkspaceIdentity = {
  tenantId: string;
  userId: string;
};

export type AuthUser = {
  id: string;
  username: string;
  tenantId: string;
  displayName: string;
  role: string;
  permissions?: string[];
};

export type AuthSession = {
  accessToken: string;
  user: AuthUser;
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getWorkspaceIdentity(): WorkspaceIdentity {
  const session = getAuthSession();
  if (session) {
    return { tenantId: session.user.tenantId, userId: session.user.id };
  }

  if (!canUseStorage()) {
    return { tenantId: DEFAULT_WORKSPACE_TENANT_ID, userId: DEFAULT_WORKSPACE_USER_ID };
  }

  const tenantId = window.localStorage.getItem(WORKSPACE_TENANT_KEY)?.trim() || DEFAULT_WORKSPACE_TENANT_ID;
  const userId = window.localStorage.getItem(WORKSPACE_USER_KEY)?.trim() || DEFAULT_WORKSPACE_USER_ID;
  return { tenantId, userId };
}

export function saveWorkspaceIdentity(identity: Partial<WorkspaceIdentity>) {
  if (!canUseStorage()) return getWorkspaceIdentity();

  const tenantId = identity.tenantId?.trim() || DEFAULT_WORKSPACE_TENANT_ID;
  const userId = identity.userId?.trim() || DEFAULT_WORKSPACE_USER_ID;
  window.localStorage.setItem(WORKSPACE_TENANT_KEY, tenantId);
  window.localStorage.setItem(WORKSPACE_USER_KEY, userId);
  return { tenantId, userId };
}

export function resetWorkspaceIdentity() {
  return saveWorkspaceIdentity({
    tenantId: DEFAULT_WORKSPACE_TENANT_ID,
    userId: DEFAULT_WORKSPACE_USER_ID,
  });
}

export function getAuthSession(): AuthSession | null {
  if (!canUseStorage()) return null;
  const accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY)?.trim();
  const rawUser = window.localStorage.getItem(AUTH_USER_KEY);
  if (!accessToken || !rawUser) return null;

  try {
    const user = JSON.parse(rawUser) as AuthUser;
    if (!user?.id || !user?.tenantId) return null;
    return { accessToken, user };
  } catch {
    return null;
  }
}

export function saveAuthSession(session: AuthSession) {
  if (!canUseStorage()) return session;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user));
  saveWorkspaceIdentity({ tenantId: session.user.tenantId, userId: session.user.id });
  return session;
}

export function clearAuthSession() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_USER_KEY);
}

export function withWorkspaceHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers);
  const identity = getWorkspaceIdentity();
  const session = getAuthSession();

  merged.set('x-workspace-tenant-id', identity.tenantId);
  merged.set('x-workspace-user-id', identity.userId);
  if (session?.accessToken) {
    merged.set('authorization', `Bearer ${session.accessToken}`);
  }
  return merged;
}

export function withWorkspaceQuery(url: string) {
  const identity = getWorkspaceIdentity();
  const session = getAuthSession();
  const nextUrl = new URL(url, window.location.origin);
  nextUrl.searchParams.set('workspaceTenantId', identity.tenantId);
  nextUrl.searchParams.set('workspaceUserId', identity.userId);
  if (session?.accessToken) {
    nextUrl.searchParams.set('accessToken', session.accessToken);
  }
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}

export async function workspaceFetch(input: string, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    headers: withWorkspaceHeaders(init.headers),
  });
}

export async function loginWithPassword(apiBaseUrl: string, username: string, password: string) {
  const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || payload?.detail || '登录失败');
  }
  const payload = (await response.json()) as { accessToken: string; user: AuthUser };
  return saveAuthSession({ accessToken: payload.accessToken, user: payload.user });
}

export async function registerWithPassword(
  apiBaseUrl: string,
  input: { username: string; password: string; tenantId?: string; displayName?: string },
) {
  const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || payload?.detail || '注册失败');
  }
  const payload = (await response.json()) as { accessToken: string; user: AuthUser };
  return saveAuthSession({ accessToken: payload.accessToken, user: payload.user });
}
