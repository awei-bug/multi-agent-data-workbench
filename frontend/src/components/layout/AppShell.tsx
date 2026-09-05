import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import MainFlowGuideBar from './MainFlowGuideBar';
import { useWorkbenchShell } from '../../context/WorkbenchShellContext';
import { currentAuthUser, roleLabel } from '../../utils/permissions';
import { logoutSession } from '../../utils/workspaceIdentity';
import { buildMainFlowGuide } from '../../utils/mainFlowGuide';

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

const primaryNav: NavItem[] = [
  {
    path: '/dashboard',
    icon: '·',
    label: '开始',
    title: '开始分析',
  },
  {
    path: '/data-sources',
    icon: '·',
    label: '上传数据',
    title: '上传数据',
  },
  {
    path: '/workspace',
    icon: '·',
    label: '做分析',
    title: '做分析',
    match: (pathname) => pathname.startsWith('/workspace'),
  },
  {
    path: '/reports',
    icon: '·',
    label: '看结果',
    title: '看结果',
  },
];

const moreNav: NavItem[] = [
  { path: '/history', icon: '·', label: '历史', title: '历史记录' },
  { path: '/templates', icon: '·', label: '模板', title: '常用模板' },
  { path: '/chat-analysis', icon: '·', label: '图表', title: '图表查看' },
  { path: '/settings', icon: '·', label: '设置', title: '设置' },
];

const allRoutes = [...primaryNav, ...moreNav];

function resolveWorkspaceNavPath(phase?: string) {
  if (phase === 'running' || phase === 'paused' || phase === 'failed') return '/workspace?step=execution';
  if (phase === 'completed' || phase === 'needs_review' || phase === 'stopped') return '/workspace?step=output';
  return '/workspace?step=input';
}

type AppShellProps = { children: ReactNode };

function shortPrimaryLabel(label: string) {
  if (label.includes('上传')) return '去上传';
  if (label.includes('填写') || label.includes('问题')) return '去提问';
  if (label.includes('开始分析') || label.includes('分析')) return '去分析';
  if (label.includes('结果') || label.includes('查看')) return '看结果';
  if (label.includes('进度')) return '看进度';
  return '继续';
}

function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeTask } = useWorkbenchShell();
  const authUser = currentAuthUser();
  const inWorkspace = location.pathname.startsWith('/workspace');
  const currentRoute =
    allRoutes.find((route) => (route.match ? route.match(location.pathname) : route.path === location.pathname)) ??
    primaryNav[0];
  const workspaceNavPath = resolveWorkspaceNavPath(String(activeTask.snapshot?.phase || ''));
  const guide = buildMainFlowGuide(activeTask);
  const hasDataSource = Boolean(activeTask.dataSource);
  const isDashboard = location.pathname.startsWith('/dashboard');
  const hideGuideBar = location.pathname.startsWith('/settings') || isDashboard;
  const pageToneClass = (() => {
    const p = location.pathname;
    if (p.startsWith('/dashboard')) return 'tone-home';
    if (p.startsWith('/data-sources')) return 'tone-data';
    if (p.startsWith('/workspace')) return 'tone-work';
    if (p.startsWith('/reports')) return 'tone-result';
    if (p.startsWith('/settings')) return 'tone-settings';
    if (p.startsWith('/history')) return 'tone-history';
    if (p.startsWith('/templates')) return 'tone-templates';
    if (p.startsWith('/chat-analysis')) return 'tone-chart';
    return 'tone-default';
  })();

  const renderNavItems = (items: NavItem[]) =>
    items.map((route) => {
      const isActive = route.match ? route.match(location.pathname) : location.pathname === route.path;
      const target = route.path === '/workspace' ? workspaceNavPath : route.path;
      return (
        <NavLink
          key={route.path}
          to={target}
          end={route.path !== '/workspace'}
          className={() => `sidebar-link-ops${isActive ? ' active' : ''}`}
          aria-current={isActive ? 'page' : undefined}
        >
          <span className="sidebar-link-icon" aria-hidden="true">
            {route.icon}
          </span>
          <span>{route.label}</span>
        </NavLink>
      );
    });

  return (
    <div className={`app-shell app-shell-ops app-shell-simple ${pageToneClass}`}>
      <aside className="sidebar sidebar-ops">
        <div className="brand-block">
          <span className="brand-mark">MA</span>
          <div>
            <h1 className="app-title">数据分析助手</h1>
            <p className="sidebar-brand-sub">上传 · 提问 · 结果</p>
          </div>
        </div>

        <button className="sidebar-primary-cta" type="button" onClick={() => navigate(guide.primaryPath)} title={guide.primaryLabel}>
          <span>{guide.primaryLabel}</span>
          <small>{guide.currentStep.label} · {guide.progressPercent}%</small>
        </button>

        <nav className="sidebar-nav-ops" aria-label="主要操作">
          <section className="sidebar-nav-group">
            <p className="sidebar-nav-group-title">主流程</p>
            <div className="sidebar-nav-group-list sidebar-nav-group-list-simple">{renderNavItems(primaryNav)}</div>
          </section>
          <section className="sidebar-nav-group">
            <p className="sidebar-nav-group-title">更多</p>
            <div className="sidebar-nav-group-list sidebar-nav-group-list-simple">{renderNavItems(moreNav)}</div>
          </section>
        </nav>

        <section className="sidebar-task-card sidebar-task-card-ops" aria-label="当前进度">
          <div className="sidebar-task-head">
            <span>当前进度</span>
            <em>{guide.currentStep.label}</em>
          </div>
          <strong>{activeTask.name || '我的分析'}</strong>
          {activeTask.dataSource ? (
            <small>数据：{activeTask.dataSource.fileName}</small>
          ) : (
            <small className="sidebar-task-warn">还没上传数据</small>
          )}
          <div className="sidebar-task-actions sidebar-task-actions-single">
            <button type="button" onClick={() => navigate(guide.primaryPath)} title={guide.primaryLabel}>
              {shortPrimaryLabel(guide.primaryLabel)}
            </button>
          </div>
        </section>

        <section className="sidebar-account-card" aria-label="账号">
          <div className="sidebar-account-copy">
            <span>当前账号</span>
            <strong>{authUser ? authUser.displayName || authUser.username : '未登录'}</strong>
            <small>
              {authUser ? `${authUser.username} · ${roleLabel(authUser.role)}` : '本地模式（可去设置登录）'}
            </small>
          </div>
          <div className="sidebar-account-actions">
            <button type="button" className="sidebar-account-settings" onClick={() => navigate('/settings')}>
              设置
            </button>
            {authUser ? (
              <button
                type="button"
                className="sidebar-account-logout"
                onClick={() => {
                  const confirmed = window.confirm('确认退出当前账号吗？');
                  if (!confirmed) return;
                  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
                  void logoutSession(apiBaseUrl).finally(() => {
                    navigate('/login', { replace: true });
                  });
                }}
              >
                退出登录
              </button>
            ) : (
              <button type="button" className="sidebar-account-logout" onClick={() => navigate('/login')}>
                去登录
              </button>
            )}
          </div>
        </section>
      </aside>

      <main className="main-panel main-panel-ops main-panel-tinted">
        <header className="topbar topbar-ops">
          <div className="topbar-copy">
            <div className="breadcrumb-row">
              <span>{currentRoute.label}</span>
              {inWorkspace ? <span className="breadcrumb-sep">/</span> : null}
              {inWorkspace ? <span>按步骤完成</span> : null}
            </div>
            <h2 className="panel-title">{inWorkspace ? '做分析' : currentRoute.title}</h2>
          </div>

          <div className="topbar-ops-actions">
            {!isDashboard ? (
              <button className="action-button" type="button" onClick={() => navigate(guide.primaryPath)}>
                {guide.primaryLabel}
              </button>
            ) : null}
            {authUser ? (
              <button
                className="tool-button topbar-logout-button"
                type="button"
                onClick={() => {
                  const confirmed = window.confirm('确认退出当前账号吗？');
                  if (!confirmed) return;
                  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
                  void logoutSession(apiBaseUrl).finally(() => {
                    navigate('/login', { replace: true });
                  });
                }}
              >
                退出登录
              </button>
            ) : (
              <button className="tool-button" type="button" onClick={() => navigate('/login')}>
                去登录
              </button>
            )}
          </div>
        </header>

        {!hideGuideBar ? <MainFlowGuideBar guide={guide} compact /> : null}

        {!hasDataSource &&
        !location.pathname.startsWith('/data-sources') &&
        !location.pathname.startsWith('/settings') &&
        !location.pathname.startsWith('/dashboard') ? (
          <div className="ops-guide-banner">
            <div>
              <strong>还差一步就能开始</strong>
              <p>先上传一份表格或文档。上传后，系统会带你填写问题并自动分析。</p>
            </div>
            <button className="action-button" type="button" onClick={() => navigate('/data-sources')}>
              去上传数据
            </button>
          </div>
        ) : null}

        {children}
      </main>
    </div>
  );
}

export default AppShell;
