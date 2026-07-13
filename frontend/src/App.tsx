import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import AppShell from './components/layout/AppShell';
import SmartEntryRedirect from './components/routing/SmartEntryRedirect';
import { WorkbenchShellContext } from './context/WorkbenchShellContext';
import ChatAnalysisPage from './pages/ChatAnalysisPage';
import DashboardPage from './pages/DashboardPage';
import DataSourcesPage from './pages/DataSourcesPage';
import HistoryPage from './pages/HistoryPage';
import LoginPage from './pages/LoginPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import TemplatesPage from './pages/TemplatesPage';
import WorkspacePage from './pages/WorkspacePage';
import { createEmptyTask } from './pages/emptyTask';
import { defaultWorkbenchContext } from './types/workbench';
import { getAuthSession, workspaceFetch, type AuthSession } from './utils/workspaceIdentity';

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = getAuthSession();
  if (!session) {
    return <Navigate replace to="/login" state={{ from: location.pathname }} />;
  }
  return children;
}

function App() {
  const [context, setContext] = useState(defaultWorkbenchContext);
  const [activeTask, setActiveTask] = useState(createEmptyTask);
  const [session, setSession] = useState<AuthSession | null>(() => getAuthSession());
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';

  useEffect(() => {
    const syncSession = () => setSession(getAuthSession());
    window.addEventListener('storage', syncSession);
    window.addEventListener('focus', syncSession);
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('focus', syncSession);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void workspaceFetch(`${apiBaseUrl}/api/tasks/active`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('active task unavailable'))))
      .then((task) => {
        if (cancelled) return;
        setActiveTask(task);
        if (task.snapshot?.context) setContext(task.snapshot.context);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, session?.accessToken]);

  return (
    <WorkbenchShellContext.Provider value={{ context, setContext, activeTask, setActiveTask }}>
      <Routes>
        <Route
          path="/login"
          element={
            session ? (
              <SmartEntryRedirect fallback="/dashboard" />
            ) : (
              <LoginPage onAuthenticated={() => setSession(getAuthSession())} />
            )
          }
        />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AppShell>
                <Routes>
                  <Route path="/" element={<SmartEntryRedirect fallback="/dashboard" />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/workspace" element={<WorkspacePage />} />
                  <Route path="/workspace/input" element={<Navigate replace to="/workspace?step=input" />} />
                  <Route path="/workspace/execution" element={<Navigate replace to="/workspace?step=execution" />} />
                  <Route path="/workspace/output" element={<Navigate replace to="/workspace?step=output" />} />
                  <Route path="/workspace-async" element={<Navigate replace to="/workspace?step=execution" />} />
                  <Route path="/data-sources" element={<DataSourcesPage />} />
                  <Route path="/chat-analysis" element={<ChatAnalysisPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/templates" element={<TemplatesPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/settings" element={<SettingsPage onLoggedOut={() => setSession(null)} />} />
                  <Route path="*" element={<Navigate replace to="/dashboard" />} />
                </Routes>
              </AppShell>
            </RequireAuth>
          }
        />
      </Routes>
    </WorkbenchShellContext.Provider>
  );
}

export default App;
