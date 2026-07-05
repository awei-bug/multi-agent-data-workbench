import type { ReactNode } from 'react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useWorkbenchShell } from '../../context/WorkbenchShellContext';
import ContextPanel from './ContextPanel';

const routeMeta: Record<string, { icon: string; label: string; crumb: string; title: string }> = {
  '/workspace': { icon: '01', label: '智能体工作台', crumb: '新建任务', title: '多 Agent 主流程' },
  '/data-sources': { icon: '02', label: '数据集管理', crumb: '数据接入', title: '数据源管理' },
  '/templates': { icon: '03', label: '模板库', crumb: '模板复用', title: '模板库' },
  '/workspace-async': { icon: '04', label: '工作流沙箱', crumb: '异步沙箱', title: '异步工作台沙箱' },
  '/history': { icon: '05', label: '历史会话', crumb: '历史回放', title: '历史任务' },
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
  const activePath = routePath ?? location.pathname;
  const currentRoute = routeMeta[activePath] ?? routeMeta['/workspace'];
  const finishedNodes = activeTask.snapshot.nodes.filter((node) => node.status === 'success').length;
  const runningNode = activeTask.snapshot.nodes.find((node) => node.status === 'running');

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
              <input type="search" placeholder="搜索任务、数据集、报告" />
            </label>
            <button className="tool-button" type="button" aria-label="消息通知">
              通知
            </button>
            <button className="tool-button" type="button" aria-label="帮助中心">
              帮助
            </button>
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
