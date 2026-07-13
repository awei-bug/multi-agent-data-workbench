import { getAuthSession, type AuthUser } from './workspaceIdentity';

export type WorkspaceRole = 'viewer' | 'analyst' | 'admin' | 'local';
export type WorkspacePermission = 'read' | 'write' | 'admin';

const ROLE_PERMISSIONS: Record<WorkspaceRole, WorkspacePermission[]> = {
  viewer: ['read'],
  analyst: ['read', 'write'],
  admin: ['read', 'write', 'admin'],
  local: ['read', 'write', 'admin'],
};

export function normalizeRole(role?: string | null): WorkspaceRole {
  const value = (role || 'viewer').toLowerCase();
  if (value === 'admin' || value === 'analyst' || value === 'viewer' || value === 'local') {
    return value;
  }
  return 'viewer';
}

export function permissionsForRole(role?: string | null): WorkspacePermission[] {
  return ROLE_PERMISSIONS[normalizeRole(role)];
}

export function hasPermission(role: string | null | undefined, permission: WorkspacePermission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function currentAuthUser(): AuthUser | null {
  return getAuthSession()?.user ?? null;
}

export function currentRole(): WorkspaceRole {
  return normalizeRole(currentAuthUser()?.role || 'local');
}

export function canWrite(): boolean {
  return hasPermission(currentRole(), 'write');
}

export function canAdmin(): boolean {
  return hasPermission(currentRole(), 'admin');
}

export function roleLabel(role?: string | null): string {
  switch (normalizeRole(role)) {
    case 'admin':
      return '管理员';
    case 'analyst':
      return '分析师';
    case 'viewer':
      return '只读访客';
    default:
      return '本地模式';
  }
}
