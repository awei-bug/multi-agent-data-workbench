import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import PageSkeleton from './components/feedback/PageSkeleton';
import AppShell from './components/layout/AppShell';
import RouteErrorBoundary from './components/routing/RouteErrorBoundary';
import SmartEntryRedirect from './components/routing/SmartEntryRedirect';
import { WorkbenchShellContext } from './context/WorkbenchShellContext';
import { createEmptyTask } from './pages/emptyTask';
// Keep the analysis shell eager: Vite HMR + optimized-deps 504 was taking down lazy WorkspacePage.
import WorkspacePage from './pages/WorkspacePage';
import { defaultWorkbenchContext } from './types/workbench';
import { AUTH_CHANGED_EVENT, getAuthSession, hydrateAuthSession, workspaceFetch, type AuthSession } from './utils/workspaceIdentity';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DataSourcesPage = lazy(() => import('./pages/DataSourcesPage'));
const ChatAnalysisPage = lazy(() => import('./pages/ChatAnalysisPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const PasswordResetPage = lazy(() => import('./pages/PasswordResetPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = getAuthSession();
  if (!session) {
    return <Navigate replace to="/login" state={{ from: location.pathname }} />;
  }
  return children;
}

function SuspendedPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <RouteErrorBoundary fallbackTitle={title}>
      <Suspense fallback={<PageSkeleton title={title} description={description} />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

function App() {
  const [context, setContext] = useState(defaultWorkbenchContext);
  const [activeTask, setActiveTask] = useState(createEmptyTask);
  const [session, setSession] = useState<AuthSession | null>(() => getAuthSession());
  const [authReady, setAuthReady] = useState(false);
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';

  useEffect(() => {
    let cancelled = false;
    void hydrateAuthSession(apiBaseUrl).then((next) => {
      if (cancelled) return;
      setSession(next);
      setAuthReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    const syncSession = () => setSession(getAuthSession());
    window.addEventListener('storage', syncSession);
    window.addEventListener('focus', syncSession);
    window.addEventListener(AUTH_CHANGED_EVENT, syncSession);
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('focus', syncSession);
      window.removeEventListener(AUTH_CHANGED_EVENT, syncSession);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const loadActiveTask = () => {
      void workspaceFetch(`${apiBaseUrl}/api/tasks/active`)
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('active task unavailable'))))
        .then((task) => {
          if (cancelled) return;
          setActiveTask((current) => ({
            ...current,
            ...task,
            dataSource: task.dataSource ?? current.dataSource,
            artifacts: task.artifacts ?? current.artifacts,
            exports: task.exports ?? current.exports,
            risks: task.risks ?? current.risks,
            executionLog: task.executionLog ?? current.executionLog,
            intent: task.intent ?? current.intent,
            snapshot: task.snapshot ?? current.snapshot,
            execution: task.execution ? { ...(current.execution || {}), ...task.execution } : current.execution,
          }));
          if (task.snapshot?.context) setContext(task.snapshot.context);
        })
        .catch(() => undefined);
    };

    loadActiveTask();
    // Keep chart/report pages in sync when workflow finishes in another tab/step.
    const onFocus = () => loadActiveTask();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadActiveTask();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    // Poll lightly while a workflow may still be producing chart artifacts.
    const timer = window.setInterval(loadActiveTask, 4000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [apiBaseUrl, session?.user.id]);

  // Warm secondary pages only. WorkspacePage is eagerly imported above.
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      void import('./pages/DataSourcesPage');
      void import('./pages/ChatAnalysisPage');
    }, 800);
    return () => window.clearTimeout(timer);
  }, [session?.user.id]);

  if (!authReady) {
    return <PageSkeleton title="正在恢复登录态" description="安全会话校验中…" />;
  }

  return (
    <WorkbenchShellContext.Provider value={{ context, setContext, activeTask, setActiveTask }}>
      <Routes>
        <Route
          path="/login"
          element={
            session ? (
              <SmartEntryRedirect fallback="/dashboard" />
            ) : (
              <SuspendedPage title="登录页加载中" description="正在准备安全登录界面…">
                <LoginPage onAuthenticated={() => setSession(getAuthSession())} />
              </SuspendedPage>
            )
          }
        />
        <Route
          path="/reset-password"
          element={
            <SuspendedPage title="重置密码加载中" description="正在准备密码重置界面…">
              <PasswordResetPage />
            </SuspendedPage>
          }
        />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AppShell>
                <Routes>
                  <Route path="/" element={<SmartEntryRedirect fallback="/dashboard" />} />
                  <Route
                    path="/dashboard"
                    element={
                      <SuspendedPage title="开始页加载中" description="正在准备你的下一步…">
                        <DashboardPage />
                      </SuspendedPage>
                    }
                  />
                  <Route
                    path="/workspace"
                    element={
                      <SuspendedPage title="分析页加载中" description="正在恢复分析步骤…">
                        <WorkspacePage />
                      </SuspendedPage>
                    }
                  />
                  <Route path="/workspace/input" element={<Navigate replace to="/workspace?step=input" />} />
                  <Route path="/workspace/execution" element={<Navigate replace to="/workspace?step=execution" />} />
                  <Route path="/workspace/output" element={<Navigate replace to="/workspace?step=output" />} />
                  <Route path="/workspace-async" element={<Navigate replace to="/workspace?step=execution" />} />
                  <Route
                    path="/data-sources"
                    element={
                      <SuspendedPage title="上传页加载中" description="正在读取已上传数据…">
                        <DataSourcesPage />
                      </SuspendedPage>
                    }
                  />
                  <Route
                    path="/chat-analysis"
                    element={
                      <SuspendedPage title="图表页加载中" description="正在准备图表与结论…">
                        <ChatAnalysisPage />
                      </SuspendedPage>
                    }
                  />
                  <Route
                    path="/history"
                    element={
                      <SuspendedPage title="历史任务加载中" description="正在读取可回放的分析任务…">
                        <HistoryPage />
                      </SuspendedPage>
                    }
                  />
                  <Route
                    path="/templates"
                    element={
                      <SuspendedPage title="模板库加载中" description="正在读取可复用的分析模板…">
                        <TemplatesPage />
                      </SuspendedPage>
                    }
                  />
                  <Route
                    path="/reports"
                    element={
                      <SuspendedPage title="报告中心加载中" description="正在整理可导出的分析报告…">
                        <ReportsPage />
                      </SuspendedPage>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <SuspendedPage title="系统设置加载中" description="正在读取工作空间与权限配置…">
                        <SettingsPage onLoggedOut={() => setSession(null)} />
                      </SuspendedPage>
                    }
                  />
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
