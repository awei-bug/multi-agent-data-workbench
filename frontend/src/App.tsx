import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import AppShell from './components/layout/AppShell';
import { WorkbenchShellContext } from './context/WorkbenchShellContext';
import { createMockTaskRepository } from './mock/mockTaskRepository';
import AsyncWorkspacePage from './pages/AsyncWorkspacePage';
import DataSourcesPage from './pages/DataSourcesPage';
import HistoryPage from './pages/HistoryPage';
import TemplatesPage from './pages/TemplatesPage';
import WorkspacePage from './pages/WorkspacePage';
import { defaultWorkbenchContext } from './types/workbench';

const repository = createMockTaskRepository();

function normalizePath(pathname: string) {
  return pathname === '/' ? '/workspace' : pathname;
}

function App() {
  const routerLocation = useLocation();
  const [context, setContext] = useState(defaultWorkbenchContext);
  const [activeTask, setActiveTask] = useState(repository.getActiveTask());
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [routePath, setRoutePath] = useState(() => normalizePath(routerLocation.pathname));

  useEffect(() => {
    const syncRoute = () => setRoutePath(normalizePath(window.location.pathname));
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(...args) {
      originalPushState.apply(this, args);
      syncRoute();
    };
    window.history.replaceState = function replaceState(...args) {
      originalReplaceState.apply(this, args);
      syncRoute();
    };

    window.addEventListener('popstate', syncRoute);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  useEffect(() => {
    const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;

    if (!apiBaseUrl) {
      return;
    }

    let cancelled = false;

    const loadActiveTask = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/active-task`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Active task fetch failed: ${response.status}`);
        }

        const task = await response.json();

        if (cancelled) {
          return;
        }

        setActiveTask(task);
        if (task.snapshot?.context) {
          setContext(task.snapshot.context);
        }
      } catch {
      }
    };

    void loadActiveTask();

    return () => {
      cancelled = true;
    };
  }, []);

  const page =
    routePath === '/data-sources' ? (
      <DataSourcesPage />
    ) : routePath === '/templates' ? (
      <TemplatesPage />
    ) : routePath === '/workspace-async' ? (
      <AsyncWorkspacePage />
    ) : routePath === '/history' ? (
      <HistoryPage />
    ) : (
      <WorkspacePage onFocusedNodeChange={setFocusedNodeId} />
    );

  return (
    <WorkbenchShellContext.Provider value={{ context, setContext, activeTask, setActiveTask }}>
      <AppShell focusedNodeId={focusedNodeId} routePath={routePath} onRouteChange={setRoutePath}>
        {page}
      </AppShell>
    </WorkbenchShellContext.Provider>
  );
}

export default App;
