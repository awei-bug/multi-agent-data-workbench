import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { createEmptyTask } from '../../pages/emptyTask';
import type { TaskRecord } from '../../types/tasks';
import { resolveContinuePath } from '../../utils/continuePlan';
import { workspaceFetch } from '../../utils/workspaceIdentity';

type SmartEntryRedirectProps = {
  fallback?: string;
};

/**
 * After login (or visiting /), send the user to the page for
 * "what they should do next" based on the active task state.
 */
function SmartEntryRedirect({ fallback = '/dashboard' }: SmartEntryRedirectProps) {
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void workspaceFetch(`${apiBaseUrl}/api/tasks/active`)
      .then((response: Response) => (response.ok ? response.json() : createEmptyTask()))
      .then((task: TaskRecord) => {
        if (cancelled) return;
        setTarget(resolveContinuePath(task, fallback));
      })
      .catch(() => {
        if (!cancelled) setTarget(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, fallback]);

  if (!target) {
    return (
      <div className="smart-entry-loading" role="status" aria-live="polite">
        <div className="smart-entry-loading-card">
          <span className="smart-entry-spinner" aria-hidden="true" />
          <strong>正在定位你的下一步…</strong>
          <p>根据当前会话状态进入最合适的页面。</p>
        </div>
      </div>
    );
  }

  return <Navigate replace to={target} />;
}

export default SmartEntryRedirect;
