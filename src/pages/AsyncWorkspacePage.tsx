import { useEffect, useMemo, useState } from 'react';

import ChartBoard from '../components/charts/ChartBoard';
import DataSourceUploader from '../components/data/DataSourceUploader';
import EditableDataGrid from '../components/data/EditableDataGrid';
import ExportCenter from '../components/export/ExportCenter';
import IntentSummary from '../components/intent/IntentSummary';
import RequirementComposer from '../components/intent/RequirementComposer';
import ReportEditor from '../components/report/ReportEditor';
import ExecutionTimeline from '../components/workflow/ExecutionTimeline';
import WorkflowCanvas from '../components/workflow/WorkflowCanvas';
import { createMockTaskRepository } from '../mock/mockTaskRepository';
import type { WorkflowNode } from '../mock/mockTaskEngine';
import { createHttpWorkspaceSessionTransport } from '../server/httpWorkspaceSessionTransport';
import { createApiWorkspaceSessionRuntime } from './apiWorkspaceSessionRuntime';
import { buildSnapshotSessionState } from './workspaceSessionController';
import { buildRunningTickUpdate, shouldStartRunningTimer } from './workspaceSessionEffects';
import { useAsyncWorkspaceSession } from './useAsyncWorkspaceSession';
import {
  buildFailAction,
  buildPauseAction,
  buildResumeAction,
  buildRetryAction,
  buildRetryCurrentAction,
  buildStartAction,
  buildStopAction,
} from './workspaceWorkflowActions';

function AsyncWorkspacePage() {
  const runtime = useMemo(() => {
    const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;

    if (apiBaseUrl) {
      const transport = createHttpWorkspaceSessionTransport({ baseUrl: apiBaseUrl });

      return createApiWorkspaceSessionRuntime({
        transport: {
          ...transport,
          async parseIntent(request) {
            const response = await fetch(`${apiBaseUrl}/api/intent/parse`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ request }),
            });

            if (!response.ok) {
              throw new Error(`Intent parse failed: ${response.status}`);
            }

            return response.json();
          },
        },
      });
    }

    const repository = createMockTaskRepository();

    return createApiWorkspaceSessionRuntime({
      transport: {
        async getActiveTask() {
          return repository.getActiveTask();
        },
        async updateActiveTask(update) {
          return repository.updateActiveTask(update);
        },
        async resetActiveTask() {
          return repository.resetActiveTask();
        },
        async createTaskFromReplay() {
          return repository.createTaskFromReplay();
        },
        async saveActiveTaskToHistory() {
          return repository.saveActiveTaskToHistory();
        },
        async parseIntent(request) {
          return {
            request,
            goal: '模拟意图摘要',
            metrics: '销售额',
            dimensions: '月份、区域',
            charts: '趋势图',
          };
        },
      },
    });
  }, []);

  const session = useAsyncWorkspaceSession({ runtime });
  const [draftSummary, setDraftSummary] = useState('异步沙箱摘要');
  const snapshot = session.activeTask.snapshot;
  const runningNode = snapshot.nodes.find((node: WorkflowNode) => node.status === 'running') ?? null;

  const updateWorkflowSnapshot = async (
    nextAction: ReturnType<
      | typeof buildStartAction
      | typeof buildPauseAction
      | typeof buildResumeAction
      | typeof buildRetryAction
      | typeof buildFailAction
      | typeof buildRetryCurrentAction
      | typeof buildStopAction
    >,
  ) => {
    const nextState = buildSnapshotSessionState({
      activeStatus: session.activeTask.status,
      currentSummary: session.reportSummary,
      nextSnapshot: nextAction.snapshot,
      summaryEntry: nextAction.summaryEntry,
    });

    await session.updateActiveTask(nextState.taskUpdate);
  };

  const workflowAction = async (
    action: 'start' | 'pause' | 'resume' | 'retry' | 'fail' | 'retry_current' | 'stop',
    fallback: () => ReturnType<
      | typeof buildStartAction
      | typeof buildPauseAction
      | typeof buildResumeAction
      | typeof buildRetryAction
      | typeof buildFailAction
      | typeof buildRetryCurrentAction
      | typeof buildStopAction
    >,
  ) => {
    const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;

    if (!apiBaseUrl) {
      await updateWorkflowSnapshot(fallback());
      return;
    }

    const response = await fetch(`${apiBaseUrl}/api/workflow/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });

    if (!response.ok) {
      throw new Error(`Workflow action failed: ${response.status}`);
    }

    await session.updateActiveTask(await response.json());
  };

  const handleStart = async () => workflowAction('start', () => buildStartAction(runtime.start()));
  const handlePause = async () => workflowAction('pause', () => buildPauseAction(runtime.pause(snapshot)));
  const handleResume = async () => workflowAction('resume', () => buildResumeAction(runtime.resume(snapshot)));
  const handleRetry = async () => workflowAction('retry', () => buildRetryAction(runtime.restart()));
  const handleFail = async () => workflowAction('fail', () => buildFailAction(runtime.fail(snapshot)));
  const handleRetryCurrent = async () =>
    workflowAction('retry_current', () => buildRetryCurrentAction(runtime.retryCurrent(snapshot)));
  const handleStop = async () => workflowAction('stop', () => buildStopAction(runtime.stop(snapshot)));

  useEffect(() => {
    const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;

    if (apiBaseUrl) {
      if (!shouldStartRunningTimer(snapshot.phase)) {
        return undefined;
      }

      const timer = window.setInterval(() => {
        void fetch(`${apiBaseUrl}/api/workflow/advance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Workflow advance failed: ${response.status}`);
            }

            return response.json();
          })
          .then((task) => session.updateActiveTask(task));
      }, 1000);

      return () => {
        window.clearInterval(timer);
      };
    }

    if (!shouldStartRunningTimer(snapshot.phase)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      const currentSnapshot = session.activeTask.snapshot;

      if (!shouldStartRunningTimer(currentSnapshot.phase)) {
        return;
      }

      const nextSnapshot = runtime.advance(currentSnapshot.nodes);
      void session.updateActiveTask(buildRunningTickUpdate(nextSnapshot));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [runtime, session, snapshot.phase]);

  return (
    <div className="workspace-grid">
      <DataSourceUploader onLoadSampleData={() => void session.handleLoadSampleData()} />
      <section className="content-card workspace-section" aria-label="异步工作台沙箱">
        <div className="section-heading">
          <span className="section-index">AX</span>
          <div>
            <h3>异步工作台沙箱</h3>
            <p>验证异步工作台桥接、状态回填以及后续 API 接入边界。</p>
          </div>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span>桥接状态</span>
            <strong>{session.bridge.status}</strong>
          </div>
          <div className="summary-card">
            <span>当前任务</span>
            <strong>{session.activeTask.name}</strong>
          </div>
        </div>
        <div className="history-detail-block">
          <h4>桥接错误</h4>
          <p>{session.bridge.errorMessage ?? '无'}</p>
        </div>
        <label className="field-label" htmlFor="async-summary">
          异步摘要草稿
        </label>
        <input
          id="async-summary"
          className="text-input"
          value={draftSummary}
          onChange={(event) => setDraftSummary(event.target.value)}
        />
        <div className="actions-row">
          <button className="action-button" type="button" onClick={() => void session.loadActiveTask()}>
            加载当前任务
          </button>
          <button
            className="action-button secondary-button"
            type="button"
            onClick={() => void session.updateActiveTask({ summary: draftSummary })}
          >
            更新摘要
          </button>
          <button className="action-button secondary-button" type="button" onClick={() => void session.resetActiveTask()}>
            重置任务
          </button>
        </div>
        <div className="actions-row">
          <button className="action-button secondary-button" type="button" onClick={() => void session.createTaskFromReplay()}>
            基于回放新建
          </button>
          <button className="action-button secondary-button" type="button" onClick={() => void session.saveActiveTaskToHistory()}>
            保存到历史
          </button>
          <button className="action-button secondary-button" type="button" onClick={session.resetBridge}>
            重置桥接
          </button>
        </div>
      </section>

      <RequirementComposer initialValue={session.composerValue} onParse={(payload) => void session.handleParse(payload)} />
      <IntentSummary summary={session.parsedIntent} />
      <WorkflowCanvas nodes={snapshot.nodes} />
      <ExecutionTimeline
        runningLabel={runningNode?.label ?? null}
        phase={snapshot.phase}
        logMessage={snapshot.logMessage}
        onStart={() => void handleStart()}
        onPause={() => void handlePause()}
        onResume={() => void handleResume()}
        onRetry={() => void handleRetry()}
        onFail={() => void handleFail()}
        onRetryCurrent={() => void handleRetryCurrent()}
        onStop={() => void handleStop()}
      />
      <EditableDataGrid onApply={(value) => void session.handleManualRevision(value)} />
      <ChartBoard onTitleChange={(title) => void session.handleChartTitleChange(title)} />
      <ReportEditor summary={session.reportSummary} onSummaryChange={(summary) => void session.handleReportSummaryChange(summary)} />
      <ExportCenter status={session.exportStatus} onExport={(record) => void session.handleExport(record)} />

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">AY</span>
          <div>
            <h3>会话快照</h3>
            <p>观察异步动作完成后的会话摘要和导出状态。</p>
          </div>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span>报告摘要</span>
            <strong>{session.reportSummary}</strong>
          </div>
          <div className="summary-card">
            <span>导出状态</span>
            <strong>{session.exportStatus}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

export default AsyncWorkspacePage;
