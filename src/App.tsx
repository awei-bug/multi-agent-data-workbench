import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

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

function App() {
  const [context, setContext] = useState(defaultWorkbenchContext);
  const [activeTask, setActiveTask] = useState(repository.getActiveTask());
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

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

  return (
    <WorkbenchShellContext.Provider value={{ context, setContext, activeTask, setActiveTask }}>
      <AppShell focusedNodeId={focusedNodeId}>
        <Routes>
          <Route path="/" element={<Navigate to="/workspace" replace />} />
          <Route path="/workspace" element={<WorkspacePage onFocusedNodeChange={setFocusedNodeId} />} />
          <Route path="/data-sources" element={<DataSourcesPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/workspace-async" element={<AsyncWorkspacePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<Navigate to="/workspace" replace />} />
        </Routes>
      </AppShell>
    </WorkbenchShellContext.Provider>
  );
}

export default App;
