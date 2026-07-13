import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import { useWorkbenchShell } from '../../context/WorkbenchShellContext';
import { currentAuthUser, roleLabel } from '../../utils/permissions';

type NavItem = {
  path: string;
  icon: string;
  label: string;
  title: string;
  match?: (pathname: string) => boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    title: '主流程',
    items: [
      {
        path: '/workspace',
        icon: 'WB',
        label: '分析工作台',
        title: '分析工作台',
        match: (pathname) => pathname.startsWith('/workspace'),
      },
      {
        path: '/data-sources',
        icon: 'DS',
        label: '数据源',
        title: '数据源管理',
      },
    ],
  },
  {
    title: '交付资产',
    items: [
      { path: '/reports', icon: 'RC', label: '报告中心', title: '报告中心' },
      { path: '/history', icon: 'HT', label: '历史任务', title: '历史任务' },
      { path: '/templates', icon: 'TP', label: '模板库', title: '模板库' },
    ],
  },
  {
    title: '管理',
    items: [
      { path: '/dashboard', icon: 'OV', label: '总览', title: '总览仪表盘' },
      { path: '/chat-analysis', icon: 'IA', label: '数据洞察', title: '数据洞察' },
      { path: '/settings', icon: 'ST', label: '设置', title: '系统设置' },
    ],
  },
];

const allRoutes = navGroups.flatMap((group) => group.items);

function resolveWorkspacePath(phase?: string) {
  if (phase === 'running' || phase === 'paused' || phase === 'failed') return '/workspace?step=execution';
  if (phase === 'completed' || phase === 'needs_review' || phase === 'stopped') return '/workspace?step=output';
  return '/workspace?step=input';
}

type AppShellProps = { children: ReactNode };

function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeTask } = useWorkbenchShell();
  const authUser = currentAuthUser();
  const inWorkspace = location.pathname.startsWith('/workspace');
  const currentRoute =
    allRoutes.find((route) => (route.match ? route.match(location.pathname) : route.path === location.pathname)) ??
    allRoutes[0];
  const continuePath = resolveWorkspacePath(String(activeTask.snapshot?.phase || ''));
  const hasDataSource = Boolean(activeTask.dataSource);
  const nextHint = !hasDataSource
    ? '先接入数据源'
    : activeTask.snapshot.phase === 'idle'
      ? '准备分析需求'
      : activeTask.snapshot.phase === 'running'
        ? '查看执行进度'
        : '查看报告交付';

  return (
    <div className="app-shell app-shell-ops">
      <aside className="sidebar sidebar-ops">
        <div className="brand-block">
          <span className="brand-mark">MA</span>
          <div>
            <h1 className="app-title">多 Agent 数据分析</h1>
            <p className="sidebar-brand-sub">数据 → 分析 → 交付</p>
          </div>
        </div>

        <button className="sidebar-primary-cta" type="button" onClick={() => navigate(continuePath)}>
          <span>继续当前分析</span>
          <small>{nextHint}</small>
        </button>

        <nav className="sidebar-nav-ops" aria-label="主导航">
          {navGroups.map((group) => (
            <section key={group.title} className="sidebar-nav-group">
              <p className="sidebar-nav-group-title">{group.title}</p>
              <div className="sidebar-nav-group-list">
                {group.items.map((route) => {
                  const isActive = route.match
                    ? route.match(location.pathname)
                    : location.pathname === route.path;
                  return (
                    <NavLink
                      key={route.path}
                      to={route.path === '/workspace' ? continuePath : route.path}
                      className={`sidebar-link-ops${isActive ? ' active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className="sidebar-link-icon" aria-hidden="true">
                        {route.icon}
                      </span>
                      <span>{route.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <section className="sidebar-task-card sidebar-task-card-ops" aria-label="当前任务概览">
          <div className="sidebar-task-head">
            <span>当前任务</span>
            <em>{activeTask.status}</em>
          </div>
          <strong>{activeTask.name}</strong>
          {activeTask.dataSource ? (
            <small>数据源：{activeTask.dataSource.fileName}</small>
          ) : (
            <small className="sidebar-task-warn">尚未绑定数据源</small>
          )}
          <div className="sidebar-task-actions">
            <button type="button" onClick={() => navigate('/data-sources')}>
              数据源
            </button>
            <button type="button" onClick={() => navigate(continuePath)}>
              进入工作台
            </button>
          </div>
          <small className="sidebar-user-line">
            {authUser ? `${authUser.username} · ${roleLabel(authUser.role)}` : '本地模式'}
          </small>
        </section>
      </aside>

      <main className="main-panel main-panel-ops">
        <header className="topbar topbar-ops">
          <div className="topbar-copy">
            <div className="breadcrumb-row">
              <span>{currentRoute.label}</span>
              {inWorkspace ? <span className="breadcrumb-sep">/</span> : null}
              {inWorkspace ? <span>三步向导</span> : null}
            </div>
            <h2 className="panel-title">{inWorkspace ? '分析工作台' : currentRoute.title}</h2>
          </div>

          <div className="topbar-ops-actions">
            <button className="tool-button" type="button" onClick={() => navigate('/data-sources')}>
              数据源
            </button>
            <button className="action-button" type="button" onClick={() => navigate(continuePath)}>
              继续分析
            </button>
          </div>
        </header>

        {!hasDataSource &&
        !location.pathname.startsWith('/data-sources') &&
        !location.pathname.startsWith('/settings') ? (
          <div className="ops-guide-banner">
            <div>
              <strong>建议操作路径</strong>
              <p>数据源 → 分析工作台（输入）→ 执行 → 报告交付。当前还没有绑定数据源。</p>
            </div>
            <button className="action-button" type="button" onClick={() => navigate('/data-sources')}>
              去接入数据
            </button>
          </div>
        ) : null}

        {children}
      </main>
    </div>
  );
}

export default AppShell;
