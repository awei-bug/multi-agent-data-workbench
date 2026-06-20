import type { ReactNode } from 'react';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { useWorkbenchShell } from '../../context/WorkbenchShellContext';
import ContextPanel from './ContextPanel';

const routeMeta: Record<string, { label: string; crumb: string; title: string }> = {
  '/workspace': { label: '新建分析任务', crumb: '新建任务', title: '多 Agent 主流程' },
  '/data-sources': { label: '数据源管理', crumb: '数据接入', title: '数据源管理' },
  '/templates': { label: '模板库', crumb: '模板复用', title: '模板库' },
  '/workspace-async': { label: '异步工作台沙箱', crumb: '异步沙箱', title: '异步工作台沙箱' },
  '/history': { label: '历史任务', crumb: '历史回放', title: '历史任务' },
};

type AppShellProps = {
  children: ReactNode;
  focusedNodeId?: string | null;
};

function AppShell({ children, focusedNodeId = null }: AppShellProps) {
  const { context, activeTask } = useWorkbenchShell();
  const location = useLocation();
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const currentRoute = routeMeta[location.pathname] ?? routeMeta['/workspace'];

  return (
    <div className={`app-shell${contextCollapsed ? ' app-shell-context-collapsed' : ''}`}>
      <aside className="sidebar">
        <h1 className="app-title">多 Agent 数据分析工作台</h1>
        <nav className="sidebar-nav" aria-label="主导航">
          {Object.entries(routeMeta).map(([path, meta]) => (
            <NavLink
              key={path}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              reloadDocument
              to={path}
            >
              {meta.label}
            </NavLink>
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
          <div className="topbar-task-meta">
            <strong>{activeTask.name}</strong>
            <span>{activeTask.status}</span>
          </div>
        </header>
        <div className="quick-actions-bar" aria-label="快捷操作">
          <button className="action-button" type="button">
            加载示例数据
            <span className="shortcut-hint">Alt+S</span>
          </button>
          <button className="action-button secondary-button" type="button">
            启动任务
            <span className="shortcut-hint">Alt+R</span>
          </button>
          <button className="action-button secondary-button" type="button">
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
        <div key={location.pathname}>{children}</div>
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
