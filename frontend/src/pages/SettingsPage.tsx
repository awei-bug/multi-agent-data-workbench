import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  clearAuthSession,
  DEFAULT_WORKSPACE_TENANT_ID,
  DEFAULT_WORKSPACE_USER_ID,
  getAuthSession,
  getWorkspaceIdentity,
  resetWorkspaceIdentity,
  saveWorkspaceIdentity,
  workspaceFetch,
} from '../utils/workspaceIdentity';
import { canAdmin, roleLabel } from '../utils/permissions';

type SettingsPageProps = {
  onLoggedOut?: () => void;
};

type ManagedUser = {
  id: string;
  username: string;
  tenantId: string;
  displayName: string;
  role: string;
  permissions?: string[];
};

type OrgItem = {
  id: string;
  name: string;
  slug: string;
  memberRole?: string;
  ownerUserId?: string;
};

type OrgMember = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
};

type OrgInvite = {
  id: string;
  username: string;
  role: string;
  token: string;
  status: string;
};

function SettingsPage({ onLoggedOut }: SettingsPageProps) {
  const navigate = useNavigate();
  const session = getAuthSession();
  const current = getWorkspaceIdentity();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [tenantId, setTenantId] = useState(current.tenantId);
  const [userId, setUserId] = useState(current.userId);
  const [status, setStatus] = useState('');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersStatus, setUsersStatus] = useState('');

  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [orgInvites, setOrgInvites] = useState<OrgInvite[]>([]);
  const [orgStatus, setOrgStatus] = useState('');
  const [orgName, setOrgName] = useState('分析协作组');
  const [orgSlug, setOrgSlug] = useState('analytics-team');
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteTokenInput, setInviteTokenInput] = useState('');

  const identityLocked = useMemo(() => Boolean(session), [session]);
  const isAdmin = canAdmin();
  const selectedOrg = orgs.find((item) => item.id === selectedOrgId) || null;
  const canManageOrg = selectedOrg?.memberRole === 'owner' || selectedOrg?.memberRole === 'admin';

  const loadUsers = () => {
    if (!isAdmin || !apiBaseUrl) {
      setUsers([]);
      return;
    }
    void workspaceFetch(`${apiBaseUrl}/api/auth/users`)
      .then((response) => {
        if (!response.ok) throw new Error('load failed');
        return response.json();
      })
      .then((payload: { items: ManagedUser[] }) => setUsers(payload.items || []))
      .catch(() => setUsersStatus('无法加载用户列表。'));
  };

  const loadOrgs = async () => {
    if (!session || !apiBaseUrl) {
      setOrgs([]);
      return;
    }
    try {
      const response = await workspaceFetch(`${apiBaseUrl}/api/orgs`);
      if (!response.ok) throw new Error('load orgs failed');
      const payload = await response.json();
      const items = (payload.items || []) as OrgItem[];
      setOrgs(items);
      if (!selectedOrgId && items[0]?.id) setSelectedOrgId(items[0].id);
      if (selectedOrgId && !items.some((item) => item.id === selectedOrgId)) {
        setSelectedOrgId(items[0]?.id || '');
      }
    } catch {
      setOrgStatus('无法加载组织列表。');
    }
  };

  const loadOrgDetail = async (orgId: string) => {
    if (!orgId || !apiBaseUrl) {
      setOrgMembers([]);
      setOrgInvites([]);
      return;
    }
    try {
      const response = await workspaceFetch(`${apiBaseUrl}/api/orgs/${encodeURIComponent(orgId)}`);
      if (!response.ok) throw new Error('load org detail failed');
      const payload = await response.json();
      setOrgMembers(payload.members || []);
      setOrgInvites(payload.invites || []);
    } catch {
      setOrgStatus('无法加载组织详情。');
    }
  };

  useEffect(() => {
    loadUsers();
    void loadOrgs();
  }, [apiBaseUrl, isAdmin, session?.accessToken]);

  useEffect(() => {
    if (selectedOrgId) void loadOrgDetail(selectedOrgId);
  }, [selectedOrgId, session?.accessToken]);

  const saveIdentity = () => {
    if (identityLocked) {
      setStatus('已登录状态下作用域由 JWT 决定，不能手动覆盖。');
      return;
    }
    const next = saveWorkspaceIdentity({ tenantId, userId });
    setTenantId(next.tenantId);
    setUserId(next.userId);
    setStatus(`已保存工作空间：${next.tenantId} / ${next.userId}`);
  };

  const resetIdentity = () => {
    if (identityLocked) {
      setStatus('已登录状态下作用域由 JWT 决定，不能手动覆盖。');
      return;
    }
    const next = resetWorkspaceIdentity();
    setTenantId(next.tenantId);
    setUserId(next.userId);
    setStatus('已恢复默认本地工作空间。');
  };

  const logout = () => {
    clearAuthSession();
    onLoggedOut?.();
    navigate('/login', { replace: true });
  };

  const changeRole = async (user: ManagedUser, role: string) => {
    setUsersStatus('正在更新角色...');
    const response = await workspaceFetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(user.id)}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setUsersStatus(payload?.error?.message || '角色更新失败');
      return;
    }
    const payload = await response.json();
    setUsers((currentUsers) =>
      currentUsers.map((item) =>
        item.id === user.id ? { ...item, role: payload.user.role, permissions: payload.user.permissions } : item,
      ),
    );
    setUsersStatus(`已将 ${user.username} 调整为 ${roleLabel(role)}`);
  };

  const createOrg = async () => {
    setOrgStatus('正在创建组织...');
    const response = await workspaceFetch(`${apiBaseUrl}/api/orgs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: orgName, slug: orgSlug }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setOrgStatus(payload?.error?.message || '创建组织失败');
      return;
    }
    const payload = await response.json();
    setOrgStatus(`组织已创建：${payload.organization.name}`);
    await loadOrgs();
    setSelectedOrgId(payload.organization.id);
  };

  const inviteMember = async () => {
    if (!selectedOrgId) return;
    setOrgStatus('正在发送邀请...');
    const response = await workspaceFetch(`${apiBaseUrl}/api/orgs/${encodeURIComponent(selectedOrgId)}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: inviteUsername, role: inviteRole }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setOrgStatus(payload?.error?.message || '邀请失败');
      return;
    }
    const payload = await response.json();
    setOrgStatus(`已生成邀请：${payload.invite.username}，令牌 ${payload.invite.token}`);
    setInviteUsername('');
    await loadOrgDetail(selectedOrgId);
  };

  const acceptInvite = async () => {
    setOrgStatus('正在接受邀请...');
    const response = await workspaceFetch(`${apiBaseUrl}/api/orgs/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteTokenInput.trim() }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setOrgStatus(payload?.error?.message || '接受邀请失败');
      return;
    }
    setOrgStatus('已加入组织。');
    setInviteTokenInput('');
    await loadOrgs();
  };

  const shareCurrentTemplate = async () => {
    if (!selectedOrgId) return;
    setOrgStatus('正在共享当前任务为组织模板...');
    const response = await workspaceFetch(
      `${apiBaseUrl}/api/orgs/${encodeURIComponent(selectedOrgId)}/share/template`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setOrgStatus(payload?.error?.message || '共享失败');
      return;
    }
    const payload = await response.json();
    setOrgStatus(`已共享组织模板：${payload.template?.name || payload.template?.id}`);
  };

  const shareResource = async (resourceType: 'task' | 'dataset' | 'template', resourceId?: string) => {
    if (!selectedOrgId) return;
    setOrgStatus(`正在共享${resourceType}到组织...`);
    const response = await workspaceFetch(
      `${apiBaseUrl}/api/orgs/${encodeURIComponent(selectedOrgId)}/share/resource`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceType,
          resourceId: resourceId || undefined,
          permission: 'read',
        }),
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setOrgStatus(payload?.error?.message || payload?.detail || '资源共享失败');
      return;
    }
    const payload = await response.json();
    setOrgStatus(`已共享 ${resourceType}：${payload.share?.resourceId || ''}`);
  };

  const shareCurrentTask = async () => {
    await shareResource('task', 'active');
  };

  const shareActiveDataset = async () => {
    // Share currently bound dataset if present on active task.
    try {
      const response = await workspaceFetch(`${apiBaseUrl}/api/tasks/active`);
      if (!response.ok) throw new Error('active task unavailable');
      const task = await response.json();
      const datasetId = task?.dataSource?.id;
      if (!datasetId) {
        setOrgStatus('当前任务未绑定数据集，无法共享。');
        return;
      }
      await shareResource('dataset', String(datasetId));
    } catch {
      setOrgStatus('读取当前任务失败，无法共享数据集。');
    }
  };

  const changeOrgMemberRole = async (member: OrgMember, role: string) => {
    if (!selectedOrgId) return;
    const response = await workspaceFetch(
      `${apiBaseUrl}/api/orgs/${encodeURIComponent(selectedOrgId)}/members/${encodeURIComponent(member.userId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setOrgStatus(payload?.error?.message || '成员角色更新失败');
      return;
    }
    setOrgStatus(`已更新成员角色：${member.username} -> ${role}`);
    await loadOrgDetail(selectedOrgId);
  };

  return (
    <div className="workspace-grid compact-page">
      <section className="enterprise-page-hero">
        <span className="enterprise-page-kicker">系统设置 / 工作空间身份</span>
        <div className="enterprise-page-title-row">
          <div>
            <h3>工作空间与企业配置</h3>
            <p>管理登录态、JWT 作用域、RBAC 角色、组织协作，以及本地兼容模式下的租户/用户标识。</p>
          </div>
        </div>
      </section>

      <section className="enterprise-metric-strip">
        <article className="enterprise-metric-card">
          <span>默认租户</span>
          <strong>{DEFAULT_WORKSPACE_TENANT_ID}</strong>
          <small>本地单机模式默认值</small>
        </article>
        <article className="enterprise-metric-card">
          <span>默认用户</span>
          <strong>{DEFAULT_WORKSPACE_USER_ID}</strong>
          <small>本地单机模式默认值</small>
        </article>
        <article className="enterprise-metric-card">
          <span>当前生效</span>
          <strong>{`${tenantId} / ${userId}`}</strong>
          <small>{identityLocked ? '由 JWT 绑定' : '本地兼容模式'}</small>
        </article>
        <article className="enterprise-metric-card">
          <span>登录状态</span>
          <strong>{session ? roleLabel(session.user.role) : '本地模式'}</strong>
          <small>{session ? session.user.role : '兼容本地默认身份'}</small>
        </article>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">AU</span>
          <div>
            <h3>账号与 JWT</h3>
            <p>登录后后端将使用 token 中的 tenantId / userId / role，不再信任可伪造请求头。</p>
          </div>
        </div>
        {session ? (
          <div className="form-grid">
            <label className="field-label">
              <span>用户名</span>
              <input className="text-input" value={session.user.username} readOnly />
            </label>
            <label className="field-label">
              <span>显示名</span>
              <input className="text-input" value={session.user.displayName} readOnly />
            </label>
            <label className="field-label">
              <span>租户</span>
              <input className="text-input" value={session.user.tenantId} readOnly />
            </label>
            <label className="field-label">
              <span>角色</span>
              <input className="text-input" value={`${roleLabel(session.user.role)} (${session.user.role})`} readOnly />
            </label>
          </div>
        ) : (
          <p className="status-note">当前未登录。可前往登录页注册本地账号。</p>
        )}
        <div className="actions-row">
          {session ? (
            <button className="action-button secondary-button" type="button" onClick={logout}>
              退出登录
            </button>
          ) : (
            <button className="action-button" type="button" onClick={() => navigate('/login')}>
              去登录 / 注册
            </button>
          )}
        </div>
      </section>

      {session ? (
        <section className="content-card workspace-section">
          <div className="section-heading">
            <span className="section-index">ORG</span>
            <div>
              <h3>组织协作</h3>
              <p>创建组织、邀请成员、共享模板。组织成员可读取组织共享模板。</p>
            </div>
          </div>

          <div className="form-grid">
            <label className="field-label">
              <span>组织名称</span>
              <input className="text-input" value={orgName} onChange={(event) => setOrgName(event.target.value)} />
            </label>
            <label className="field-label">
              <span>组织标识（slug）</span>
              <input className="text-input" value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} />
            </label>
          </div>
          <div className="actions-row">
            <button className="action-button" type="button" onClick={() => void createOrg()}>
              创建组织
            </button>
            <button className="action-button secondary-button" type="button" onClick={() => void loadOrgs()}>
              刷新组织
            </button>
          </div>

          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="field-label">
              <span>当前组织</span>
              <select
                className="text-input"
                value={selectedOrgId}
                onChange={(event) => setSelectedOrgId(event.target.value)}
              >
                <option value="">请选择</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}（{org.memberRole || 'member'}）
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>接受邀请令牌</span>
              <input
                className="text-input"
                value={inviteTokenInput}
                onChange={(event) => setInviteTokenInput(event.target.value)}
                placeholder="粘贴邀请 token"
              />
            </label>
          </div>
          <div className="actions-row">
            <button className="action-button secondary-button" type="button" onClick={() => void acceptInvite()}>
              接受邀请
            </button>
            <button
              className="action-button"
              type="button"
              disabled={!selectedOrgId}
              onClick={() => void shareCurrentTemplate()}
            >
              共享当前任务为组织模板
            </button>
            <button
              className="action-button secondary-button"
              type="button"
              disabled={!selectedOrgId}
              onClick={() => void shareCurrentTask()}
            >
              共享当前任务到组织
            </button>
            <button
              className="action-button secondary-button"
              type="button"
              disabled={!selectedOrgId}
              onClick={() => void shareActiveDataset()}
            >
              共享当前数据集到组织
            </button>
          </div>

          {selectedOrgId ? (
            <>
              {canManageOrg ? (
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <label className="field-label">
                    <span>邀请用户名</span>
                    <input
                      className="text-input"
                      value={inviteUsername}
                      onChange={(event) => setInviteUsername(event.target.value)}
                      placeholder="member-b"
                    />
                  </label>
                  <label className="field-label">
                    <span>邀请角色</span>
                    <select
                      className="text-input"
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value)}
                    >
                      <option value="viewer">viewer</option>
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </label>
                  <div className="actions-row">
                    <button className="action-button" type="button" onClick={() => void inviteMember()}>
                      生成邀请
                    </button>
                  </div>
                </div>
              ) : (
                <p className="status-note">你是该组织成员，但不是管理员，无法邀请他人。</p>
              )}

              <div className="history-list" style={{ marginTop: 12 }}>
                {orgMembers.map((member) => (
                  <article className="history-card" key={member.id}>
                    <div className="history-card-header">
                      <h4>{member.displayName || member.username}</h4>
                      <span className="history-badge">{member.role}</span>
                    </div>
                    <p>{member.username}</p>
                    {canManageOrg && member.role !== 'owner' ? (
                      <label className="field-label">
                        <span>成员角色</span>
                        <select
                          className="text-input"
                          value={member.role}
                          onChange={(event) => void changeOrgMemberRole(member, event.target.value)}
                        >
                          <option value="viewer">viewer</option>
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      </label>
                    ) : null}
                  </article>
                ))}
              </div>

              {orgInvites.length > 0 ? (
                <div className="history-list" style={{ marginTop: 12 }}>
                  {orgInvites.map((invite) => (
                    <article className="history-card" key={invite.id}>
                      <div className="history-card-header">
                        <h4>{invite.username}</h4>
                        <span className="history-badge">{invite.role}</span>
                      </div>
                      <p className="status-note">token: {invite.token}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="status-note">还没有组织。可先创建一个组织，或接受邀请令牌加入。</p>
          )}
          {orgStatus ? <p className="status-note">{orgStatus}</p> : null}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="content-card workspace-section">
          <div className="section-heading">
            <span className="section-index">RB</span>
            <div>
              <h3>角色权限管理</h3>
              <p>admin 可管理同租户用户角色：viewer（只读）/ analyst（可写）/ admin（管理）。</p>
            </div>
          </div>
          <div className="history-list">
            {users.map((user) => (
              <article className="history-card" key={user.id}>
                <div className="history-card-header">
                  <h4>{user.displayName || user.username}</h4>
                  <span className="history-badge">{roleLabel(user.role)}</span>
                </div>
                <p>{`${user.username} · ${user.tenantId}`}</p>
                <div className="actions-row">
                  <label className="field-label">
                    <span>角色</span>
                    <select
                      className="text-input"
                      value={user.role}
                      onChange={(event) => void changeRole(user, event.target.value)}
                    >
                      <option value="viewer">viewer · 只读</option>
                      <option value="analyst">analyst · 可写</option>
                      <option value="admin">admin · 管理</option>
                    </select>
                  </label>
                </div>
              </article>
            ))}
            {users.length === 0 ? <p className="status-note">暂无用户，或当前账号无权查看。</p> : null}
          </div>
          {usersStatus ? <p className="status-note">{usersStatus}</p> : null}
        </section>
      ) : null}

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">ST</span>
          <div>
            <h3>工作空间身份（兼容模式）</h3>
            <p>仅在未登录时生效。登录后由 JWT 强制绑定，防止伪造租户/用户。</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field-label">
            <span>租户 ID</span>
            <input
              className="text-input"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="例如：tenant-a"
              disabled={identityLocked}
            />
          </label>
          <label className="field-label">
            <span>用户 ID</span>
            <input
              className="text-input"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="例如：analyst-a"
              disabled={identityLocked}
            />
          </label>
        </div>
        <div className="actions-row">
          <button className="action-button" type="button" onClick={saveIdentity} disabled={identityLocked}>
            保存并立即生效
          </button>
          <button className="action-button secondary-button" type="button" onClick={resetIdentity} disabled={identityLocked}>
            恢复默认值
          </button>
        </div>
        <p className="status-note">普通接口会自动附带请求头；下载链接会自动附带同名查询参数与 accessToken。</p>
        {status ? <p className="status-note">{status}</p> : null}
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">EG</span>
          <div>
            <h3>企业级基础能力</h3>
            <p>当前已落地的企业化基础设施状态。</p>
          </div>
        </div>
        <ul className="context-risk-list">
          <li>
            <span className="status-chip status-chip-success">已完成</span> 本地账号注册/登录 + JWT scope 绑定
          </li>
          <li>
            <span className="status-chip status-chip-success">已完成</span> RBAC：viewer / analyst / admin
          </li>
          <li>
            <span className="status-chip status-chip-success">已完成</span> 组织协作：创建 / 邀请 / 共享模板
          </li>
          <li>
            <span className="status-chip status-chip-success">已完成</span> 组织级任务/数据集共享
          </li>
          <li>
            <span className="status-chip status-chip-success">已完成</span> 生产安全基线、对象存储、备份恢复、SSE
          </li>
          <li>
            <span className="status-chip status-chip-success">已完成</span> SSO（OIDC）登录入口
          </li>
          <li>
            <span className="status-chip status-chip-success">已完成</span> 蓝绿发布脚本
          </li>
          <li>
            <span className="status-chip">下一步</span> 完整项目空间权限矩阵 / 合规增强
          </li>
        </ul>
      </section>
    </div>
  );
}

export default SettingsPage;
