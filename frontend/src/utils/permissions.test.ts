import { beforeEach, describe, expect, it } from 'vitest';

import { clearAuthSession, saveAuthSession } from './workspaceIdentity';
import { canAdmin, canWrite, hasPermission, permissionsForRole, roleLabel } from './permissions';

describe('permissions', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('maps roles to permission sets', () => {
    expect(permissionsForRole('viewer')).toEqual(['read']);
    expect(permissionsForRole('analyst')).toEqual(['read', 'write']);
    expect(permissionsForRole('admin')).toEqual(['read', 'write', 'admin']);
    expect(hasPermission('viewer', 'write')).toBe(false);
    expect(hasPermission('analyst', 'write')).toBe(true);
    expect(hasPermission('admin', 'admin')).toBe(true);
  });

  it('reads write and admin capability from session role', () => {
    expect(canWrite()).toBe(true);
    expect(canAdmin()).toBe(true);

    saveAuthSession({
      accessToken: 'token',
      user: {
        id: 'u1',
        username: 'viewer1',
        tenantId: 't1',
        displayName: 'Viewer',
        role: 'viewer',
      },
    });
    expect(canWrite()).toBe(false);
    expect(canAdmin()).toBe(false);
    expect(roleLabel('viewer')).toBe('只读访客');

    clearAuthSession();
  });
});
