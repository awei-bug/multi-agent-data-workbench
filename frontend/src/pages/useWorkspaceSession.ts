import { useEffect, useRef, useState } from 'react';

import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { WorkflowSnapshot } from '../mock/mockTaskEngine';
import type {
  DataSourceColumnRecord,
  ExportRecord,
  FieldMappingRecord,
  TaskDataSourceRecord,
  TaskRecord,
} from '../types/tasks';
import { DEFAULT_EXPORT_STATUS, DEFAULT_REQUEST, DEFAULT_SUMMARY, EMPTY_REQUEST } from './workspaceSessionCopy';
import {
  buildChartTitleAction,
  buildConfirmCsvMappingAction,
  buildExportAction,
  buildManualRevisionAction,
  buildParseAction,
  buildReplayAction,
} from './workspaceSessionActions';
import { buildSnapshotSessionState, getComposerValue } from './workspaceSessionController';
import { buildActiveTaskSyncUpdate, buildRunningTickUpdate, shouldStartRunningTimer } from './workspaceSessionEffects';
import {
  buildConfirmedCsvMappingContext,
  buildImportedDataContext,
} from './workspaceSampleData';
import { createWorkspaceSessionRuntime } from './workspaceSessionRuntime';
import {
  buildFailAction,
  buildPauseAction,
  buildResumeAction,
  buildRetryAction,
  buildRetryCurrentAction,
  buildStartAction,
  buildStopAction,
} from './workspaceWorkflowActions';
import { type SessionUpdate } from './workspaceSessionState';
import { workspaceFetch } from '../utils/workspaceIdentity';

export type ParsedIntent = {
  request: string;
  goal: string;
  metrics: string;
  dimensions: string;
  charts: string;
} | null;

type UseWorkspaceSessionOptions = {
  runtime?: ReturnType<typeof createWorkspaceSessionRuntime>;
};

export { DEFAULT_EXPORT_STATUS, DEFAULT_REQUEST, DEFAULT_SUMMARY, EMPTY_REQUEST };

function isStructuredDataSource(dataSource?: TaskDataSourceRecord) {
  return !!dataSource && dataSource.kind !== 'document';
}

function parseMappingSummary(mappingSummary: string): FieldMappingRecord[] {
  const content = mappingSummary.includes('：') ? mappingSummary.split('：').slice(1).join('：') : mappingSummary;

  return content
    .split('，')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [source, target] = item.split('->').map((part) => part.trim());
      return source && target ? { source, target } : null;
    })
    .filter((item): item is FieldMappingRecord => item !== null);
}

function deriveIntentDefaults(dataSource?: TaskDataSourceRecord) {
  if (dataSource?.kind === 'document') {
    return {
      metrics: '关键结论、风险、行动项',
      dimensions: '章节、主题、时间',
    };
  }

  if (!dataSource || dataSource.fieldMappings.length === 0) {
    return {
      metrics: '同比、环比、区域对比',
      dimensions: '月份、区域、渠道',
    };
  }

  const metricTargets = dataSource.fieldMappings
    .filter((item) => /(指标|数值|金额|销售|订单)/.test(item.target))
    .map((item) => item.target);
  const dimensionTargets = dataSource.fieldMappings
    .filter((item) => !metricTargets.includes(item.target))
    .map((item) => item.target);

  return {
    metrics: metricTargets.length > 0 ? metricTargets.join('、') : '同比、环比、区域对比',
    dimensions: dimensionTargets.length > 0 ? dimensionTargets.join('、') : '月份、区域、渠道',
  };
}

function withDefaultFieldMappings(dataSource?: TaskDataSourceRecord) {
  if (!dataSource || !isStructuredDataSource(dataSource) || dataSource.fieldMappings.length > 0) {
    return dataSource;
  }

  return {
    ...dataSource,
    fieldMappings: (dataSource.columns ?? []).map((column) => ({ source: column.name, target: column.name })),
  };
}

function getDataSourceValidationIssues(dataSource?: TaskDataSourceRecord) {
  if (!isStructuredDataSource(dataSource)) {
    return [];
  }

  if (!dataSource || dataSource.fieldMappings.length === 0) {
    return [];
  }

  const duplicateTargets = dataSource.fieldMappings
    .map((item) => item.target)
    .filter((target, index, targets) => targets.indexOf(target) !== index)
    .filter((target, index, targets) => targets.indexOf(target) === index);
  const issues = duplicateTargets.map((target) => `字段“${target}”被重复映射，请保持一列只对应一个业务字段。`);
  return issues;
}

function getWorkflowValidationError(dataSource?: TaskDataSourceRecord) {
  if (!isStructuredDataSource(dataSource)) {
    return null;
  }

  if (!dataSource || dataSource.fieldMappings.length === 0) {
    return null;
  }

  const validationIssues = getDataSourceValidationIssues(dataSource);

  if (validationIssues.length > 0) {
    return validationIssues[0];
  }

  return null;
}

function prependRisk(currentRisks: string[], risk: string) {
  return [risk, ...currentRisks.filter((item) => item !== risk)];
}

export function useWorkspaceSession(options: UseWorkspaceSessionOptions = {}) {
  const runtime = options.runtime ?? createWorkspaceSessionRuntime();
  const { activeTask, setContext, setActiveTask } = useWorkbenchShell();
  const [parsedIntent, setParsedIntent] = useState<ParsedIntent>(null);
  const [requestDraft, setRequestDraft] = useState(() => getComposerValue(activeTask.request));
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>(() => activeTask.snapshot);
  const latestSnapshotRef = useRef(snapshot);
  const latestTaskRef = useRef<TaskRecord>(activeTask);
  const [reportSummary, setReportSummary] = useState(activeTask.summary || DEFAULT_SUMMARY);
  const [exportStatus, setExportStatus] = useState(activeTask.exports[0]?.status ?? DEFAULT_EXPORT_STATUS);
  const [pendingDataSource, setPendingDataSource] = useState<TaskDataSourceRecord | undefined>(() => withDefaultFieldMappings(activeTask.dataSource));

  const updateTask = (update: SessionUpdate) => {
    const current = latestTaskRef.current;
    const nextTask = {
      ...current,
      ...update,
      exports: update.exports ?? current.exports,
      risks: update.risks ?? current.risks,
      snapshot: update.snapshot ?? current.snapshot,
      dataSource: update.dataSource ?? current.dataSource,
    };

    latestTaskRef.current = nextTask;
    setActiveTask(nextTask);
    return nextTask;
  };

  const syncTaskSession = (task: ReturnType<typeof runtime.getActiveTask>) => {
    setRequestDraft(getComposerValue(task.request));
    setSnapshot(task.snapshot);
    setReportSummary(task.summary || DEFAULT_SUMMARY);
    setExportStatus(task.exports[0]?.status ?? DEFAULT_EXPORT_STATUS);
    setPendingDataSource(withDefaultFieldMappings(task.dataSource));
    setActiveTask(task);
  };

  const updateSnapshot = (nextSnapshot: WorkflowSnapshot, summaryEntry?: string) => {
    setSnapshot(nextSnapshot);

    const nextState = buildSnapshotSessionState({
      activeStatus: activeTask.status,
      currentSummary: reportSummary || DEFAULT_SUMMARY,
      nextSnapshot,
      summaryEntry,
    });

    if (summaryEntry) {
      setReportSummary(nextState.nextSummary);
    }

    updateTask(nextState.taskUpdate);
  };

  useEffect(() => {
    setContext(snapshot.context);
    latestSnapshotRef.current = snapshot;
  }, [setContext, snapshot]);

  useEffect(() => {
    latestTaskRef.current = activeTask;
    setRequestDraft(getComposerValue(activeTask.request));
    setSnapshot(activeTask.snapshot);
    setReportSummary(activeTask.summary || DEFAULT_SUMMARY);
    setExportStatus(activeTask.exports[0]?.status ?? DEFAULT_EXPORT_STATUS);
    setPendingDataSource(withDefaultFieldMappings(activeTask.dataSource));
  }, [activeTask.id, activeTask.name, activeTask.status]);

  useEffect(() => {
    updateTask(buildActiveTaskSyncUpdate({ summary: reportSummary }));
  }, [reportSummary]);

  useEffect(() => {
    if (!shouldStartRunningTimer(snapshot.phase)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      const current = latestSnapshotRef.current;

      if (!shouldStartRunningTimer(current.phase)) {
        return;
      }

      const nextSnapshot = runtime.advance(current.nodes);

      latestSnapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      updateTask(buildRunningTickUpdate(nextSnapshot));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [runtime, snapshot.phase]);

  const handleParse = async (nextIntent: ParsedIntent) => {
    setParsedIntent(nextIntent);

    if (!nextIntent) {
      return;
    }

    const resolvedIntent = (await runtime.parseIntent?.(nextIntent.request)) ?? nextIntent;
    const nextAction = buildParseAction(resolvedIntent);
    setParsedIntent(nextAction.parsedIntent);
    setRequestDraft(resolvedIntent.request);
    setReportSummary(nextAction.summary);
    updateTask(nextAction.taskUpdate);
  };

  const handleExitReplay = () => {
    setParsedIntent(buildReplayAction().parsedIntent);
    syncTaskSession(runtime.resetActiveTask());
  };

  const handleCreateFromReplay = () => {
    setParsedIntent(buildReplayAction().parsedIntent);
    syncTaskSession(runtime.createTaskFromReplay());
  };

  const handleCreateFromTemplate = (template: { name: string; request: string; summary: string }) => {
    setParsedIntent(null);
    syncTaskSession(runtime.createTaskFromTemplate(template));
  };

  const handleLoadHistoryTask = (taskId: string) => {
    const task = runtime.loadTaskIntoWorkspace(taskId);
    if (task) {
      setParsedIntent(buildReplayAction().parsedIntent);
      syncTaskSession(task);
    }
  };

  const handleReportSummaryChange = (summary: string) => {
    setReportSummary(summary);
    updateTask({ summary });
  };

  const handleManualRevision = (value: string) => {
    setReportSummary((current) => buildManualRevisionAction(current || DEFAULT_SUMMARY, value));
  };

  const handleChartTitleChange = (title: string) => {
    setReportSummary((current) => buildChartTitleAction(current || DEFAULT_SUMMARY, title));
  };

  const handleExport = (record: ExportRecord) => {
    const nextAction = buildExportAction({
      mode: activeTask.mode,
      activeExports: activeTask.exports,
      record,
      reportSummary,
    });

    setExportStatus(nextAction.exportStatus);
    updateTask(nextAction.taskUpdate);

    const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;

    if (apiBaseUrl) {
      void workspaceFetch(`${apiBaseUrl}/api/active-task`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextAction.taskUpdate),
      }).then(() => {
        if (!nextAction.shouldSaveHistory) {
          return null;
        }

        return workspaceFetch(`${apiBaseUrl}/api/history/save-active-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      });
      return;
    }

    if (nextAction.shouldSaveHistory) {
      runtime.saveActiveTaskToHistory();
    }
  };

  const handleSaveTemplate = () => {
    const draft = {
      name: requestDraft,
      request: requestDraft,
      summary: reportSummary,
    };
    const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;

    if (!apiBaseUrl) {
      runtime.saveActiveTaskAsTemplate(draft);
      return;
    }

    void workspaceFetch(`${apiBaseUrl}/api/active-task`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    }).then(() =>
      workspaceFetch(`${apiBaseUrl}/api/templates/save-active-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      }),
    );
  };

  const handleRequestDraftChange = (value: string) => {
    setRequestDraft(value);
  };

  const applyBlockedStart = (message: string) => {
    const nextRisks = prependRisk(snapshot.context.risks, message);
    const nextSnapshot = {
      ...snapshot,
      logMessage: message,
      context: {
        ...snapshot.context,
        latestLog: message,
        risks: nextRisks,
      },
    };

    setReportSummary((current) => buildConfirmCsvMappingAction(current || DEFAULT_SUMMARY, message));
    setSnapshot(nextSnapshot);
    setContext(nextSnapshot.context);
    updateTask({
      snapshot: nextSnapshot,
      risks: nextRisks,
    });
  };

  const handleStart = () => {
    const validationError = getWorkflowValidationError(pendingDataSource);

    if (validationError) {
      applyBlockedStart(validationError);
      return;
    }

    const nextAction = buildStartAction(runtime.start());
    updateSnapshot(nextAction.snapshot, nextAction.summaryEntry);
  };

  const handlePause = () => {
    const nextAction = buildPauseAction(runtime.pause(snapshot));
    updateSnapshot(nextAction.snapshot, nextAction.summaryEntry);
  };

  const handleResume = () => {
    const nextAction = buildResumeAction(runtime.resume(snapshot));
    updateSnapshot(nextAction.snapshot, nextAction.summaryEntry);
  };

  const handleRetry = () => {
    const nextAction = buildRetryAction(runtime.restart());
    updateSnapshot(nextAction.snapshot, nextAction.summaryEntry);
  };

  const handleFail = () => {
    const nextAction = buildFailAction(runtime.fail(snapshot));
    updateSnapshot(nextAction.snapshot, nextAction.summaryEntry);
  };

  const handleRetryCurrent = () => {
    const nextAction = buildRetryCurrentAction(runtime.retryCurrent(snapshot));
    updateSnapshot(nextAction.snapshot, nextAction.summaryEntry);
  };

  const handleStop = () => {
    const nextAction = buildStopAction(runtime.stop(snapshot));
    updateSnapshot(nextAction.snapshot, nextAction.summaryEntry);
  };

  const handleImportDataSource = (dataSource: TaskDataSourceRecord) => {
    const mappedDataSource = withDefaultFieldMappings(dataSource) ?? dataSource;
    const nextSnapshot = {
      ...snapshot,
      context: buildImportedDataContext(snapshot.context, mappedDataSource),
    };

    setPendingDataSource(mappedDataSource);
    updateTask({ dataSource: mappedDataSource });
    updateSnapshot(nextSnapshot);

    const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;
    if (apiBaseUrl) {
      void workspaceFetch(`${apiBaseUrl}/api/active-task`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataSource: mappedDataSource, snapshot: nextSnapshot }),
      });
    }
  };

  const handleImportCsvData = (
    fileName: string,
    columnCount: number,
    rowCount: number,
    columns: DataSourceColumnRecord[] = [],
  ) => {
    handleImportDataSource({
      kind: 'csv',
      formatLabel: 'CSV',
      fileName,
      columnCount,
      rowCount,
      columns,
      previewRows: [],
      analysisRows: [],
      textPreview: '',
      fieldMappings: [],
    });
  };

  const handleConfirmCsvMapping = (mappingSummary: string) => {
    const nextSnapshot = {
      ...snapshot,
      context: buildConfirmedCsvMappingContext(snapshot.context, mappingSummary),
    };

    const nextSummary = buildConfirmCsvMappingAction(reportSummary || DEFAULT_SUMMARY, mappingSummary);
    const nextDataSource = pendingDataSource
      ? {
          ...pendingDataSource,
          fieldMappings: parseMappingSummary(mappingSummary),
        }
      : undefined;

    if (nextDataSource) {
      nextDataSource.validationIssues = getDataSourceValidationIssues(nextDataSource);
      setPendingDataSource(nextDataSource);
      updateTask({ dataSource: nextDataSource });

      const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;
      if (apiBaseUrl) {
        void workspaceFetch(`${apiBaseUrl}/api/active-task`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataSource: nextDataSource, snapshot: nextSnapshot }),
        });
      }
    }

    setReportSummary(nextSummary);
    updateSnapshot(nextSnapshot, mappingSummary);
  };

  const runningNode = snapshot.nodes.find((node) => node.status === 'running') ?? null;
  const composerValue = requestDraft;
  const intentDefaults = deriveIntentDefaults(pendingDataSource);

  return {
    activeTask,
    composerValue,
    exportStatus,
    parsedIntent,
    reportSummary,
    runningNode,
    snapshot,
    intentDefaults,
    handleChartTitleChange,
    handleCreateFromReplay,
    handleCreateFromTemplate,
    handleExitReplay,
    handleExport,
    handleFail,
    handleConfirmCsvMapping,
    handleImportDataSource,
    handleImportCsvData,
    handleLoadHistoryTask,
    handleManualRevision,
    handleParse,
    handlePause,
    handleReportSummaryChange,
    handleRequestDraftChange,
    handleResume,
    handleRetry,
    handleRetryCurrent,
    handleSaveTemplate,
    handleStart,
    handleStop,
  };
}
