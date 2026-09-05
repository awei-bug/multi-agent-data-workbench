import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import EmptyState from '../components/feedback/EmptyState';
import FlowAlert from '../components/feedback/FlowAlert';
import { usePageFeedback } from '../components/feedback/usePageFeedback';
import {
  DEFAULT_WORKSPACE_TENANT_ID,
  DEFAULT_WORKSPACE_USER_ID,
  getAuthSession,
  getWorkspaceIdentity,
  logoutSession,
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
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const session = getAuthSession();
  const current = getWorkspaceIdentity();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [tenantId, setTenantId] = useState(current.tenantId);
  const [userId, setUserId] = useState(current.userId);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const identityFeedback = usePageFeedback();
  const usersFeedback = usePageFeedback();
  const orgFeedback = usePageFeedback();
  const { status, statusTone, setStatus, notify: notifyIdentity } = identityFeedback;
  const { status: usersStatus, statusTone: usersStatusTone, setStatus: setUsersStatus, notify: notifyUsers } = usersFeedback;
  const { status: orgStatus, statusTone: orgStatusTone, setStatus: setOrgStatus, notify: notifyOrg } = orgFeedback;

  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [orgInvites, setOrgInvites] = useState<OrgInvite[]>([]);
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
      .catch(() => notifyUsers('无法加载用户列表', { tone: 'danger' }));
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
      notifyOrg('无法加载组织列表', { tone: 'danger' });
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
      notifyOrg('无法加载组织详情', { tone: 'danger' });
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
      notifyIdentity('无法修改作用域', { description: '已登录状态下由 JWT 决定，不能手动覆盖。', tone: 'warn' });
      return;
    }
    const next = saveWorkspaceIdentity({ tenantId, userId });
    setTenantId(next.tenantId);
    setUserId(next.userId);
    notifyIdentity('工作空间已保存', { description: `${next.tenantId} / ${next.userId}`, tone: 'success' });
  };

  const resetIdentity = () => {
    if (identityLocked) {
      notifyIdentity('无法修改作用域', { description: '已登录状态下由 JWT 决定，不能手动覆盖。', tone: 'warn' });
      return;
    }
    const confirmed = window.confirm('确认恢复默认本地工作空间身份吗？');
    if (!confirmed) {
      notifyIdentity('已取消恢复默认值', { tone: 'info' });
      return;
    }
    const next = resetWorkspaceIdentity();
    setTenantId(next.tenantId);
    setUserId(next.userId);
    notifyIdentity('已恢复默认本地工作空间', { tone: 'success' });
  };

  const logout = () => {
    const confirmed = window.confirm('确认退出当前账号吗？未保存的本地草稿不会自动上传。');
    if (!confirmed) return;
    const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
    void logoutSession(apiBaseUrl).finally(() => {
      onLoggedOut?.();
      notifyIdentity('已退出登录', { tone: 'info', keepStatus: false });
      navigate('/login', { replace: true });
    });
  };

  const changeRole = async (user: ManagedUser, role: string) => {
    if (role === user.role) return;
    const confirmed = window.confirm(`确认将 ${user.username} 的角色调整为 ${roleLabel(role)} 吗？`);
    if (!confirmed) {
      notifyUsers('已取消角色变更', { tone: 'info' });
      return;
    }
    setUsersStatus('正在更新角色...', 'info');
    const response = await workspaceFetch(`${apiBaseUrl}/api/auth/users/${encodeURIComponent(user.id)}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      notifyUsers('角色更新失败', { description: payload?.error?.message, tone: 'danger' });
      return;
    }
    const payload = await response.json();
    setUsers((currentUsers) =>
      currentUsers.map((item) =>
        item.id === user.id ? { ...item, role: payload.user.role, permissions: payload.user.permissions } : item,
      ),
    );
    notifyUsers('角色已更新', { description: `${user.username} → ${roleLabel(role)}`, tone: 'success' });
  };

  const createOrg = async () => {
    setOrgStatus('正在创建组织...', 'info');
    const response = await workspaceFetch(`${apiBaseUrl}/api/orgs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: orgName, slug: orgSlug }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      notifyOrg('创建组织失败', { description: payload?.error?.message, tone: 'danger' });
      return;
    }
    const payload = await response.json();
    notifyOrg('组织已创建', { description: payload.organization.name, tone: 'success' });
    await loadOrgs();
    setSelectedOrgId(payload.organization.id);
  };

  const inviteMember = async () => {
    if (!selectedOrgId) return;
    setOrgStatus('正在发送邀请...', 'info');
    const response = await workspaceFetch(`${apiBaseUrl}/api/orgs/${encodeURIComponent(selectedOrgId)}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: inviteUsername, role: inviteRole }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      notifyOrg('邀请失败', { description: payload?.error?.message, tone: 'danger' });
      return;
    }
    const payload = await response.json();
    notifyOrg('邀请已生成', { description: `${payload.invite.username} · ${payload.invite.token}`, tone: 'success' });
    setInviteUsername('');
    await loadOrgDetail(selectedOrgId);
  };

  const acceptInvite = async () => {
    setOrgStatus('正在接受邀请...', 'info');
    const response = await workspaceFetch(`${apiBaseUrl}/api/orgs/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteTokenInput.trim() }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      notifyOrg('接受邀请失败', { description: payload?.error?.message, tone: 'danger' });
      return;
    }
    notifyOrg('已加入组织', { tone: 'success' });
    setInviteTokenInput('');
    await loadOrgs();
  };

  const shareCurrentTemplate = async () => {
    if (!selectedOrgId) return;
    setOrgStatus('正在共享当前任务为组织模板...', 'info');
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
      notifyOrg('共享失败', { description: payload?.error?.message, tone: 'danger' });
      return;
    }
    const payload = await response.json();
    notifyOrg('模板已共享到组织', { description: payload.template?.name || payload.template?.id, tone: 'success' });
  };

  const shareResource = async (resourceType: 'task' | 'dataset' | 'template', resourceId?: string) => {
    if (!selectedOrgId) return;
    setOrgStatus(`正在共享${resourceType}到组织...`, 'info');
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
      notifyOrg('资源共享失败', { description: payload?.error?.message || payload?.detail, tone: 'danger' });
      return;
    }
    const payload = await response.json();
    notifyOrg('资源已共享到组织', { description: `${resourceType} ${payload.share?.resourceId || ''}`.trim(), tone: 'success' });
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
        notifyOrg('无法共享数据集', { description: '当前任务未绑定数据集。', tone: 'warn' });
        return;
      }
      await shareResource('dataset', String(datasetId));
    } catch {
      notifyOrg('无法共享数据集', { description: '读取当前任务失败。', tone: 'danger' });
    }
  };

  const changeOrgMemberRole = async (member: OrgMember, role: string) => {
    if (!selectedOrgId) return;
    if (role === member.role) return;
    const confirmed = window.confirm(`确认将成员 ${member.username} 调整为 ${role} 吗？`);
    if (!confirmed) {
      notifyOrg('已取消成员角色变更', { tone: 'info' });
      return;
    }
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
      notifyOrg('成员角色更新失败', { description: payload?.error?.message, tone: 'danger' });
      return;
    }
    notifyOrg('成员角色已更新', { description: `${member.username} → ${role}`, tone: 'success' });
    await loadOrgDetail(selectedOrgId);
  };

  return (
    <div className="workspace-grid compact-page settings-page page-tint-settings">
      <section className="enterprise-page-hero">
        <div className="enterprise-page-title-row">
          <div>
            <h3>设置</h3>
            <p>查看当前账号，需要换人使用时点「退出登录」。</p>
          </div>
          <div className="enterprise-page-actions">
            {session ? (
              <button className="action-button secondary-button settings-logout-btn" type="button" onClick={logout}>
                退出登录
              </button>
            ) : (
              <button className="action-button" type="button" onClick={() => navigate('/login')}>
                去登录 / 注册
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="enterprise-metric-strip">
        <article className={`enterprise-metric-card metric-tone-${session ? 'success' : 'warn'}`}>
          <span>登录状态</span>
          <strong>{session ? '已登录' : '未登录'}</strong>
          <small>{session ? '可以正常使用分析功能' : '部分功能可能受限'}</small>
        </article>
        <article className="enterprise-metric-card metric-tone-accent">
          <span>当前账号</span>
          <strong>{session ? (session.user.displayName || session.user.username) : '访客'}</strong>
          <small>{session ? session.user.username : '登录后显示'}</small>
        </article>
        <article className="enterprise-metric-card metric-tone-teal">
          <span>角色</span>
          <strong>{session ? roleLabel(session.user.role) : '本地模式'}</strong>
          <small>{session ? '决定可编辑范围' : '未登录兼容模式'}</small>
        </article>
        <article className="enterprise-metric-card metric-tone-sand">
          <span>团队</span>
          <strong>{session ? session.user.tenantId : DEFAULT_WORKSPACE_TENANT_ID}</strong>
          <small>个人使用保持默认即可</small>
        </article>
      </section>

      <section className="content-card workspace-section settings-account-card">
        <div className="settings-profile-band">
          <div className="settings-profile-avatar" aria-hidden="true">
            {(session?.user.displayName || session?.user.username || '访')[0]?.toUpperCase()}
          </div>
          <div>
            <h3>我的账号</h3>
            <p>这是你当前登录的身份信息。普通使用只需关心这里。</p>
          </div>
        </div>
        <div className="section-heading settings-account-heading-spacer">
          <div />
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
              <span>团队标识</span>
              <input className="text-input" value={session.user.tenantId} readOnly />
            </label>
            <label className="field-label">
              <span>角色</span>
              <input className="text-input" value={`${roleLabel(session.user.role)} (${session.user.role})`} readOnly />
            </label>
          </div>
        ) : (
          <EmptyState
            icon="AU"
            title="当前未登录"
            description="登录后可保存分析记录，并按账号隔离数据。"
            primaryLabel="去登录 / 注册"
            onPrimary={() => navigate('/login')}
          />
        )}
        <div className="actions-row">
          {session ? (
            <button className="action-button secondary-button settings-logout-btn" type="button" onClick={logout}>
              退出当前账号
            </button>
          ) : (
            <button className="action-button" type="button" onClick={() => navigate('/login')}>
              去登录 / 注册
            </button>
          )}
        </div>
      </section>

      <section className="content-card workspace-section settings-advanced-card">
        <div className="section-heading">
          <div>
            <h3>高级设置</h3>
            <p>组织协作、权限、底层身份绑定等。日常分析不需要打开。</p>
          </div>
        </div>
        <div className="actions-row">
          <button
            className="action-button secondary-button"
            type="button"
            onClick={() => setShowAdvancedSettings((v) => !v)}
          >
            {showAdvancedSettings ? '收起高级设置' : '展开高级设置'}
          </button>
        </div>
      </section>

      {showAdvancedSettings ? (
      <>
      {session ? (
        <section className="content-card workspace-section">
          <div className="section-heading">
          <div>
              <h3>组织协作</h3>
              <p>创建组织、邀请成员、共享模板。组织成员可读取组织共享模板。</p>
            </div>
          </div>

          <div className="form-grid" id="org-create-form">
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
                <EmptyState
              icon="LOCK"
              title="当前无权管理组织成员"
              description="只有组织 owner / admin 可以邀请成员、改角色和共享资源。"
              tone="warn"
            />
              )}

              <div className="history-list" style={{ marginTop: 12 }}>
                {orgMembers.length === 0 ? (
                  <EmptyState
                    icon="MB"
                    title="暂无组织成员"
                    description="可通过邀请令牌添加成员，或等待对方接受邀请。"
                  />
                ) : null}
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
            <EmptyState
              icon="ORG"
              title="还没有组织"
              description="先创建一个组织，或使用邀请令牌加入后，才能共享模板与任务。"
              primaryLabel="滚动到创建组织"
              onPrimary={() => document.getElementById('org-create-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
          )}
          {orgStatus ? (
            <FlowAlert
              tone={orgStatusTone}
              title={orgStatus}
              description={orgStatusTone === 'danger' ? '请检查权限、网络或输入后重试。' : undefined}
            />
          ) : null}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="content-card workspace-section">
          <div className="section-heading">
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
            {users.length === 0 ? (
            <EmptyState
              icon="RB"
              title="暂无用户可管理"
              description="当前租户还没有其他用户，或你的账号无权查看用户列表。"
              tone="warn"
            />
          ) : null}
          </div>
          {usersStatus ? (
          <FlowAlert
            tone={usersStatusTone}
            title={usersStatus}
            description={usersStatusTone === 'danger' ? '角色变更未生效，请确认你具备 admin 权限。' : undefined}
          />
        ) : null}
        </section>
      ) : null}

      <section className="content-card workspace-section">
        <div className="section-heading">
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
        {status ? (
          <FlowAlert
            tone={statusTone}
            title={status}
            description={statusTone === 'warn' ? '登录后作用域由 JWT 强制绑定。' : undefined}
          />
        ) : null}
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
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
      </>
      ) : null}
    </div>
  );
}

export default SettingsPage;
