const AUTH_USER_KEY = 'workspace.authUser';
export const AUTH_CHANGED_EVENT = 'workspace-auth-changed';
const CSRF_COOKIE_NAME = 'workspace_csrf_token';

function notifyAuthChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

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
  /** Present only for legacy/test compatibility; production uses HttpOnly cookies. */
  accessToken?: string;
  refreshToken?: string;
  user: AuthUser;
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';').map((part) => part.trim());
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return decodeURIComponent(part.slice(name.length + 1));
    }
  }
  return null;
}

export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE_NAME);
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
  const rawUser = window.localStorage.getItem(AUTH_USER_KEY);
  if (!rawUser) return null;

  try {
    const user = JSON.parse(rawUser) as AuthUser;
    if (!user?.id || !user?.tenantId) return null;
    // Tokens live in HttpOnly cookies; localStorage only keeps display user profile.
    return { user };
  } catch {
    return null;
  }
}

export function saveAuthSession(session: AuthSession) {
  if (!canUseStorage()) return session;
  // Never persist long-lived tokens in localStorage (XSS surface).
  window.localStorage.removeItem('workspace.accessToken');
  window.localStorage.removeItem('workspace.refreshToken');
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user));
  saveWorkspaceIdentity({ tenantId: session.user.tenantId, userId: session.user.id });
  notifyAuthChanged();
  return { user: session.user };
}

export function clearAuthSession() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem('workspace.accessToken');
  window.localStorage.removeItem('workspace.refreshToken');
  window.localStorage.removeItem(AUTH_USER_KEY);
  notifyAuthChanged();
}

export function withWorkspaceHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers);
  const identity = getWorkspaceIdentity();
  const session = getAuthSession();

  merged.set('x-workspace-tenant-id', identity.tenantId);
  merged.set('x-workspace-user-id', identity.userId);
  // Prefer cookie auth; Authorization only if a non-cookie token is explicitly provided (tests/legacy).
  if (session?.accessToken) {
    merged.set('authorization', `Bearer ${session.accessToken}`);
  }
  const csrf = getCsrfToken();
  if (csrf) {
    merged.set('x-csrf-token', csrf);
  }
  return merged;
}

/** Append tenant/user query only. Never put long-lived access tokens in URLs. */
export function withWorkspaceQuery(url: string) {
  const identity = getWorkspaceIdentity();
  const nextUrl = new URL(url, window.location.origin);
  nextUrl.searchParams.set('workspaceTenantId', identity.tenantId);
  nextUrl.searchParams.set('workspaceUserId', identity.userId);
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}

export async function issueEphemeralTicket(
  apiBaseUrl: string,
  kind: 'stream' | 'download' = 'stream',
): Promise<string | null> {
  const path = kind === 'download' ? '/api/auth/download-ticket' : '/api/auth/stream-ticket';
  try {
    const response = await workspaceFetch(`${apiBaseUrl}${path}`, { method: 'POST' });
    if (!response.ok) return null;
    const payload = (await response.json()) as { ticket?: string };
    return payload.ticket || null;
  } catch {
    return null;
  }
}

/** Build a short-lived ticketed URL for EventSource / anchor downloads. */
export async function withTicketQuery(url: string, apiBaseUrl: string, kind: 'stream' | 'download' = 'stream') {
  const base = withWorkspaceQuery(url);
  const ticket = await issueEphemeralTicket(apiBaseUrl, kind);
  if (!ticket) return base;
  const nextUrl = new URL(base, window.location.origin);
  nextUrl.searchParams.set('ticket', ticket);
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshSession(apiBaseUrl: string): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: withWorkspaceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        clearAuthSession();
        return false;
      }
      const payload = (await response.json()) as {
        accessToken?: string;
        refreshToken?: string;
        user: AuthUser;
      };
      saveAuthSession({ user: payload.user });
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function workspaceFetch(input: string, init: RequestInit = {}) {
  const apiBaseUrl = (() => {
    try {
      return new URL(input, window.location.origin).origin === window.location.origin
        ? (import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '')
        : new URL(input).origin;
    } catch {
      return import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
    }
  })();

  const response = await fetch(input, {
    ...init,
    credentials: 'include',
    headers: withWorkspaceHeaders(init.headers),
  });

  if (response.status !== 401) return response;

  const refreshed = await tryRefreshSession(apiBaseUrl);
  if (!refreshed) {
    clearAuthSession();
    return response;
  }

  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: withWorkspaceHeaders(init.headers),
  });
}

const AUTH_CODE_MESSAGES: Record<string, string> = {
  invalid_username: '用户名需为 3～64 位，只能包含字母、数字、下划线 _、点 . 或短横线 -',
  invalid_password: '密码至少需要 8 位，请再设置长一点',
  invalid_credentials: '用户名或密码不正确，请检查后重试',
  username_taken: '该用户名已被注册，请换一个用户名',
  invalid_role: '角色无效',
  login_locked: '登录失败次数过多，请稍后再试',
  registration_disabled: '开放注册已关闭，请联系管理员或使用企业 SSO',
  tenant_self_select_disabled: '不允许自选租户，请使用默认租户',
  csrf_failed: '安全校验失败，请刷新页面后重试',
  http_401: '用户名或密码不正确，请检查后重试',
  http_409: '该用户名已被注册，请换一个用户名',
  request_validation_failed: '提交内容不完整或格式不正确，请检查用户名和密码',
};

const AUTH_ENGLISH_MESSAGES: Array<[RegExp, string]> = [
  [/failed to fetch/i, '无法连接服务器，请确认后端服务已启动（默认端口 8787）'],
  [/networkerror|network request failed|load failed|fetch failed/i, '网络连接失败，请检查网络或后端是否在运行'],
  [/network ?error/i, '网络连接失败，请检查网络或后端是否在运行'],
  [/econnrefused|connection refused/i, '连不上后端：连接被拒绝，请先启动后端服务'],
  [/timeout|timed out/i, '请求超时，请稍后重试或检查后端是否卡住'],
  [/invalid username or password/i, '用户名或密码不正确，请检查后重试'],
  [/username already exists/i, '该用户名已被注册，请换一个用户名'],
  [/username must be/i, '用户名需为 3～64 位，只能包含字母、数字、下划线 _、点 . 或短横线 -'],
  [/password must be at least/i, '密码至少需要 8 位，请再设置长一点'],
  [/internal server error/i, '服务器内部出错，请查看后端日志'],
  [/not found/i, '接口不存在，请确认前后端地址配置是否正确'],
  [/cors/i, '跨域请求被拦截，请检查前后端地址配置'],
];

function translateAuthText(raw: string, fallback: string): string {
  const text = String(raw || '').trim();
  if (!text) return fallback;
  for (const [pattern, message] of AUTH_ENGLISH_MESSAGES) {
    if (pattern.test(text)) return message;
  }
  if (/[一-鿿]/.test(text)) return text;
  return fallback === text ? text : `${fallback}（${text}）`;
}

function extractAuthErrorMessage(payload: unknown, fallback: string): string {
  const data = payload as {
    error?: { code?: string; message?: string };
    detail?: string | { code?: string; message?: string };
    message?: string;
  } | null;

  const code = data?.error?.code || (typeof data?.detail === 'object' ? data?.detail?.code : undefined);
  if (code && AUTH_CODE_MESSAGES[code]) return AUTH_CODE_MESSAGES[code];

  const raw =
    data?.error?.message ||
    (typeof data?.detail === 'string' ? data.detail : data?.detail?.message) ||
    data?.message ||
    '';

  return translateAuthText(raw, fallback);
}

/** 把任意登录/注册异常转成可展示的中文原因 */
export function toAuthUserMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error instanceof Error) {
    if (error.message && /[一-鿿]/.test(error.message) && !/failed to fetch/i.test(error.message)) {
      return error.message;
    }
    return translateAuthText(error.message || '', fallback);
  }
  if (typeof error === 'string') return translateAuthText(error, fallback);
  return fallback;
}

async function readAuthErrorPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      return text ? { message: text } : null;
    } catch {
      return null;
    }
  }
}

function statusFallback(status: number, action: 'login' | 'register'): string {
  if (status === 400) return action === 'login' ? '登录信息有误，请检查用户名和密码' : '注册信息有误，请检查填写内容';
  if (status === 401) return '用户名或密码不正确，请检查后重试';
  if (status === 403) return action === 'register' ? '开放注册已关闭，请联系管理员' : '没有权限执行此操作';
  if (status === 409) return '该用户名已被注册，请换一个用户名';
  if (status === 422) return '提交内容不完整或格式不正确，请检查用户名和密码';
  if (status === 429) return '尝试太频繁，请稍后再试';
  if (status >= 500) return '服务器出错了，请稍后重试或查看后端日志';
  return action === 'login' ? '登录失败，请稍后重试' : '注册失败，请稍后重试';
}

export async function loginWithPassword(apiBaseUrl: string, username: string, password: string) {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (error) {
    throw new Error(toAuthUserMessage(error, '无法连接服务器，请确认后端服务已启动（默认端口 8787）'));
  }

  if (!response.ok) {
    const payload = await readAuthErrorPayload(response);
    throw new Error(extractAuthErrorMessage(payload, statusFallback(response.status, 'login')));
  }

  const payload = (await response.json()) as { accessToken?: string; refreshToken?: string; user: AuthUser };
  return saveAuthSession({ user: payload.user });
}

export async function registerWithPassword(
  apiBaseUrl: string,
  input: { username: string; password: string; tenantId?: string; displayName?: string },
) {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw new Error(toAuthUserMessage(error, '无法连接服务器，请确认后端服务已启动（默认端口 8787）'));
  }

  if (!response.ok) {
    const payload = await readAuthErrorPayload(response);
    throw new Error(extractAuthErrorMessage(payload, statusFallback(response.status, 'register')));
  }
  const payload = (await response.json()) as { accessToken?: string; refreshToken?: string; user: AuthUser };
  return saveAuthSession({ user: payload.user });
}

export async function requestPasswordReset(apiBaseUrl: string, username: string) {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
  } catch (error) {
    throw new Error(toAuthUserMessage(error, '无法连接服务器，请确认后端服务已启动（默认端口 8787）'));
  }
  if (!response.ok) {
    const payload = await readAuthErrorPayload(response);
    throw new Error(extractAuthErrorMessage(payload, '申请重置失败，请稍后重试'));
  }
  return (await response.json()) as {
    ok: boolean;
    message?: string;
    resetToken?: string;
    expiresAt?: string;
  };
}

export async function confirmPasswordReset(apiBaseUrl: string, token: string, newPassword: string) {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/auth/password-reset/confirm`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });
  } catch (error) {
    throw new Error(toAuthUserMessage(error, '无法连接服务器，请确认后端服务已启动（默认端口 8787）'));
  }
  if (!response.ok) {
    const payload = await readAuthErrorPayload(response);
    throw new Error(extractAuthErrorMessage(payload, '重置密码失败，请检查链接是否过期'));
  }
  return (await response.json()) as { ok: boolean; message?: string };
}

export async function logoutSession(apiBaseUrl: string) {
  try {
    await fetch(`${apiBaseUrl}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: withWorkspaceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
  } catch {
    // best effort
  }
  clearAuthSession();
}

/** Bootstrap session from cookie via /api/auth/me (no token in localStorage). */
export async function hydrateAuthSession(apiBaseUrl: string): Promise<AuthSession | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
      method: 'GET',
      credentials: 'include',
      headers: withWorkspaceHeaders(),
    });
    if (response.status === 401) {
      clearAuthSession();
      return null;
    }
    if (!response.ok) {
      // Backend unavailable: keep any locally cached profile for offline/dev shells.
      return getAuthSession();
    }
    const payload = (await response.json()) as { authenticated?: boolean; user?: AuthUser };
    if (!payload.authenticated || !payload.user?.id) {
      // Anonymous/local mode — only clear if we previously thought we were logged in
      // and server explicitly says unauthenticated without local-dev fallback.
      if (payload.authenticated === false && getAuthSession()) {
        // Keep profile when auth is optional (local mode returns authenticated:false with local user).
        if (payload.user?.role === 'local' || payload.user?.id === DEFAULT_WORKSPACE_USER_ID) {
          return getAuthSession();
        }
        clearAuthSession();
        return null;
      }
      return getAuthSession();
    }
    return saveAuthSession({ user: payload.user });
  } catch {
    return getAuthSession();
  }
}

/** Production builds should not mutate real active tasks via demo shortcuts. */
export function isDemoFlowEnabled() {
  if (import.meta.env.VITE_ENABLE_DEMO_FLOW === 'true') return true;
  if (import.meta.env.VITE_ENABLE_DEMO_FLOW === 'false') return false;
  return Boolean(import.meta.env.DEV);
}
