import { useEffect, useState } from 'react';

import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { WorkflowSnapshot } from '../mock/mockTaskEngine';
import type { DataSourceColumnRecord, ExportRecord, FieldMappingRecord, TaskDataSourceRecord } from '../types/tasks';
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
import { buildConfirmedCsvMappingContext, buildImportedDataContext, buildSampleDataContext } from './workspaceSampleData';
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

const START_BLOCKED_SUMMARY = '字段映射尚未确认，暂不能启动多 Agent 流程。';

export { DEFAULT_EXPORT_STATUS, DEFAULT_REQUEST, DEFAULT_SUMMARY, EMPTY_REQUEST };

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

function shouldBlockStart(dataSource?: TaskDataSourceRecord) {
  return dataSource?.kind === 'csv' && dataSource.fieldMappings.length === 0;
}

function getDataSourceValidationIssues(dataSource?: TaskDataSourceRecord) {
  if (!dataSource || dataSource.fieldMappings.length === 0) {
    return [];
  }

  const duplicateTargets = dataSource.fieldMappings
    .map((item) => item.target)
    .filter((target, index, targets) => targets.indexOf(target) !== index)
    .filter((target, index, targets) => targets.indexOf(target) === index);
  const issues = duplicateTargets.map((target) => `字段“${target}”被重复映射，请保持一列只对应一个业务字段。`);
  const mappedSalesColumn = dataSource.fieldMappings.find((item) => item.target === '销售额');
  const salesColumnType = dataSource.columns?.find((item) => item.name === mappedSalesColumn?.source)?.type;

  if (dataSource.columns?.length && (!mappedSalesColumn || salesColumnType !== 'number')) {
    issues.push('销售额字段缺少数值列映射，请将数值字段映射为“销售额”。');
  }

  return issues;
}

function getWorkflowValidationError(dataSource?: TaskDataSourceRecord) {
  if (!dataSource || dataSource.fieldMappings.length === 0) {
    return null;
  }

  const validationIssues = getDataSourceValidationIssues(dataSource);

  if (validationIssues.length > 0) {
    return validationIssues[0];
  }

  const targets = dataSource.fieldMappings.map((item) => item.target);

  if (!targets.includes('销售额')) {
    return '指标计算 Agent 缺少销售额字段映射，暂不能启动多 Agent 流程。';
  }

  if (!targets.includes('月份')) {
    return '数据清洗 Agent 缺少月份字段映射，暂不能启动多 Agent 流程。';
  }

  if (!targets.includes('区域')) {
    return '洞察分析 Agent 缺少区域字段映射，暂不能启动多 Agent 流程。';
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
  const [reportSummary, setReportSummary] = useState(activeTask.summary || DEFAULT_SUMMARY);
  const [exportStatus, setExportStatus] = useState(activeTask.exports[0]?.status ?? DEFAULT_EXPORT_STATUS);
  const [pendingDataSource, setPendingDataSource] = useState<TaskDataSourceRecord | undefined>(() => activeTask.dataSource);

  const updateTask = (update: SessionUpdate) => {
    const nextTask = runtime.updateActiveTask(update);
    setActiveTask(nextTask);

    return nextTask;
  };

  const syncTaskSession = (task: ReturnType<typeof runtime.getActiveTask>) => {
    setRequestDraft(getComposerValue(task.request));
    setSnapshot(task.snapshot);
    setReportSummary(task.summary || DEFAULT_SUMMARY);
    setExportStatus(task.exports[0]?.status ?? DEFAULT_EXPORT_STATUS);
    setPendingDataSource(task.dataSource);
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
    setActiveTask(runtime.updateActiveTask(buildActiveTaskSyncUpdate({ snapshot })));
  }, [runtime, setActiveTask, setContext, snapshot]);

  useEffect(() => {
    updateTask(buildActiveTaskSyncUpdate({ summary: reportSummary }));
  }, [reportSummary]);

  useEffect(() => {
    if (!shouldStartRunningTimer(snapshot.phase)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setSnapshot((current) => {
        if (!shouldStartRunningTimer(current.phase)) {
          return current;
        }

        const nextSnapshot = runtime.advance(current.nodes);
        updateTask(buildRunningTickUpdate(nextSnapshot));

        return nextSnapshot;
      });
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
      void fetch(`${apiBaseUrl}/api/active-task`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextAction.taskUpdate),
      }).then(() => {
        if (!nextAction.shouldSaveHistory) {
          return null;
        }

        return fetch(`${apiBaseUrl}/api/history/save-active-task`, {
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

    void fetch(`${apiBaseUrl}/api/active-task`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    }).then(() =>
      fetch(`${apiBaseUrl}/api/templates/save-active-task`, {
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
    if (shouldBlockStart(pendingDataSource)) {
      applyBlockedStart(START_BLOCKED_SUMMARY);
      return;
    }

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

  const handleLoadSampleData = () => {
    const nextSnapshot = {
      ...snapshot,
      context: buildSampleDataContext(snapshot.context),
    };

    updateSnapshot(nextSnapshot);
  };

  const handleImportCsvData = (
    fileName: string,
    columnCount: number,
    rowCount: number,
    columns: DataSourceColumnRecord[] = [],
  ) => {
    const nextSnapshot = {
      ...snapshot,
      context: buildImportedDataContext(snapshot.context, fileName, columnCount, rowCount),
    };

    const nextDataSource: TaskDataSourceRecord = {
      kind: 'csv',
      fileName,
      columnCount,
      rowCount,
      columns,
      fieldMappings: [],
    };

    setPendingDataSource(nextDataSource);
    updateTask({ dataSource: nextDataSource });
    updateSnapshot(nextSnapshot);
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
    handleExitReplay,
    handleExport,
    handleFail,
    handleConfirmCsvMapping,
    handleImportCsvData,
    handleLoadSampleData,
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
