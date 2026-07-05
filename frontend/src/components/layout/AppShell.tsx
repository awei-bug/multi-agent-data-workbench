import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useWorkbenchShell } from '../../context/WorkbenchShellContext';
import ContextPanel from './ContextPanel';

const routeMeta: Record<string, { icon: string; label: string; crumb: string; title: string }> = {
  '/dashboard': { icon: '01', label: '总览仪表盘', crumb: '平台总览', title: '总览仪表盘' },
  '/workspace': { icon: '02', label: '智能体工作台', crumb: '新建任务', title: '多 Agent 主流程' },
  '/chat-analysis': { icon: '03', label: '对话分析', crumb: '对话分析', title: '对话分析' },
  '/workflow-designer': { icon: '04', label: '工作流画布', crumb: '流程编排', title: '工作流画布' },
  '/data-sources': { icon: '05', label: '数据集管理', crumb: '数据接入', title: '数据源管理' },
  '/reports': { icon: '06', label: '报告中心', crumb: '报告管理', title: '报告中心' },
  '/templates': { icon: '07', label: '模板库', crumb: '模板复用', title: '模板库' },
  '/history': { icon: '08', label: '历史会话', crumb: '历史回放', title: '历史任务' },
  '/workspace-async': { icon: '09', label: '异步沙箱', crumb: '异步沙箱', title: '异步工作台沙箱' },
  '/settings': { icon: '10', label: '系统设置', crumb: '系统设置', title: '系统设置' },
};

type AppShellProps = {
  children: ReactNode;
  focusedNodeId?: string | null;
  routePath?: string;
  onRouteChange?: (path: string) => void;
};

function AppShell({ children, focusedNodeId = null, routePath, onRouteChange }: AppShellProps) {
  const { context, activeTask } = useWorkbenchShell();
  const location = useLocation();
  const navigate = useNavigate();
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTool, setActiveTool] = useState<'notifications' | 'help' | null>(null);
  const [apiSearchResults, setApiSearchResults] = useState<Array<{ kind: string; id: string; name: string }>>([]);
  const [notifications, setNotifications] = useState<Array<{ id: string; level: string; message: string }>>([]);
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;
  const activePath = routePath ?? location.pathname;
  const currentRoute = routeMeta[activePath] ?? routeMeta['/workspace'];
  const finishedNodes = activeTask.snapshot.nodes.filter((node) => node.status === 'success').length;
  const runningNode = activeTask.snapshot.nodes.find((node) => node.status === 'running');
  const searchResults = Object.entries(routeMeta).filter(([, meta]) => meta.label.includes(searchQuery) || meta.title.includes(searchQuery));
  const goToSearchResult = (kind: string) => {
    if (kind === 'dataset') navigateTo('/data-sources');
    else if (kind === 'template') navigateTo('/templates');
    else navigateTo('/history');
  };

  useEffect(() => {
    if (!apiBaseUrl || !searchQuery.trim()) {
      setApiSearchResults([]);
      return;
    }
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/api/search?query=${encodeURIComponent(searchQuery)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((results) => setApiSearchResults(results))
      .catch(() => setApiSearchResults([]));
    return () => controller.abort();
  }, [apiBaseUrl, searchQuery]);

  useEffect(() => {
    if (!apiBaseUrl || activeTool !== 'notifications') return;
    let cancelled = false;
    void fetch(`${apiBaseUrl}/api/notifications`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items) => {
        if (!cancelled) setNotifications(items);
      })
      .catch(() => {
        if (!cancelled) setNotifications([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTool, apiBaseUrl]);

  const navigateTo = (path: string) => {
    navigate(path);
    onRouteChange?.(path);
  };

  const emitWorkspaceAction = (action: 'load-sample' | 'start' | 'focus-export') => {
    if (activePath !== '/workspace') {
      navigate({ pathname: '/workspace', hash: `#${action}` });
      onRouteChange?.('/workspace');
      return;
    }

    window.dispatchEvent(new CustomEvent(`workspace:${action}`));
  };

  return (
    <div className={`app-shell${contextCollapsed ? ' app-shell-context-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand-block">
          <span className="brand-mark">MA</span>
          <h1 className="app-title">多 Agent 数据分析工作台</h1>
        </div>
        <div className="sidebar-intro">
          <span className="context-label">工作流状态</span>
          <strong>{activeTask.status}</strong>
          <p>{currentRoute.title}</p>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {Object.entries(routeMeta).map(([path, meta]) => (
            <button
              key={path}
              className={`sidebar-link${activePath === path ? ' active' : ''}`}
              type="button"
              aria-current={activePath === path ? 'page' : undefined}
              onClick={() => navigateTo(path)}
            >
              <span className="sidebar-link-icon" aria-hidden="true">
                {meta.icon}
              </span>
              <span>{meta.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">任务工作区</p>
            <div className="breadcrumb-row">
              <span>{`任务工作区 / ${currentRoute.crumb} / ${currentRoute.title}`}</span>
            </div>
            <h2 className="panel-title">{currentRoute.title}</h2>
          </div>
          <div className="topbar-tools" aria-label="全局工具">
            <label className="topbar-search">
              <span className="sr-only">全局搜索</span>
              <input
                type="search"
                placeholder="搜索任务、数据集、报告"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery ? (
                <div className="topbar-popover">
                  {apiSearchResults.length > 0 ? (
                    apiSearchResults.map((item) => (
                      <button key={`${item.kind}-${item.id}`} type="button" onClick={() => goToSearchResult(item.kind)}>
                        {item.name}
                      </button>
                    ))
                  ) : searchResults.length > 0 ? (
                    searchResults.map(([path, meta]) => (
                      <button key={path} type="button" onClick={() => navigateTo(path)}>
                        {meta.label}
                      </button>
                    ))
                  ) : (
                    <span>没有匹配结果</span>
                  )}
                </div>
              ) : null}
            </label>
            <button
              className="tool-button"
              type="button"
              aria-label="消息通知"
              onClick={() => setActiveTool((current) => (current === 'notifications' ? null : 'notifications'))}
            >
              通知
            </button>
            <button
              className="tool-button"
              type="button"
              aria-label="帮助中心"
              onClick={() => setActiveTool((current) => (current === 'help' ? null : 'help'))}
            >
              帮助
            </button>
            {activeTool ? (
              <div className="topbar-popover topbar-tool-popover">
                {activeTool === 'notifications' ? (
                  <>
                    <strong>消息通知</strong>
                    {(notifications.length > 0 ? notifications : [{ id: 'local', message: runningNode ? `${runningNode.label} 正在执行` : '暂无新的任务告警', level: 'info' }]).map(
                      (item) => (
                        <span key={item.id}>{item.message}</span>
                      ),
                    )}
                  </>
                ) : (
                  <>
                    <strong>帮助中心</strong>
                    <button type="button" onClick={() => navigateTo('/workspace')}>
                      查看主流程
                    </button>
                    <button type="button" onClick={() => navigateTo('/workflow-designer')}>
                      查看工作流画布
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <div className="topbar-task-meta">
            <strong>{activeTask.name}</strong>
            <span>{activeTask.status}</span>
          </div>
        </header>
        <section className="dashboard-strip" aria-label="平台运行概览">
          <div className="metric-card metric-card-blue">
            <span>在线 Agent</span>
            <strong>{activeTask.snapshot.nodes.length}</strong>
          </div>
          <div className="metric-card metric-card-green">
            <span>已完成节点</span>
            <strong>{finishedNodes}</strong>
          </div>
          <div className="metric-card metric-card-amber">
            <span>当前节点</span>
            <strong>{runningNode?.label ?? '等待启动'}</strong>
          </div>
          <div className="metric-card metric-card-red">
            <span>风险提示</span>
            <strong>{activeTask.risks.length}</strong>
          </div>
        </section>
        <div className="quick-actions-bar" aria-label="快捷操作">
          <button
            className="action-button action-button-primary"
            type="button"
            aria-label="加载示例数据"
            onClick={() => emitWorkspaceAction('load-sample')}
          >
            加载示例数据
            <span className="shortcut-hint">Alt+S</span>
          </button>
          <button
            className="action-button secondary-button"
            type="button"
            aria-label="启动任务"
            onClick={() => emitWorkspaceAction('start')}
          >
            启动任务
            <span className="shortcut-hint">Alt+R</span>
          </button>
          <button
            className="action-button secondary-button"
            type="button"
            aria-label="导出结果"
            onClick={() => emitWorkspaceAction('focus-export')}
          >
            导出结果
            <span className="shortcut-hint">Alt+E</span>
          </button>
          <button
            className="panel-toggle-button"
            type="button"
            aria-expanded={!contextCollapsed}
            aria-controls="context-panel"
            onClick={() => setContextCollapsed((current) => !current)}
          >
            {contextCollapsed ? '展开上下文面板' : '收起上下文面板'}
          </button>
        </div>
        <div key={activePath}>{children}</div>
      </main>
      <ContextPanel
        collapsed={contextCollapsed}
        context={context}
        activeTask={activeTask}
        focusedNodeId={focusedNodeId}
        onToggle={() => setContextCollapsed((current) => !current)}
      />
    </div>
  );
}

export default AppShell;
